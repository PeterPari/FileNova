use rusqlite::{Connection, Result};
use std::path::Path;

pub fn init_db<P: AsRef<Path>>(path: P) -> Result<Connection> {
    let conn = Connection::open(path)?;

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
            is_directory BOOLEAN DEFAULT FALSE,
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

    // Create indexes
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
        "CREATE INDEX IF NOT EXISTS idx_activity_time ON activity (detected_at)",
        [],
    )?;

    // Stage 4: Add perceptual_hash column to files (silently fails if exists)
    let _ = conn.execute("ALTER TABLE files ADD COLUMN perceptual_hash TEXT", []);

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
    let _ = conn.execute("ALTER TABLE files ADD COLUMN extracted_text TEXT", []);
    let _ = conn.execute("ALTER TABLE files ADD COLUMN extraction_error TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE files ADD COLUMN embedding_generated BOOLEAN DEFAULT FALSE",
        [],
    );

    // Stage 5: Indexes for extraction pipeline queries
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_files_content_extracted ON files (content_extracted)",
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

    Ok(conn)
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
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
