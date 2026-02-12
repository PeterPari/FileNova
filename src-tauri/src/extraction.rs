use crate::long_path::safe_path;
use rayon::prelude::*;
use rusqlite::{params, params_from_iter, Connection};
use std::fs;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::embeddings::{self, EmbeddingChunk, EmbeddingConfig};
use crate::vector_store::VectorStore;

#[derive(Clone, serde::Serialize)]
pub struct ExtractionStatus {
    pub is_extracting: bool,
    pub is_paused: bool,
    pub total_files: u64,
    pub processed_files: u64,
    pub failed_files: u64,
    pub current_file: String,
}

#[derive(Clone)]
pub struct ExtractionState {
    pub is_extracting: Arc<AtomicBool>,
    pub is_paused: Arc<AtomicBool>,
    pub total_files: Arc<AtomicU64>,
    pub processed_files: Arc<AtomicU64>,
    pub failed_files: Arc<AtomicU64>,
    pub current_file: Arc<Mutex<String>>,
}

impl ExtractionState {
    pub fn new() -> Self {
        Self {
            is_extracting: Arc::new(AtomicBool::new(false)),
            is_paused: Arc::new(AtomicBool::new(false)),
            total_files: Arc::new(AtomicU64::new(0)),
            processed_files: Arc::new(AtomicU64::new(0)),
            failed_files: Arc::new(AtomicU64::new(0)),
            current_file: Arc::new(Mutex::new(String::new())),
        }
    }
}

pub fn get_extraction_status(state: &ExtractionState) -> ExtractionStatus {
    ExtractionStatus {
        is_extracting: state.is_extracting.load(Ordering::Relaxed),
        is_paused: state.is_paused.load(Ordering::Relaxed),
        total_files: state.total_files.load(Ordering::Relaxed),
        processed_files: state.processed_files.load(Ordering::Relaxed),
        failed_files: state.failed_files.load(Ordering::Relaxed),
        current_file: state.current_file.lock().unwrap().clone(),
    }
}

struct FileToProcess {
    id: i64,
    path: String,
    extension: Option<String>,
    extracted_text: Option<String>, // Already extracted but needs embedding
}

pub fn start_extraction(
    app: AppHandle,
    state: ExtractionState,
    vector_store: Arc<VectorStore>,
    file_ids: Option<Vec<i64>>,
) {
    if state.is_extracting.swap(true, Ordering::SeqCst) {
        // If already running, ensure it's not paused? Or just let it be?
        // Let's unpause if start is called again, or just return.
        // If user clicks start while paused, maybe we should resume?
        // For now, standard behavior: if running, do nothing. User should use resume.
        return;
    }
    state.is_paused.store(false, Ordering::SeqCst);
    state.total_files.store(0, Ordering::SeqCst);
    state.processed_files.store(0, Ordering::SeqCst);
    state.failed_files.store(0, Ordering::SeqCst);

    std::thread::spawn(move || {
        let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
        let mut conn = Connection::open(&db_path).expect("Failed to open DB for extraction");

        // Fetch files needing extraction OR embedding
        let files: Vec<FileToProcess> = {
            let base_sql = "SELECT id, path, extension, extracted_text FROM files\
                 WHERE is_directory = 0\
                   AND (extraction_completed = FALSE\
                        OR (extraction_completed = TRUE AND embedding_generated = FALSE AND extracted_text IS NOT NULL))";

            let (sql, params): (String, Vec<i64>) = if let Some(ids) = file_ids.clone() {
                if !ids.is_empty() {
                    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                    (
                        format!("{} AND id IN ({}) ORDER BY size_bytes ASC", base_sql, placeholders),
                        ids,
                    )
                } else {
                    (format!("{} ORDER BY size_bytes ASC", base_sql), vec![])
                }
            } else {
                (format!("{} ORDER BY size_bytes ASC", base_sql), vec![])
            };

            let mut stmt = conn.prepare(&sql).expect("Failed to prepare extraction query");

            let mapper = |row: &rusqlite::Row| -> rusqlite::Result<FileToProcess> {
                Ok(FileToProcess {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    extension: row.get(2)?,
                    extracted_text: row.get(3)?,
                })
            };

            let collected: Vec<FileToProcess> = if params.is_empty() {
                stmt.query_map([], mapper)
                    .expect("Failed to query files")
                    .filter_map(|r| r.ok())
                    .collect()
            } else {
                stmt.query_map(params_from_iter(params), mapper)
                    .expect("Failed to query files")
                    .filter_map(|r| r.ok())
                    .collect()
            };

            collected
        };

        let total = files.len() as u64;
        state.total_files.store(total, Ordering::SeqCst);

        if total == 0 {
            state.is_extracting.store(false, Ordering::SeqCst);
            let _ = app.emit("extraction-finished", ());
            return;
        }

        // Load embedding config
        let config = EmbeddingConfig::from_settings(&conn);
        let client = reqwest::Client::new();

        // Process in batches of 100
        for batch in files.chunks(100) {
            // Check stop signal
            if !state.is_extracting.load(Ordering::SeqCst) {
                break;
            }

            // Check pause signal
            while state.is_paused.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(500));
                // If stopped while paused
                if !state.is_extracting.load(Ordering::SeqCst) {
                    break;
                }
            }
            if !state.is_extracting.load(Ordering::SeqCst) {
                break;
            }

            // Phase 1: Extract text (parallel with rayon) for files that need it
            let extraction_results: Vec<(i64, String, Result<String, String>)> = batch
                .par_iter()
                .filter(|f| f.extracted_text.is_none())
                .map(|f| {
                    let ext = f.extension.as_deref().unwrap_or("");
                    let result = extract_text(Path::new(&f.path), ext);
                    (f.id, f.path.clone(), result)
                })
                .collect();

            // Save extracted text to SQLite
            {
                let tx = conn.transaction().expect("Failed to begin transaction");
                for (file_id, _path, result) in &extraction_results {
                    match result {
                        Ok(text) => {
                            let _ = tx.execute(
                                "UPDATE files SET extracted_text = ?1, content_extracted = TRUE, extraction_completed = TRUE, extraction_error = NULL WHERE id = ?2",
                                params![text, file_id],
                            );
                        }
                        Err(err) => {
                            let _ = tx.execute(
                                "UPDATE files SET content_extracted = TRUE, extraction_completed = TRUE, extraction_error = ?1 WHERE id = ?2",
                                params![err, file_id],
                            );
                        }
                    }
                }
                tx.commit().expect("Failed to commit extraction results");
            }

            // Count failures from this batch
            let batch_failures = extraction_results
                .iter()
                .filter(|(_, _, r)| r.is_err())
                .count() as u64;
            state
                .failed_files
                .fetch_add(batch_failures, Ordering::SeqCst);

            // Phase 2: Generate embeddings for all files in batch that have text
            for f in batch {
                if !state.is_extracting.load(Ordering::SeqCst) {
                    break;
                }
                // Check pause inside inner loop too for better responsiveness
                while state.is_paused.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if !state.is_extracting.load(Ordering::SeqCst) {
                        break;
                    }
                }

                *state.current_file.lock().unwrap() = f.path.clone();

                // Get text: either just extracted or previously extracted
                let text = if let Some(ref existing) = f.extracted_text {
                    Some(existing.clone())
                } else {
                    extraction_results
                        .iter()
                        .find(|(id, _, _)| *id == f.id)
                        .and_then(|(_, _, r)| r.as_ref().ok().cloned())
                };

                if let Some(text) = text {
                    if !text.is_empty() {
                        // Chunk and embed
                        let chunks = embeddings::chunk_text_with_offsets(
                            &text,
                            config.chunk_size,
                            config.chunk_overlap,
                        );
                        let mut embedding_chunks = Vec::new();
                        let mut embed_ok = true;

                        for (i, (chunk_text, char_offset)) in chunks.iter().enumerate() {
                            let embed_result = tauri::async_runtime::block_on(
                                embeddings::generate_embedding(&client, &config, chunk_text),
                            );

                            match embed_result {
                                Ok(vector) => {
                                    embedding_chunks.push(EmbeddingChunk {
                                        file_id: f.id,
                                        file_path: f.path.clone(),
                                        chunk_index: i as u32,
                                        chunk_text: chunk_text.clone(),
                                        char_offset: *char_offset,
                                        embedding: vector,
                                    });
                                }
                                Err(_) => {
                                    // Ollama not available, skip embedding for now
                                    embed_ok = false;
                                    break;
                                }
                            }
                        }

                        if embed_ok && !embedding_chunks.is_empty() {
                            let store_result = tauri::async_runtime::block_on(
                                vector_store
                                    .upsert_file_embeddings(embedding_chunks, config.dimensions),
                            );

                            if store_result.is_ok() {
                                let _ = conn.execute(
                                    "UPDATE files SET embedding_generated = TRUE WHERE id = ?1",
                                    params![f.id],
                                );
                            }
                        }
                    } else {
                        // Empty text, mark as embedded (nothing to embed)
                        let _ = conn.execute(
                            "UPDATE files SET embedding_generated = TRUE WHERE id = ?1",
                            params![f.id],
                        );
                    }
                }

                state.processed_files.fetch_add(1, Ordering::SeqCst);

                // Emit progress
                let status = get_extraction_status(&state);
                let _ = app.emit("extraction-progress", status);
            }
        }

        // Rebuild vector index after bulk inserts
        let _ = tauri::async_runtime::block_on(vector_store.create_index());

        state.is_extracting.store(false, Ordering::SeqCst);
        let _ = app.emit("extraction-finished", ());
    });
}

fn extract_text(path: &Path, extension: &str) -> Result<String, String> {
    match extension.to_lowercase().as_str() {
        "pdf" => extract_pdf(path),
        "docx" => extract_docx(path),
        "txt" | "md" | "csv" | "log" | "ini" | "cfg" | "env" | "gitignore" => {
            extract_plaintext(path)
        }
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "java" | "c" | "cpp" | "h" | "hpp" | "html"
        | "css" | "scss" | "json" | "toml" | "yaml" | "yml" | "xml" | "sql" | "sh" | "bat"
        | "ps1" | "rb" | "go" | "swift" | "kt" | "php" => extract_plaintext(path),
        "jpg" | "jpeg" | "png" | "tiff" | "tif" | "heif" | "webp" => extract_exif(path),
        _ => Err("Unsupported file type".into()),
    }
}

fn extract_pdf(path: &Path) -> Result<String, String> {
    // Skip files larger than 50MB
    let metadata = fs::metadata(safe_path(path)).map_err(|e| e.to_string())?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("PDF too large (>50MB)".into());
    }

    let bytes = fs::read(safe_path(path)).map_err(|e| e.to_string())?;
    let text = pdf_extract::extract_text_from_mem(&bytes).map_err(|e| e.to_string())?;

    // Truncate to 100k chars
    Ok(truncate_text(&text, 100_000))
}

fn extract_docx(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(safe_path(path)).map_err(|e| e.to_string())?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("DOCX too large (>50MB)".into());
    }

    let bytes = fs::read(safe_path(path)).map_err(|e| e.to_string())?;
    let docx = docx_rs::read_docx(&bytes).map_err(|e| e.to_string())?;

    let mut text = String::new();
    for child in docx.document.children {
        if let docx_rs::DocumentChild::Paragraph(para) = child {
            for child in &para.children {
                if let docx_rs::ParagraphChild::Run(run) = child {
                    for child in &run.children {
                        if let docx_rs::RunChild::Text(t) = child {
                            text.push_str(&t.text);
                        }
                    }
                }
            }
            text.push('\n');
        }
    }

    Ok(truncate_text(&text, 100_000))
}

fn extract_plaintext(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(safe_path(path)).map_err(|e| e.to_string())?;
    let size = metadata.len();

    // Cap at 1MB
    if size > 1024 * 1024 {
        // Read only first 1MB
        use std::io::Read;
        let file = fs::File::open(safe_path(path)).map_err(|e| e.to_string())?;
        let mut reader = std::io::BufReader::new(file);
        let mut buf = vec![0u8; 1024 * 1024];
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        buf.truncate(n);
        String::from_utf8(buf).map_err(|_| "Not valid UTF-8".into())
    } else {
        fs::read_to_string(safe_path(path)).map_err(|e| e.to_string())
    }
}

fn extract_exif(path: &Path) -> Result<String, String> {
    let file = fs::File::open(safe_path(path)).map_err(|e| e.to_string())?;
    let mut bufreader = std::io::BufReader::new(file);
    let exifreader = exif::Reader::new();
    let exif_data = exifreader
        .read_from_container(&mut bufreader)
        .map_err(|e| e.to_string())?;

    let mut parts = Vec::new();
    for field in exif_data.fields() {
        let tag_name = format!("{}", field.tag);
        let value = field.display_value().with_unit(&exif_data).to_string();
        parts.push(format!("{}: {}", tag_name, value));
    }

    if parts.is_empty() {
        return Err("No EXIF data found".into());
    }

    Ok(parts.join("\n"))
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    if text.len() <= max_chars {
        text.to_string()
    } else {
        text.chars().take(max_chars).collect()
    }
}
