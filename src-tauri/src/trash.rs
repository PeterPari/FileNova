use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
pub struct TrashMetadata {
    pub original_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub deleted_at: String,
    pub batch_id: String,
}

pub fn get_trash_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("trash")
}

pub fn move_to_trash(
    app: &AppHandle,
    conn: &Connection,
    file_path: &str,
    batch_id: &str,
) -> Result<String, String> {
    let source = Path::new(file_path);
    if !source.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let trash_dir = get_trash_dir(app);
    let entry_id = Uuid::new_v4().to_string();
    let entry_dir = trash_dir.join(&entry_id);
    fs::create_dir_all(&entry_dir).map_err(|e| e.to_string())?;

    let file_name = source
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let dest = entry_dir.join(&file_name);
    let file_size = fs::metadata(source).map(|m| m.len()).unwrap_or(0);

    // Move the file (rename, or copy+delete as fallback)
    if let Err(_) = fs::rename(source, &dest) {
        fs::copy(source, &dest).map_err(|e| format!("Failed to copy file to trash: {}", e))?;
        fs::remove_file(source)
            .map_err(|e| format!("Copied to trash but failed to remove original: {}", e))?;
    }

    // Write metadata
    let now = Utc::now().to_rfc3339();
    let metadata = TrashMetadata {
        original_path: file_path.to_string(),
        file_name: file_name.clone(),
        file_size,
        deleted_at: now.clone(),
        batch_id: batch_id.to_string(),
    };
    let metadata_json = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    fs::write(entry_dir.join("metadata.json"), &metadata_json).map_err(|e| e.to_string())?;

    // Log to operations table
    conn.execute(
        "INSERT INTO operations (batch_id, operation, source_path, dest_path, file_size, metadata_json, performed_at, undone)
         VALUES (?1, 'move_to_trash', ?2, ?3, ?4, ?5, ?6, 0)",
        params![
            batch_id,
            file_path,
            dest.to_string_lossy().to_string(),
            file_size as i64,
            &metadata_json,
            &now
        ],
    )
    .map_err(|e| e.to_string())?;

    // Remove from files table
    conn.execute("DELETE FROM files WHERE path = ?1", [file_path])
        .map_err(|e| e.to_string())?;

    // Remove from duplicate_group_files
    conn.execute(
        "DELETE FROM duplicate_group_files WHERE file_path = ?1",
        [file_path],
    )
    .map_err(|e| e.to_string())?;

    Ok(entry_id)
}

pub fn restore_from_trash(
    _app: &AppHandle,
    conn: &Connection,
    batch_id: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, source_path, dest_path, metadata_json FROM operations
             WHERE batch_id = ?1 AND operation = 'move_to_trash' AND undone = 0",
        )
        .map_err(|e| e.to_string())?;

    let ops: Vec<(i64, String, String, String)> = stmt
        .query_map([batch_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut restored = Vec::new();

    for (op_id, source_path, dest_path, metadata_json) in &ops {
        let dest = Path::new(dest_path);
        let source = Path::new(source_path);

        if !dest.exists() {
            // File already gone from trash (cleanup ran or manual deletion)
            conn.execute("UPDATE operations SET undone = 1 WHERE id = ?1", [op_id])
                .map_err(|e| e.to_string())?;
            continue;
        }

        // Check if original location is already occupied
        if source.exists() {
            return Err(format!(
                "Cannot restore: file already exists at {}",
                source_path
            ));
        }

        // Ensure parent directory exists
        if let Some(parent) = source.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        // Move file back
        if let Err(_) = fs::rename(dest, source) {
            fs::copy(dest, source)
                .map_err(|e| format!("Failed to restore file: {}", e))?;
            fs::remove_file(dest).ok();
        }

        // Mark operation as undone
        conn.execute("UPDATE operations SET undone = 1 WHERE id = ?1", [op_id])
            .map_err(|e| e.to_string())?;

        // Re-insert file metadata into files table from the stored metadata
        if let Ok(meta) = serde_json::from_str::<TrashMetadata>(metadata_json) {
            let path = Path::new(&meta.original_path);
            if let Ok(file_meta) = fs::metadata(path) {
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
                let now = Utc::now().timestamp();

                let modified = file_meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64);

                let created = file_meta
                    .created()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64);

                let _ = conn.execute(
                    "INSERT OR IGNORE INTO files (path, name, extension, size_bytes, created_at, modified_at, parent_path, is_directory, indexed_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
                    params![
                        meta.original_path,
                        name,
                        extension,
                        meta.file_size as i64,
                        created,
                        modified,
                        parent,
                        now
                    ],
                );
            }
        }

        // Clean up the trash entry directory
        if let Some(trash_entry_dir) = dest.parent() {
            let _ = fs::remove_dir_all(trash_entry_dir);
        }

        restored.push(source_path.clone());
    }

    Ok(restored)
}

pub fn cleanup_old_trash(app: &AppHandle, retention_days: i64) -> Result<u64, String> {
    let trash_dir = get_trash_dir(app);
    if !trash_dir.exists() {
        return Ok(0);
    }

    let cutoff = Utc::now() - Duration::days(retention_days);
    let mut cleaned = 0u64;

    let entries = fs::read_dir(&trash_dir).map_err(|e| e.to_string())?;

    for entry in entries.filter_map(|e| e.ok()) {
        let meta_path = entry.path().join("metadata.json");
        if let Ok(contents) = fs::read_to_string(&meta_path) {
            if let Ok(meta) = serde_json::from_str::<TrashMetadata>(&contents) {
                if let Ok(deleted_at) = DateTime::parse_from_rfc3339(&meta.deleted_at) {
                    if deleted_at < cutoff {
                        let _ = fs::remove_dir_all(entry.path());
                        cleaned += 1;
                    }
                }
            }
        }
    }

    Ok(cleaned)
}
