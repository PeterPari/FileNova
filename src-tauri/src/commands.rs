use crate::db::{get_setting, save_setting};
use crate::duplicates::{self, DuplicateScanState, DuplicateScanStatus};
use crate::embeddings::EmbeddingConfig;
use crate::extraction::{self, ExtractionState, ExtractionStatus};
use crate::indexer::{build_status, start_indexing as run_indexing, IndexStatus, IndexerState};
use crate::long_path::safe_path;
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
    pub file_types: Vec<String>,
    pub size_range: Option<(u64, u64)>,
    pub date_range: Option<(chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)>,
    pub location: Option<String>,
}

impl Default for SearchFilters {
    fn default() -> Self {
        Self {
            file_types: Vec::new(),
            size_range: None,
            date_range: None,
            location: None,
        }
    }
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
    build_status(state.inner())
}

#[tauri::command]
pub fn get_app_setting(app: AppHandle, key: String) -> Result<Option<String>, String> {
    if is_secret_key(&key) {
        return Err("Access denied for secure setting key".to_string());
    }
    let conn = crate::db::get_conn(&app)?;
    get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_app_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    if is_secret_key(&key) {
        return Err("Access denied for secure setting key".to_string());
    }
    let conn = crate::db::get_conn(&app)?;
    save_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_openai_api_key() -> Result<Option<String>, String> {
    crate::db::get_secret("openai_api_key")
}

#[tauri::command]
pub fn save_openai_api_key(value: String) -> Result<(), String> {
    crate::db::save_secret("openai_api_key", &value)
}

#[tauri::command]
pub fn save_gemini_api_key(value: String) -> Result<(), String> {
    crate::db::save_secret("gemini_api_key", &value)
}

#[tauri::command]
pub fn get_gemini_api_key() -> Result<Option<String>, String> {
    crate::db::get_secret("gemini_api_key")
}

fn is_secret_key(key: &str) -> bool {
    matches!(
        key,
        "openai_api_key" | "gemini_api_key" | "api_key" | "secret" | "token"
    )
}

#[tauri::command]
pub fn list_directory(path: &str) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(safe_path(Path::new(path))).map_err(|e| e.to_string())?;
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
    let metadata = fs::metadata(safe_path(path_obj)).map_err(|e| e.to_string())?;

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

use chrono::{DateTime, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};

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
    let conn = crate::db::get_conn(&app)?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT id, query, search_type, result_count, searched_at 
             FROM search_history 
             ORDER BY searched_at DESC 
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let history = stmt
        .query_map([limit], |row| {
             let _searched_at: String = row.get(4)?;
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

fn normalize_extension(value: &str) -> Option<String> {
    let cleaned = value.trim().trim_start_matches('.').to_lowercase();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn to_utc_range(start: NaiveDateTime, end: NaiveDateTime) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    let start_local = Local.from_local_datetime(&start).single()?;
    let end_local = Local.from_local_datetime(&end).single()?;
    Some((start_local.with_timezone(&Utc), end_local.with_timezone(&Utc)))
}

fn parse_single_date_range(value: &str) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    let value = value.trim();

    if value.len() == 4 && value.chars().all(char::is_numeric) {
        let year = value.parse::<i32>().ok()?;
        let start = NaiveDate::from_ymd_opt(year, 1, 1)?.and_hms_opt(0, 0, 0)?;
        let end = NaiveDate::from_ymd_opt(year, 12, 31)?.and_hms_opt(23, 59, 59)?;
        return to_utc_range(start, end);
    }

    if value.len() == 7 {
        let parts: Vec<_> = value.split('-').collect();
        if parts.len() == 2 {
            let year = parts[0].parse::<i32>().ok()?;
            let month = parts[1].parse::<u32>().ok()?;
            let start = NaiveDate::from_ymd_opt(year, month, 1)?.and_hms_opt(0, 0, 0)?;
            let next_month = if month == 12 {
                NaiveDate::from_ymd_opt(year + 1, 1, 1)?
            } else {
                NaiveDate::from_ymd_opt(year, month + 1, 1)?
            };
            let end_date = next_month - Duration::days(1);
            let end = end_date.and_hms_opt(23, 59, 59)?;
            return to_utc_range(start, end);
        }
    }

    if let Ok(day) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        let start = day.and_hms_opt(0, 0, 0)?;
        let end = day.and_hms_opt(23, 59, 59)?;
        return to_utc_range(start, end);
    }

    None
}

fn parse_date_range_value(value: &str) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    let raw = value.trim().trim_matches('"');
    let lowered = raw.to_lowercase();
    let now = Local::now();

    match lowered.as_str() {
        "today" => {
            let start = now.date_naive().and_time(NaiveTime::MIN);
            let end = now
                .date_naive()
                .and_time(NaiveTime::from_hms_milli_opt(23, 59, 59, 999)?);
            return to_utc_range(start, end);
        }
        "last-week" => {
            let start = (now - Duration::days(7))
                .date_naive()
                .and_time(NaiveTime::MIN);
            let end = now
                .date_naive()
                .and_time(NaiveTime::from_hms_milli_opt(23, 59, 59, 999)?);
            return to_utc_range(start, end);
        }
        "last-month" => {
            let start = (now - Duration::days(30))
                .date_naive()
                .and_time(NaiveTime::MIN);
            let end = now
                .date_naive()
                .and_time(NaiveTime::from_hms_milli_opt(23, 59, 59, 999)?);
            return to_utc_range(start, end);
        }
        _ => {}
    }

    if raw.contains("..") {
        let parts: Vec<_> = raw.split("..").collect();
        if parts.len() == 2 {
            let start = parse_single_date_range(parts[0])?.0;
            let end = parse_single_date_range(parts[1])?.1;
            return Some((start, end));
        }
    }

    parse_single_date_range(raw)
}

fn parse_advanced_query(query: &str) -> (String, SearchFilters) {
    let mut filters = SearchFilters::default();
    let mut remaining = query.to_string();

    let re_type = Regex::new(r#"(?i)\btype:(\"[^\"]+\"|[^\s]+)"#).unwrap();
    for cap in re_type.captures_iter(query) {
        let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        for ext in raw.trim_matches('"').split(',') {
            if let Some(cleaned) = normalize_extension(ext) {
                filters.file_types.push(cleaned);
            }
        }
    }
    remaining = re_type.replace_all(&remaining, "").to_string();

    let re_size_range = Regex::new(r"(?i)\bsize:([\d\.]+[kmgt]?b?)\s*-\s*([\d\.]+[kmgt]?b?)").unwrap();
    for cap in re_size_range.captures_iter(query) {
        let min_val = parse_size(&cap[1]);
        let max_val = parse_size(&cap[2]);
        if let (Some(min), Some(max)) = (min_val, max_val) {
            let (min_v, max_v) = if min <= max { (min, max) } else { (max, min) };
            filters.size_range = Some((min_v, max_v));
        }
    }
    remaining = re_size_range.replace_all(&remaining, "").to_string();

    let re_size = Regex::new(r"(?i)\bsize:([<>]=?|=)?([\d\.]+[kmgt]?b?)").unwrap();
    for cap in re_size.captures_iter(&remaining) {
        let op = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        if let Some(bytes) = parse_size(&cap[2]) {
            let range = match op {
                ">" | ">=" => Some((bytes, u64::MAX)),
                "<" | "<=" => Some((0, bytes)),
                _ => Some((bytes, bytes)),
            };
            filters.size_range = range;
        }
    }
    remaining = re_size.replace_all(&remaining, "").to_string();

    let re_modified = Regex::new(r#"(?i)\bmodified:(\"[^\"]+\"|[^\s]+)"#).unwrap();
    for cap in re_modified.captures_iter(query) {
        let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        if let Some(range) = parse_date_range_value(raw) {
            filters.date_range = Some(range);
        }
    }
    remaining = re_modified.replace_all(&remaining, "").to_string();

    let re_path = Regex::new(r#"(?i)\bpath:(\"[^\"]+\"|[^\s]+)"#).unwrap();
    for cap in re_path.captures_iter(query) {
        let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let value = raw.trim_matches('"').to_string();
        if !value.is_empty() {
            filters.location = Some(value);
        }
    }
    remaining = re_path.replace_all(&remaining, "").to_string();

    let re_in = Regex::new(r#"(?i)\bin:(\"[^\"]+\"|[^\s]+)"#).unwrap();
    for cap in re_in.captures_iter(query) {
        let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let value = raw.trim_matches('"').to_string();
        if !value.is_empty() {
            filters.location = Some(value);
        }
    }
    remaining = re_in.replace_all(&remaining, "").to_string();

    let remaining = remaining.split_whitespace().collect::<Vec<_>>().join(" ");
    (remaining.trim().to_string(), filters)
}

fn merge_search_filters(mut base: SearchFilters, extra: SearchFilters) -> SearchFilters {
    if !extra.file_types.is_empty() {
        base.file_types.extend(extra.file_types);
    }
    if extra.size_range.is_some() {
        base.size_range = extra.size_range;
    }
    if extra.date_range.is_some() {
        base.date_range = extra.date_range;
    }
    if extra.location.is_some() {
        base.location = extra.location;
    }
    base
}

fn apply_search_filters_to_results(
    results: Vec<HybridSearchResult>,
    filters: &SearchFilters,
) -> Vec<HybridSearchResult> {
    let type_filters: std::collections::HashSet<String> = filters
        .file_types
        .iter()
        .filter_map(|t| normalize_extension(t))
        .collect();

    let location_filter = filters.location.as_ref().map(|loc| {
        let normalized = loc.replace('/', &std::path::MAIN_SEPARATOR.to_string());
        normalized.to_lowercase()
    });

    results
        .into_iter()
        .filter(|r| {
            if !type_filters.is_empty() {
                let ext = r
                    .extension
                    .as_ref()
                    .and_then(|e| normalize_extension(e));
                if ext.map(|e| !type_filters.contains(&e)).unwrap_or(true) {
                    return false;
                }
            }

            if let Some((min, max)) = filters.size_range {
                let size = r.size_bytes.max(0) as u64;
                if size < min || size > max {
                    return false;
                }
            }

            if let Some((start, end)) = &filters.date_range {
                let ts = r.modified_at;
                let start_ts = start.timestamp();
                let end_ts = end.timestamp();
                if ts < start_ts || ts > end_ts {
                    return false;
                }
            }

            if let Some(ref loc) = location_filter {
                let path = r.path.to_lowercase();
                if path.contains(std::path::MAIN_SEPARATOR) {
                    if !path.starts_with(loc) && !path.contains(loc) {
                        return false;
                    }
                } else if !path.contains(loc) {
                    return false;
                }
            }

            true
        })
        .collect()
}

fn hydrate_hybrid_results(
    conn: &Connection,
    results: &mut [HybridSearchResult],
) -> Result<(), String> {
    for result in results.iter_mut() {
        let row = conn.query_row(
            "SELECT size_bytes, modified_at, extension FROM files WHERE path = ?1",
            [&result.path],
            |row| {
                Ok((
                    row.get::<_, i64>(0).unwrap_or(0),
                    row.get::<_, i64>(1).unwrap_or(0),
                    row.get::<_, Option<String>>(2).ok().flatten(),
                ))
            },
        );

        if let Ok((size, modified, extension)) = row {
            result.size_bytes = size;
            result.modified_at = modified;
            if result.extension.is_none() {
                result.extension = extension;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn search_keyword(
    app: AppHandle,
    state: State<Arc<IndexManager>>,
    query: String,
    filters: SearchFilters,
) -> Result<Vec<SearchResult>, String> {
    let (keyword_query, parsed_filters) = parse_advanced_query(&query);
    let merged_filters = merge_search_filters(filters, parsed_filters);

    let mut search_query = keyword_query.clone();
    let mut tags_to_filter = Vec::new();

    let re_tag = Regex::new(r"(?i)\btag:(\w+)").unwrap();
    for cap in re_tag.captures_iter(&query) {
        tags_to_filter.push(cap[1].to_string());
    }
    // Remove tags from search_query
    search_query = re_tag.replace_all(&search_query, "").to_string();

    // 1. If tags present, find allowed paths
    let allowed_paths: Option<Vec<String>> = if !tags_to_filter.is_empty() {
        let conn = crate::db::get_conn(&app)?;

        let mut file_ids: Option<std::collections::HashSet<i64>> = None;

        for tag in tags_to_filter {
            let mut stmt = conn
                .prepare_cached("SELECT file_id FROM tags WHERE tag LIKE ?1")
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
    let has_filters = !merged_filters.file_types.is_empty()
        || merged_filters.size_range.is_some()
        || merged_filters.date_range.is_some()
        || merged_filters.location.is_some();

    if search_query.trim().is_empty() && allowed_paths.is_none() && !has_filters {
        return Ok(vec![]);
    }

    let results_res = state.search(&search_query, 200);
    
    let mut results = results_res.map_err(|e| e.to_string())?;
    
    // 3. Filter by paths if tags were used
    let allowed_set: Option<std::collections::HashSet<String>> =
        allowed_paths.map(|paths| paths.into_iter().collect());

    let type_filters: std::collections::HashSet<String> = merged_filters
        .file_types
        .iter()
        .filter_map(|t| normalize_extension(t))
        .collect();

    let location_filter = merged_filters.location.as_ref().map(|loc| {
        let normalized = loc.replace('/', &std::path::MAIN_SEPARATOR.to_string());
        normalized.to_lowercase()
    });

    results = results
        .into_iter()
        .filter(|r| {
            if let Some(ref set) = allowed_set {
                if !set.contains(&r.path) {
                    return false;
                }
            }

            if !type_filters.is_empty() {
                let ext = r
                    .extension
                    .as_ref()
                    .and_then(|e| normalize_extension(e));
                if ext.map(|e| !type_filters.contains(&e)).unwrap_or(true) {
                    return false;
                }
            }

            if let Some((min, max)) = merged_filters.size_range {
                let size = r.size_bytes.max(0) as u64;
                if size < min || size > max {
                    return false;
                }
            }

            if let Some((start, end)) = &merged_filters.date_range {
                let ts = r.modified_at;
                let start_ts = start.timestamp();
                let end_ts = end.timestamp();
                if ts < start_ts || ts > end_ts {
                    return false;
                }
            }

            if let Some(ref loc) = location_filter {
                let path = r.path.to_lowercase();
                if path.contains(std::path::MAIN_SEPARATOR) {
                    if !path.starts_with(loc) && !path.contains(loc) {
                        return false;
                    }
                } else if !path.contains(loc) {
                    return false;
                }
            }

            true
        })
        .collect();

    results.truncate(50);
    
    // 4. Save to History (Async or just ignore error)
    if !query.trim().is_empty() {
        let app_handle = app.clone();
        let query_clone = query.clone();
        let count = results.len() as i64;
        std::thread::spawn(move || {
             let pool = app_handle.state::<crate::db::DbPool>();
             if let Ok(conn) = pool.main.get() {
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

fn category_case_sql() -> &'static str {
    "CASE \
        WHEN extension IN ('mp4', 'mkv', 'avi', 'mov', 'webm') THEN 'Videos' \
        WHEN extension IN ('jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp') THEN 'Images' \
        WHEN extension IN ('pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt') THEN 'Documents' \
        WHEN extension IN ('zip', 'tar', 'gz', '7z', 'rar', 'iso') THEN 'Archives' \
        WHEN extension IN ('rs', 'ts', 'tsx', 'js', 'jsx', 'py', 'java', 'c', 'cpp', 'html', 'css', 'json', 'toml', 'yaml') THEN 'Code' \
        ELSE 'Other' \
     END"
}

#[tauri::command]
pub fn get_storage_breakdown(app: AppHandle) -> Result<StorageBreakdown, String> {
    let conn = crate::db::get_conn(&app)?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT 
                {category_case} as category,
                SUM(size_bytes) as total_size,
                COUNT(*) as count
             FROM files
             WHERE is_directory = 0
             GROUP BY category",
            category_case = category_case_sql()
        ))
        .map_err(|e| e.to_string())?;

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
    let conn = crate::db::get_conn(&app)?;

    let mut stmt = conn
        .prepare_cached(
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
    pub category: String,
}

#[tauri::command]
pub fn get_folder_sizes(app: AppHandle, path: String) -> Result<Vec<FolderSize>, String> {
    let folders = fs::read_dir(safe_path(Path::new(&path)))
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.metadata().map(|m| m.is_dir()).unwrap_or(false))
        .collect::<Vec<_>>();

    let conn = crate::db::get_conn(&app)?;

    // Get all descendant folder sizes
    // Use likelihood that path separator is platform specific
    let path_prefix = if path.ends_with(std::path::MAIN_SEPARATOR) {
        path.clone()
    } else {
        format!("{}{}", path, std::path::MAIN_SEPARATOR)
    };

    let mut stmt = conn
        .prepare_cached(
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

        let category_query = format!(
            "SELECT {category_case} as category, SUM(size_bytes) as total_size\
             FROM files\
             WHERE is_directory = 0 AND path LIKE ?1 || '%'\
             GROUP BY category\
             ORDER BY total_size DESC\
             LIMIT 1",
            category_case = category_case_sql()
        );

        let category = conn
            .query_row(&category_query, [entry_path_str.as_str()], |row| row.get(0))
            .optional()
            .unwrap_or(None)
            .unwrap_or_else(|| "Other".to_string());

        result.push(FolderSize {
            name,
            path: entry_path_str,
            size,
            category,
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
    let conn = crate::db::get_conn(&app)?;

    let mut stmt = conn
        .prepare_cached(
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
    let conn = crate::db::get_conn(&app)?;

    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    let groups: Vec<(i64, String, Option<String>, i64, i64)> = if let Some(ref gt) = group_type {
        let mut stmt = conn
            .prepare_cached(
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
            .prepare_cached(
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
            .prepare_cached(
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
pub fn get_duplicate_group_files(
    app: AppHandle,
    group_id: i64,
) -> Result<Vec<FileEntry>, String> {
    let conn = crate::db::get_conn(&app)?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT f.name, f.path, f.is_directory, f.size_bytes, f.modified_at
             FROM duplicate_group_files dgf
             JOIN files f ON f.id = dgf.file_id
             WHERE dgf.group_id = ?1
             ORDER BY f.modified_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([group_id], |row| {
            Ok(FileEntry {
                name: row.get(0)?,
                path: row.get(1)?,
                is_directory: row.get::<_, i64>(2).unwrap_or(0) != 0,
                size: row.get::<_, i64>(3).unwrap_or(0) as u64,
                modified_at: row.get::<_, i64>(4).unwrap_or(0) as u64,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        if let Ok(entry) = row {
            result.push(entry);
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn delete_duplicate_files(
    app: AppHandle,
    file_ids: Vec<i64>,
    keep_file_id: i64,
) -> Result<BatchResult, String> {
    if file_ids.contains(&keep_file_id) {
        return Err("Cannot delete the file marked to keep".into());
    }

    let conn = crate::db::get_conn(&app)?;

    let batch_id = uuid::Uuid::new_v4().to_string();
    let mut bytes_recovered = 0u64;
    let mut files_processed = 0u64;

    let keep_path: String = conn
        .query_row(
            "SELECT path FROM files WHERE id = ?1",
            [keep_file_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    for file_id in &file_ids {
        let path: String = conn
            .query_row(
                "SELECT path FROM files WHERE id = ?1",
                [file_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if path == keep_path {
            continue;
        }

        let size = fs::metadata(safe_path(Path::new(&path))).map(|m| m.len()).unwrap_or(0);
        crate::trash::move_to_trash(&app, &conn, &path, &batch_id)?;
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
    let conn = crate::db::get_conn(&app)?;

    let mut restored = crate::trash::restore_from_trash(&app, &conn, &batch_id)?;
    if let Ok(mut moves) = crate::execution::undo_move_batch(&conn, &batch_id) {
        restored.append(&mut moves);
    }

    let _ = app.emit("duplicates-changed", ());
    let _ = app.emit("file-changed", ()); // Notify general file changes

    Ok(restored)
}

#[tauri::command]
pub fn undo_operation(app: AppHandle, batch_id: String) -> Result<(), String> {
    undo_batch(app, batch_id).map(|_| ())
}

#[tauri::command]
pub fn undo_last_operations(app: AppHandle, count: i64) -> Result<Vec<String>, String> {
    if count <= 0 {
        return Ok(Vec::new());
    }

    let conn = crate::db::get_conn(&app)?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT batch_id, MAX(performed_at) as performed_at
             FROM operations
             WHERE undone = 0
             GROUP BY batch_id
             ORDER BY performed_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let batch_ids: Vec<String> = stmt
        .query_map([count], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut undone = Vec::new();
    for batch_id in batch_ids {
        if undo_batch(app.clone(), batch_id.clone()).is_ok() {
            undone.push(batch_id);
        }
    }

    Ok(undone)
}

#[tauri::command]
pub fn get_recent_operations(
    app: AppHandle,
    limit: Option<i64>,
) -> Result<Vec<OperationBatch>, String> {
    let conn = crate::db::get_conn(&app)?;

    let limit = limit.unwrap_or(10);

    let mut stmt = conn
        .prepare_cached(
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
pub struct OperationHistoryItem {
    pub batch_id: String,
    pub operation: String,
    pub file_count: i64,
    pub description: String,
    pub performed_at: String,
    pub undone: bool,
}

#[tauri::command]
pub fn get_operation_history(app: AppHandle) -> Result<Vec<OperationHistoryItem>, String> {
    let conn = crate::db::get_conn(&app)?;

    let mut stmt = conn.prepare_cached(
        "SELECT batch_id, operation, COUNT(*) as cnt, MIN(performed_at) as performed_at, MIN(undone) as is_undone
         FROM operations
         GROUP BY batch_id
         ORDER BY performed_at DESC
         LIMIT 20"
    ).map_err(|e| e.to_string())?;

    let history = stmt.query_map([], |row| {
        let batch_id: String = row.get(0)?;
        let op: String = row.get(1)?;
        let count: i64 = row.get(2)?;
        let performed_at: String = row.get(3)?;
        let undone: bool = row.get(4)?;

        let description = match op.as_str() {
            "move" => format!("Moved {} files", count),
            "move_to_trash" => format!("Moved {} files to trash", count),
            "rename" => format!("Renamed {} files", count), // if we distinguish rename in future
            _ => format!("{} {} files", op, count), 
        };

        Ok(OperationHistoryItem {
            batch_id,
            operation: op,
            file_count: count,
            description,
            performed_at,
            undone
        })
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    Ok(history)
}

#[tauri::command]
pub fn redo_batch(app: AppHandle, batch_id: String) -> Result<Vec<String>, String> {
    let conn = crate::db::get_conn(&app)?;

    let mut redone_paths = Vec::new();

    // Try redo trash
    if let Ok(mut paths) = crate::trash::redo_trash_batch(&app, &conn, &batch_id) {
        redone_paths.append(&mut paths);
    }
    
    // Try redo moves
    if let Ok(mut paths) = crate::execution::redo_move_batch(&conn, &batch_id) {
        redone_paths.append(&mut paths);
    }

    let _ = app.emit("duplicates-changed", ());
    let _ = app.emit("file-changed", ());

    Ok(redone_paths)
}

#[tauri::command]
pub fn redo_operation(app: AppHandle, batch_id: String) -> Result<(), String> {
    redo_batch(app, batch_id).map(|_| ())
}

#[tauri::command]
pub fn get_trash_contents(app: AppHandle) -> Result<Vec<crate::trash::TrashItem>, String> {
    crate::trash::get_trash_items(app)
}

#[tauri::command]
pub fn restore_from_trash(app: AppHandle, file_ids: Vec<i64>) -> Result<(), String> {
    crate::trash::restore_trash_items(app, file_ids)
}

#[tauri::command]
pub fn empty_trash(app: AppHandle) -> Result<(), String> {
    crate::trash::empty_trash_bin(app)
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
    let conn = crate::db::get_conn(&app)?;

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
    let conn = crate::db::get_conn(&app)?;

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
#[allow(dead_code)]
pub struct Rule {
    pub id: i64,
    pub name: String,
    pub condition_json: String,
    pub action_json: String,
    pub enabled: bool,
    pub trigger: String,
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
    file_ids: Option<Vec<i64>>,
) {
    extraction::start_extraction(
        app,
        state.inner().clone(),
        Arc::clone(&vector_store),
        file_ids,
    );
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
    let conn = crate::db::get_conn(&app)?;

    let total: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM files WHERE is_directory = 0",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())? as u64;

    let extracted: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM files WHERE extraction_completed = TRUE AND is_directory = 0",
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
    let conn = crate::db::get_conn(&app)?;
    let config = EmbeddingConfig::from_settings(&conn);
    let limit = limit.unwrap_or(20);

    let mut results =
        crate::semantic_search::search_semantic_only(&vector_store, &config, &query, limit).await?;

    hydrate_hybrid_results(&conn, &mut results)?;

    if !query.trim().is_empty() {
        let app_handle = app.clone();
        let query_clone = query.clone();
        let count = results.len() as i64;
        std::thread::spawn(move || {
            let pool = app_handle.state::<crate::db::DbPool>();
            if let Ok(conn) = pool.main.get() {
                let _ = conn.execute(
                    "INSERT INTO search_history (query, search_type, result_count, searched_at) VALUES (?1, 'semantic', ?2, datetime('now'))",
                    params![query_clone, count],
                );
            }
        });
    }

    Ok(results)
}

#[tauri::command]
pub async fn search_hybrid(
    index_manager: State<'_, Arc<IndexManager>>,
    vector_store: State<'_, Arc<VectorStore>>,
    app: AppHandle,
    query: String,
    limit: Option<usize>,
    filters: SearchFilters,
) -> Result<Vec<HybridSearchResult>, String> {
    let conn = crate::db::get_conn(&app)?;
    let embed_config = EmbeddingConfig::from_settings(&conn);
    let search_config = crate::semantic_search::SearchConfig {
        keyword_limit: limit.unwrap_or(50),
        semantic_limit: limit.unwrap_or(30),
        ..Default::default()
    };

    let mut results = crate::semantic_search::search_hybrid(
        &index_manager,
        &vector_store,
        &embed_config,
        &query,
        &search_config,
    )
    .await?;

    hydrate_hybrid_results(&conn, &mut results)?;

    let results = apply_search_filters_to_results(results, &filters);

    if !query.trim().is_empty() {
        let app_handle = app.clone();
        let query_clone = query.clone();
        let count = results.len() as i64;
        std::thread::spawn(move || {
            let pool = app_handle.state::<crate::db::DbPool>();
            if let Ok(conn) = pool.main.get() {
                let _ = conn.execute(
                    "INSERT INTO search_history (query, search_type, result_count, searched_at) VALUES (?1, 'hybrid', ?2, datetime('now'))",
                    params![query_clone, count],
                );
            }
        });
    }

    Ok(results)
}

#[tauri::command]
pub async fn check_ai_status(app: AppHandle) -> Result<AiStatus, String> {
    let conn = crate::db::get_conn(&app)?;
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
pub async fn get_ai_tags(app: AppHandle, file_id: i64) -> Result<Vec<Tag>, String> {
    tagging::get_tags_for_file(&app, file_id).await
}

#[tauri::command]
pub async fn add_tag(app: AppHandle, file_id: i64, tag: String) -> Result<(), String> {
    tagging::add_tag(&app, file_id, tag, "user".to_string(), 1.0).await
}

#[tauri::command]
pub async fn add_user_tag(app: AppHandle, file_id: i64, tag: String) -> Result<(), String> {
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
        let size = fs::metadata(safe_path(path)).map(|m| m.len()).unwrap_or(0);
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

    if let Ok(entries) = fs::read_dir(safe_path(path)) {
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

// ============================================================================
// Stage 10: File Preview & Power Features
// ============================================================================

#[tauri::command]
pub async fn generate_file_preview(
    app_handle: AppHandle,
    file_id: i64,
    preview_type: String,
) -> Result<crate::preview::FilePreview, String> {
    let conn = crate::db::get_preview_conn(&app_handle)?;

    crate::preview::generate_file_preview(&conn, file_id, &preview_type)
}

#[tauri::command]
pub async fn get_audio_waveform(path: String) -> Result<Vec<f32>, String> {
    crate::preview::get_audio_waveform(&path)
}

#[tauri::command]
pub async fn extract_pdf_preview(path: String, page: i32) -> Result<Vec<u8>, String> {
    crate::preview::extract_pdf_preview(&path, page)
}

#[tauri::command]
pub async fn get_video_thumbnail(path: String) -> Result<Vec<u8>, String> {
    crate::preview::get_video_thumbnail(&path)
}

#[tauri::command]
pub async fn get_bookmarks(app_handle: AppHandle) -> Result<Vec<crate::preview::Bookmark>, String> {
    let conn = crate::db::get_preview_conn(&app_handle)?;

    crate::preview::get_bookmarks(&conn)
}

#[tauri::command]
pub async fn add_bookmark(
    app_handle: AppHandle,
    path: String,
    name: String,
) -> Result<(), String> {
    let conn = crate::db::get_preview_conn(&app_handle)?;

    crate::preview::add_bookmark(&conn, &path, &name)
}

#[tauri::command]
pub async fn remove_bookmark(app_handle: AppHandle, path: String) -> Result<(), String> {
    let conn = crate::db::get_preview_conn(&app_handle)?;

    crate::preview::remove_bookmark(&conn, &path)
}

#[tauri::command]
pub async fn reorder_bookmarks(
    app_handle: AppHandle,
    ordered_paths: Vec<String>,
) -> Result<(), String> {
    let conn = crate::db::get_preview_conn(&app_handle)?;

    crate::preview::reorder_bookmarks(&conn, &ordered_paths)
}

#[tauri::command]
pub async fn get_pinned_files(app_handle: AppHandle) -> Result<Vec<String>, String> {
    let conn = crate::db::get_preview_conn(&app_handle)?;

    crate::preview::get_pinned_files(&conn)
}

#[tauri::command]
pub async fn toggle_pin_file(app_handle: AppHandle, path: String) -> Result<bool, String> {
    let conn = crate::db::get_preview_conn(&app_handle)?;

    crate::preview::toggle_pin_file(&conn, &path)
}

#[tauri::command]
pub async fn get_recent_files(
    app_handle: AppHandle,
    limit: usize,
) -> Result<Vec<FileEntry>, String> {
    let conn = crate::db::get_preview_conn(&app_handle)?;

    crate::preview::get_recent_files(&conn, limit)
}

#[tauri::command]
pub async fn record_file_access(app_handle: AppHandle, file_id: i64) -> Result<(), String> {
    let conn = crate::db::get_preview_conn(&app_handle)?;

    crate::preview::record_file_access(&conn, file_id)
}

#[tauri::command]
pub async fn save_workspace(
    app_handle: AppHandle,
    name: String,
    config: String,
) -> Result<i64, String> {
    let conn = crate::db::get_preview_conn(&app_handle)?;

    crate::preview::save_workspace(&conn, &name, &config)
}

#[tauri::command]
pub async fn load_workspace(
    app_handle: AppHandle,
    id: i64,
) -> Result<crate::preview::WorkspaceConfig, String> {
    let conn = crate::db::get_preview_conn(&app_handle)?;

    crate::preview::load_workspace(&conn, id)
}

#[tauri::command]
pub async fn get_workspaces(
    app_handle: AppHandle,
) -> Result<Vec<crate::preview::Workspace>, String> {
    let conn = crate::db::get_preview_conn(&app_handle)?;

    crate::preview::get_workspaces(&conn)
}

// ---------------------------------------------------------------------------
// Stage 11: Disk Space Check
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn check_disk_space(path: String) -> Result<crate::error_handling::DiskSpaceStatus, String> {
    let p = std::path::PathBuf::from(&path);
    crate::error_handling::check_disk_space(&p)
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
    fn test_parse_advanced_query_type() {
        let (text, filters) = parse_advanced_query("test type:pdf");
        assert_eq!(text, "test");
        assert!(filters.file_types.contains(&"pdf".to_string()));
    }

    #[test]
    fn test_parse_advanced_query_size_gt() {
        let (_text, filters) = parse_advanced_query("size:>10mb");
        assert!(filters.size_range.is_some());
        let (min, _max) = filters.size_range.unwrap();
        assert_eq!(min, 10485760);
    }

    #[test]
    fn test_parse_advanced_query_size_lt() {
        let (_text, filters) = parse_advanced_query("size:<1kb");
        assert!(filters.size_range.is_some());
        let (_min, max) = filters.size_range.unwrap();
        assert_eq!(max, 1024);
    }

    #[test]
    fn test_parse_advanced_query_mixed() {
        let (text, filters) = parse_advanced_query("vacation type:jpg size:>5mb");
        assert_eq!(text, "vacation");
        assert!(filters.file_types.contains(&"jpg".to_string()));
        assert!(filters.size_range.is_some());
    }
}