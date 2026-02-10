use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tantivy::collector::TopDocs;
use tantivy::query::{QueryParser, TermQuery};
use tantivy::schema::*;
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, TantivyError, Term};

pub struct IndexManager {
    index: Index,
    writer: Arc<Mutex<IndexWriter>>,
    reader: IndexReader,
}

#[derive(Clone, serde::Serialize)]
pub struct SearchResult {
    pub path: String,
    pub score: f32,
    pub name: String,
    pub extension: Option<String>,
    pub parent_path: String,
    pub size_bytes: i64,
    pub modified_at: i64,
}

impl IndexManager {
    pub fn new<P: AsRef<Path>>(index_path: P) -> Result<Self, TantivyError> {
        let index_path = index_path.as_ref();
        if !index_path.exists() {
            fs::create_dir_all(index_path).map_err(|e| TantivyError::SystemError(e.to_string()))?;
        }

        let mut schema_builder = Schema::builder();
        schema_builder.add_text_field("path", TEXT | STORED);
        schema_builder.add_text_field("name", TEXT | STORED);
        schema_builder.add_text_field("extension", STRING | STORED);
        schema_builder.add_text_field("parent_path", STRING | STORED);
        schema_builder.add_i64_field("size_bytes", INDEXED | STORED | FAST);
        schema_builder.add_i64_field("modified_at", INDEXED | STORED | FAST);
        // unique key for updates/deletes, not analyzed
        schema_builder.add_text_field("path_raw", STRING | STORED);

        let schema = schema_builder.build();

        // Use open_in_dir in 0.22, or builder
        let index = Index::open_in_dir(&index_path)
            .or_else(|_| Index::create_in_dir(&index_path, schema.clone()))?;

        // 50MB buffer
        let writer = index.writer(50_000_000)?;
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual) // Manual control
            .try_into()?;

        Ok(Self {
            index,
            writer: Arc::new(Mutex::new(writer)),
            reader,
        })
    }

    pub fn add_or_update_file(
        &self,
        path: &str,
        name: &str,
        extension: Option<&str>,
        parent_path: &str,
        size_bytes: i64,
        modified_at: i64,
    ) -> Result<(), TantivyError> {
        let schema = self.index.schema();
        let path_field = schema.get_field("path").unwrap();
        let name_field = schema.get_field("name").unwrap();
        let extension_field = schema.get_field("extension").unwrap();
        let parent_path_field = schema.get_field("parent_path").unwrap();
        let size_bytes_field = schema.get_field("size_bytes").unwrap();
        let modified_at_field = schema.get_field("modified_at").unwrap();
        let path_raw_field = schema.get_field("path_raw").unwrap();

        let mut doc = TantivyDocument::default();
        doc.add_text(path_field, path);
        doc.add_text(name_field, name);
        if let Some(ext) = extension {
            doc.add_text(extension_field, ext);
        }
        doc.add_text(parent_path_field, parent_path);
        doc.add_i64(size_bytes_field, size_bytes);
        doc.add_i64(modified_at_field, modified_at);
        doc.add_text(path_raw_field, path);

        let mut writer = self.writer.lock().unwrap();

        // Delete existing document with this path
        let term = Term::from_field_text(path_raw_field, path);
        writer.delete_term(term);

        writer.add_document(doc)?;

        // For real-time updates, we commit. In high-load, this should be batched.
        writer.commit()?;

        // Reload reader to make changes visible immediately
        self.reader.reload()?;

        Ok(())
    }

    pub fn remove_file(&self, path: &str) -> Result<(), TantivyError> {
        let schema = self.index.schema();
        let path_raw_field = schema.get_field("path_raw").unwrap();

        let mut writer = self.writer.lock().unwrap();
        let term = Term::from_field_text(path_raw_field, path);
        writer.delete_term(term);
        writer.commit()?;
        self.reader.reload()?;

        Ok(())
    }

    pub fn commit(&self) -> Result<(), TantivyError> {
        let mut writer = self.writer.lock().unwrap();
        writer.commit()?;
        self.reader.reload()?;
        Ok(())
    }

    pub fn rebuild_index(&self, db_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open(db_path)?;
        let mut stmt = conn.prepare(
            "SELECT path, name, extension, parent_path, size_bytes, modified_at FROM files",
        )?;

        let file_iter = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, Option<i64>>(5)?,
            ))
        })?;

        {
            let mut writer = self.writer.lock().unwrap();
            writer.delete_all_documents()?;

            let schema = self.index.schema();
            let path_field = schema.get_field("path").unwrap();
            let name_field = schema.get_field("name").unwrap();
            let extension_field = schema.get_field("extension").unwrap();
            let parent_path_field = schema.get_field("parent_path").unwrap();
            let size_bytes_field = schema.get_field("size_bytes").unwrap();
            let modified_at_field = schema.get_field("modified_at").unwrap();
            let path_raw_field = schema.get_field("path_raw").unwrap();

            for file_res in file_iter {
                if let Ok((path, name, ext, parent, size, mod_at)) = file_res {
                    let mut doc = TantivyDocument::default();
                    doc.add_text(path_field, &path);
                    doc.add_text(name_field, &name);
                    if let Some(e) = ext {
                        doc.add_text(extension_field, &e);
                    }
                    doc.add_text(parent_path_field, &parent);
                    doc.add_i64(size_bytes_field, size);
                    doc.add_i64(modified_at_field, mod_at.unwrap_or(0));
                    doc.add_text(path_raw_field, &path);

                    writer.add_document(doc)?;
                }
            }
            writer.commit()?;
        }
        self.reader
            .reload()
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

        Ok(())
    }

    pub fn search(&self, query_str: &str, limit: usize) -> Result<Vec<SearchResult>, TantivyError> {
        let searcher = self.reader.searcher();
        let schema = self.index.schema();
        let path_field = schema.get_field("path").unwrap();
        let name_field = schema.get_field("name").unwrap();
        let extension_field = schema.get_field("extension").unwrap();
        let parent_path_field = schema.get_field("parent_path").unwrap();
        let size_bytes_field = schema.get_field("size_bytes").unwrap();
        let modified_at_field = schema.get_field("modified_at").unwrap();

        // Basic query parsing
        // We might want to use a more complex parser if 'query_str' contains field queries logic
        // But `QueryParser` handles field:value syntax automatically if fields are registered.
        // We should register all fields we want to be searchable via "field:val" syntax.
        let mut query_parser = QueryParser::for_index(&self.index, vec![name_field, path_field]);
        query_parser.set_field_fuzzy(name_field, true, 2, true); // Fuzzy search on name

        // Define fields that can be searched explicitly
        // invalid fields in query throws error.

        if query_str.trim().is_empty() {
            return Ok(vec![]);
        }

        let query = query_parser.parse_query(query_str)?;
        let top_docs = searcher.search(&query, &TopDocs::with_limit(limit))?;

        let mut results = Vec::new();
        for (score, doc_address) in top_docs {
            let retrieved_doc: TantivyDocument = searcher.doc(doc_address)?;

            let path = retrieved_doc
                .get_first(path_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let name = retrieved_doc
                .get_first(name_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let extension = retrieved_doc
                .get_first(extension_field)
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let parent_path = retrieved_doc
                .get_first(parent_path_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let size_bytes = retrieved_doc
                .get_first(size_bytes_field)
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            let modified_at = retrieved_doc
                .get_first(modified_at_field)
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            results.push(SearchResult {
                path,
                score,
                name,
                extension,
                parent_path,
                size_bytes,
                modified_at,
            });
        }

        Ok(results)
    }
}
