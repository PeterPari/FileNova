use rusqlite::{Connection, Result};
use std::path::{Path, PathBuf};
use tauri::Manager;

const SECRET_SERVICE_NAME: &str = "filenova";

/// Connection pool for the application databases.
pub struct DbPool {
    pub main: r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>,
    pub preview: r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>,
}

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub db_path: PathBuf,
    pub preview_db_path: PathBuf,
    pub index_path: PathBuf,
    pub vector_path: PathBuf,
    pub trash_dir: PathBuf,
}

pub fn resolve_app_paths(app: &tauri::AppHandle) -> std::result::Result<AppPaths, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {}", e))?;

    Ok(AppPaths {
        db_path: app_dir.join("filenova.db"),
        preview_db_path: app_dir.join("file_nova.db"),
        index_path: app_dir.join("search_index"),
        vector_path: app_dir.join("vector_store"),
        trash_dir: app_dir.join("filenova-trash"),
    })
}

impl DbPool {
    pub fn new(main_path: &Path, preview_path: &Path) -> std::result::Result<Self, String> {
        let main_mgr = r2d2_sqlite::SqliteConnectionManager::file(main_path);
        let main_pool = r2d2::Pool::builder()
            .max_size(8)
            .build(main_mgr)
            .map_err(|e| format!("Failed to create main pool: {}", e))?;

        // Set pragmas on each connection in the main pool
        if let Ok(conn) = main_pool.get() {
            let _ = conn.pragma_update(None, "journal_mode", "WAL");
            let _ = conn.pragma_update(None, "synchronous", "NORMAL");
        }

        let preview_mgr = r2d2_sqlite::SqliteConnectionManager::file(preview_path);
        let preview_pool = r2d2::Pool::builder()
            .max_size(4)
            .build(preview_mgr)
            .map_err(|e| format!("Failed to create preview pool: {}", e))?;

        if let Ok(conn) = preview_pool.get() {
            let _ = conn.pragma_update(None, "journal_mode", "WAL");
            let _ = conn.pragma_update(None, "synchronous", "NORMAL");
        }

        Ok(Self {
            main: main_pool,
            preview: preview_pool,
        })
    }
}

/// Get a pooled connection to the main database via AppHandle.
pub fn get_conn(app: &tauri::AppHandle) -> std::result::Result<r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>, String> {
    let pool = app.state::<DbPool>();
    pool.main.get().map_err(|e| format!("Pool error: {}", e))
}

/// Get a pooled connection to the preview/bookmarks database via AppHandle.
pub fn get_preview_conn(app: &tauri::AppHandle) -> std::result::Result<r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>, String> {
    let pool = app.state::<DbPool>();
    pool.preview.get().map_err(|e| format!("Pool error: {}", e))
}

pub fn get_setting_i64(conn: &Connection, key: &str, default_value: i64) -> i64 {
    get_setting(conn, key)
        .ok()
        .flatten()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(default_value)
}

pub fn init_db<P: AsRef<Path>>(path: P) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;

    // Create files table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            extension TEXT,
            size_bytes INTEGER NOT NULL,
            created_at DATETIME,
            modified_at DATETIME,
            accessed_at DATETIME,
            parent_path TEXT NOT NULL,
            hash_blake3 TEXT,
            content_extracted BOOLEAN DEFAULT FALSE,
            extraction_completed BOOLEAN DEFAULT FALSE,
            extracted_text TEXT,
            extraction_error TEXT,
            embedding_generated BOOLEAN DEFAULT FALSE,
            is_directory BOOLEAN DEFAULT FALSE,
            is_deleted BOOLEAN DEFAULT FALSE,
            indexed_at DATETIME NOT NULL
        )",
        [],
    )?;

    // Create settings table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    // Create activity table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS activity (
            id INTEGER PRIMARY KEY,
            file_path TEXT NOT NULL,
            action TEXT NOT NULL,
            old_path TEXT,
            detected_at DATETIME NOT NULL
        )",
        [],
    )?;

    // Stage 4: Add columns to files (silently fails if exists)
    let _ = conn.execute("ALTER TABLE files ADD COLUMN perceptual_hash TEXT", []);
    let _ = conn.execute("ALTER TABLE files ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE", []);

    // Create indexes (must run after ALTER TABLE so columns exist for older databases)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_parent_path ON files (parent_path)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_extension ON files (extension)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_modified_at ON files (modified_at)",
        [],
    )?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_name ON files (name)", [])?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_is_deleted ON files (is_deleted)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_activity_time ON activity (detected_at)",
        [],
    )?;

    // Stage 4: Create duplicate_groups table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS duplicate_groups (
            id INTEGER PRIMARY KEY,
            group_type TEXT NOT NULL DEFAULT 'exact',
            hash_blake3 TEXT,
            perceptual_hash TEXT,
            file_count INTEGER NOT NULL DEFAULT 0,
            total_wasted_bytes INTEGER NOT NULL DEFAULT 0,
            scanned_at DATETIME NOT NULL
        )",
        [],
    )?;

    // Stage 4: Create duplicate_group_files junction table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS duplicate_group_files (
            id INTEGER PRIMARY KEY,
            group_id INTEGER NOT NULL REFERENCES duplicate_groups(id) ON DELETE CASCADE,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            file_path TEXT NOT NULL,
            is_kept INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;

    // Stage 4: Create operations journal table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS operations (
            id INTEGER PRIMARY KEY,
            batch_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            source_path TEXT NOT NULL,
            dest_path TEXT,
            file_size INTEGER,
            metadata_json TEXT,
            performed_at DATETIME NOT NULL,
            undone INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;

    // Stage 4: New indexes
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_files_hash ON files (hash_blake3)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_files_phash ON files (perceptual_hash)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dup_group_files_group ON duplicate_group_files (group_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ops_batch ON operations (batch_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ops_undone ON operations (undone, performed_at)",
        [],
    )?;

    // Stage 5: Add content extraction & embedding columns (silently fails if exists)
    let _ = conn.execute(
        "ALTER TABLE files ADD COLUMN content_extracted BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE files ADD COLUMN extraction_completed BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute("ALTER TABLE files ADD COLUMN extracted_text TEXT", []);
    let _ = conn.execute("ALTER TABLE files ADD COLUMN extraction_error TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE files ADD COLUMN embedding_generated BOOLEAN DEFAULT FALSE",
        [],
    );

    let _ = conn.execute(
        "UPDATE files SET extraction_completed = content_extracted",
        [],
    );

    // Stage 8: Add undo_data_json to operations (silently fails if exists)
    let _ = conn.execute("ALTER TABLE operations ADD COLUMN undo_data_json TEXT", []);

    // Stage 5: Indexes for extraction pipeline queries
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_files_content_extracted ON files (content_extracted)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_files_extraction_completed ON files (extraction_completed)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_files_embedding ON files (embedding_generated)",
        [],
    )?;

    // Stage 6: Tags table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY,
            file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            source TEXT NOT NULL,
            confidence REAL,
            created_at DATETIME NOT NULL,
            UNIQUE(file_id, tag)
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tags_file ON tags(file_id)",
        [],
    )?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag)", [])?;

    // Stage 6: Rules table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS rules (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            condition_json TEXT NOT NULL,
            action_json TEXT NOT NULL,
            enabled BOOLEAN DEFAULT TRUE,
            trigger TEXT NOT NULL,
            schedule_cron TEXT,
            created_at DATETIME NOT NULL
        )",
        [],
    )?;

    // Stage 8: Rule suggestion feedback
    conn.execute(
        "CREATE TABLE IF NOT EXISTS rule_suggestion_feedback (
            id INTEGER PRIMARY KEY,
            signature TEXT UNIQUE NOT NULL,
            status TEXT NOT NULL,
            updated_at DATETIME NOT NULL
        )",
        [],
    )?;

    // Stage 7: Suggestions table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS suggestions (
            id INTEGER PRIMARY KEY,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            plan_json TEXT NOT NULL,
            file_count INTEGER NOT NULL,
            confidence REAL NOT NULL,
            status TEXT DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'modified'
            created_at DATETIME NOT NULL,
            resolved_at DATETIME
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_suggestions_created ON suggestions(created_at)",
        [],
    )?;

    // Stage 3: Search History
    conn.execute(
        "CREATE TABLE IF NOT EXISTS search_history (
            id INTEGER PRIMARY KEY,
            query TEXT NOT NULL,
            search_type TEXT NOT NULL, -- 'keyword', 'semantic', 'hybrid'
            result_count INTEGER,
            searched_at DATETIME NOT NULL
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_search_history_time ON search_history(searched_at DESC)",
        [],
    )?;

    // Stage 9: Chat Interface & Rule Automation
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chat_sessions (
            id INTEGER PRIMARY KEY,
            started_at DATETIME NOT NULL,
            last_message_at DATETIME NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY,
            session_id INTEGER REFERENCES chat_sessions(id),
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata_json TEXT,
            created_at DATETIME NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS rule_executions (
            id INTEGER PRIMARY KEY,
            rule_id INTEGER REFERENCES rules(id),
            executed_at DATETIME NOT NULL,
            files_affected INTEGER,
            success BOOLEAN,
            error_message TEXT
        )",
        [],
    )?;

    // Check for API Key in environment variables (for development)
    // and store it in the OS credential vault instead of plaintext DB.
    if let Ok(api_key) = std::env::var("GEMINI_API_KEY") {
        let _ = save_secret("gemini_api_key", &api_key);
    }

    // Stage 10: Recent Files table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS recent_files (
            file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
            accessed_at DATETIME NOT NULL,
            access_count INTEGER DEFAULT 1,
            PRIMARY KEY (file_id)
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_recent_files_accessed ON recent_files(accessed_at DESC)",
        [],
    )?;

    // Stage 10: Workspaces table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS workspaces (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            config_json TEXT NOT NULL,
            created_at DATETIME NOT NULL
        )",
        [],
    )?;

    Ok(conn)
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare_cached("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query([key])?;

    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn save_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        [key, value],
    )?;
    Ok(())
}

pub fn get_secret(key: &str) -> std::result::Result<Option<String>, String> {
    let entry = keyring::Entry::new(SECRET_SERVICE_NAME, key)
        .map_err(|e| format!("Failed to initialize secure store entry: {}", e))?;

    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read secure setting '{}': {}", key, e)),
    }
}

pub fn save_secret(key: &str, value: &str) -> std::result::Result<(), String> {
    let entry = keyring::Entry::new(SECRET_SERVICE_NAME, key)
        .map_err(|e| format!("Failed to initialize secure store entry: {}", e))?;

    if value.trim().is_empty() {
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Failed to clear secure setting '{}': {}", key, e)),
        }
    } else {
        entry
            .set_password(value)
            .map_err(|e| format!("Failed to save secure setting '{}': {}", key, e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        init_db(":memory:").expect("in-memory DB should initialize")
    }

    #[test]
    fn init_db_creates_tables() {
        let conn = test_conn();
        // Verify a few core tables exist by querying sqlite_master
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(tables.contains(&"files".to_string()));
        assert!(tables.contains(&"settings".to_string()));
        assert!(tables.contains(&"operations".to_string()));
        assert!(tables.contains(&"tags".to_string()));
        assert!(tables.contains(&"rules".to_string()));
    }

    #[test]
    fn get_setting_returns_none_for_missing_key() {
        let conn = test_conn();
        let val = get_setting(&conn, "nonexistent").unwrap();
        assert!(val.is_none());
    }

    #[test]
    fn save_and_get_setting() {
        let conn = test_conn();
        save_setting(&conn, "theme", "dark").unwrap();
        let val = get_setting(&conn, "theme").unwrap();
        assert_eq!(val, Some("dark".to_string()));
    }

    #[test]
    fn save_setting_upsert() {
        let conn = test_conn();
        save_setting(&conn, "lang", "en").unwrap();
        save_setting(&conn, "lang", "fr").unwrap();
        let val = get_setting(&conn, "lang").unwrap();
        assert_eq!(val, Some("fr".to_string()));
    }

    #[test]
    fn multiple_settings() {
        let conn = test_conn();
        save_setting(&conn, "a", "1").unwrap();
        save_setting(&conn, "b", "2").unwrap();
        save_setting(&conn, "c", "3").unwrap();
        assert_eq!(get_setting(&conn, "a").unwrap(), Some("1".to_string()));
        assert_eq!(get_setting(&conn, "b").unwrap(), Some("2".to_string()));
        assert_eq!(get_setting(&conn, "c").unwrap(), Some("3".to_string()));
    }
}
