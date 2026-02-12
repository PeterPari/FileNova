use blake3::Hasher;
use crate::long_path::safe_path;
use rayon::prelude::*;
use rusqlite::{params, Connection};
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::SystemTime;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

#[derive(Clone, serde::Serialize)]
pub struct IndexStatus {
    pub total_files: u64,
    pub processed_files: u64,
    pub current_path: String,
    pub is_indexing: bool,
    pub percentage_complete: f64,
    pub estimated_time_remaining_secs: u64,
}

#[derive(Clone)]
pub struct IndexerState {
    pub is_indexing: Arc<AtomicBool>,
    pub is_paused: Arc<AtomicBool>,
    pub total_files: Arc<AtomicU64>,
    pub processed_files: Arc<AtomicU64>,
    pub current_path: Arc<Mutex<String>>,
    pub start_time_ms: Arc<AtomicU64>,
    pub last_emit_ms: Arc<AtomicU64>,
}

impl IndexerState {
    pub fn new() -> Self {
        Self {
            is_indexing: Arc::new(AtomicBool::new(false)),
            is_paused: Arc::new(AtomicBool::new(false)),
            total_files: Arc::new(AtomicU64::new(0)),
            processed_files: Arc::new(AtomicU64::new(0)),
            current_path: Arc::new(Mutex::new(String::new())),
            start_time_ms: Arc::new(AtomicU64::new(0)),
            last_emit_ms: Arc::new(AtomicU64::new(0)),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn percentage_complete(processed: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        (processed as f64 / total as f64) * 100.0
    }
}

fn estimate_remaining_secs(processed: u64, total: u64, start_time_ms: u64) -> u64 {
    if processed == 0 || total <= processed || start_time_ms == 0 {
        return 0;
    }

    let elapsed_ms = now_ms().saturating_sub(start_time_ms);
    if elapsed_ms < 1000 {
        return 0;
    }

    let elapsed_secs = elapsed_ms as f64 / 1000.0;
    let rate = processed as f64 / elapsed_secs;
    if rate <= 0.0 {
        return 0;
    }

    let remaining = (total - processed) as f64 / rate;
    remaining.max(0.0).round() as u64
}

pub fn build_status(state: &IndexerState) -> IndexStatus {
    let total = state.total_files.load(Ordering::Relaxed);
    let processed = state.processed_files.load(Ordering::Relaxed);
    let start_time_ms = state.start_time_ms.load(Ordering::Relaxed);
    IndexStatus {
        total_files: total,
        processed_files: processed,
        current_path: state.current_path.lock().unwrap().clone(),
        is_indexing: state.is_indexing.load(Ordering::Relaxed),
        percentage_complete: percentage_complete(processed, total),
        estimated_time_remaining_secs: estimate_remaining_secs(processed, total, start_time_ms),
    }
}

fn is_hidden_path(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if name.starts_with('.') {
            return true;
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if let Ok(metadata) = fs::metadata(safe_path(path)) {
            const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
            const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
            let attrs = metadata.file_attributes();
            return (attrs & FILE_ATTRIBUTE_HIDDEN) != 0 || (attrs & FILE_ATTRIBUTE_SYSTEM) != 0;
        }
    }

    false
}

fn hash_file(path: &Path) -> Option<String> {
    let file = File::open(safe_path(path)).ok()?;
    let mut reader = BufReader::new(file);
    let mut hasher = Hasher::new();
    let mut buffer = [0; 8192];

    while let Ok(n) = reader.read(&mut buffer) {
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    Some(hasher.finalize().to_hex().to_string())
}

pub fn start_indexing(app: AppHandle, paths: Vec<String>, state: IndexerState) {
    if state.is_indexing.swap(true, Ordering::SeqCst) {
        return; // Already indexing
    }
    state.is_paused.store(false, Ordering::SeqCst);
    state.total_files.store(0, Ordering::SeqCst);
    state.processed_files.store(0, Ordering::SeqCst);
    state.start_time_ms.store(now_ms(), Ordering::SeqCst);
    state.last_emit_ms.store(0, Ordering::SeqCst);

    std::thread::spawn(move || {
        let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
        let mut conn = Connection::open(&db_path).expect("Failed to open DB in worker");

        // Optimizations
        let _ = conn.execute("PRAGMA journal_mode = WAL;", []);
        let _ = conn.execute("PRAGMA synchronous = NORMAL;", []);

        for root_path in paths {
            if !state.is_indexing.load(Ordering::SeqCst) {
                break;
            }

            let walker = WalkDir::new(&root_path).follow_links(false).into_iter();

            // Collect files first (chunking strategy could be better but this is simple start)
            // For 1M+ files, we should stream, but for "parallel processing", collecting chunks is easier
            // Let's stream and collect in chunks of 1000

            let mut chunk = Vec::new();

            for entry in walker.filter_map(|e| e.ok()) {
                if !state.is_indexing.load(Ordering::SeqCst) {
                    break;
                } // Stop signal

                // Pause logic
                while state.is_paused.load(Ordering::SeqCst) {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    if !state.is_indexing.load(Ordering::SeqCst) {
                        break;
                    }
                }

                if entry.file_type().is_symlink() {
                    continue;
                }

                let path = entry.path().to_owned();
                if is_hidden_path(&path) {
                    continue;
                }

                if !path.is_file() {
                    continue;
                }

                state.total_files.fetch_add(1, Ordering::SeqCst);
                *state.current_path.lock().unwrap() = path.to_string_lossy().to_string();

                if event_emit_throttled(&app, &state) {
                    // Emit event handled inside
                }

                chunk.push(path);

                if chunk.len() >= 1000 {
                    process_chunk(&mut conn, &chunk);
                    state
                        .processed_files
                        .fetch_add(chunk.len() as u64, Ordering::SeqCst);
                    chunk.clear();
                }
            }
            // Process remaining
            if !chunk.is_empty() {
                process_chunk(&mut conn, &chunk);
                state
                    .processed_files
                    .fetch_add(chunk.len() as u64, Ordering::SeqCst);
            }
        }

        state.is_indexing.store(false, Ordering::SeqCst);
        let _ = app.emit("indexing-finished", ());
    });
}

fn process_chunk(conn: &mut Connection, paths: &[PathBuf]) {
    // Rayon distinct parallel hashing (blake3 + perceptual for images)
    let results: Vec<_> = paths
        .par_iter()
        .map(|path| {
            let metadata = fs::metadata(safe_path(path)).ok()?;
            let size = metadata.len();

            let should_hash = size < 500 * 1024 * 1024; // 500MB limit
            let hash = if should_hash { hash_file(path) } else { None };

            // Perceptual hash for image files (< 100MB)
            let phash = if crate::duplicates::is_image_file(path) && size < 100 * 1024 * 1024 {
                crate::duplicates::compute_perceptual_hash(path)
            } else {
                None
            };

            Some((path, metadata, hash, phash))
        })
        .collect();

    let tx = conn.transaction().unwrap();
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO files (path, name, extension, size_bytes, created_at, modified_at, accessed_at, parent_path, hash_blake3, perceptual_hash, is_directory, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(path) DO UPDATE SET
                size_bytes=excluded.size_bytes,
                modified_at=excluded.modified_at,
                hash_blake3=excluded.hash_blake3,
                perceptual_hash=excluded.perceptual_hash,
                indexed_at=excluded.indexed_at"
        ).unwrap();

        for res in results {
            if let Some((path, metadata, hash, phash)) = res {
                let name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let extension = path.extension().map(|e| e.to_string_lossy().to_string());
                let parent = path
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                // Timestamps
                let created = metadata
                    .created()
                    .ok()
                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs());
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs());
                let accessed = metadata
                    .accessed()
                    .ok()
                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs());
                let now = SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();

                let _ = stmt.execute(params![
                    path.to_string_lossy().to_string(),
                    name,
                    extension,
                    metadata.len(),
                    created,
                    modified,
                    accessed,
                    parent,
                    hash,
                    phash,
                    false, // is_directory = false (since we filtered for files)
                    now
                ]);
            }
        }
    }
    tx.commit().unwrap();
}

// Simple throttle helper
fn event_emit_throttled(app: &AppHandle, state: &IndexerState) -> bool {
    let now = now_ms();
    let last = state.last_emit_ms.load(Ordering::Relaxed);
    if now.saturating_sub(last) < 100 {
        return false;
    }

    state.last_emit_ms.store(now, Ordering::Relaxed);
    let status = build_status(state);
    app.emit("indexing-progress", status).is_ok()
}
