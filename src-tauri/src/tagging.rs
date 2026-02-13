use crate::db;
use log::error;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub file_id: i64,
    pub tag: String,
    pub source: String, // "ai", "user", "rule"
    pub confidence: f64,
    pub created_at: String, // ISO8601 string
}

#[derive(Clone)]
#[allow(dead_code)]
pub struct TaggingState {
    pub active: Arc<Mutex<bool>>,
}

impl TaggingState {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(false)),
        }
    }
}

pub async fn get_tags_for_file(app: &AppHandle, file_id: i64) -> Result<Vec<Tag>, String> {
    let conn = crate::db::get_conn(app)?;

    let mut stmt = conn
        .prepare_cached("SELECT id, file_id, tag, source, confidence, created_at FROM tags WHERE file_id = ?1 ORDER BY confidence DESC")
        .map_err(|e| e.to_string())?;

    let tags_iter = stmt
        .query_map([file_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                file_id: row.get(1)?,
                tag: row.get(2)?,
                source: row.get(3)?,
                confidence: row.get(4)?,
                created_at: row.get(5)?,
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
    let conn = crate::db::get_conn(app)?;

    let normalized_tag = tag.trim().to_lowercase();
    
    // Check if tag exists
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM tags WHERE file_id = ?1 AND tag = ?2)",
        [file_id.to_string(), normalized_tag.clone()],
        |row| row.get(0),
    ).unwrap_or(false);

    if exists {
        return Ok(());
    }

    conn.execute(
        "INSERT INTO tags (file_id, tag, source, confidence, created_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))",
        (file_id, normalized_tag, source, confidence),
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn remove_tag(app: &AppHandle, tag_id: i64) -> Result<(), String> {
    let conn = crate::db::get_conn(app)?;

    conn.execute(
        "DELETE FROM tags WHERE id = ?1",
        [tag_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn get_all_unique_tags(app: &AppHandle) -> Result<Vec<String>, String> {
    let conn = crate::db::get_conn(app)?;

    let mut stmt = conn
        .prepare_cached("SELECT DISTINCT tag FROM tags ORDER BY tag ASC")
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
    let conn = crate::db::get_conn(app)?;

    let mut stmt = conn
        .prepare_cached("SELECT tag, COUNT(*) as count FROM tags GROUP BY tag ORDER BY count DESC LIMIT 50")
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
    format: String,
}

#[derive(Deserialize)]
struct OllamaResponse {
    response: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct OpenAIMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    temperature: f64,
}

#[derive(Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
}

#[derive(Deserialize)]
struct OpenAIChoice {
    message: OpenAIMessage,
}

pub async fn generate_tags(app: &AppHandle, file_id: i64) -> Result<Vec<String>, String> {
    // 1. Get file content & settings
    let conn = crate::db::get_conn(app)?;

    // Get settings
    let provider = db::get_setting(&conn, "ai_provider")
        .map_err(|e| e.to_string())?
        .unwrap_or("ollama".to_string());
    
    let ollama_url = db::get_setting(&conn, "ollama_url")
        .map_err(|e| e.to_string())?
        .unwrap_or("http://localhost:11434".to_string());
        
    let openai_key = crate::db::get_secret("openai_api_key")
        .unwrap_or(None)
        .or_else(|| {
            db::get_setting(&conn, "openai_api_key")
                .ok()
                .flatten()
        })
        .unwrap_or_default();

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
        "You are an expert file classifier.\n\nReturn ONLY a JSON array of 2-5 short, lowercase tags.\nNo markdown, no extra text.\n\nFilename: {}\nFile type: {}\nContent preview (first 2000 chars): {}\n\nExamples:\n[\"invoice\", \"tax-2024\"]\n[\"python-code\", \"machine-learning\"]\n",
        filename,
        extension.unwrap_or_default(),
        content_preview
    );

    let client = reqwest::Client::new();
    let json_response: String;

    if provider == "openai" || provider == "cloud" {
        if openai_key.is_empty() {
            return Err("OpenAI API key not set".to_string());
        }
        let res = client.post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", openai_key))
            .header("Content-Type", "application/json")
            .json(&OpenAIRequest {
                model: db::get_setting(&conn, "ai_tag_model")
                    .map_err(|e| e.to_string())?
                    .unwrap_or("gpt-4o-mini".to_string()),
                messages: vec![
                    OpenAIMessage { role: "system".to_string(), content: "You are a helpful assistant that generates tags for files. Return only JSON array.".to_string() },
                    OpenAIMessage { role: "user".to_string(), content: prompt },
                ],
                temperature: 0.3,
            })
            .send()
            .await
            .map_err(|e| format!("OpenAI Request failed: {}", e))?;

             if !res.status().is_success() {
                return Err(format!("OpenAI returned error: {}", res.status()));
            }

            let body: OpenAIResponse = res.json().await.map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;
            json_response = body.choices.first().map(|c| c.message.content.clone()).unwrap_or_default();

    } else {
        // Local (Ollama)
        let gen_model = db::get_setting(&conn, "ai_tag_model")
            .map_err(|e| e.to_string())?
            .unwrap_or("llama3".to_string());

        let res = client.post(format!("{}/api/generate", ollama_url))
            .json(&OllamaRequest {
                model: gen_model, 
                prompt,
                stream: false,
                format: "json".to_string(),
            })
            .send()
            .await
            .map_err(|e| format!("Ollama Request failed: {}", e))?;

        if !res.status().is_success() {
            return Err(format!("Ollama returned error: {}", res.status()));
        }

        let body: OllamaResponse = res.json().await.map_err(|e| format!("Failed to parse Ollama response: {}", e))?;
        json_response = body.response;
    }
    
    // 4. Parse JSON tags
    let clean_json = json_response.trim().replace("```json", "").replace("```", "");
    // Attempt to find the array if there is extra text
    let start_idx = clean_json.find('[').unwrap_or(0);
    let end_idx = clean_json.rfind(']').map(|i| i + 1).unwrap_or(clean_json.len());
    let potential_json = &clean_json[start_idx..end_idx];

    let tags: Vec<String> = serde_json::from_str(potential_json).map_err(|e| format!("AI output not JSON array: {} (Output: {})", e, clean_json))?;

    Ok(tags)
}

pub async fn auto_tag_file(app: &AppHandle, file_id: i64) -> Result<(), String> {
    let tags = generate_tags(app, file_id).await?;
    
    for tag in tags {
        add_tag(app, file_id, tag, "ai".to_string(), 0.7).await?;
    }
    
    Ok(())
}

pub async fn get_tags_for_directory(app: &AppHandle, parent_path: String) -> Result<std::collections::HashMap<String, Vec<Tag>>, String> {
    let conn = crate::db::get_conn(app)?;

    // Join files and tags
    // We match on parent_path in files table
    let mut stmt = conn
        .prepare_cached(
            "SELECT f.name, t.id, t.file_id, t.tag, t.source, t.confidence, t.created_at 
             FROM files f
             JOIN tags t ON f.id = t.file_id
             WHERE f.parent_path = ?1
             ORDER BY t.confidence DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([parent_path], |row| {
            Ok((
                row.get::<_, String>(0)?,
                Tag {
                    id: row.get(1)?,
                    file_id: row.get(2)?,
                    tag: row.get(3)?,
                    source: row.get(4)?,
                    confidence: row.get(5)?,
                    created_at: row.get(6)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut result = std::collections::HashMap::new();
    for row in rows {
        if let Ok((name, tag)) = row {
            result.entry(name).or_insert_with(Vec::new).push(tag);
        }
    }

    Ok(result)
}

pub fn start_auto_tagging_task(app: AppHandle, file_ids: Vec<i64>) {
    tauri::async_runtime::spawn(async move {
        let _ = app.emit("tagging-started", &file_ids.len());

        let mut success_count = 0;
        let mut fail_count = 0;

        for batch in file_ids.chunks(50) {
            for file_id in batch {
                match auto_tag_file(&app, *file_id).await {
                    Ok(_) => {
                        success_count += 1;
                        let _ = app.emit("tagging-progress", success_count);
                    }
                    Err(e) => {
                        error!("Failed to tag file {}: {}", file_id, e);
                        fail_count += 1;
                    }
                }
            }

            // Basic rate limiting between batches
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }

        let _ = app.emit("tagging-finished", (success_count, fail_count));
    });
}
