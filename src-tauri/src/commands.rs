use crate::db::{get_setting, save_setting};
use crate::duplicates::{self, DuplicateScanState, DuplicateScanStatus};
use crate::embeddings::EmbeddingConfig;
use crate::extraction::{self, ExtractionState, ExtractionStatus};
use crate::indexer::{start_indexing as run_indexing, IndexStatus, IndexerState};
use crate::search_index::{IndexManager, SearchResult};
use crate::semantic_search::HybridSearchResult;
use crate::tagging::{self, Tag}; // Stage 6
use crate::vector_store::VectorStore;
use crate::watcher::start_watcher;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchFilters {
    pub file_types: Option<Vec<String>>,
    // Add other filters as needed later
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified_at: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub created_at: Option<u64>,
    pub modified_at: Option<u64>,
    pub accessed_at: Option<u64>,
    pub readonly: bool,
}

#[tauri::command]
pub fn start_indexing(app: AppHandle, paths: Vec<String>, state: State<IndexerState>) {
    // Save paths to settings
    if let Ok(paths_json) = serde_json::to_string(&paths) {
        let _ = save_app_setting(app.clone(), "indexed_paths".to_string(), paths_json);
    }

    let paths_clone = paths.clone();
    run_indexing(app.clone(), paths, state.inner().clone());
    start_watcher(app, paths_clone);
}

#[tauri::command]
pub fn pause_indexing(state: State<IndexerState>) {
    state.is_paused.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn resume_indexing(state: State<IndexerState>) {
    state.is_paused.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn get_index_status(state: State<IndexerState>) -> IndexStatus {
    IndexStatus {
        total_files: state.total_files.load(Ordering::Relaxed),
        processed_files: state.processed_files.load(Ordering::Relaxed),
        current_path: state.current_path.lock().unwrap().clone(),
        is_indexing: state.is_indexing.load(Ordering::Relaxed),
    }
}

#[tauri::command]
pub fn get_app_setting(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_app_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    save_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_directory(path: &str) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut files = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let path = entry.path();

        let modified_at = metadata
            .modified()
            .unwrap_or(UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        files.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            is_directory: metadata.is_dir(),
            size: metadata.len(),
            modified_at,
        });
    }

    // Sort: Directories first, then files
    files.sort_by(|a, b| {
        if a.is_directory == b.is_directory {
            a.name.cmp(&b.name)
        } else if a.is_directory {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    Ok(files)
}

#[tauri::command]
pub fn get_file_info(path: &str) -> Result<FileInfo, String> {
    let path_obj = Path::new(path);
    let metadata = fs::metadata(path_obj).map_err(|e| e.to_string())?;

    let created_at = metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    let accessed_at = metadata
        .accessed()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    Ok(FileInfo {
        name: path_obj
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        path: path.to_string(),
        is_directory: metadata.is_dir(),
        size: metadata.len(),
        created_at,
        modified_at,
        accessed_at,
        readonly: metadata.permissions().readonly(),
    })
}

use regex::Regex;

fn parse_size(size_str: &str) -> Option<u64> {
    let re = Regex::new(r"(?i)^([\d\.]+)(b|kb|mb|gb|tb)?$").ok()?;
    let caps = re.captures(size_str)?;
    let val: f64 = caps[1].parse().ok()?;
    let unit = caps
        .get(2)
        .map(|m| m.as_str().to_lowercase())
        .unwrap_or("b".to_string());

    let multiplier = match unit.as_str() {
        "kb" => 1024.0,
        "mb" => 1024.0 * 1024.0,
        "gb" => 1024.0 * 1024.0 * 1024.0,
        "tb" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };

    Some((val * multiplier) as u64)
}

use chrono::{Duration, Local, NaiveDate, NaiveDateTime, NaiveTime};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchHistoryEntry {
    pub id: i64,
    pub query: String,
    pub search_type: String,
    pub result_count: i64,
    pub searched_at: i64,
}

#[tauri::command]
pub fn get_search_history(app: AppHandle, limit: usize) -> Result<Vec<SearchHistoryEntry>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, query, search_type, result_count, searched_at 
             FROM search_history 
             ORDER BY searched_at DESC 
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let history = stmt
        .query_map([limit], |row| {
             let searched_at: String = row.get(4)?;
             // Convert string datetime to unix timestamp (approximated for display sorting if needed, or pass string)
             // Actually, DB stores DATETIME as string usually in sqlite unless integer mode.
             // `current_timestamp` or `datetime('now')` is string.
             // We can return string or parse.
             // Let's parse to i64 for frontend consistency if possible, or just string.
             // Front end expects number? Let's check.
             // `SearchResult` has `modified_at` as i64 (seconds).
             // SQLite `DATETIME` is string "YYYY-MM-DD HH:MM:SS".
             
             let dt_str: String = row.get(4)?;
             let dt = NaiveDateTime::parse_from_str(&dt_str, "%Y-%m-%d %H:%M:%S")
                .unwrap_or_default()
                .and_utc()
                .timestamp();

            Ok(SearchHistoryEntry {
                id: row.get(0)?,
                query: row.get(1)?,
                search_type: row.get(2)?,
                result_count: row.get::<_, i64>(3).unwrap_or(0),
                searched_at: dt,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for entry in history {
        if let Ok(e) = entry {
            result.push(e);
        }
    }
    Ok(result)
}

fn parse_date_query(val: &str) -> Option<String> {
    let now = Local::now();
    let today_start = now.date_naive().and_time(NaiveTime::MIN).and_local_timezone(Local).unwrap().timestamp();
    let today_end = now.date_naive().and_time(NaiveTime::from_hms_milli_opt(23, 59, 59, 999).unwrap()).and_local_timezone(Local).unwrap().timestamp();

    match val.to_lowercase().as_str() {
        "today" => Some(format!("modified_at:[{} TO {}]", today_start, today_end)),
        "yesterday" => {
            let y = now - Duration::days(1);
            let y_start = y.date_naive().and_time(NaiveTime::MIN).and_local_timezone(Local).unwrap().timestamp();
            let y_end = y.date_naive().and_time(NaiveTime::from_hms_milli_opt(23, 59, 59, 999).unwrap()).and_local_timezone(Local).unwrap().timestamp();
            Some(format!("modified_at:[{} TO {}]", y_start, y_end))
        }
        "last-week" => {
            let start = (now - Duration::days(7)).timestamp();
            Some(format!("modified_at:[{} TO {}]", start, today_end))
        }
        "last-month" => {
             let start = (now - Duration::days(30)).timestamp();
             Some(format!("modified_at:[{} TO {}]", start, today_end))
        }
        // Handle explicit years e.g., 2023
        v if v.len() == 4 && v.chars().all(char::is_numeric) => {
             if let Ok(year) = v.parse::<i32>() {
                 let start = NaiveDate::from_ymd_opt(year, 1, 1)?.and_hms_opt(0,0,0)?.and_local_timezone(Local).unwrap().timestamp();
                 let end = NaiveDate::from_ymd_opt(year, 12, 31)?.and_hms_opt(23,59,59)?.and_local_timezone(Local).unwrap().timestamp();
                 Some(format!("modified_at:[{} TO {}]", start, end))
             } else { None }
        }
        _ => None
    }
}

fn parse_advanced_query(query: &str) -> String {
    let mut final_query = query.to_string();

    // 1. Handle type: -> extension:
    let re_type = Regex::new(r"(?i)\btype:(\w+)").unwrap();
    final_query = re_type.replace_all(&final_query, "extension:$1").to_string();

    // 2. Handle size:
    let re_size = Regex::new(r"(?i)\bsize:([<>]?)([\d\.]+[kmgt]?b?)").unwrap();
    if let Some(_caps) = re_size.captures(&final_query.clone()) {
        final_query = re_size
            .replace_all(&final_query, |caps: &regex::Captures| {
                let op = &caps[1];
                let val_str = &caps[2];
                if let Some(bytes) = parse_size(val_str) {
                    match op {
                        ">" => format!("size_bytes:{{{} TO *}}", bytes),
                        "<" => format!("size_bytes:{{* TO {}}}", bytes),
                        _ => format!("size_bytes:[{} TO {}]", bytes, bytes),
                    }
                } else {
                    caps[0].to_string()
                }
            })
            .to_string();
    }

    // 3. Handle modified: / date:
    let re_date = Regex::new(r"(?i)\b(modified|date):([\w-]+)").unwrap();
    if let Some(_caps) = re_date.captures(&final_query.clone()) {
         final_query = re_date.replace_all(&final_query, |caps: &regex::Captures| {
            let val = &caps[2];
            if let Some(q) = parse_date_query(val) {
                q
            } else {
                caps[0].to_string()
            }
         }).to_string();
    }
    
    // 4. Handle path:
    // path:foo -> path:"foo" (phrase query) or just path:foo
    // If path contains slashes, we need to be careful with tokenization.
    // Tantivy path field is TEXT. Standard tokenizer splits on slashes?
    // Let's wrap value in quotes if it looks like a path?
    // Or just let user type it.
    // Replace `path:val` with `path:val` (noop), but maybe handle generic "in:folder"?
    // "in:Downloads" -> parent_path:Downloads
    let re_in = Regex::new(r"(?i)\bin:(\S+)").unwrap();
     final_query = re_in.replace_all(&final_query, "parent_path:$1").to_string();


    final_query
}

#[tauri::command]
pub fn search_keyword(
    app: AppHandle,
    state: State<Arc<IndexManager>>,
    query: String,
    _filters: Option<SearchFilters>,
) -> Result<Vec<SearchResult>, String> {
    // 0. Pre-process query for advanced syntax
    let advanced_query = parse_advanced_query(&query);

    let mut search_query = advanced_query.clone();
    let mut tags_to_filter = Vec::new();

    let re_tag = Regex::new(r"(?i)\btag:(\w+)").unwrap();
    for cap in re_tag.captures_iter(&query) {
        tags_to_filter.push(cap[1].to_string());
    }
    // Remove tags from search_query
    search_query = re_tag.replace_all(&search_query, "").to_string();

    // 1. If tags present, find allowed paths
    let allowed_paths: Option<Vec<String>> = if !tags_to_filter.is_empty() {
        let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

        let mut file_ids: Option<std::collections::HashSet<i64>> = None;

        for tag in tags_to_filter {
            let mut stmt = conn
                .prepare("SELECT file_id FROM tags WHERE tag LIKE ?1")
                .map_err(|e| e.to_string())?;
            let ids: std::collections::HashSet<i64> = stmt
                .query_map([tag], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();

            if let Some(current_ids) = file_ids {
                file_ids = Some(current_ids.intersection(&ids).cloned().collect());
            } else {
                file_ids = Some(ids);
            }
        }

        let final_ids = file_ids.unwrap_or_default();

        if final_ids.is_empty() {
            return Ok(vec![]); 
        }

        let ids_str = final_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        if ids_str.is_empty() {
            return Ok(vec![]);
        }

        let mut stmt = conn
            .prepare(&format!("SELECT path FROM files WHERE id IN ({})", ids_str))
            .map_err(|e| e.to_string())?;
        let paths: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        Some(paths)
    } else {
        None
    };

    // 2. Perform Search
    let results_res = if search_query.trim().is_empty() {
        if let Some(paths) = &allowed_paths {
             state.search("*", 50)
        } else {
             Ok(vec![])
        }
    } else {
         state.search(&search_query, 50)
    };
    
    let mut results = results_res.map_err(|e| e.to_string())?;
    
    // 3. Filter by paths if tags were used
    if let Some(paths) = allowed_paths {
        let set: std::collections::HashSet<String> = paths.into_iter().collect();
         results = results
            .into_iter()
            .filter(|r| set.contains(&r.path))
            .collect();
    }
    
    // 4. Save to History (Async or just ignore error)
    if !query.trim().is_empty() {
        let app_handle = app.clone();
        let query_clone = query.clone();
        let count = results.len() as i64;
        std::thread::spawn(move || {
             let db_path = app_handle.path().app_data_dir().unwrap().join("filenova.db");
             if let Ok(conn) = Connection::open(db_path) {
                 let _ = conn.execute(
                     "INSERT INTO search_history (query, search_type, result_count, searched_at) VALUES (?1, 'keyword', ?2, datetime('now'))",
                     params![query_clone, count]
                 );
             }
        });
    }

    Ok(results)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StorageBreakdown {
    pub total_size: u64,
    pub file_count: u64,
    pub breakdown: Vec<FileTypeStats>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileTypeStats {
    pub category: String,
    pub size: u64,
    pub count: u64,
}

#[tauri::command]
pub fn get_storage_breakdown(app: AppHandle) -> Result<StorageBreakdown, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT 
            CASE 
                WHEN extension IN ('mp4', 'mkv', 'avi', 'mov', 'webm') THEN 'Video'
                WHEN extension IN ('jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp') THEN 'Image'
                WHEN extension IN ('mp3', 'wav', 'flac', 'aac', 'ogg') THEN 'Audio'
                WHEN extension IN ('pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt') THEN 'Document'
                WHEN extension IN ('zip', 'tar', 'gz', '7z', 'rar', 'iso') THEN 'Archive'
                WHEN extension IN ('exe', 'msi', 'dll', 'bin') THEN 'Binary'
                WHEN extension IN ('rs', 'ts', 'tsx', 'js', 'jsx', 'py', 'java', 'c', 'cpp', 'html', 'css', 'json', 'toml', 'yaml') THEN 'Code'
                ELSE 'Other'
            END as category,
            SUM(size_bytes) as total_size,
            COUNT(*) as count
         FROM files
         WHERE is_directory = 0
         GROUP BY category"
    ).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(FileTypeStats {
                category: row.get(0)?,
                size: row.get::<_, i64>(1)? as u64,
                count: row.get::<_, i64>(2)? as u64,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut breakdown = Vec::new();
    let mut total_size = 0;
    let mut file_count = 0;

    for row in rows {
        if let Ok(stat) = row {
            total_size += stat.size;
            file_count += stat.count;
            breakdown.push(stat);
        }
    }

    Ok(StorageBreakdown {
        total_size,
        file_count,
        breakdown,
    })
}

#[tauri::command]
pub fn get_largest_files(app: AppHandle, limit: usize) -> Result<Vec<FileEntry>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT name, path, size_bytes, modified_at 
         FROM files 
         WHERE is_directory = 0 
         ORDER BY size_bytes DESC 
         LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let files = stmt
        .query_map([limit], |row| {
            Ok(FileEntry {
                name: row.get(0)?,
                path: row.get(1)?,
                is_directory: false,
                size: row.get::<_, i64>(2)? as u64,
                modified_at: row.get::<_, i64>(3).unwrap_or(0) as u64,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for file in files {
        if let Ok(f) = file {
            result.push(f);
        }
    }

    Ok(result)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FolderSize {
    pub name: String,
    pub path: String,
    pub size: u64,
}

#[tauri::command]
pub fn get_folder_sizes(app: AppHandle, path: String) -> Result<Vec<FolderSize>, String> {
    let folders = fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.metadata().map(|m| m.is_dir()).unwrap_or(false))
        .collect::<Vec<_>>();

    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    // Get all descendant folder sizes
    // Use likelihood that path separator is platform specific
    let path_prefix = if path.ends_with(std::path::MAIN_SEPARATOR) {
        path.clone()
    } else {
        format!("{}{}", path, std::path::MAIN_SEPARATOR)
    };

    let mut stmt = conn
        .prepare(
            "SELECT parent_path, SUM(size_bytes) 
         FROM files 
         WHERE parent_path LIKE ?1 || '%' 
         GROUP BY parent_path",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&path_prefix], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u64))
        })
        .map_err(|e| e.to_string())?;

    let mut path_sizes = Vec::new();
    for row in rows {
        if let Ok((p, s)) = row {
            path_sizes.push((p, s));
        }
    }

    let mut result = Vec::new();

    for entry in folders {
        let entry_path = entry.path();
        let entry_path_str = entry_path.to_string_lossy().to_string();
        let name = entry.file_name().to_string_lossy().to_string();

        // Sum size if parent_path starts with entry_path_str
        // Handle exact match or prefix match with separator
        let prefix = format!("{}{}", entry_path_str, std::path::MAIN_SEPARATOR);

        let mut size = 0;
        for (p_path, p_size) in &path_sizes {
            if p_path == &entry_path_str || p_path.starts_with(&prefix) {
                size += p_size;
            }
        }

        result.push(FolderSize {
            name,
            path: entry_path_str,
            size,
        });
    }

    // Sort by size desc
    result.sort_by(|a, b| b.size.cmp(&a.size));

    Ok(result)
}

// ---------------------------------------------------------------------------
// Stage 4: Duplicate Detection Commands
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DuplicateFileEntry {
    pub id: i64,
    pub file_id: i64,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified_at: u64,
    pub parent_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DuplicateGroup {
    pub id: i64,
    pub group_type: String,
    pub hash_blake3: Option<String>,
    pub file_count: i64,
    pub total_wasted_bytes: i64,
    pub files: Vec<DuplicateFileEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DuplicateSummary {
    pub total_groups: u64,
    pub total_wasted_bytes: u64,
    pub exact_groups: u64,
    pub perceptual_groups: u64,
    pub smart_groups: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BatchResult {
    pub batch_id: String,
    pub files_processed: u64,
    pub bytes_recovered: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OperationBatch {
    pub batch_id: String,
    pub file_count: u64,
    pub total_size: u64,
    pub performed_at: String,
}

#[tauri::command]
pub fn scan_duplicates(app: AppHandle, state: State<DuplicateScanState>) {
    duplicates::scan_duplicates(app, state.inner().clone());
}

#[tauri::command]
pub fn get_duplicate_scan_status(state: State<DuplicateScanState>) -> DuplicateScanStatus {
    duplicates::get_status(state.inner())
}

#[tauri::command]
pub fn get_duplicate_summary(app: AppHandle) -> Result<DuplicateSummary, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT
                COUNT(*) as total_groups,
                COALESCE(SUM(total_wasted_bytes), 0) as total_wasted,
                SUM(CASE WHEN group_type = 'exact' THEN 1 ELSE 0 END) as exact_cnt,
                SUM(CASE WHEN group_type = 'perceptual' THEN 1 ELSE 0 END) as perceptual_cnt,
                SUM(CASE WHEN group_type = 'smart' THEN 1 ELSE 0 END) as smart_cnt
             FROM duplicate_groups",
        )
        .map_err(|e| e.to_string())?;

    let summary = stmt
        .query_row([], |row| {
            Ok(DuplicateSummary {
                total_groups: row.get::<_, i64>(0)? as u64,
                total_wasted_bytes: row.get::<_, i64>(1)? as u64,
                exact_groups: row.get::<_, i64>(2)?.max(0) as u64,
                perceptual_groups: row.get::<_, i64>(3)?.max(0) as u64,
                smart_groups: row.get::<_, i64>(4)?.max(0) as u64,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(summary)
}

#[tauri::command]
pub fn get_duplicates(
    app: AppHandle,
    group_type: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<DuplicateGroup>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    let groups: Vec<(i64, String, Option<String>, i64, i64)> = if let Some(ref gt) = group_type {
        let mut stmt = conn
            .prepare(
                "SELECT id, group_type, hash_blake3, file_count, total_wasted_bytes
                 FROM duplicate_groups
                 WHERE group_type = ?1
                 ORDER BY total_wasted_bytes DESC
                 LIMIT ?2 OFFSET ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt
            .query_map(params![gt, limit, offset], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, group_type, hash_blake3, file_count, total_wasted_bytes
                 FROM duplicate_groups
                 ORDER BY total_wasted_bytes DESC
                 LIMIT ?1 OFFSET ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt
            .query_map(params![limit, offset], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    let mut result = Vec::new();

    for (group_id, group_type, hash_blake3, file_count, total_wasted_bytes) in groups {
        let mut file_stmt = conn
            .prepare(
                "SELECT dgf.id, dgf.file_id, f.name, f.path, f.size_bytes, f.modified_at, f.parent_path
                 FROM duplicate_group_files dgf
                 JOIN files f ON f.id = dgf.file_id
                 WHERE dgf.group_id = ?1
                 ORDER BY f.modified_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let files: Vec<DuplicateFileEntry> = file_stmt
            .query_map([group_id], |row| {
                Ok(DuplicateFileEntry {
                    id: row.get(0)?,
                    file_id: row.get(1)?,
                    name: row.get(2)?,
                    path: row.get(3)?,
                    size: row.get::<_, i64>(4)? as u64,
                    modified_at: row.get::<_, i64>(5).unwrap_or(0) as u64,
                    parent_path: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        result.push(DuplicateGroup {
            id: group_id,
            group_type,
            hash_blake3,
            file_count,
            total_wasted_bytes,
            files,
        });
    }

    Ok(result)
}

#[tauri::command]
pub fn delete_duplicate_files(
    app: AppHandle,
    file_paths: Vec<String>,
    keep_path: String,
) -> Result<BatchResult, String> {
    if file_paths.contains(&keep_path) {
        return Err("Cannot delete the file marked to keep".into());
    }

    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let batch_id = uuid::Uuid::new_v4().to_string();
    let mut bytes_recovered = 0u64;
    let mut files_processed = 0u64;

    for path in &file_paths {
        let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        crate::trash::move_to_trash(&app, &conn, path, &batch_id)?;
        bytes_recovered += size;
        files_processed += 1;
    }

    // Clean up empty groups (groups with <= 1 file remaining)
    conn.execute(
        "DELETE FROM duplicate_groups WHERE id IN (
            SELECT dg.id FROM duplicate_groups dg
            LEFT JOIN duplicate_group_files dgf ON dgf.group_id = dg.id
            GROUP BY dg.id
            HAVING COUNT(dgf.id) <= 1
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Update file counts for remaining groups
    conn.execute(
        "UPDATE duplicate_groups SET file_count = (
            SELECT COUNT(*) FROM duplicate_group_files WHERE group_id = duplicate_groups.id
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    let _ = app.emit("duplicates-changed", ());

    Ok(BatchResult {
        batch_id,
        files_processed,
        bytes_recovered,
    })
}

#[tauri::command]
pub fn undo_batch(app: AppHandle, batch_id: String) -> Result<Vec<String>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let restored = crate::trash::restore_from_trash(&app, &conn, &batch_id)?;

    let _ = app.emit("duplicates-changed", ());

    Ok(restored)
}

#[tauri::command]
pub fn get_recent_operations(
    app: AppHandle,
    limit: Option<i64>,
) -> Result<Vec<OperationBatch>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let limit = limit.unwrap_or(10);

    let mut stmt = conn
        .prepare(
            "SELECT batch_id, COUNT(*) as file_count, COALESCE(SUM(file_size), 0) as total_size, MAX(performed_at) as performed_at
             FROM operations
             WHERE operation = 'move_to_trash' AND undone = 0
             GROUP BY batch_id
             ORDER BY performed_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let batches: Vec<OperationBatch> = stmt
        .query_map([limit], |row| {
            Ok(OperationBatch {
                batch_id: row.get(0)?,
                file_count: row.get::<_, i64>(1)? as u64,
                total_size: row.get::<_, i64>(2)? as u64,
                performed_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(batches)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ActivityEntry {
    pub id: i64,
    pub file_path: String,
    pub action: String,
    pub detected_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ActivityFilters {
    pub time_range: Option<String>, // "today", "week", "month"
    pub action_type: Option<Vec<String>>,
    pub folder: Option<String>,
    pub file_type: Option<Vec<String>>, // e.g., ["pdf", "jpg"]
    pub limit: Option<i64>,
}

#[tauri::command]
pub fn get_activity_feed(app: AppHandle, filters: ActivityFilters) -> Result<Vec<ActivityEntry>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut sql = "SELECT id, file_path, action, detected_at FROM activity WHERE 1=1".to_string();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    // Time Filter
    if let Some(time_range) = &filters.time_range {
        match time_range.as_str() {
            "today" => sql.push_str(" AND detected_at >= date('now', 'start of day')"),
            "week" => sql.push_str(" AND detected_at >= date('now', '-7 days')"),
            "month" => sql.push_str(" AND detected_at >= date('now', '-30 days')"),
            _ => {}
        }
    }

    // Folder Filter
    if let Some(folder) = &filters.folder {
        if !folder.is_empty() {
             sql.push_str(" AND file_path LIKE ?");
             params.push(Box::new(format!("{}%", folder)));
        }
    }

    // Action Filter
    if let Some(actions) = &filters.action_type {
        if !actions.is_empty() {
            let placeholders: Vec<String> = actions.iter().map(|_| "?".to_string()).collect();
            sql.push_str(&format!(" AND action IN ({})", placeholders.join(",")));
            for action in actions {
                params.push(Box::new(action.clone()));
            }
        }
    }

    // File Type Filter
    if let Some(types) = &filters.file_type {
         if !types.is_empty() {
            let clauses: Vec<String> = types.iter().map(|_| "file_path LIKE ?".to_string()).collect();
            sql.push_str(&format!(" AND ({})", clauses.join(" OR ")));
            for t in types {
                params.push(Box::new(format!("%.{}", t)));
            }
         }
    }

    sql.push_str(" ORDER BY detected_at DESC");

    if let Some(limit) = filters.limit {
        sql.push_str(" LIMIT ?");
        params.push(Box::new(limit));
    } else {
         sql.push_str(" LIMIT 50");
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    
    // Convert to vector of references for rusqlite
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let activities = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(ActivityEntry {
                id: row.get(0)?,
                file_path: row.get(1)?,
                action: row.get(2)?,
                detected_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
        
    Ok(activities)
}



#[tauri::command]
pub fn get_file_db_id(app: AppHandle, path: String) -> Result<Option<i64>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let id: Option<i64> = conn
        .query_row("SELECT id FROM files WHERE path = ?1", [&path], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(id)
}

// ---------------------------------------------------------------------------
// Stage 6: Rules Commands
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Rule {
    pub id: i64,
    pub name: String,
    pub condition_json: String,
    pub action_json: String,
    pub enabled: bool,
    pub trigger: String,
}

#[tauri::command]
pub fn get_rules(app: AppHandle) -> Result<Vec<Rule>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, condition_json, action_json, enabled, trigger FROM rules ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rules = stmt
        .query_map([], |row| {
            Ok(Rule {
                id: row.get(0)?,
                name: row.get(1)?,
                condition_json: row.get(2)?,
                action_json: row.get(3)?,
                enabled: row.get(4)?,
                trigger: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rules)
}

#[tauri::command]
pub fn save_rule(app: AppHandle, rule: Rule) -> Result<(), String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    if rule.id > 0 {
        // Update
        conn.execute(
            "UPDATE rules SET name = ?1, condition_json = ?2, action_json = ?3, enabled = ?4, trigger = ?5 WHERE id = ?6",
            params![rule.name, rule.condition_json, rule.action_json, rule.enabled, rule.trigger, rule.id],
        ).map_err(|e| e.to_string())?;
    } else {
        // Insert
        conn.execute(
            "INSERT INTO rules (name, condition_json, action_json, enabled, trigger, created_at) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
            params![rule.name, rule.condition_json, rule.action_json, rule.enabled, rule.trigger],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn delete_rule(app: AppHandle, rule_id: i64) -> Result<(), String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM rules WHERE id = ?1", [rule_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Stage 5: Content Extraction & Semantic Search Commands
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExtractionStats {
    pub total_files: u64,
    pub extracted_files: u64,
    pub failed_files: u64,
    pub embedded_files: u64,
    pub pending_files: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AiStatus {
    pub ollama_running: bool,
    pub model_available: bool,
    pub model_name: String,
    pub provider_url: String,
}

#[tauri::command]
pub fn start_content_extraction(
    app: AppHandle,
    state: State<ExtractionState>,
    vector_store: State<Arc<VectorStore>>,
) {
    extraction::start_extraction(app, state.inner().clone(), Arc::clone(&vector_store));
}

#[tauri::command]
pub fn pause_content_extraction(state: State<ExtractionState>) {
    state.is_paused.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn resume_content_extraction(state: State<ExtractionState>) {
    state.is_paused.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn get_extraction_status(state: State<ExtractionState>) -> ExtractionStatus {
    extraction::get_extraction_status(state.inner())
}

#[tauri::command]
pub fn get_extraction_stats(app: AppHandle) -> Result<ExtractionStats, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let total: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM files WHERE is_directory = 0",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())? as u64;

    let extracted: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM files WHERE content_extracted = TRUE AND is_directory = 0",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())? as u64;

    let failed: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM files WHERE extraction_error IS NOT NULL AND is_directory = 0",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())? as u64;

    let embedded: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM files WHERE embedding_generated = TRUE AND is_directory = 0",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())? as u64;

    Ok(ExtractionStats {
        total_files: total,
        extracted_files: extracted,
        failed_files: failed,
        embedded_files: embedded,
        pending_files: total.saturating_sub(extracted),
    })
}

#[tauri::command]
pub async fn search_semantic(
    vector_store: State<'_, Arc<VectorStore>>,
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<HybridSearchResult>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let config = EmbeddingConfig::from_settings(&conn);
    let limit = limit.unwrap_or(20);

    crate::semantic_search::search_semantic_only(&vector_store, &config, &query, limit).await
}

#[tauri::command]
pub async fn search_hybrid(
    index_manager: State<'_, Arc<IndexManager>>,
    vector_store: State<'_, Arc<VectorStore>>,
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<HybridSearchResult>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let embed_config = EmbeddingConfig::from_settings(&conn);
    let search_config = crate::semantic_search::SearchConfig {
        keyword_limit: limit.unwrap_or(50),
        semantic_limit: limit.unwrap_or(30),
        ..Default::default()
    };

    crate::semantic_search::search_hybrid(
        &index_manager,
        &vector_store,
        &embed_config,
        &query,
        &search_config,
    )
    .await
}

#[tauri::command]
pub async fn check_ai_status(app: AppHandle) -> Result<AiStatus, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let config = EmbeddingConfig::from_settings(&conn);

    let is_healthy = crate::embeddings::check_provider_health(&config)
        .await
        .unwrap_or(false);

    Ok(AiStatus {
        ollama_running: is_healthy,
        model_available: is_healthy,
        model_name: config.model,
        provider_url: if config.provider == crate::embeddings::AiProvider::Ollama {
            config.ollama_url
        } else {
            "https://api.openai.com".to_string()
        },
    })
}

// ---------------------------------------------------------------------------
// Stage 6: Tagging Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_tags(app: AppHandle, file_id: i64) -> Result<Vec<Tag>, String> {
    tagging::get_tags_for_file(&app, file_id).await
}

#[tauri::command]
pub async fn add_tag(app: AppHandle, file_id: i64, tag: String) -> Result<(), String> {
    tagging::add_tag(&app, file_id, tag, "user".to_string(), 1.0).await
}

#[tauri::command]
pub async fn remove_tag(app: AppHandle, tag_id: i64) -> Result<(), String> {
    tagging::remove_tag(&app, tag_id).await
}

#[tauri::command]
pub async fn get_all_tags(app: AppHandle) -> Result<Vec<String>, String> {
    tagging::get_all_unique_tags(&app).await
}

#[tauri::command]
pub async fn get_tag_stats(app: AppHandle) -> Result<Vec<tagging::TagStat>, String> {
    tagging::get_tag_stats(&app).await
}

#[tauri::command]
pub async fn auto_tag_file(app: AppHandle, file_id: i64) -> Result<(), String> {
    tagging::auto_tag_file(&app, file_id).await
}

#[tauri::command]
pub async fn start_auto_tagging(app: AppHandle, file_ids: Vec<i64>) -> Result<(), String> {
    tagging::start_auto_tagging_task(app, file_ids);
    Ok(())
}

#[tauri::command]
pub async fn get_tags_for_directory(app: AppHandle, path: String) -> Result<std::collections::HashMap<String, Vec<Tag>>, String> {
    tagging::get_tags_for_directory(&app, path).await
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DirectoryNode {
    pub name: String,
    pub path: String,
    pub children: Vec<DirectoryNode>,
    pub is_directory: bool,
    pub size: u64,
    pub file_count: usize,
}

fn build_tree(path: &Path, current_depth: usize, max_depth: usize) -> DirectoryNode {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let path_str = path.to_string_lossy().to_string();

    if !path.is_dir() {
        let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        return DirectoryNode {
            name,
            path: path_str,
            children: vec![],
            is_directory: false,
            size,
            file_count: 1,
        };
    }

    if current_depth >= max_depth {
        return DirectoryNode {
            name,
            path: path_str,
            children: vec![],
            is_directory: true,
            size: 0,
            file_count: 0,
        };
    }

    let mut children = Vec::new();
    let mut total_size = 0;
    let mut total_count = 0;

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let child_node = build_tree(&entry.path(), current_depth + 1, max_depth);
            total_size += child_node.size;
            total_count += child_node.file_count;
            children.push(child_node);
        }
    }

    children.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    DirectoryNode {
        name,
        path: path_str,
        children,
        is_directory: true,
        size: total_size,
        file_count: total_count,
    }
}

#[tauri::command]
pub async fn get_directory_tree(path: String, max_depth: usize) -> Result<DirectoryNode, String> {
    let root = Path::new(&path);
    if !root.exists() {
        return Err("Path does not exist".to_string());
    }

    // Run blocking IO in a separate thread
    let path_clone = path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&path_clone);
        build_tree(root, 0, max_depth)
    }).await.map_err(|e| e.to_string())?;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_size() {
        assert_eq!(parse_size("10b"), Some(10));
        assert_eq!(parse_size("1kb"), Some(1024));
        assert_eq!(parse_size("1.5mb"), Some(1572864));
        assert_eq!(parse_size("1gb"), Some(1073741824));
    }

    #[test]
    fn test_parse_advanced_query() {
        assert_eq!(parse_advanced_query("test type:pdf"), "test extension:pdf");
        assert_eq!(
            parse_advanced_query("size:>10mb"),
            "size_bytes:{10485760 TO *}"
        );
        assert_eq!(parse_advanced_query("size:<1kb"), "size_bytes:{* TO 1024}");
        // Mixed
        let q = parse_advanced_query("vacation type:jpg size:>5mb");
        assert!(q.contains("extension:jpg"));
        assert!(q.contains("size_bytes:{5242880 TO *}"));
    }
}
