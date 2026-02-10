use crate::db;
use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileMove {
    pub file_path: String,
    pub new_path: String,
    pub reason: Option<String>,
}

pub fn execute_moves(
    conn: &Connection,
    moves: Vec<FileMove>,
    batch_id: &str,
) -> Result<(), String> {
    for mv in moves {
        let src = Path::new(&mv.file_path);
        let dst = Path::new(&mv.new_path);

        // 1. Validate
        if !src.exists() {
            eprintln!("Source not found: {:?}", src);
            continue; // Skip or Error? Skipping for now to allow partial success
        }

        if let Some(parent) = dst.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
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

        let file_size = std::fs::metadata(src).map(|m| m.len()).unwrap_or(0);

        // Perform the move
        std::fs::rename(src, &final_dst)
            .map_err(|e| format!("Failed to move {:?} to {:?}: {}", src, final_dst, e))?;

        // 3. Log to Operations Table
        // "operation", "source_path", "dest_path", "file_size", "performed_at", "batch_id"
        let metadata = serde_json::json!({
            "original_dst": mv.new_path // Store intended dest in case we renamed on collision
        });

        conn.execute(
            "INSERT INTO operations (batch_id, operation, source_path, dest_path, file_size, metadata_json, performed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (
                batch_id,
                "move",
                src.to_string_lossy().to_string(),
                final_dst.to_string_lossy().to_string(),
                file_size,
                metadata.to_string(),
                Utc::now().to_rfc3339(),
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
    }

    Ok(())
}
