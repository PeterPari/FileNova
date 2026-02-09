use std::sync::Arc;

use arrow_array::{
    Array, FixedSizeListArray, Float32Array, Int32Array, Int64Array,
    RecordBatch, RecordBatchIterator, StringArray,
};
use arrow_schema::{DataType, Field, Schema};
use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use tokio::sync::Mutex as TokioMutex;

use crate::embeddings::EmbeddingChunk;

pub struct VectorStore {
    db: lancedb::Connection,
    table: TokioMutex<Option<lancedb::Table>>,
}

#[derive(Clone, serde::Serialize)]
pub struct VectorSearchResult {
    pub file_id: i64,
    pub file_path: String,
    pub chunk_text: String,
    pub chunk_index: u32,
    pub distance: f32,
}

impl VectorStore {
    pub async fn new(db_path: &str) -> Result<Self, String> {
        let db = lancedb::connect(db_path)
            .execute()
            .await
            .map_err(|e| format!("Failed to connect to LanceDB: {}", e))?;

        Ok(Self {
            db,
            table: TokioMutex::new(None),
        })
    }

    fn build_schema(dimensions: usize) -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new("file_id", DataType::Int64, false),
            Field::new("file_path", DataType::Utf8, false),
            Field::new("chunk_index", DataType::Int32, false),
            Field::new("chunk_text", DataType::Utf8, false),
            Field::new(
                "vector",
                DataType::FixedSizeList(
                    Arc::new(Field::new("item", DataType::Float32, true)),
                    dimensions as i32,
                ),
                false,
            ),
        ]))
    }

    async fn ensure_table(&self, dimensions: usize) -> Result<lancedb::Table, String> {
        let mut guard = self.table.lock().await;

        if let Some(ref table) = *guard {
            // Check if dimensions match. If not, we might need to recreate.
            // Simplified check: assume if we have a table handle in memory it's correct for this session?
            // No, user might change settings. 
            // Real check would be inspecting table schema.
            // For now, let's just proceed. If schema mismatch, insert will fail.
             return Ok(table.clone());
        }

        // Try opening existing table
        let existing = self.db.open_table("embeddings").execute().await;
        
        match existing {
            Ok(table) => {
                // Check schema dimensions
                let schema = table.schema().await.map_err(|e| format!("Failed to get schema: {}", e))?;
                let mut valid = false;

                if let Some(field) = schema.field_with_name("vector").ok() {
                    if let DataType::FixedSizeList(_, size) = field.data_type() {
                        if *size == dimensions as i32 {
                            valid = true;
                        }
                    }
                }

                if valid {
                    *guard = Some(table.clone());
                    return Ok(table);
                } else {
                    // Mismatch or invalid columns
                    self.db.drop_table("embeddings", &Vec::<String>::new()).await.map_err(|e| format!("Failed to drop invalid table: {}", e))?;
                }
            }
            Err(_) => {
                // Table doesn't exist, create it
            }
        }

        let schema = Self::build_schema(dimensions);
        let table = self
            .db
            .create_empty_table("embeddings", schema)
            .execute()
            .await
            .map_err(|e| format!("Failed to create embeddings table: {}", e))?;

        *guard = Some(table.clone());
        Ok(table)
    }

    pub async fn upsert_file_embeddings(
        &self,
        chunks: Vec<EmbeddingChunk>,
        dimensions: usize,
    ) -> Result<(), String> {
        if chunks.is_empty() {
            return Ok(());
        }

        let table = self.ensure_table(dimensions).await?;
        let file_id = chunks[0].file_id;

        // Delete existing embeddings for this file
        let _ = table
            .delete(&format!("file_id = {}", file_id))
            .await;

        let schema = Self::build_schema(dimensions);
        let n = chunks.len();

        // Build arrays
        let file_ids: Vec<i64> = chunks.iter().map(|c| c.file_id).collect();
        let file_paths: Vec<&str> = chunks.iter().map(|c| c.file_path.as_str()).collect();
        let chunk_indices: Vec<i32> = chunks.iter().map(|c| c.chunk_index as i32).collect();
        let chunk_texts: Vec<&str> = chunks.iter().map(|c| c.chunk_text.as_str()).collect();

        // Build the vector column as FixedSizeList<Float32>
        let mut flat_values: Vec<f32> = Vec::with_capacity(n * dimensions);
        for chunk in &chunks {
            if chunk.embedding.len() != dimensions {
                return Err(format!(
                    "Embedding dimension mismatch: expected {}, got {}",
                    dimensions,
                    chunk.embedding.len()
                ));
            }
            flat_values.extend_from_slice(&chunk.embedding);
        }

        let values_array = Float32Array::from(flat_values);
        let field = Arc::new(Field::new("item", DataType::Float32, true));
        let vector_array = FixedSizeListArray::try_new(
            field,
            dimensions as i32,
            Arc::new(values_array),
            None,
        )
        .map_err(|e| format!("Failed to build vector array: {}", e))?;

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(file_ids)),
                Arc::new(StringArray::from(file_paths)),
                Arc::new(Int32Array::from(chunk_indices)),
                Arc::new(StringArray::from(chunk_texts)),
                Arc::new(vector_array) as Arc<dyn Array>,
            ],
        )
        .map_err(|e| format!("Failed to create RecordBatch: {}", e))?;

        let batches = RecordBatchIterator::new(vec![Ok(batch)], schema);

        table
            .add(Box::new(batches))
            .execute()
            .await
            .map_err(|e| format!("Failed to add embeddings: {}", e))?;

        Ok(())
    }

    // Note: remove_file_embeddings needs dimensions just to get the table handle
    // We can either pass it or try to open "embeddings" blindly. 
    // Since we delete by file_id, we can probably just open the table directly.
    pub async fn remove_file_embeddings(&self, file_id: i64) -> Result<(), String> {
        // Blindly try to open table. if it doesn't exist, nothing to delete.
         let existing = self.db.open_table("embeddings").execute().await;
         if let Ok(table) = existing {
             table
            .delete(&format!("file_id = {}", file_id))
            .await
            .map_err(|e| format!("Failed to delete embeddings: {}", e))?;
         }
        Ok(())
    }

    pub async fn search(
        &self,
        query_vector: &[f32],
        limit: usize,
    ) -> Result<Vec<VectorSearchResult>, String> {
        let dimensions = query_vector.len();
        let table = self.ensure_table(dimensions).await?;

        let results = table
            .vector_search(query_vector)
            .map_err(|e| format!("Failed to create vector search: {}", e))?
            .limit(limit)
            .execute()
            .await
            .map_err(|e| format!("Failed to execute vector search: {}", e))?;

        let batches: Vec<RecordBatch> = results
            .try_collect()
            .await
            .map_err(|e| format!("Failed to collect search results: {}", e))?;

        let mut search_results = Vec::new();

        for batch in &batches {
            let file_ids = batch
                .column_by_name("file_id")
                .and_then(|c| c.as_any().downcast_ref::<Int64Array>())
                .ok_or("Missing file_id column")?;

            let file_paths = batch
                .column_by_name("file_path")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                .ok_or("Missing file_path column")?;

            let chunk_texts = batch
                .column_by_name("chunk_text")
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
                .ok_or("Missing chunk_text column")?;

            let chunk_indices = batch
                .column_by_name("chunk_index")
                .and_then(|c| c.as_any().downcast_ref::<Int32Array>())
                .ok_or("Missing chunk_index column")?;

            let distances = batch
                .column_by_name("_distance")
                .and_then(|c| c.as_any().downcast_ref::<Float32Array>())
                .ok_or("Missing _distance column")?;

            for i in 0..batch.num_rows() {
                search_results.push(VectorSearchResult {
                    file_id: file_ids.value(i),
                    file_path: file_paths.value(i).to_string(),
                    chunk_text: chunk_texts.value(i).to_string(),
                    chunk_index: chunk_indices.value(i) as u32,
                    distance: distances.value(i),
                });
            }
        }

        Ok(search_results)
    }

    pub async fn create_index(&self) -> Result<(), String> {
        // Blindly open.
         let existing = self.db.open_table("embeddings").execute().await;
         let table = match existing {
             Ok(t) => t,
             Err(_) => return Ok(()),
         };

        // Only create index if we have enough rows (ANN index needs sufficient data)
        let count = table
            .count_rows(None)
            .await
            .map_err(|e| format!("Failed to count rows: {}", e))?;

        if count < 256 {
            return Ok(()); // Too few rows for an effective index
        }

        table
            .create_index(&["vector"], lancedb::index::Index::Auto)
            .execute()
            .await
            .map_err(|e| format!("Failed to create vector index: {}", e))?;

        Ok(())
    }
}
