use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use crate::extraction::ExtractionState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub file_id: i64,
    pub tag: String,
    pub source: String, // "ai", "user", "rule"
    pub confidence: f64,
    pub created_at: String, // ISO8601 string for simplicity in frontend
}

#[derive(Clone)]
pub struct TaggingState {
    // We might need a queue or status here later
    pub active: Arc<Mutex<bool>>,
}

impl TaggingState {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(false)),
        }
    }
}

pub async fn get_tags_for_file(app: &AppHandle, file_id: i64) -> Result<Vec<Tag>, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, file_id, tag, source, confidence, created_at FROM tags WHERE file_id = ?1 ORDER BY confidence DESC")
        .map_err(|e| e.to_string())?;

    let tags_iter = stmt
        .query_map([file_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                file_id: row.get(1)?,
                tag: row.get(2)?,
                source: row.get(3)?,
                confidence: row.get(4)?,
                created_at: row.get(5)?, // Assuming stored as string, or needs conversion from numeric
            })
        })
        .map_err(|e| e.to_string())?;

    let mut tags = Vec::new();
    for tag in tags_iter {
        tags.push(tag.map_err(|e| e.to_string())?);
    }

    Ok(tags)
}

pub async fn add_tag(app: &AppHandle, file_id: i64, tag: String, source: String, confidence: f64) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let normalized_tag = tag.trim().to_lowercase();
    
    // Check if tag exists
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM tags WHERE file_id = ?1 AND tag = ?2)",
        [file_id.to_string(), normalized_tag.clone()], // params must be refs
        |row| row.get(0),
    ).unwrap_or(false);

    if exists {
        return Ok(()); // Already exists, ignore
    }

    conn.execute(
        "INSERT INTO tags (file_id, tag, source, confidence, created_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))",
        (file_id, normalized_tag, source, confidence),
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn remove_tag(app: &AppHandle, tag_id: i64) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM tags WHERE id = ?1",
        [tag_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn get_all_unique_tags(app: &AppHandle) -> Result<Vec<String>, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT DISTINCT tag FROM tags ORDER BY tag ASC")
        .map_err(|e| e.to_string())?;

    let tags_iter = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut tags = Vec::new();
    for tag in tags_iter {
        tags.push(tag.map_err(|e| e.to_string())?);
    }

    Ok(tags)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TagStat {
    pub tag: String,
    pub count: i64,
}

pub async fn get_tag_stats(app: &AppHandle) -> Result<Vec<TagStat>, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT tag, COUNT(*) as count FROM tags GROUP BY tag ORDER BY count DESC LIMIT 50")
        .map_err(|e| e.to_string())?;

    let stats = stmt
        .query_map([], |row| {
            Ok(TagStat {
                tag: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(stats)
}

// AI Tagging Logic

#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: bool,
    format: String, // "json"
}

#[derive(Deserialize)]
struct OllamaResponse {
    response: String,
}

pub async fn generate_tags(app: &AppHandle, file_id: i64) -> Result<Vec<String>, String> {
    // 1. Get file content
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let (filename, extension, extracted_text): (String, Option<String>, Option<String>) = conn.query_row(
        "SELECT name, extension, extracted_text FROM files WHERE id = ?1",
        [file_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(|e| format!("File not found: {}", e))?;

    let content_preview = extracted_text.unwrap_or_default().chars().take(2000).collect::<String>();
    
    if content_preview.is_empty() {
         return Err("No content extracted for this file".to_string());
    }

    // 2. Construct Prompt
    let prompt = format!(
        "Analyze this file and suggest 2-5 relevant tags.\nFilename: {}\nFile type: {}\nContent preview: {}\nExamples of good tags:\n- invoice, receipt, tax-2024\n- vacation-photos, beach, summer-2024\n- python-code, machine-learning, project-xyz\n- resume, job-search, 2024\nReturn ONLY a JSON array of tags: [\"tag1\", \"tag2\", \"tag3\"]",
        filename,
        extension.unwrap_or_default(),
        content_preview
    );

    // 3. Call Ollama (Hardcoded for now, can be configured)
    // Assuming Ollama is running on localhost:11434
    let client = reqwest::Client::new();
    let res = client.post("http://localhost:11434/api/generate")
        .json(&OllamaRequest {
            model: "llama3".to_string(), // Or mistral
            prompt,
            stream: false,
            format: "json".to_string(),
        })
        .send()
        .await
        .map_err(|e| format!("AI Request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("AI returned error: {}", res.status()));
    }

    let body: OllamaResponse = res.json().await.map_err(|e| format!("Failed to parse AI response: {}", e))?;
    
    // 4. Parse JSON tags
    let tags: Vec<String> = serde_json::from_str(&body.response).map_err(|e| format!("AI output not JSON array: {}", e))?;

    Ok(tags)
}

pub async fn auto_tag_file(app: &AppHandle, file_id: i64) -> Result<(), String> {
    let tags = generate_tags(app, file_id).await?;
    
    for tag in tags {
        add_tag(app, file_id, tag, "ai".to_string(), 0.7).await?;
    }
    
    Ok(())
}
