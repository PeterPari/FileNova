use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use chrono::Local;

use crate::db;
use crate::search_index::IndexManager;

const SYSTEM_PROMPT: &str = r#"
You are FileNova, a smart local file organization assistant.
Your goal is to classify the user's natural language query into a specific JSON command.
Do not output markdown, explanations, or chat. OUTPUT ONLY RAW JSON.

Current Date: {CURRENT_DATE}

Supported Intents:
1. "search": Find files based on name, extension, size, or date. Supports multi-filter queries.
2. "analyze": Calculate statistics about storage, file types, or trends over time.
3. "compare": Compare two folder paths to find unique or different files.
4. "organize": Propose moving/cleaning files.
5. "chat": General friendly conversation or questions about what you can do.

JSON Schema:
{
  "intent": "search" | "analyze" | "compare" | "organize" | "chat",
  "text_response": "A friendly summary of what you are about to do or the answer if general.",
  "params": {
     // For search (all optional, combine for multi-filter)
     "query": "keywords to search for",
     "file_type": "pdf" | "jpg" | "video" | "image" | "audio" | "document" | "code" | "archive" | etc,
     "date_after": "YYYY-MM-DD",
     "date_before": "YYYY-MM-DD",
     "min_size_mb": 100,
     "max_size_mb": 500,
     "location": "path/to/folder",

     // For analyze
     "metric": "size" | "count" | "type_distribution" | "trend" | "largest_files" | "oldest_files",
     "target_folder": "path/to/folder",
     "trend_days": 30,

     // For compare
     "folder_a": "path/to/first/folder",
     "folder_b": "path/to/second/folder",

     // For organize
     "action": "move" | "delete",
     "criteria": "description"
  }
}

Example 1: "Find all my large videos from 2024"
{
  "intent": "search",
  "text_response": "I'm looking for video files larger than 100MB from 2024.",
  "params": { "file_type": "video", "date_after": "2024-01-01", "min_size_mb": 100 }
}

Example 2: "Python files modified last week that are bigger than 1MB"
{
  "intent": "search",
  "text_response": "Searching for Python files modified in the last week over 1MB.",
  "params": { "query": "py", "file_type": "code", "date_after": "{LAST_WEEK}", "min_size_mb": 1 }
}

Example 3: "Compare my Documents and Backup folders"
{
  "intent": "compare",
  "text_response": "Comparing Documents and Backup folders for differences.",
  "params": { "folder_a": "Documents", "folder_b": "Backup" }
}

Example 4: "Show storage trend over the last 3 months"
{
  "intent": "analyze",
  "text_response": "Analyzing storage trends over the past 90 days.",
  "params": { "metric": "trend", "trend_days": 90 }
}
"#;

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatSession {
    pub id: i64,
    pub started_at: String,
    pub last_message_at: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatMessage {
    pub id: i64,
    pub session_id: i64,
    pub role: String,
    pub content: String,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatResponse {
    pub message: ChatMessage,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatFileResult {
    pub name: String,
    pub path: String,
    pub extension: Option<String>,
    pub size_bytes: i64,
    pub modified_at: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatAction {
    pub action_type: String,       // "move", "rename", "delete"
    pub file_path: String,
    pub new_path: Option<String>,  // for move/rename
    pub reason: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatMetadata {
    pub intent: String,
    pub params: Option<serde_json::Value>,
    pub files: Option<Vec<ChatFileResult>>,
    pub actions: Option<Vec<ChatAction>>,
    pub batch_id: Option<String>,
    pub action_status: Option<String>,  // "pending", "confirmed", "cancelled", "undone"
    pub suggestions: Option<Vec<String>>,
    pub analysis_data: Option<AnalysisData>,
    pub compare_results: Option<CompareResults>,
    pub error_info: Option<ChatErrorInfo>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatErrorInfo {
    pub error_type: String,        // "no_results", "search_error", "action_failed", "invalid_query", "network_error"
    pub message: String,
    pub did_you_mean: Vec<String>, // alternative query suggestions
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AnalysisData {
    pub title: String,
    pub summary: String,
    pub stats: Vec<StatItem>,
    pub trend_data: Option<Vec<TrendPoint>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StatItem {
    pub label: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TrendPoint {
    pub date: String,
    pub count: i64,
    pub size_bytes: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CompareResults {
    pub folder_a: String,
    pub folder_b: String,
    pub only_in_a: Vec<ChatFileResult>,
    pub only_in_b: Vec<ChatFileResult>,
    pub common_count: usize,
    pub size_a_total: i64,
    pub size_b_total: i64,
}

// Internal structures for LLM Logic
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "intent", content = "params")]
#[allow(dead_code)]
pub enum UserIntent {
    #[serde(rename = "search")]
    Search(SearchIntent),
    #[serde(rename = "analyze")]
    Analyze(AnalyzeIntent),
    #[serde(rename = "compare")]
    Compare(CompareIntent),
    #[serde(rename = "organize")]
    Organize(OrganizeIntent),
    #[serde(rename = "chat")]
    Chat, 
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[allow(dead_code)]
pub struct SearchIntent {
    query: Option<String>,
    file_type: Option<String>,
    date_after: Option<String>,
    date_before: Option<String>,
    min_size_mb: Option<u64>,
    max_size_mb: Option<u64>,
    location: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[allow(dead_code)]
pub struct AnalyzeIntent {
    metric: Option<String>,
    target_folder: Option<String>,
    trend_days: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[allow(dead_code)]
pub struct CompareIntent {
    folder_a: Option<String>,
    folder_b: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[allow(dead_code)]
pub struct OrganizeIntent {
    action: Option<String>,
    criteria: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmResponse {
    intent: String,
    text_response: String,
    params: Option<serde_json::Value>,
}

// Gemini API Structs
#[derive(Serialize)]
struct GeminiPart {
    text: String,
}
#[derive(Serialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}
#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
}

#[derive(Deserialize)]
struct GeminiResponsePart {
    text: Option<String>,
}
#[derive(Deserialize)]
struct GeminiResponseContent {
    parts: Option<Vec<GeminiResponsePart>>,
}
#[derive(Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiResponseContent>,
}
#[derive(Deserialize)]
#[allow(dead_code)]
struct GeminiApiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    error: Option<serde_json::Value>,
}

#[tauri::command]
pub fn create_chat_session(app_handle: AppHandle) -> Result<i64, String> {
    let conn = crate::db::get_conn(&app_handle)?;

    conn.execute(
        "INSERT INTO chat_sessions (started_at, last_message_at) VALUES (datetime('now'), datetime('now'))",
        [],
    ).map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    Ok(id)
}

#[tauri::command]
pub fn get_chat_sessions(app_handle: AppHandle) -> Result<Vec<ChatSession>, String> {
    let conn = crate::db::get_conn(&app_handle)?;

    let mut stmt = conn.prepare_cached("SELECT id, started_at, last_message_at FROM chat_sessions ORDER BY last_message_at DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(ChatSession {
            id: row.get(0)?,
            started_at: row.get(1)?,
            last_message_at: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|e| e.to_string())?);
    }
    Ok(sessions)
}

#[tauri::command]
pub fn get_chat_messages(app_handle: AppHandle, session_id: i64) -> Result<Vec<ChatMessage>, String> {
    let conn = crate::db::get_conn(&app_handle)?;

    let mut stmt = conn.prepare_cached("SELECT id, session_id, role, content, metadata_json, created_at FROM chat_messages WHERE session_id = ?1 ORDER BY created_at ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([session_id], |row| {
        Ok(ChatMessage {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            metadata_json: row.get(4)?,
            created_at: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|e| e.to_string())?);
    }
    Ok(messages)
}

#[tauri::command]
pub async fn chat_query(app_handle: AppHandle, index_state: State<'_, Arc<IndexManager>>, session_id: i64, message: String) -> Result<ChatResponse, String> {
    let conn = crate::db::get_conn(&app_handle)?;

    // 1. Save User Message
    conn.execute(
        "INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?1, 'user', ?2, datetime('now'))",
        [session_id.to_string().as_str(), message.as_str()],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE chat_sessions SET last_message_at = datetime('now') WHERE id = ?1",
        [session_id],
    ).map_err(|e| e.to_string())?;

    // 2. Fetch API Key
    let api_key = db::get_setting(&conn, "gemini_api_key")
        .map_err(|e| e.to_string())?
        .ok_or("No Gemini API Key found. Please add it to settings.")?;

    // 3. Load conversation history for context awareness
    let history = {
        let mut stmt = conn.prepare_cached(
            "SELECT role, content FROM chat_messages WHERE session_id = ?1 ORDER BY created_at ASC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([session_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        let mut hist = Vec::new();
        for row in rows {
            if let Ok((role, content)) = row {
                hist.push((role, content));
            }
        }
        hist
    };

    // Build conversation context (last 10 messages to keep prompt size manageable)
    let history_str = if history.len() > 1 {
        let recent: Vec<String> = history.iter()
            .rev()
            .skip(1) // skip the just-inserted user message (we append it separately)
            .take(10)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|(role, content)| {
                let label = if role == "user" { "User" } else { "Assistant" };
                format!("{}: {}", label, content)
            })
            .collect();
        if recent.is_empty() {
            String::new()
        } else {
            format!("\n\nConversation History:\n{}\n", recent.join("\n"))
        }
    } else {
        String::new()
    };

    // 4. Construct LLM Request with history context
    let current_date = Local::now().format("%Y-%m-%d").to_string();
    let system_msg = SYSTEM_PROMPT.replace("{CURRENT_DATE}", &current_date);
    let full_prompt = format!("{}{}\n\nUser Query: {}", system_msg, history_str, message);

    let client = reqwest::Client::new();
    let request_body = GeminiRequest {
        contents: vec![GeminiContent {
            parts: vec![GeminiPart { text: full_prompt }],
        }],
    };

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={}",
        api_key
    );

    // 4. Call LLM
    let res = match client.post(&url)
        .json(&request_body)
        .send()
        .await {
        Ok(r) => r,
        Err(e) => {
            // Graceful network error — return a friendly chat message instead of crashing
            let error_text = format!("⚠️ I'm having trouble connecting to the AI service. Please check your internet connection and try again.");
            let metadata = ChatMetadata {
                intent: "chat".to_string(),
                params: None,
                files: None,
                actions: None,
                batch_id: None,
                action_status: None,
                suggestions: Some(vec!["Try again".to_string(), "Check settings".to_string()]),
                analysis_data: None,
                compare_results: None,
                error_info: Some(ChatErrorInfo {
                    error_type: "network_error".to_string(),
                    message: format!("Network error: {}", e),
                    did_you_mean: vec![],
                }),
            };
            let metadata_str = serde_json::to_string(&metadata).unwrap_or_default();
            conn.execute(
                "INSERT INTO chat_messages (session_id, role, content, metadata_json, created_at) VALUES (?1, 'assistant', ?2, ?3, datetime('now'))",
                params![session_id.to_string(), error_text, metadata_str],
            ).map_err(|e| e.to_string())?;
            let last_id = conn.last_insert_rowid();
            return Ok(ChatResponse {
                message: ChatMessage {
                    id: last_id, session_id, role: "assistant".to_string(),
                    content: error_text, metadata_json: Some(metadata_str),
                    created_at: Local::now().to_rfc3339(),
                }
            });
        }
    };

    if !res.status().is_success() {
        let status_code = res.status();
        let error_text = if status_code.as_u16() == 429 {
            "⚠️ I've hit the rate limit for AI requests. Please wait a moment and try again.".to_string()
        } else if status_code.as_u16() == 401 || status_code.as_u16() == 403 {
            "⚠️ Your AI API key appears to be invalid or expired. Please check your API key in Settings.".to_string()
        } else {
            format!("⚠️ The AI service returned an error ({}). Please try again later.", status_code)
        };
        let metadata = ChatMetadata {
            intent: "chat".to_string(),
            params: None,
            files: None,
            actions: None,
            batch_id: None,
            action_status: None,
            suggestions: Some(vec!["Try again".to_string(), "Open Settings".to_string()]),
            analysis_data: None,
            compare_results: None,
            error_info: Some(ChatErrorInfo {
                error_type: "network_error".to_string(),
                message: format!("HTTP {}", status_code),
                did_you_mean: vec![],
            }),
        };
        let metadata_str = serde_json::to_string(&metadata).unwrap_or_default();
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, metadata_json, created_at) VALUES (?1, 'assistant', ?2, ?3, datetime('now'))",
            params![session_id.to_string(), error_text, metadata_str],
        ).map_err(|e| e.to_string())?;
        let last_id = conn.last_insert_rowid();
        return Ok(ChatResponse {
            message: ChatMessage {
                id: last_id, session_id, role: "assistant".to_string(),
                content: error_text, metadata_json: Some(metadata_str),
                created_at: Local::now().to_rfc3339(),
            }
        });
    }

    let gemini_resp: GeminiApiResponse = res.json().await.map_err(|e| format!("Failed to parse LLM Response: {}", e))?;

    // 5. Extract Text
    let raw_text = gemini_resp.candidates
        .and_then(|c| c.first().and_then(|f| f.content.as_ref().and_then(|co| co.parts.as_ref().and_then(|p| p.first().and_then(|pa| pa.text.clone())))))
        .ok_or("Empty response from AI")?;

    // 6. Parse JSON from LLM (it might wrap in markdown blocks ```json ... ```)
    let json_str = clean_json_markdown(&raw_text);
    
    let parsed: LlmResponse = serde_json::from_str(&json_str).unwrap_or(LlmResponse {
        intent: "chat".to_string(),
        text_response: raw_text.clone(), // Fallback to raw text if not JSON
        params: None,
    });

    // 7. Execute Logic — run actual search when applicable
    let mut file_results: Vec<ChatFileResult> = Vec::new();
    let mut proposed_actions: Vec<ChatAction> = Vec::new();
    let mut action_status: Option<String> = None;
    let mut analysis_data: Option<AnalysisData> = None;
    let mut compare_results: Option<CompareResults> = None;

    let final_response_text = match parsed.intent.as_str() {
        "search" => {
            // Multi-filter search: combine Tantivy keyword search with SQL filters
            execute_search(&parsed, &index_state, &conn, &mut file_results)
        },
        "organize" => {
            // Generate proposed actions from LLM params
            if let Some(params) = &parsed.params {
                let action_type = params.get("action").and_then(|v| v.as_str()).unwrap_or("move").to_string();
                let criteria = params.get("criteria").and_then(|v| v.as_str()).unwrap_or("").to_string();
                
                // Search for files that match the criteria to build action proposals
                if !criteria.is_empty() {
                    if let Ok(results) = index_state.search(&criteria, 20) {
                        for r in &results {
                            let new_path = if action_type == "move" {
                                let ext = r.extension.as_deref().unwrap_or("misc");
                                let parent = std::path::Path::new(&r.path).parent().unwrap_or(std::path::Path::new(""));
                                Some(parent.join(format!("Organized/{}", ext)).join(&r.name).to_string_lossy().to_string())
                            } else {
                                None
                            };
                            
                            proposed_actions.push(ChatAction {
                                action_type: action_type.clone(),
                                file_path: r.path.clone(),
                                new_path,
                                reason: Some(criteria.clone()),
                            });

                            file_results.push(ChatFileResult {
                                name: r.name.clone(),
                                path: r.path.clone(),
                                extension: r.extension.clone(),
                                size_bytes: r.size_bytes,
                                modified_at: r.modified_at,
                            });
                        }
                    }
                }
            }
            
            if proposed_actions.is_empty() {
                format!("📁 {}", parsed.text_response)
            } else {
                action_status = Some("pending".to_string());
                format!("📁 {} — I've prepared {} action{} for your review. Please confirm or cancel.", 
                    parsed.text_response, 
                    proposed_actions.len(),
                    if proposed_actions.len() == 1 { "" } else { "s" })
            }
        },
        "analyze" => {
            execute_analyze(&parsed, &conn, &mut analysis_data)
        },
        "compare" => {
            execute_compare(&parsed, &conn, &mut compare_results, &mut file_results)
        },
        _ => parsed.text_response.clone()
    };

    // Generate next-action suggestions based on intent
    let suggestions = generate_next_actions(&parsed.intent, &file_results, &proposed_actions);

    // Build structured metadata with file results, actions, and suggestions
    // Build error info for failed/empty results
    let error_info = build_error_info(&parsed, &file_results, &final_response_text, &conn);

    // Override suggestions with error-contextual ones if error occurred
    let suggestions = if error_info.is_some() {
        let err = error_info.as_ref().unwrap();
        if !err.did_you_mean.is_empty() {
            err.did_you_mean.clone()
        } else {
            suggestions
        }
    } else {
        suggestions
    };

    let metadata = ChatMetadata {
        intent: parsed.intent.clone(),
        params: parsed.params.clone(),
        files: if file_results.is_empty() { None } else { Some(file_results) },
        actions: if proposed_actions.is_empty() { None } else { Some(proposed_actions) },
        batch_id: None,
        action_status,
        suggestions: if suggestions.is_empty() { None } else { Some(suggestions) },
        analysis_data,
        compare_results,
        error_info,
    };
    let metadata_str = serde_json::to_string(&metadata).unwrap_or(json_str.clone());
    
    // Save Assistant Message
    conn.execute(
        "INSERT INTO chat_messages (session_id, role, content, metadata_json, created_at) VALUES (?1, 'assistant', ?2, ?3, datetime('now'))",
        params![session_id.to_string(), final_response_text, metadata_str],
    ).map_err(|e| e.to_string())?;

    let last_id = conn.last_insert_rowid();

    Ok(ChatResponse {
        message: ChatMessage {
            id: last_id,
            session_id,
            role: "assistant".to_string(),
            content: final_response_text,
            metadata_json: Some(metadata_str),
            created_at: Local::now().to_rfc3339(), 
        }
    })
}

/// Execute a confirmed chat action (move/rename/delete)
#[tauri::command]
pub fn chat_execute_action(app_handle: AppHandle, message_id: i64, session_id: i64) -> Result<ChatResponse, String> {
    let conn = crate::db::get_conn(&app_handle)?;

    // 1. Load the message's metadata
    let metadata_json: String = conn.query_row(
        "SELECT metadata_json FROM chat_messages WHERE id = ?1",
        [message_id],
        |row| row.get(0),
    ).map_err(|e| format!("Message not found: {}", e))?;

    let mut metadata: ChatMetadata = serde_json::from_str(&metadata_json)
        .map_err(|e| format!("Invalid metadata: {}", e))?;

    let actions = metadata.actions.clone().unwrap_or_default();
    if actions.is_empty() {
        return Err("No actions to execute".to_string());
    }

    // 2. Convert ChatActions to FileMoves and execute
    let batch_id = format!("chat-{}-{}", session_id, chrono::Utc::now().timestamp());
    let moves: Vec<crate::execution::FileMove> = actions.iter()
        .filter(|a| a.action_type == "move" || a.action_type == "rename")
        .filter_map(|a| {
            a.new_path.as_ref().map(|np| crate::execution::FileMove {
                file_path: a.file_path.clone(),
                new_path: np.clone(),
                reason: a.reason.clone(),
            })
        })
        .collect();

    let files_count = moves.len();

    if !moves.is_empty() {
        crate::execution::execute_moves_with_operation(
            Some(&app_handle),
            &conn,
            moves,
            &batch_id,
            "chat_organize",
        )?;
    }

    // 3. Update original message metadata to "confirmed"
    metadata.action_status = Some("confirmed".to_string());
    metadata.batch_id = Some(batch_id.clone());
    let updated_meta = serde_json::to_string(&metadata).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chat_messages SET metadata_json = ?1 WHERE id = ?2",
        params![updated_meta, message_id],
    ).map_err(|e| e.to_string())?;

    // 4. Save a confirmation message
    let confirm_text = format!("✅ Done! Successfully executed {} action{}. You can undo this if needed.", 
        files_count, if files_count == 1 { "" } else { "s" });

    let confirm_metadata = ChatMetadata {
        intent: "action_result".to_string(),
        params: None,
        files: None,
        actions: None,
        batch_id: Some(batch_id),
        action_status: Some("confirmed".to_string()),
        suggestions: Some(vec!["Undo the last action".to_string(), "Show what changed".to_string()]),
        analysis_data: None,
        compare_results: None,
        error_info: None,
    };
    let confirm_meta_str = serde_json::to_string(&confirm_metadata).unwrap_or_default();

    conn.execute(
        "INSERT INTO chat_messages (session_id, role, content, metadata_json, created_at) VALUES (?1, 'assistant', ?2, ?3, datetime('now'))",
        params![session_id.to_string(), confirm_text, confirm_meta_str],
    ).map_err(|e| e.to_string())?;

    let last_id = conn.last_insert_rowid();

    Ok(ChatResponse {
        message: ChatMessage {
            id: last_id,
            session_id,
            role: "assistant".to_string(),
            content: confirm_text,
            metadata_json: Some(confirm_meta_str),
            created_at: Local::now().to_rfc3339(),
        }
    })
}

/// Undo a previously confirmed chat action
#[tauri::command]
pub fn chat_undo_action(app_handle: AppHandle, batch_id: String, session_id: i64) -> Result<ChatResponse, String> {
    let conn = crate::db::get_conn(&app_handle)?;

    let restored = crate::execution::undo_move_batch(&conn, &batch_id)?;

    let _ = app_handle.emit("file-changed", ());

    // Update any messages referencing this batch_id to "undone"
    let all_msgs: Vec<(i64, String)> = {
        let mut stmt = conn.prepare_cached(
            "SELECT id, metadata_json FROM chat_messages WHERE session_id = ?1 AND metadata_json LIKE ?2"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![session_id, format!("%{}%", batch_id)], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    for (msg_id, meta_str) in all_msgs {
        if let Ok(mut meta) = serde_json::from_str::<ChatMetadata>(&meta_str) {
            meta.action_status = Some("undone".to_string());
            if let Ok(updated) = serde_json::to_string(&meta) {
                let _ = conn.execute(
                    "UPDATE chat_messages SET metadata_json = ?1 WHERE id = ?2",
                    params![updated, msg_id],
                );
            }
        }
    }

    let undo_text = format!("↩️ Undone! Restored {} file{}.", restored.len(), if restored.len() == 1 { "" } else { "s" });
    let undo_metadata = ChatMetadata {
        intent: "action_result".to_string(),
        params: None,
        files: None,
        actions: None,
        batch_id: Some(batch_id),
        action_status: Some("undone".to_string()),
        suggestions: Some(vec!["Show my recent files".to_string(), "Organize my Downloads".to_string()]),
        analysis_data: None,
        compare_results: None,
        error_info: None,
    };
    let undo_meta_str = serde_json::to_string(&undo_metadata).unwrap_or_default();

    conn.execute(
        "INSERT INTO chat_messages (session_id, role, content, metadata_json, created_at) VALUES (?1, 'assistant', ?2, ?3, datetime('now'))",
        params![session_id.to_string(), undo_text, undo_meta_str],
    ).map_err(|e| e.to_string())?;

    let last_id = conn.last_insert_rowid();

    Ok(ChatResponse {
        message: ChatMessage {
            id: last_id,
            session_id,
            role: "assistant".to_string(),
            content: undo_text,
            metadata_json: Some(undo_meta_str),
            created_at: Local::now().to_rfc3339(),
        }
    })
}

/// Generate contextual next-action suggestions based on the response intent
fn generate_next_actions(intent: &str, files: &[ChatFileResult], actions: &[ChatAction]) -> Vec<String> {
    match intent {
        "search" => {
            let mut suggestions = Vec::new();
            if !files.is_empty() {
                suggestions.push("Show me the largest ones".to_string());
                suggestions.push("Organize these files".to_string());
                if files.len() > 5 {
                    suggestions.push("Find duplicates among these".to_string());
                }
                suggestions.push("What's the total size?".to_string());
            } else {
                suggestions.push("Try a broader search".to_string());
                suggestions.push("Show all recent files".to_string());
            }
            suggestions
        }
        "analyze" => {
            vec![
                "Show me the biggest folders".to_string(),
                "Find files I haven't opened in a year".to_string(),
                "What file types use the most space?".to_string(),
                "Show storage trend over last 30 days".to_string(),
            ]
        }
        "compare" => {
            vec![
                "Show me the unique files in detail".to_string(),
                "Organize the differences".to_string(),
                "Which folder uses more space?".to_string(),
            ]
        }
        "organize" => {
            if !actions.is_empty() {
                vec![
                    "Show me what will change".to_string(),
                    "Undo the last action".to_string(),
                ]
            } else {
                vec![
                    "Organize my Downloads folder".to_string(),
                    "Clean up temporary files".to_string(),
                    "Sort files by type".to_string(),
                ]
            }
        }
        "chat" => {
            vec![
                "Find large video files".to_string(),
                "Show storage usage".to_string(),
                "Compare two folders".to_string(),
                "Organize my Downloads".to_string(),
            ]
        }
        _ => Vec::new(),
    }
}

/// Multi-filter search: Uses Tantivy for keyword matching, then applies SQL filters for size/date/location
fn execute_search(parsed: &LlmResponse, index_state: &crate::search_index::IndexManager, conn: &Connection, file_results: &mut Vec<ChatFileResult>) -> String {
    let search_query = build_search_query(parsed);
    let params = parsed.params.as_ref();

    // Extract advanced filter params
    let min_size = params.and_then(|p| p.get("min_size_mb")).and_then(|v| v.as_u64()).map(|mb| mb * 1_048_576);
    let max_size = params.and_then(|p| p.get("max_size_mb")).and_then(|v| v.as_u64()).map(|mb| mb * 1_048_576);
    let date_after = params.and_then(|p| p.get("date_after")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let date_before = params.and_then(|p| p.get("date_before")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let location = params.and_then(|p| p.get("location")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let file_type = params.and_then(|p| p.get("file_type")).and_then(|v| v.as_str()).map(|s| s.to_string());

    let has_complex_filters = min_size.is_some() || max_size.is_some() || date_after.is_some() || date_before.is_some() || location.is_some();

    if has_complex_filters {
        // Use SQL-based search for complex multi-filter queries
        let mut sql = String::from("SELECT name, path, extension, size_bytes, CAST(strftime('%s', modified_at) AS INTEGER) as modified_ts FROM files WHERE is_deleted = 0 AND is_directory = 0");
        let mut sql_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        // Extension filter from file_type
        if let Some(ref ft) = file_type {
            let extensions = map_file_type_to_extensions(ft);
            if !extensions.is_empty() {
                let placeholders: Vec<String> = extensions.iter().enumerate().map(|(_, _)| "?".to_string()).collect();
                sql.push_str(&format!(" AND LOWER(extension) IN ({})", placeholders.join(",")));
                for ext in &extensions {
                    sql_params.push(Box::new(ext.clone()));
                }
            }
        }

        // Size filters
        if let Some(min) = min_size {
            sql.push_str(" AND size_bytes >= ?");
            sql_params.push(Box::new(min as i64));
        }
        if let Some(max) = max_size {
            sql.push_str(" AND size_bytes <= ?");
            sql_params.push(Box::new(max as i64));
        }

        // Date filters
        if let Some(ref after) = date_after {
            sql.push_str(" AND modified_at >= ?");
            sql_params.push(Box::new(format!("{}T00:00:00", after)));
        }
        if let Some(ref before) = date_before {
            sql.push_str(" AND modified_at <= ?");
            sql_params.push(Box::new(format!("{}T23:59:59", before)));
        }

        // Location filter
        if let Some(ref loc) = location {
            sql.push_str(" AND path LIKE ?");
            sql_params.push(Box::new(format!("%{}%", loc)));
        }

        // Name/keyword filter
        if let Some(query_kw) = params.and_then(|p| p.get("query")).and_then(|v| v.as_str()) {
            if !query_kw.is_empty() {
                sql.push_str(" AND LOWER(name) LIKE ?");
                sql_params.push(Box::new(format!("%{}%", query_kw.to_lowercase())));
            }
        }

        sql.push_str(" ORDER BY modified_at DESC LIMIT 50");

        let param_refs: Vec<&dyn rusqlite::types::ToSql> = sql_params.iter().map(|p| p.as_ref()).collect();
        match conn.prepare(&sql).and_then(|mut stmt| {
            let rows = stmt.query_map(rusqlite::params_from_iter(param_refs.iter()), |row| {
                Ok(ChatFileResult {
                    name: row.get(0)?,
                    path: row.get(1)?,
                    extension: row.get(2)?,
                    size_bytes: row.get(3)?,
                    modified_at: row.get::<_, i64>(4).unwrap_or(0),
                })
            })?;
            let mut results = Vec::new();
            for row in rows {
                if let Ok(r) = row {
                    results.push(r);
                }
            }
            Ok(results)
        }) {
            Ok(results) => {
                *file_results = results;
                if file_results.is_empty() {
                    format!("🔍 {} — No files found matching your criteria.", parsed.text_response)
                } else {
                    format!("🔍 {} — Found {} file{}.", parsed.text_response, file_results.len(), if file_results.len() == 1 { "" } else { "s" })
                }
            }
            Err(e) => format!("🔍 {} — Search error: {}", parsed.text_response, e),
        }
    } else if !search_query.is_empty() {
        // Simple keyword search via Tantivy
        match index_state.search(&search_query, 20) {
            Ok(results) => {
                *file_results = results.iter().map(|r| ChatFileResult {
                    name: r.name.clone(),
                    path: r.path.clone(),
                    extension: r.extension.clone(),
                    size_bytes: r.size_bytes,
                    modified_at: r.modified_at,
                }).collect();
                
                if file_results.is_empty() {
                    format!("🔍 {} — No files found matching your criteria.", parsed.text_response)
                } else {
                    format!("🔍 {} — Found {} file{}.", parsed.text_response, file_results.len(), if file_results.len() == 1 { "" } else { "s" })
                }
            }
            Err(e) => format!("🔍 {} — Search error: {}", parsed.text_response, e),
        }
    } else {
        format!("🔍 {}", parsed.text_response)
    }
}

/// Execute analyze intent — storage breakdown, type distribution, trend analysis
fn execute_analyze(parsed: &LlmResponse, conn: &Connection, analysis_data: &mut Option<AnalysisData>) -> String {
    let params = parsed.params.as_ref();
    let metric = params.and_then(|p| p.get("metric")).and_then(|v| v.as_str()).unwrap_or("size");
    let target_folder = params.and_then(|p| p.get("target_folder")).and_then(|v| v.as_str());

    match metric {
        "trend" | "history" => {
            let days = params.and_then(|p| p.get("trend_days")).and_then(|v| v.as_i64()).unwrap_or(30);
            // Query activity table for trend data
            let sql = "SELECT DATE(detected_at) as day, COUNT(*) as count FROM activity WHERE detected_at >= datetime('now', ? || ' days') GROUP BY DATE(detected_at) ORDER BY day";
            let days_param = format!("-{}", days);
            
            let trend_points: Vec<TrendPoint> = conn.prepare(sql)
                .and_then(|mut stmt| {
                    let rows = stmt.query_map(rusqlite::params![days_param], |row| {
                        Ok(TrendPoint {
                            date: row.get(0)?,
                            count: row.get(1)?,
                            size_bytes: 0,
                        })
                    })?;
                    Ok(rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
                })
                .unwrap_or_default();

            // Also get total files added/modified count
            let total_events: i64 = conn.query_row(
                "SELECT COUNT(*) FROM activity WHERE detected_at >= datetime('now', ? || ' days')",
                rusqlite::params![days_param],
                |row| row.get(0),
            ).unwrap_or(0);

            let summary = format!("{} file events over the last {} days", total_events, days);
            *analysis_data = Some(AnalysisData {
                title: format!("File Activity Trend — Last {} Days", days),
                summary: summary.clone(),
                stats: vec![
                    StatItem { label: "Total Events".to_string(), value: total_events.to_string() },
                    StatItem { label: "Period".to_string(), value: format!("{} days", days) },
                    StatItem { label: "Days with Activity".to_string(), value: trend_points.len().to_string() },
                ],
                trend_data: if trend_points.is_empty() { None } else { Some(trend_points) },
            });

            format!("📊 {} — {}", parsed.text_response, summary)
        }
        "type_distribution" => {
            let mut sql = String::from(
                "SELECT CASE \
                    WHEN LOWER(extension) IN ('mp4','mkv','avi','mov','wmv','flv','webm') THEN 'Videos' \
                    WHEN LOWER(extension) IN ('jpg','jpeg','png','gif','bmp','svg','webp','ico') THEN 'Images' \
                    WHEN LOWER(extension) IN ('pdf','doc','docx','txt','rtf','odt','xls','xlsx','csv','ppt','pptx') THEN 'Documents' \
                    WHEN LOWER(extension) IN ('zip','rar','7z','tar','gz','bz2') THEN 'Archives' \
                    WHEN LOWER(extension) IN ('mp3','wav','flac','aac','ogg','wma') THEN 'Audio' \
                    WHEN LOWER(extension) IN ('rs','ts','js','py','java','cpp','c','h','go','rb','php','html','css') THEN 'Code' \
                    ELSE 'Other' END as category, \
                 COUNT(*) as cnt, SUM(size_bytes) as total_size \
                 FROM files WHERE is_deleted = 0 AND is_directory = 0"
            );

            if let Some(folder) = target_folder {
                sql.push_str(&format!(" AND path LIKE '%{}%'", folder.replace('\'', "''")));
            }
            sql.push_str(" GROUP BY category ORDER BY total_size DESC");

            let stats: Vec<StatItem> = conn.prepare(&sql)
                .and_then(|mut stmt| {
                    let rows = stmt.query_map([], |row| {
                        let cat: String = row.get(0)?;
                        let count: i64 = row.get(1)?;
                        let size: i64 = row.get(2)?;
                        Ok(StatItem {
                            label: cat,
                            value: format!("{} files, {}", count, format_size(size)),
                        })
                    })?;
                    Ok(rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
                })
                .unwrap_or_default();

            let total_files: i64 = stats.iter().map(|s| {
                s.value.split(' ').next().unwrap_or("0").parse::<i64>().unwrap_or(0)
            }).sum();

            *analysis_data = Some(AnalysisData {
                title: "File Type Distribution".to_string(),
                summary: format!("{} files across {} categories", total_files, stats.len()),
                stats,
                trend_data: None,
            });

            format!("📊 {}", parsed.text_response)
        }
        "largest_files" => {
            let mut sql = String::from("SELECT name, path, extension, size_bytes, CAST(strftime('%s', modified_at) AS INTEGER) FROM files WHERE is_deleted = 0 AND is_directory = 0");
            if let Some(folder) = target_folder {
                sql.push_str(&format!(" AND path LIKE '%{}%'", folder.replace('\'', "''")));
            }
            sql.push_str(" ORDER BY size_bytes DESC LIMIT 20");

            let mut file_results_local: Vec<ChatFileResult> = Vec::new();
            if let Ok(mut stmt) = conn.prepare(&sql) {
                if let Ok(rows) = stmt.query_map([], |row| {
                    Ok(ChatFileResult {
                        name: row.get(0)?,
                        path: row.get(1)?,
                        extension: row.get(2)?,
                        size_bytes: row.get(3)?,
                        modified_at: row.get::<_, i64>(4).unwrap_or(0),
                    })
                }) {
                    file_results_local = rows.filter_map(|r| r.ok()).collect();
                }
            }

            let total_size: i64 = file_results_local.iter().map(|f| f.size_bytes).sum();
            *analysis_data = Some(AnalysisData {
                title: "Largest Files".to_string(),
                summary: format!("Top {} files using {}", file_results_local.len(), format_size(total_size)),
                stats: file_results_local.iter().take(10).map(|f| StatItem {
                    label: f.name.clone(),
                    value: format_size(f.size_bytes),
                }).collect(),
                trend_data: None,
            });

            format!("📊 {}", parsed.text_response)
        }
        "oldest_files" => {
            let mut sql = String::from("SELECT name, path, extension, size_bytes, CAST(strftime('%s', modified_at) AS INTEGER) FROM files WHERE is_deleted = 0 AND is_directory = 0");
            if let Some(folder) = target_folder {
                sql.push_str(&format!(" AND path LIKE '%{}%'", folder.replace('\'', "''")));
            }
            sql.push_str(" ORDER BY modified_at ASC LIMIT 20");

            let mut stats = Vec::new();
            if let Ok(mut stmt) = conn.prepare(&sql) {
                if let Ok(rows) = stmt.query_map([], |row| {
                    let name: String = row.get(0)?;
                    let modified: i64 = row.get::<_, i64>(4).unwrap_or(0);
                    let date = chrono::DateTime::from_timestamp(modified, 0)
                        .map(|dt| dt.format("%Y-%m-%d").to_string())
                        .unwrap_or_else(|| "Unknown".to_string());
                    Ok(StatItem {
                        label: name,
                        value: date,
                    })
                }) {
                    stats = rows.filter_map(|r| r.ok()).collect();
                }
            }

            *analysis_data = Some(AnalysisData {
                title: "Oldest Files".to_string(),
                summary: format!("Found {} oldest files", stats.len()),
                stats,
                trend_data: None,
            });

            format!("📊 {}", parsed.text_response)
        }
        _ => {
            // Default: storage size breakdown
            let mut sql = String::from("SELECT COUNT(*) as cnt, SUM(size_bytes) as total FROM files WHERE is_deleted = 0 AND is_directory = 0");
            if let Some(folder) = target_folder {
                sql.push_str(&format!(" AND path LIKE '%{}%'", folder.replace('\'', "''")));
            }

            let (file_count, total_size) = conn.query_row(&sql, [], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1).unwrap_or(0)))
            }).unwrap_or((0, 0));

            // Get folder count
            let folder_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM files WHERE is_deleted = 0 AND is_directory = 1",
                [],
                |row| row.get(0),
            ).unwrap_or(0);

            *analysis_data = Some(AnalysisData {
                title: if target_folder.is_some() { format!("Storage Analysis: {}", target_folder.unwrap()) } else { "Storage Overview".to_string() },
                summary: format!("{} files in {} folders using {}", file_count, folder_count, format_size(total_size)),
                stats: vec![
                    StatItem { label: "Total Files".to_string(), value: file_count.to_string() },
                    StatItem { label: "Total Folders".to_string(), value: folder_count.to_string() },
                    StatItem { label: "Total Size".to_string(), value: format_size(total_size) },
                    StatItem { label: "Average File Size".to_string(), value: if file_count > 0 { format_size(total_size / file_count) } else { "0 B".to_string() } },
                ],
                trend_data: None,
            });

            format!("📊 {}", parsed.text_response)
        }
    }
}

/// Execute compare intent — diff two folders
fn execute_compare(parsed: &LlmResponse, conn: &Connection, compare_results: &mut Option<CompareResults>, file_results: &mut Vec<ChatFileResult>) -> String {
    let params = parsed.params.as_ref();
    let folder_a = params.and_then(|p| p.get("folder_a")).and_then(|v| v.as_str()).unwrap_or("");
    let folder_b = params.and_then(|p| p.get("folder_b")).and_then(|v| v.as_str()).unwrap_or("");

    if folder_a.is_empty() || folder_b.is_empty() {
        return format!("🔄 {} — Please specify two folders to compare.", parsed.text_response);
    }

    // Query files in folder A
    let files_a: Vec<ChatFileResult> = conn.prepare_cached(
        "SELECT name, path, extension, size_bytes, CAST(strftime('%s', modified_at) AS INTEGER) FROM files WHERE is_deleted = 0 AND is_directory = 0 AND path LIKE ?1"
    ).and_then(|mut stmt| {
        let rows = stmt.query_map(rusqlite::params![format!("%{}%", folder_a)], |row| {
            Ok(ChatFileResult {
                name: row.get(0)?,
                path: row.get(1)?,
                extension: row.get(2)?,
                size_bytes: row.get(3)?,
                modified_at: row.get::<_, i64>(4).unwrap_or(0),
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
    }).unwrap_or_default();

    // Query files in folder B
    let files_b: Vec<ChatFileResult> = conn.prepare_cached(
        "SELECT name, path, extension, size_bytes, CAST(strftime('%s', modified_at) AS INTEGER) FROM files WHERE is_deleted = 0 AND is_directory = 0 AND path LIKE ?1"
    ).and_then(|mut stmt| {
        let rows = stmt.query_map(rusqlite::params![format!("%{}%", folder_b)], |row| {
            Ok(ChatFileResult {
                name: row.get(0)?,
                path: row.get(1)?,
                extension: row.get(2)?,
                size_bytes: row.get(3)?,
                modified_at: row.get::<_, i64>(4).unwrap_or(0),
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect::<Vec<_>>())
    }).unwrap_or_default();

    // Compare by name
    let names_a: std::collections::HashSet<&str> = files_a.iter().map(|f| f.name.as_str()).collect();
    let names_b: std::collections::HashSet<&str> = files_b.iter().map(|f| f.name.as_str()).collect();

    let only_in_a: Vec<ChatFileResult> = files_a.iter().filter(|f| !names_b.contains(f.name.as_str())).cloned().collect();
    let only_in_b: Vec<ChatFileResult> = files_b.iter().filter(|f| !names_a.contains(f.name.as_str())).cloned().collect();
    let common_count = names_a.intersection(&names_b).count();

    let size_a: i64 = files_a.iter().map(|f| f.size_bytes).sum();
    let size_b: i64 = files_b.iter().map(|f| f.size_bytes).sum();

    // Populate file_results with unique files for the card display
    for f in only_in_a.iter().chain(only_in_b.iter()).take(20) {
        file_results.push(f.clone());
    }

    let summary = format!(
        "Compared {} files in '{}' ({}) vs {} files in '{}' ({}). {} files in common, {} unique to '{}', {} unique to '{}'.",
        files_a.len(), folder_a, format_size(size_a),
        files_b.len(), folder_b, format_size(size_b),
        common_count, only_in_a.len(), folder_a, only_in_b.len(), folder_b
    );

    *compare_results = Some(CompareResults {
        folder_a: folder_a.to_string(),
        folder_b: folder_b.to_string(),
        only_in_a,
        only_in_b,
        common_count,
        size_a_total: size_a,
        size_b_total: size_b,
    });

    format!("🔄 {}", summary)
}

/// Map common file type names to extension lists
fn map_file_type_to_extensions(file_type: &str) -> Vec<String> {
    let ft = file_type.to_lowercase();
    match ft.as_str() {
        "video" => vec!["mp4","mkv","avi","mov","wmv","flv","webm"],
        "image" | "photo" | "jpg" | "png" => vec!["jpg","jpeg","png","gif","bmp","svg","webp","ico"],
        "audio" | "music" => vec!["mp3","wav","flac","aac","ogg","wma"],
        "document" | "doc" => vec!["pdf","docx","doc","txt","rtf","odt"],
        "spreadsheet" | "excel" => vec!["xlsx","xls","csv"],
        "archive" | "zip" => vec!["zip","rar","7z","tar","gz","bz2"],
        "code" => vec!["rs","ts","js","py","java","cpp","c","h","go","rb","php","html","css","json"],
        "pdf" => vec!["pdf"],
        _ => vec![ft.as_str()],
    }.into_iter().map(|s| s.to_string()).collect()
}

/// Format byte sizes into human-readable strings
fn format_size(bytes: i64) -> String {
    const KB: i64 = 1024;
    const MB: i64 = 1024 * 1024;
    const GB: i64 = 1024 * 1024 * 1024;
    
    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// Build a Tantivy search query string from the parsed LLM response params
fn build_search_query(parsed: &LlmResponse) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(params) = &parsed.params {
        // Use "query" field if present
        if let Some(query) = params.get("query").and_then(|v| v.as_str()) {
            if !query.is_empty() {
                parts.push(query.to_string());
            }
        }
        // Use "file_type" as extension filter
        if let Some(file_type) = params.get("file_type").and_then(|v| v.as_str()) {
            if !file_type.is_empty() {
                // Map common type names to extensions
                let file_type_lower = file_type.to_lowercase();
                let ext = match file_type_lower.as_str() {
                    "video" => "mp4 mkv avi mov".to_string(),
                    "image" | "photo" => "jpg jpeg png gif webp".to_string(),
                    "audio" | "music" => "mp3 wav flac aac ogg".to_string(),
                    "document" | "doc" => "pdf docx doc txt".to_string(),
                    "spreadsheet" => "xlsx xls csv".to_string(),
                    "archive" => "zip rar 7z tar gz".to_string(),
                    "code" => "rs ts js py java cpp".to_string(),
                    _ => file_type_lower.clone(),
                };
                parts.push(ext);
            }
        }
    }

    // Fallback: use the original text_response keywords
    if parts.is_empty() {
        // Extract meaningful words from the text_response
        let stop_words = ["i'm", "looking", "for", "searching", "files", "file", "your", "the", "a", "an", "from", "in", "with", "that", "are", "is", "of"];
        let words: Vec<&str> = parsed.text_response.split_whitespace()
            .filter(|w| {
                let lower = w.to_lowercase();
                !stop_words.contains(&lower.as_str()) && lower.len() > 2
            })
            .take(5)
            .collect();
        if !words.is_empty() {
            parts.push(words.join(" "));
        }
    }

    parts.join(" ")
}

/// Build error info for no-result or failed queries, with "Did you mean...?" suggestions
fn build_error_info(parsed: &LlmResponse, file_results: &[ChatFileResult], response_text: &str, conn: &Connection) -> Option<ChatErrorInfo> {
    let intent = parsed.intent.as_str();

    // Detect search errors
    if response_text.contains("Search error:") {
        let did_you_mean = generate_search_suggestions(parsed, conn);
        return Some(ChatErrorInfo {
            error_type: "search_error".to_string(),
            message: "The search query couldn't be processed.".to_string(),
            did_you_mean,
        });
    }

    // Detect no results for search/compare intents
    if (intent == "search" || intent == "compare") && file_results.is_empty() && response_text.contains("No files found") {
        let did_you_mean = generate_search_suggestions(parsed, conn);
        return Some(ChatErrorInfo {
            error_type: "no_results".to_string(),
            message: "No files matched your search criteria.".to_string(),
            did_you_mean,
        });
    }

    // Detect action failures
    if response_text.contains("Action failed") || response_text.contains("failed:") {
        return Some(ChatErrorInfo {
            error_type: "action_failed".to_string(),
            message: "The requested file operation could not be completed.".to_string(),
            did_you_mean: vec![
                "Try again".to_string(),
                "Check file permissions".to_string(),
                "Show me the files instead".to_string(),
            ],
        });
    }

    None
}

/// Generate "Did you mean...?" suggestions by looking at what's actually in the database
fn generate_search_suggestions(parsed: &LlmResponse, conn: &Connection) -> Vec<String> {
    let mut suggestions = Vec::new();
    let params = parsed.params.as_ref();

    // Suggest broadening file type
    if let Some(file_type) = params.and_then(|p| p.get("file_type")).and_then(|v| v.as_str()) {
        suggestions.push(format!("Search without the '{}' filter", file_type));
    }

    // Suggest removing date filter
    if params.and_then(|p| p.get("date_after")).is_some() || params.and_then(|p| p.get("date_before")).is_some() {
        suggestions.push("Search without date restrictions".to_string());
    }

    // Suggest removing size filter
    if params.and_then(|p| p.get("min_size_mb")).is_some() || params.and_then(|p| p.get("max_size_mb")).is_some() {
        suggestions.push("Search without size limits".to_string());
    }

    // Try to suggest similar filenames from the DB
    if let Some(query) = params.and_then(|p| p.get("query")).and_then(|v| v.as_str()) {
        if let Ok(mut stmt) = conn.prepare_cached(
            "SELECT DISTINCT name FROM files WHERE is_deleted = 0 AND LOWER(name) LIKE ?1 LIMIT 3"
        ) {
            let pattern = format!("%{}%", query.to_lowercase());
            if let Ok(rows) = stmt.query_map(rusqlite::params![pattern], |row| row.get::<_, String>(0)) {
                for row in rows.flatten().take(3) {
                    suggestions.push(format!("Did you mean '{}'?", row));
                }
            }
        }

        // If no similar files found, suggest related extensions
        if suggestions.iter().all(|s| !s.starts_with("Did you mean")) {
            if let Ok(exts) = conn.prepare_cached(
                "SELECT DISTINCT extension FROM files WHERE is_deleted = 0 AND extension IS NOT NULL AND LOWER(extension) LIKE ?1 LIMIT 3"
            ).and_then(|mut stmt| {
                let pattern = format!("%{}%", query.to_lowercase());
                let rows = stmt.query_map(rusqlite::params![pattern], |row| row.get::<_, String>(0))?;
                Ok(rows.flatten().collect::<Vec<_>>())
            }) {
                for ext in exts {
                    suggestions.push(format!("Search for .{} files", ext));
                }
            }
        }
    }

    // Always add a generic fallback
    if suggestions.is_empty() {
        suggestions.push("Try a broader search".to_string());
        suggestions.push("Show all recent files".to_string());
        suggestions.push("Show storage overview".to_string());
    }

    suggestions
}

fn clean_json_markdown(text: &str) -> String {
    let text = text.trim();
    if text.starts_with("```json") {
        text.strip_prefix("```json").unwrap_or(text).strip_suffix("```").unwrap_or(text).trim().to_string()
    } else if text.starts_with("```") {
        text.strip_prefix("```").unwrap_or(text).strip_suffix("```").unwrap_or(text).trim().to_string()
    } else {
        text.to_string()
    }
}