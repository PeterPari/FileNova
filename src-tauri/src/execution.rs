use crate::long_path::safe_path;
use crate::search_index::IndexManager;
use chrono::Utc;
use log::warn;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::SystemTime;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileMove {
    pub file_path: String,
    pub new_path: String,
    pub reason: Option<String>,
}

pub fn execute_moves_with_operation(
    app: Option<&AppHandle>,
    conn: &Connection,
    moves: Vec<FileMove>,
    batch_id: &str,
    operation: &str,
) -> Result<(), String> {
    // Check disk space before starting moves
    if let Some(first_mv) = moves.first() {
        let dst = Path::new(&first_mv.new_path);
        let check_path = dst.parent().unwrap_or(dst).to_path_buf();
        crate::error_handling::require_disk_space(&check_path)?;
    }

    let _ = conn.execute("DELETE FROM operations WHERE undone = 1", []);

    let index_manager = app.map(|a| a.state::<Arc<IndexManager>>());

    for mv in moves {
        let src = Path::new(&mv.file_path);
        let dst = Path::new(&mv.new_path);

        // 1. Validate
        if !src.exists() {
            warn!("Source not found: {:?}", src);
            continue; // Skip or Error? Skipping for now to allow partial success
        }

        if let Some(parent) = dst.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(safe_path(parent)).map_err(|e| e.to_string())?;
            }
        }

        // 2. Move (Rename)
        // Check for collision
        let final_dst = if dst.exists() {
            // Simple rename strategy if conflict: append timestamp
            // In a real app, we might ask user or have a strategy in the plan
            let file_stem = dst.file_stem().unwrap().to_string_lossy();
            let ext = dst
                .extension()
                .map(|e| e.to_string_lossy())
                .unwrap_or_default();
            let timestamp = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            let new_name = if ext.is_empty() {
                format!("{}_{}", file_stem, timestamp)
            } else {
                format!("{}_{}.{}", file_stem, timestamp, ext)
            };
            dst.with_file_name(new_name)
        } else {
            dst.to_path_buf()
        };

        let file_size = std::fs::metadata(safe_path(src)).map(|m| m.len()).unwrap_or(0);

        // Perform the move
        std::fs::rename(safe_path(src), safe_path(&final_dst))
            .map_err(|e| format!("Failed to move {:?} to {:?}: {}", src, final_dst, e))?;

        // 3. Log to Operations Table
        // "operation", "source_path", "dest_path", "file_size", "performed_at", "batch_id"
        let metadata = serde_json::json!({
            "original_dst": mv.new_path // Store intended dest in case we renamed on collision
        });

        let performed_at = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO operations (batch_id, operation, source_path, dest_path, file_size, metadata_json, performed_at, undo_data_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            (
                batch_id,
                operation,
                src.to_string_lossy().to_string(),
                final_dst.to_string_lossy().to_string(),
                file_size,
                metadata.to_string(),
                performed_at,
                serde_json::json!({
                    "original_path": src.to_string_lossy(),
                    "target_path": final_dst.to_string_lossy()
                }).to_string()
            ),
        ).map_err(|e| format!("Failed to log operation: {}", e))?;

        // 4. Update Files Table
        // We need to update the path of the existing file record
        // AND potentially update children if it's a directory (naive recursive update not implemented here yet)

        let _ = conn.execute(
            "UPDATE files SET path = ?1, parent_path = ?2, modified_at = ?3 WHERE path = ?4",
            (
                final_dst.to_string_lossy().to_string(),
                final_dst.parent().unwrap().to_string_lossy().to_string(),
                Utc::now().to_rfc3339(),
                src.to_string_lossy().to_string(),
            ),
        );

        if let Some(index_manager) = index_manager.as_ref() {
            let _ = index_manager.remove_file(&src.to_string_lossy());
            if let Ok(meta) = std::fs::metadata(safe_path(&final_dst)) {
                let name = final_dst
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let extension = final_dst.extension().map(|e| e.to_string_lossy().to_string());
                let parent = final_dst
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);

                let _ = index_manager.add_or_update_file(
                    &final_dst.to_string_lossy(),
                    &name,
                    extension.as_deref(),
                    &parent,
                    meta.len() as i64,
                    modified,
                );
            }
        }
    }

    if let Some(index_manager) = index_manager.as_ref() {
        let _ = index_manager.commit();
    }

    Ok(())
}

#[allow(dead_code)]
pub fn execute_moves(conn: &Connection, moves: Vec<FileMove>, batch_id: &str) -> Result<(), String> {
    execute_moves_with_operation(None, conn, moves, batch_id, "move")
}

pub fn undo_move_batch(conn: &Connection, batch_id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, source_path, dest_path FROM operations
             WHERE batch_id = ?1 AND operation IN ('move', 'rename') AND undone = 0",
        )
        .map_err(|e| e.to_string())?;

    let ops: Vec<(i64, String, String)> = stmt
        .query_map([batch_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut restored = Vec::new();

    for (op_id, source_path, dest_path) in ops {
        let current_loc = Path::new(&dest_path);
        let original_loc = Path::new(&source_path);

        if !current_loc.exists() {
            // File missing from where it was moved to?
            // Maybe user moved it again? We can't safely undo.
            // Log warning?
            warn!("Cannot undo move: File not found at {}", dest_path);
            continue;
        }

        if original_loc.exists() {
            warn!(
                "Cannot undo move: Original location occupied {}",
                source_path
            );
            continue;
        }

        if let Some(parent) = original_loc.parent() {
            std::fs::create_dir_all(safe_path(parent)).map_err(|e| e.to_string())?;
        }

        std::fs::rename(safe_path(current_loc), safe_path(original_loc))
            .map_err(|e| format!("Failed to move back: {}", e))?;

        // Updates files table
        let _ = conn.execute(
            "UPDATE files SET path = ?1, parent_path = ?2, modified_at = ?3 WHERE path = ?4",
            (
                source_path.clone(),
                original_loc.parent().unwrap().to_string_lossy().to_string(),
                Utc::now().to_rfc3339(),
                dest_path.clone(),
            ),
        );

        conn.execute("UPDATE operations SET undone = 1 WHERE id = ?1", [op_id])
            .map_err(|e| e.to_string())?;

        restored.push(source_path);
    }

    Ok(restored)
}

pub fn redo_move_batch(conn: &Connection, batch_id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, source_path, dest_path, undo_data_json FROM operations 
             WHERE batch_id = ?1 AND operation IN ('move', 'rename') AND undone = 1",
        )
        .map_err(|e| e.to_string())?;

    let ops: Vec<(i64, String, String, String)> = stmt
        .query_map([batch_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3).unwrap_or_default(),
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut redone_paths = Vec::new();

    for (op_id, _source_path, _dest_path, undo_data_json) in ops {
        // undo_data_json contains { original_path, target_path }
        // When we undid, we moved FROM target_path TO original_path.
        // The 'operations' table source_path/dest_path might be confusing now.
        // Usually source_path = original, dest_path = target.
        // When undone=1, the file is at original path.
        // We want to move it back to target path.

        let undo_data: serde_json::Value =
            serde_json::from_str(&undo_data_json).unwrap_or_default();
        let original_path = undo_data["original_path"].as_str().unwrap_or("");
        let target_path = undo_data["target_path"].as_str().unwrap_or("");

        if original_path.is_empty() || target_path.is_empty() {
            continue;
        }

        let current_loc = Path::new(original_path);
        let target_loc = Path::new(target_path);

        if !current_loc.exists() {
            continue; // Can't redo if file is missing
        }

        // Ensure target dir exists
        if let Some(parent) = target_loc.parent() {
            std::fs::create_dir_all(safe_path(parent)).ok();
        }

        std::fs::rename(safe_path(current_loc), safe_path(target_loc))
            .map_err(|e| format!("Failed to redo move: {}", e))?;

        // Update files table
        let _ = conn.execute(
            "UPDATE files SET path = ?1, parent_path = ?2, modified_at = ?3 WHERE path = ?4",
            (
                target_path,
                target_loc.parent().unwrap().to_string_lossy().to_string(),
                Utc::now().to_rfc3339(),
                original_path,
            ),
        );

        conn.execute("UPDATE operations SET undone = 0 WHERE id = ?1", [op_id])
            .map_err(|e| e.to_string())?;

        redone_paths.push(target_path.to_string());
    }

    Ok(redone_paths)
}
