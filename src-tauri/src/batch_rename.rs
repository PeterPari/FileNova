use chrono::{DateTime, Local, NaiveDateTime, Utc};
use crate::long_path::safe_path;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use tauri::{AppHandle, Manager};
use rusqlite::{params, Connection, OptionalExtension};
use crate::search_index::IndexManager;
use crate::suggestions::{RenameExample, RenameFileContext, RenamePatternSuggestion, SuggestionEngine};
use crate::embeddings::EmbeddingConfig;
use crate::db;
use std::sync::Arc;
use exif::{In, Reader, Tag};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RenamePreview {
    pub file_id: Option<i64>, // ID might be missing if file not in DB
    pub original_name: String,
    pub new_name: String,
    pub original_path: String,
    pub new_path: String,
    pub conflict: Option<RenameConflict>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RenameConflict {
    pub kind: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RenameOperation {
    pub original_path: String,
    pub new_path: String,
    pub overwrite: bool,
    pub skip: bool,
}

pub struct FileMetadata {
    pub id: Option<i64>,
    pub name: String,
    pub path: String,
    pub extension: Option<String>,
    pub created_at: Option<i64>,
    pub exif_date: Option<i64>,
    pub tags: Vec<String>,
}

fn parse_datetime_to_timestamp(value: &str) -> Option<i64> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(value) {
        return Some(dt.timestamp());
    }

    if let Ok(dt) = NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S") {
        return Some(dt.and_utc().timestamp());
    }

    None
}

fn extract_exif_timestamp(path: &Path) -> Option<i64> {
    let file = File::open(safe_path(path)).ok()?;
    let mut bufreader = BufReader::new(file);
    let exif = Reader::new().read_from_container(&mut bufreader).ok()?;

    let date_value = exif
        .get_field(Tag::DateTimeOriginal, In::PRIMARY)
        .or_else(|| exif.get_field(Tag::DateTime, In::PRIMARY))
        .map(|f| f.display_value().with_unit(&exif).to_string());

    if let Some(date_str) = date_value {
        if let Ok(dt) = NaiveDateTime::parse_from_str(&date_str, "%Y:%m:%d %H:%M:%S") {
            return Some(dt.and_utc().timestamp());
        }
    }

    None
}

fn fetch_tags_for_path(conn: &Connection, path: &str) -> Vec<String> {
    let mut stmt = match conn.prepare_cached(
        "SELECT t.tag FROM tags t JOIN files f ON t.file_id = f.id WHERE f.path = ?1",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    stmt.query_map([path], |row| row.get::<_, String>(0))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

fn build_file_metadata(conn: Option<&Connection>, paths: &[String]) -> Vec<FileMetadata> {
    let mut file_metadata_list = Vec::new();

    for path in paths {
        let p = Path::new(path);
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        let extension = p.extension().map(|e| e.to_string_lossy().to_string());

        let mut meta = FileMetadata {
            id: None,
            name: name.clone(),
            path: path.clone(),
            extension: extension.clone(),
            created_at: None,
            exif_date: None,
            tags: Vec::new(),
        };

        if let Some(c) = conn {
            if let Ok(mut stmt) = c.prepare_cached("SELECT id, created_at FROM files WHERE path = ?1") {
                let res: Option<(i64, Option<String>)> = stmt
                    .query_row([path], |row| Ok((row.get(0)?, row.get(1)?)))
                    .optional()
                    .unwrap_or(None);

                if let Some((id, created_at_str)) = res {
                    meta.id = Some(id);
                    if let Some(s) = created_at_str {
                        meta.created_at = parse_datetime_to_timestamp(&s);
                    }
                }
            }

            meta.tags = fetch_tags_for_path(c, path);
        }

        if meta.created_at.is_none() {
            if let Ok(fs_meta) = std::fs::metadata(safe_path(Path::new(path))) {
                if let Ok(created) = fs_meta.created() {
                    if let Ok(duration) = created.duration_since(std::time::UNIX_EPOCH) {
                        meta.created_at = Some(duration.as_secs() as i64);
                    }
                }
            }
        }

        let should_try_exif = extension
            .as_deref()
            .map(|ext| matches!(ext.to_lowercase().as_str(), "jpg" | "jpeg" | "tiff" | "tif"))
            .unwrap_or(false);

        if should_try_exif {
            meta.exif_date = extract_exif_timestamp(p);
        }

        file_metadata_list.push(meta);
    }

    file_metadata_list
}

fn build_file_metadata_from_ids(conn: &Connection, ids: &[i64]) -> Result<Vec<FileMetadata>, String> {
    let mut file_metadata_list = Vec::new();

    for id in ids {
        let mut stmt = conn
            .prepare_cached("SELECT id, path, name, extension, created_at FROM files WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        let row: Option<(i64, String, String, Option<String>, Option<String>)> = stmt
            .query_row([id], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some((file_id, path, name, extension, created_at_str)) = row {
            let created_at = created_at_str
                .as_deref()
                .and_then(parse_datetime_to_timestamp);

            let mut meta = FileMetadata {
                id: Some(file_id),
                name,
                path: path.clone(),
                extension: extension.clone(),
                created_at,
                exif_date: None,
                tags: fetch_tags_for_path(conn, &path),
            };

            let should_try_exif = extension
                .as_deref()
                .map(|ext| matches!(ext.to_lowercase().as_str(), "jpg" | "jpeg" | "tiff" | "tif"))
                .unwrap_or(false);

            if should_try_exif {
                meta.exif_date = extract_exif_timestamp(Path::new(&path));
            }

            file_metadata_list.push(meta);
        }
    }

    Ok(file_metadata_list)
}

pub fn apply_rename_pattern_single(
    name: &str,
    extension: &str,
    date_ts: Option<i64>,
    tags: &[String],
    pattern: &str,
    counter: usize,
) -> String {
    let mut new_name = pattern.to_string();
    let re_token = Regex::new(r"\{([A-Za-z0-9_-]+)\}").unwrap();
    let now = chrono::Local::now();
    let name_stem = Path::new(name)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

    let effective_date = date_ts
        .and_then(|ts| DateTime::<Utc>::from_timestamp(ts, 0))
        .map(|dt| dt.with_timezone(&Local))
        .unwrap_or(now);

    let tag_value = tags
        .first()
        .map(|t| t.trim().replace(' ', "_"))
        .unwrap_or_default();

    new_name = re_token
            .replace_all(&new_name, |caps: &regex::Captures| {
                match &caps[1] {
                    "name" | "filename" | "original" => name_stem.clone(),
                    "ext" | "extension" => extension.to_string(),
                    "counter" | "seq" => {
                        format!("{:03}", counter) // Default 3 digit padding
                    }
                    "YYYY" => effective_date.format("%Y").to_string(),
                    "MM" => effective_date.format("%m").to_string(),
                    "DD" => effective_date.format("%d").to_string(),
                    "YYYY-MM-DD" => effective_date.format("%Y-%m-%d").to_string(),
                    "tag" => tag_value.clone(),
                    _ => caps[0].to_string(), // Keep unknown tokens
                }
            })
            .to_string();

    // Ensure extension is preserved if logic dictates (simple logic for now)
    if !extension.is_empty() {
            let has_ext_token = pattern.contains("{ext}") || pattern.contains("{extension}");
            let ends_with_ext = new_name.to_lowercase().ends_with(&format!(".{}", extension.to_lowercase()));
            
            if !has_ext_token && !ends_with_ext {
                new_name = format!("{}.{}", new_name, extension);
            }
    }
    
    new_name
}

pub fn generate_preview(
    files: Vec<FileMetadata>, 
    pattern: &str,
    counter_start: usize,
) -> Vec<RenamePreview> {
    let mut previews = Vec::new();
    let mut counter = counter_start;
    
    for file in files {
        let extension = file.extension.clone().unwrap_or_default();
        
        let effective_date = file.exif_date.or(file.created_at);
        let new_name = apply_rename_pattern_single(
            &file.name,
            &extension,
            effective_date,
            &file.tags,
            pattern,
            counter,
        );

        // Handle counter increment
        if pattern.contains("{counter}") || pattern.contains("{seq}") {
            counter += 1;
        }

        let parent = Path::new(&file.path).parent().unwrap_or(Path::new(""));
        let new_path = parent.join(&new_name).to_string_lossy().to_string();

        previews.push(RenamePreview {
            file_id: file.id,
            original_name: file.name,
            new_name,
            original_path: file.path,
            new_path,
            conflict: None,
        });
    }

    let mut counts: HashMap<String, usize> = HashMap::new();
    for p in &previews {
        *counts.entry(p.new_path.clone()).or_insert(0) += 1;
    }

    previews
        .into_iter()
        .map(|mut p| {
            if counts.get(&p.new_path).copied().unwrap_or(0) > 1 {
                p.conflict = Some(RenameConflict {
                    kind: "duplicate".to_string(),
                    message: "Multiple files would resolve to the same name.".to_string(),
                });
            } else if p.new_path != p.original_path && Path::new(&p.new_path).exists() {
                p.conflict = Some(RenameConflict {
                    kind: "exists".to_string(),
                    message: "A file already exists at the destination.".to_string(),
                });
            }
            p
        })
        .collect()
}

#[tauri::command]
pub fn batch_rename_preview(
    app: AppHandle,
    paths: Vec<String>,
    pattern: &str,
) -> Result<Vec<RenamePreview>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    
    // Attempt to connect to DB, but don't fail hard if generic rename allows non-indexed files?
    // User requirement: "Update database". So we assume DB access is desired.
    let conn = Connection::open(db_path).ok(); 

    let file_metadata_list = build_file_metadata(conn.as_ref(), &paths);
    let previews = generate_preview(file_metadata_list, pattern, 1);
    Ok(previews)
}

#[tauri::command]
pub fn batch_rename(
    app: AppHandle,
    file_ids: Vec<i64>,
    pattern: &str,
) -> Result<Vec<RenamePreview>, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let file_metadata_list = build_file_metadata_from_ids(&conn, &file_ids)?;
    let previews = generate_preview(file_metadata_list, pattern, 1);

    Ok(previews)
}

#[tauri::command]
pub fn execute_batch_rename(
    app: AppHandle,
    renames: Vec<RenameOperation>,
) -> Result<String, String> {
    // Returns batch_id
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let batch_id = uuid::Uuid::new_v4().to_string();
    let _ = conn.execute("DELETE FROM operations WHERE undone = 1", []);

    let index_manager = app.state::<Arc<IndexManager>>();

    for rename in renames {
        if rename.skip {
            continue;
        }

        if rename.original_path == rename.new_path {
            continue;
        }

        let src = Path::new(&rename.original_path);
        let dst = Path::new(&rename.new_path);

        if !src.exists() {
            return Err(format!("Source not found: {}", rename.original_path));
        }

        if dst.exists() {
            if rename.overwrite {
                std::fs::remove_file(safe_path(dst))
                    .map_err(|e| format!("Failed to overwrite {}: {}", rename.new_path, e))?;
            } else {
                return Err(format!("Conflict: destination exists for {}", rename.new_path));
            }
        }

        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(safe_path(parent)).map_err(|e| e.to_string())?;
        }

        if let Err(_e) = std::fs::rename(safe_path(src), safe_path(dst)) {
            std::fs::copy(safe_path(src), safe_path(dst))
                .map_err(|err| format!("Failed to rename {}: {}", rename.original_path, err))?;
            std::fs::remove_file(safe_path(src))
                .map_err(|err| format!("Failed to remove original {}: {}", rename.original_path, err))?;
        }

        let file_size = std::fs::metadata(safe_path(dst)).map(|m| m.len()).unwrap_or(0);
        let performed_at = Utc::now().to_rfc3339();

        let original_name = Path::new(&rename.original_path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let new_name = Path::new(&rename.new_path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        conn.execute(
            "INSERT INTO operations (batch_id, operation, source_path, dest_path, file_size, metadata_json, performed_at, undo_data_json)
             VALUES (?1, 'rename', ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                batch_id,
                rename.original_path,
                rename.new_path,
                file_size as i64,
                serde_json::json!({
                    "original_name": original_name,
                    "new_name": new_name
                })
                .to_string(),
                performed_at,
                serde_json::json!({
                    "original_path": rename.original_path,
                    "target_path": rename.new_path
                })
                .to_string()
            ],
        )
        .map_err(|e| format!("Failed to log rename: {}", e))?;

        let parent = dst
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let extension = dst.extension().map(|e| e.to_string_lossy().to_string());

        let _ = conn.execute(
            "UPDATE files SET path = ?1, name = ?2, extension = ?3, parent_path = ?4, modified_at = ?5, is_deleted = 0 WHERE path = ?6",
            params![
                rename.new_path,
                new_name,
                extension,
                parent,
                performed_at,
                rename.original_path
            ],
        );

        let _ = conn.execute(
            "UPDATE duplicate_group_files SET file_path = ?1 WHERE file_path = ?2",
            params![rename.new_path, rename.original_path],
        );

        let _ = index_manager.remove_file(&rename.original_path);
        let modified = std::fs::metadata(safe_path(dst))
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let _ = index_manager.add_or_update_file(
            &rename.new_path,
            &new_name,
            extension.as_deref(),
            &parent,
            file_size as i64,
            modified,
        );
    }

    let _ = index_manager.commit();

    Ok(batch_id)
}

fn split_prefix_number(stem: &str) -> (String, Option<usize>) {
    let chars = stem.chars().collect::<Vec<_>>();
    let mut idx = chars.len();
    while idx > 0 && chars[idx - 1].is_ascii_digit() {
        idx -= 1;
    }

    if idx == chars.len() {
        return (stem.to_string(), None);
    }

    let prefix = chars[..idx].iter().collect::<String>();
    let number_len = chars.len() - idx;
    (prefix, Some(number_len))
}

fn build_heuristic_pattern(files: &[FileMetadata]) -> RenamePatternSuggestion {
    if files.is_empty() {
        return RenamePatternSuggestion {
            pattern: "{filename}_{counter}".to_string(),
            examples: Vec::new(),
        };
    }

    let mut prefix_counts: HashMap<String, usize> = HashMap::new();
    let mut with_dates = 0;
    let mut with_tags = 0;

    for file in files {
        let stem = Path::new(&file.name)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let (prefix, number_len) = split_prefix_number(&stem);
        if number_len.is_some() && !prefix.is_empty() {
            *prefix_counts.entry(prefix).or_insert(0) += 1;
        }
        if file.exif_date.or(file.created_at).is_some() {
            with_dates += 1;
        }
        if !file.tags.is_empty() {
            with_tags += 1;
        }
    }

    let min_threshold = std::cmp::max(2, (files.len() * 6) / 10);
    let mut common_prefix = None;
    for (prefix, count) in prefix_counts {
        if count >= min_threshold {
            common_prefix = Some(prefix);
            break;
        }
    }

    let include_date = with_dates * 2 >= files.len();
    let include_tag = with_tags * 2 >= files.len();

    let mut pattern = String::new();
    if include_date {
        pattern.push_str("{YYYY}-{MM}-{DD}_");
    }
    if include_tag {
        pattern.push_str("{tag}_");
    }

    if let Some(prefix) = common_prefix {
        pattern.push_str(&prefix);
        if !prefix.ends_with('_') && !prefix.ends_with('-') {
            pattern.push('_');
        }
        pattern.push_str("{counter}");
    } else {
        pattern.push_str("{filename}_{counter}");
    }

    let examples = files
        .iter()
        .take(3)
        .enumerate()
        .map(|(idx, file)| {
            let extension = file.extension.clone().unwrap_or_default();
            let effective_date = file.exif_date.or(file.created_at);
            let new_name = apply_rename_pattern_single(
                &file.name,
                &extension,
                effective_date,
                &file.tags,
                &pattern,
                idx + 1,
            );
            RenameExample {
                old: file.name.clone(),
                new: new_name,
            }
        })
        .collect();

    RenamePatternSuggestion { pattern, examples }
}

#[tauri::command]
pub async fn detect_rename_pattern(
    app: AppHandle,
    files: Vec<String>,
) -> Result<RenamePatternSuggestion, String> {
    // Load config
    let config = {
        let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
        let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;
        EmbeddingConfig::from_settings(&conn)
    };

    let conn = {
        let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
        Connection::open(db_path).ok()
    };

    let metadata = build_file_metadata(conn.as_ref(), &files);
    let location = {
        let mut parents = metadata
            .iter()
            .filter_map(|m| Path::new(&m.path).parent().map(|p| p.to_string_lossy().to_string()))
            .collect::<Vec<_>>();
        parents.dedup();
        if parents.len() == 1 {
            parents[0].clone()
        } else {
            "Multiple locations".to_string()
        }
    };

    let contexts: Vec<RenameFileContext> = metadata
        .iter()
        .map(|m| {
            let date_str = m
                .exif_date
                .or(m.created_at)
                .and_then(|ts| DateTime::<Utc>::from_timestamp(ts, 0))
                .map(|dt| dt.format("%Y-%m-%d").to_string());

            RenameFileContext {
                name: m.name.clone(),
                date: date_str,
                tags: m.tags.clone(),
            }
        })
        .collect();

    let engine = SuggestionEngine::new(app);
    match engine
        .detect_pattern_with_context(&contexts, &location, &config)
        .await
    {
        Ok(suggestion) => Ok(suggestion),
        Err(_) => Ok(build_heuristic_pattern(&metadata)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── apply_rename_pattern_single ────────────────────────────────
    #[test]
    fn rename_basic_name_counter() {
        let result = apply_rename_pattern_single(
            "photo.jpg", "jpg", None, &[], "{name}_{counter}", 1,
        );
        assert_eq!(result, "photo_001.jpg");
    }

    #[test]
    fn rename_preserves_extension() {
        let result = apply_rename_pattern_single(
            "report.pdf", "pdf", None, &[], "{name}", 1,
        );
        assert_eq!(result, "report.pdf");
    }

    #[test]
    fn rename_with_ext_token() {
        let result = apply_rename_pattern_single(
            "data.csv", "csv", None, &[], "{name}.{ext}", 1,
        );
        assert_eq!(result, "data.csv");
    }

    #[test]
    fn rename_with_tag_token() {
        let tags = vec!["vacation".to_string()];
        let result = apply_rename_pattern_single(
            "img.png", "png", None, &tags, "{tag}_{counter}", 5,
        );
        assert_eq!(result, "vacation_005.png");
    }

    #[test]
    fn rename_with_date_tokens() {
        // 2024-06-15 00:00:00 UTC → timestamp 1718409600
        let ts = Some(1718409600i64);
        let result = apply_rename_pattern_single(
            "doc.txt", "txt", ts, &[], "{YYYY}-{MM}-{DD}_{name}", 1,
        );
        assert!(result.starts_with("2024-06-15_doc") || result.starts_with("2024-06-1")); // TZ-dependent
        assert!(result.ends_with(".txt"));
    }

    #[test]
    fn rename_unknown_token_preserved() {
        let result = apply_rename_pattern_single(
            "f.txt", "txt", None, &[], "{unknown}_{name}", 1,
        );
        assert!(result.contains("{unknown}"));
    }

    // ── parse_datetime_to_timestamp ────────────────────────────────
    #[test]
    fn parse_rfc3339() {
        let ts = parse_datetime_to_timestamp("2024-06-15T12:00:00+00:00");
        assert!(ts.is_some());
    }

    #[test]
    fn parse_datetime_ymd_hms() {
        let ts = parse_datetime_to_timestamp("2024-06-15 12:00:00");
        assert!(ts.is_some());
    }

    #[test]
    fn parse_datetime_invalid() {
        assert!(parse_datetime_to_timestamp("not-a-date").is_none());
        assert!(parse_datetime_to_timestamp("").is_none());
    }

    // ── split_prefix_number ────────────────────────────────────────
    #[test]
    fn split_trailing_number() {
        let (prefix, len) = split_prefix_number("photo001");
        assert_eq!(prefix, "photo");
        assert_eq!(len, Some(3));
    }

    #[test]
    fn split_no_number() {
        let (prefix, len) = split_prefix_number("readme");
        assert_eq!(prefix, "readme");
        assert!(len.is_none());
    }

    #[test]
    fn split_all_digits() {
        let (prefix, len) = split_prefix_number("123");
        assert_eq!(prefix, "");
        assert_eq!(len, Some(3));
    }
}