#![allow(dead_code)]
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderPreference {
    pub path: String,
    pub view_mode: String,
    pub sort_column: String,
    pub sort_direction: String,
    pub column_widths: Option<String>,
    pub icon_size: Option<i32>,
}

pub fn init_folder_preferences_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS folder_preferences (
            path TEXT PRIMARY KEY,
            view_mode TEXT NOT NULL,
            sort_column TEXT NOT NULL,
            sort_direction TEXT NOT NULL,
            column_widths TEXT,
            icon_size INTEGER
        )",
        [],
    )?;
    Ok(())
}

pub fn save_folder_preference(conn: &Connection, pref: &FolderPreference) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO folder_preferences 
         (path, view_mode, sort_column, sort_direction, column_widths, icon_size)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            &pref.path,
            &pref.view_mode,
            &pref.sort_column,
            &pref.sort_direction,
            &pref.column_widths,
            &pref.icon_size,
        ],
    )?;
    Ok(())
}

pub fn get_folder_preference(conn: &Connection, path: &str) -> Result<Option<FolderPreference>> {
    let mut stmt = conn.prepare_cached(
        "SELECT path, view_mode, sort_column, sort_direction, column_widths, icon_size 
         FROM folder_preferences WHERE path = ?1",
    )?;

    let mut rows = stmt.query(params![path])?;

    if let Some(row) = rows.next()? {
        Ok(Some(FolderPreference {
            path: row.get(0)?,
            view_mode: row.get(1)?,
            sort_column: row.get(2)?,
            sort_direction: row.get(3)?,
            column_widths: row.get(4)?,
            icon_size: row.get(5)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn delete_folder_preference(conn: &Connection, path: &str) -> Result<()> {
    conn.execute("DELETE FROM folder_preferences WHERE path = ?1", params![path])?;
    Ok(())
}