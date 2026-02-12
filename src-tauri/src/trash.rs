use chrono::{DateTime, Duration, Utc};
use crate::long_path::safe_path;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf, Prefix};
use tauri::{AppHandle, Manager, Emitter};
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
pub struct TrashMetadata {
    pub original_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub deleted_at: String,
    pub batch_id: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TrashItem {
    pub id: i64, // Operation ID
    pub original_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub deleted_at: String,
}

fn build_trash_relative_path(original: &Path) -> PathBuf {
    let mut rel = PathBuf::new();

    for comp in original.components() {
        match comp {
            Component::Prefix(prefix) => {
                let label = match prefix.kind() {
                    Prefix::Disk(d) | Prefix::VerbatimDisk(d) => {
                        format!("drive_{}", d as char)
                    }
                    Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => format!(
                        "unc_{}_{}",
                        server.to_string_lossy(),
                        share.to_string_lossy()
                    ),
                    _ => "path".to_string(),
                };
                rel.push(label);
            }
            Component::RootDir => {}
            Component::Normal(part) => rel.push(part),
            Component::CurDir => {}
            Component::ParentDir => rel.push(".."),
        }
    }

    if rel.as_os_str().is_empty() {
        rel.push("unknown");
    }

    rel
}

fn unique_trash_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }

    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let ext = path.extension().map(|e| e.to_string_lossy());
    let suffix = Uuid::new_v4().to_string();

    let new_name = if let Some(ext) = ext {
        format!("{}_{}.{}", stem, suffix, ext)
    } else {
        format!("{}_{}", stem, suffix)
    };

    path.with_file_name(new_name)
}

#[tauri::command]
pub fn get_trash_items(app: AppHandle) -> Result<Vec<TrashItem>, String> {
    let conn = crate::db::get_conn(&app)?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT id, source_path, file_size, metadata_json, performed_at 
             FROM operations 
             WHERE operation = 'move_to_trash' AND undone = 0
             ORDER BY performed_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([], |row| {
             let metadata_json: String = row.get(3)?;
             let meta: TrashMetadata = serde_json::from_str(&metadata_json).unwrap_or_else(|_| TrashMetadata {
                 original_path: row.get(1).unwrap_or_default(),
                 file_name: Path::new(&row.get::<_, String>(1).unwrap_or_default())
                    .file_name().unwrap_or_default().to_string_lossy().to_string(),
                 file_size: row.get(2).unwrap_or(0),
                 deleted_at: row.get(4).unwrap_or_default(),
                 batch_id: "".to_string()
             });

            Ok(TrashItem {
                id: row.get(0)?,
                original_path: row.get(1)?,
                file_name: meta.file_name,
                file_size: row.get::<_, i64>(2)? as u64,
                deleted_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for item in items {
        if let Ok(i) = item {
            result.push(i);
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn empty_trash_bin(app: AppHandle) -> Result<(), String> {
    let conn = crate::db::get_conn(&app)?;
    let trash_dir = get_trash_dir(&app);

    // 1. Get all active trash operations
    let mut stmt = conn.prepare_cached("SELECT id, source_path, dest_path FROM operations WHERE operation = 'move_to_trash' AND undone = 0").map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    }).map_err(|e| e.to_string())?;

    for row in rows {
        if let Ok((op_id, source_path, dest_path)) = row {
            let dest = Path::new(&dest_path);
            // Delete the trashed file and metadata
            let _ = fs::remove_file(safe_path(dest));
            let meta_path = dest.with_file_name(format!("{}.metadata.json", dest.file_name().unwrap_or_default().to_string_lossy()));
            let _ = fs::remove_file(safe_path(&meta_path));

            // Delete empty parent folders inside trash root
            if let Some(parent) = dest.parent() {
                 if parent.starts_with(&trash_dir) {
                     let _ = fs::remove_dir_all(safe_path(parent));
                 }
            }
            
            // Remove DB records
            let _ = conn.execute("DELETE FROM tags WHERE file_id IN (SELECT id FROM files WHERE path = ?1)", [&source_path]);
            let _ = conn.execute("DELETE FROM duplicate_group_files WHERE file_path = ?1", [&source_path]);
            let _ = conn.execute("DELETE FROM files WHERE path = ?1", [&source_path]);
            let _ = conn.execute("DELETE FROM operations WHERE id = ?1", [op_id]);
        }
    }
    
    // Also ensure the trash directory is actually empty of any orphans
    if trash_dir.exists() {
        for entry in fs::read_dir(safe_path(&trash_dir)).map_err(|e| e.to_string())? {
             if let Ok(e) = entry {
                 let _ = fs::remove_dir_all(safe_path(&e.path()));
             }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn restore_trash_items(app: AppHandle, operation_ids: Vec<i64>) -> Result<(), String> {
    let conn = crate::db::get_conn(&app)?;
    
    for op_id in operation_ids {
        // reuse restore logic but customized for single ID
         restore_single_item(&conn, op_id)?;
    }
    Ok(())
}

fn restore_single_item(conn: &Connection, op_id: i64) -> Result<(), String> {
    let mut stmt = conn.prepare_cached("SELECT source_path, dest_path, metadata_json FROM operations WHERE id = ?1").map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![op_id]).map_err(|e| e.to_string())?;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let source_path: String = row.get(0).map_err(|e| e.to_string())?;
        let dest_path: String = row.get(1).map_err(|e| e.to_string())?;
        let metadata_json: String = row.get(2).map_err(|e| e.to_string())?;
        
        let dest = Path::new(&dest_path);
        let source = Path::new(&source_path);

        if !dest.exists() {
             return Err(format!("Trash file not found: {}", dest_path));
        }
        
         // Check if original location is already occupied
        if source.exists() {
            return Err(format!("Cannot restore: file already exists at {}", source_path));
        }

        // Ensure parent directory exists
        if let Some(parent) = source.parent() {
            fs::create_dir_all(safe_path(parent)).map_err(|e| e.to_string())?;
        }

        // Move file back
        if let Err(_e) = fs::rename(safe_path(dest), safe_path(source)) {
             // Try copy if rename fails (cross-device)
             fs::copy(safe_path(dest), safe_path(source)).map_err(|err| format!("Failed to restore: {}", err))?;
             fs::remove_file(safe_path(dest)).ok();
        }
        
         // Mark operation as undone
        conn.execute("UPDATE operations SET undone = 1 WHERE id = ?1", [op_id])
            .map_err(|e| e.to_string())?;
            
         // Restore files table row and clear deleted flag
         if let Ok(meta) = serde_json::from_str::<TrashMetadata>(&metadata_json) {
              let parent = Path::new(&meta.original_path)
                  .parent()
                  .unwrap_or(Path::new(""))
                  .to_string_lossy()
                  .to_string();

              let updated = conn.execute(
                  "UPDATE files SET is_deleted = 0 WHERE path = ?1",
                  params![meta.original_path],
              ).unwrap_or(0);

              if updated == 0 {
                  let _ = conn.execute(
                      "INSERT OR IGNORE INTO files (path, name, size_bytes, is_directory, modified_at, parent_path, indexed_at, is_deleted)
                       VALUES (?1, ?2, ?3, 0, strftime('%s', 'now'), ?4, strftime('%s', 'now'), 0)",
                       params![meta.original_path, meta.file_name, meta.file_size as i64, parent]
                  );
              }
         }
         
         // Clean up trash folder
         if let Some(parent) = dest.parent() {
             let _ = fs::remove_dir(safe_path(parent)); // Only removes if empty, which is what we want (metadata.json might be left if we don't delete it)
             // We should actally delete the whole folder
             let _ = fs::remove_dir_all(safe_path(parent));
         }
    }
    Ok(())
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

    // Check disk space at trash destination
    crate::error_handling::require_disk_space(&trash_dir)?;

    let _ = conn.execute("DELETE FROM operations WHERE undone = 1", []);
    let file_name = source
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let relative = build_trash_relative_path(source);
    let mut dest = trash_dir.join(&relative);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(safe_path(parent)).map_err(|e| e.to_string())?;
    }

    dest = unique_trash_path(&dest);
    let file_size = fs::metadata(safe_path(source)).map(|m| m.len()).unwrap_or(0);

    // Move the file (rename, or copy+delete as fallback)
    if let Err(_) = fs::rename(safe_path(source), safe_path(&dest)) {
        fs::copy(safe_path(source), safe_path(&dest)).map_err(|e| format!("Failed to copy file to trash: {}", e))?;
        fs::remove_file(safe_path(source))
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
    let dest_name = dest.file_name().unwrap_or_default().to_string_lossy();
    let metadata_path = dest.with_file_name(format!("{}.metadata.json", dest_name));
    fs::write(safe_path(&metadata_path), &metadata_json).map_err(|e| e.to_string())?;

    // Log to operations table
    conn.execute(
        "INSERT INTO operations (batch_id, operation, source_path, dest_path, file_size, metadata_json, performed_at, undone, undo_data_json)
         VALUES (?1, 'move_to_trash', ?2, ?3, ?4, ?5, ?6, 0, ?7)",
        params![
            batch_id,
            file_path,
            dest.to_string_lossy().to_string(),
            file_size as i64,
            &metadata_json,
            &now,
            serde_json::json!({
                "original_path": file_path,
                "deleted_at": now
            })
            .to_string()
        ],
    )
    .map_err(|e| e.to_string())?;

    // Keep the file row but mark it as deleted
    let _ = conn.execute(
        "UPDATE files SET is_deleted = 1, modified_at = ?1 WHERE path = ?2",
        params![now, file_path],
    );

    Ok(dest.to_string_lossy().to_string())
}

pub fn restore_from_trash(
    _app: &AppHandle,
    conn: &Connection,
    batch_id: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare_cached(
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
            fs::create_dir_all(safe_path(parent)).map_err(|e| e.to_string())?;
        }

        // Move file back
        if let Err(_) = fs::rename(safe_path(dest), safe_path(source)) {
            fs::copy(safe_path(dest), safe_path(source))
                .map_err(|e| format!("Failed to restore file: {}", e))?;
            fs::remove_file(safe_path(dest)).ok();
        }

        // Mark operation as undone
        conn.execute("UPDATE operations SET undone = 1 WHERE id = ?1", [op_id])
            .map_err(|e| e.to_string())?;

        // Restore file metadata and clear deleted flag
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

                let updated = conn.execute(
                    "UPDATE files SET is_deleted = 0 WHERE path = ?1",
                    params![meta.original_path],
                ).unwrap_or(0);

                if updated == 0 {
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO files (path, name, extension, size_bytes, created_at, modified_at, parent_path, is_directory, indexed_at, is_deleted)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, 0)",
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
        }

        // Clean up the trash entry directory
        if let Some(trash_entry_dir) = dest.parent() {
            let _ = fs::remove_dir_all(trash_entry_dir);
        }

        restored.push(source_path.clone());
    }

    Ok(restored)
}

pub fn redo_trash_batch(
    app: &AppHandle,
    conn: &Connection,
    batch_id: &str,
) -> Result<Vec<String>, String> {
    // Select undone trash operations
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, source_path, metadata_json FROM operations
             WHERE batch_id = ?1 AND operation = 'move_to_trash' AND undone = 1",
        )
        .map_err(|e| e.to_string())?;

    let ops: Vec<(i64, String, String)> = stmt
        .query_map([batch_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut redone_paths = Vec::new();

    for (op_id, source_path, metadata_json) in ops {
        let source = Path::new(&source_path);
        if !source.exists() {
            continue;
        }

        // We need to move it back to trash.
        // We can reuse the existing operation record but we need to re-create the trash file.
        // Or we can just use move_to_trash but that inserts a NEW record.
        // To strictly "redo" and toggle undone=0, we need to manually move and update the DB row.
        
        let trash_dir = get_trash_dir(app);
        // We need to generate a new entry_id because the old one was likely deleted on restore
        let entry_id = Uuid::new_v4().to_string(); 
        let entry_dir = trash_dir.join(&entry_id);
        fs::create_dir_all(&entry_dir).map_err(|e| e.to_string())?;

        let meta: TrashMetadata = serde_json::from_str(&metadata_json).map_err(|e| e.to_string())?;
        let dest = entry_dir.join(&meta.file_name);
        
        // Move file
        if let Err(_) = fs::rename(source, &dest) {
             fs::copy(source, &dest).map_err(|e| e.to_string())?;
             fs::remove_file(source).ok();
        }

        // Write metadata file
        fs::write(entry_dir.join("metadata.json"), &metadata_json).map_err(|e| e.to_string())?;

        // Update operation record: Update dest_path (directory changed), undone=0, performed_at=now? 
        // We should probably keep original performed_at but update the metadata/dest?
        // Actually, if we change dest_path, we must update it.
        // The previous dest_path is invalid now.
        
        conn.execute(
            "UPDATE operations SET dest_path = ?1, undone = 0 WHERE id = ?2",
            params![dest.to_string_lossy().to_string(), op_id]
        ).map_err(|e| e.to_string())?;
        
        // Remove from files table
        conn.execute("DELETE FROM files WHERE path = ?1", [&source_path]).ok();

        redone_paths.push(source_path);
    }

    Ok(redone_paths)
}

pub fn cleanup_old_trash(app: &AppHandle, retention_days: i64) -> Result<u64, String> {
    let trash_dir = get_trash_dir(app);
    if !trash_dir.exists() {
        return Ok(0);
    }

    let cutoff = Utc::now() - Duration::days(retention_days);
    let mut cleaned = 0u64;

    let conn = crate::db::get_conn(app)?;

    let mut stmt = conn.prepare_cached(
        "SELECT id, source_path, dest_path, performed_at FROM operations
         WHERE operation = 'move_to_trash' AND undone = 0",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    }).map_err(|e| e.to_string())?;

    for row in rows {
        if let Ok((op_id, source_path, dest_path, performed_at)) = row {
            let deleted_at = DateTime::parse_from_rfc3339(&performed_at).unwrap_or_else(|_| Utc::now().fixed_offset());
            if deleted_at < cutoff {
                let dest = Path::new(&dest_path);
                let _ = fs::remove_file(dest);
                let meta_path = dest.with_file_name(format!("{}.metadata.json", dest.file_name().unwrap_or_default().to_string_lossy()));
                let _ = fs::remove_file(meta_path);

                if let Some(parent) = dest.parent() {
                    if parent.starts_with(&trash_dir) {
                        let _ = fs::remove_dir_all(parent);
                    }
                }

                let _ = conn.execute("DELETE FROM tags WHERE file_id IN (SELECT id FROM files WHERE path = ?1)", [&source_path]);
                let _ = conn.execute("DELETE FROM duplicate_group_files WHERE file_path = ?1", [&source_path]);
                let _ = conn.execute("DELETE FROM files WHERE path = ?1", [&source_path]);
                let _ = conn.execute("DELETE FROM operations WHERE id = ?1", [op_id]);

                cleaned += 1;
            }
        }
    }

    Ok(cleaned)
}

#[tauri::command]
pub fn move_file_to_trash(app: AppHandle, path: String) -> Result<(), String> {
    let conn = crate::db::get_conn(&app)?;
    
    let batch_id = Uuid::new_v4().to_string();
    
    move_to_trash(&app, &conn, &path, &batch_id)?;
    
    let _ = app.emit("trash-updated", ());
    let _ = app.emit("file-changed", ());
    
    Ok(())
}

fn get_trash_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("filenova-trash")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn trash_relative_path_windows_drive() {
        let p = Path::new("C:\\Users\\test\\file.txt");
        let rel = build_trash_relative_path(p);
        let s = rel.to_string_lossy().replace('\\', "/");
        assert!(s.starts_with("drive_C"));
        assert!(s.contains("Users"));
        assert!(s.contains("file.txt"));
    }

    #[test]
    fn trash_relative_path_empty() {
        let p = Path::new("");
        let rel = build_trash_relative_path(p);
        assert_eq!(rel, PathBuf::from("unknown"));
    }

    #[test]
    fn trash_relative_path_relative_input() {
        let p = Path::new("some/folder/file.txt");
        let rel = build_trash_relative_path(p);
        let s = rel.to_string_lossy().replace('\\', "/");
        assert!(s.contains("some"));
        assert!(s.contains("folder"));
        assert!(s.contains("file.txt"));
    }

    #[test]
    fn trash_item_struct_fields() {
        let item = TrashItem {
            id: 1,
            original_path: "/tmp/test.txt".to_string(),
            file_name: "test.txt".to_string(),
            file_size: 1024,
            deleted_at: "2024-01-01".to_string(),
        };
        assert_eq!(item.file_name, "test.txt");
        assert_eq!(item.file_size, 1024);
    }

    #[test]
    fn unique_trash_path_nonexistent() {
        // For a path that does not exist, unique_trash_path should return it unchanged
        let p = Path::new("C:\\nonexistent_dir_abc123\\file.txt");
        let result = unique_trash_path(p);
        assert_eq!(result, p);
    }
}