use serde::{Deserialize, Serialize};
use std::fs;
use sysinfo::System;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct DiagnosticInfo {
    pub version: String,
    pub os: String,
    pub arch: String,
    pub indexed_files: u64,
    pub database_size_mb: f64,
    pub memory_usage_mb: f64,
    pub recent_errors: Vec<String>,
}

#[tauri::command]
pub async fn generate_diagnostics<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<DiagnosticInfo, String> {
    // Get version from Cargo.toml
    let version = env!("CARGO_PKG_VERSION").to_string();

    // Get system info
    let mut sys = System::new_all();
    sys.refresh_all();

    let os = format!(
        "{} {}",
        System::name().unwrap_or_else(|| "Unknown".to_string()),
        System::os_version().unwrap_or_else(|| "Unknown".to_string())
    );

    let arch = std::env::consts::ARCH.to_string();

    // Get memory usage (approximate)
    let memory_usage_mb = sys.used_memory() as f64 / 1024.0 / 1024.0;

    // Get database info
    let db_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("filenova.db");

    let (indexed_files, database_size_mb) = if db_path.exists() {
        let size = fs::metadata(&db_path)
            .map(|m| m.len() as f64 / 1024.0 / 1024.0)
            .unwrap_or(0.0);

        // Count indexed files from database
        let count = if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            conn.query_row("SELECT COUNT(*) FROM files WHERE is_directory = 0", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap_or(0) as u64
        } else {
            0
        };

        (count, size)
    } else {
        (0, 0.0)
    };

    // Get recent errors (this would read from logs in a real implementation)
    let recent_errors = vec![
        // Placeholder - would read from actual log file
    ];

    Ok(DiagnosticInfo {
        version,
        os,
        arch,
        indexed_files,
        database_size_mb,
        memory_usage_mb,
        recent_errors,
    })
}

#[tauri::command]
pub async fn write_diagnostic_report(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn check_index_integrity<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<bool, String> {
    let db_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("filenova.db");

    if !db_path.exists() {
        return Ok(true); // No database yet, so it's "valid"
    }

    // Open database and run integrity check
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

    let result: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(result == "ok")
}

#[tauri::command]
pub async fn vacuum_database<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    let db_path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("filenova.db");

    if !db_path.exists() {
        return Ok(());
    }

    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute("VACUUM", []).map_err(|e| e.to_string())?;

    Ok(())
}
