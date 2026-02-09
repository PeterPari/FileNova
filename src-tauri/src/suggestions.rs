use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

use crate::db;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Suggestion {
    pub id: Option<i64>,
    pub category: String, // 'declutter', 'consolidate', 'rename', 'archive', 'sort', 'optimize'
    pub title: String,
    pub description: String,
    pub plan_json: String, // Serialized SuggestionPlan
    pub file_count: i64,
    pub confidence: f32,
    pub status: String,
    pub created_at: String, // ISO8601
    pub resolved_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SuggestionPlan {
    pub moves: Vec<FileMove>,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileMove {
    pub file_path: String,
    pub new_path: String,
    pub reason: Option<String>,
}

pub struct SuggestionEngine {
    app_handle: AppHandle,
}

impl SuggestionEngine {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    pub fn run_heuristics(&self) -> Result<Vec<Suggestion>, String> {
        let mut suggestions = Vec::new();

        // 1. Declutter Downloads
        if let Some(s) = self.check_downloads_declutter() {
            suggestions.push(s);
        }

        // 2. Consolidate PDFs (Example heuristic)
        // In a real app, this would query the DB for scattered file types
        // For now, we'll dummy it or do a simple DB query if possible

        Ok(suggestions)
    }

    fn check_downloads_declutter(&self) -> Option<Suggestion> {
        // This is a simplified check. In production, use the DB to query files in Downloads
        // For demonstration, let's assume we use the DB.
        
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;
        
        // Query files in Downloads folder (naive path check)
        // In reality, we should know the user's download folder path. 
        // We'll assume %USERPROFILE%/Downloads for Windows for now or query a setting.
        
        // Let's just mock a "Downloads" path relative query for now or skip if we can't find it.
        // A better approach: Query files where parent_path ends with "Downloads" and count them.
        
        let mut stmt = conn.prepare(
            "SELECT COUNT(*), SUM(size_bytes) FROM files WHERE parent_path LIKE '%Downloads%'"
        ).ok()?;
        
        let mut rows = stmt.query([]).ok()?;
        
        if let Some(row) = rows.next().ok()? {
            let count: i64 = row.get(0).unwrap_or(0);
            
            if count > 20 {
                 let plan = SuggestionPlan {
                    moves: vec![], // Populated in a real detail scan
                    reason: "Downloads folder is cluttered".to_string(),
                };
                
                return Some(Suggestion {
                    id: None,
                    category: "declutter".to_string(),
                    title: "Clean up Downloads".to_string(),
                    description: format!("Found {} files in Downloads that could be organized.", count),
                    plan_json: serde_json::to_string(&plan).unwrap_or_default(),
                    file_count: count,
                    confidence: 0.8,
                    status: "pending".to_string(),
                    created_at: Utc::now().to_rfc3339(),
                    resolved_at: None,
                });
            }
        }

        None
    }
    pub async fn run_ai_analysis(&self) -> Result<Vec<Suggestion>, String> {
        let mut suggestions = Vec::new();
        
        // 1. Identify messy folders
        // For prototype: Look at "Downloads" and "Desktop" (mocked paths for now)
        // Real app: Query DB for folders with > 50 files and 0 subfolders.
        
        // Mocking a check for "unsorted" folder
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

        // Find folders with many files
        let mut stmt = conn.prepare(
            "SELECT parent_path, COUNT(*) as c FROM files GROUP BY parent_path HAVING c > 10"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |row| {
             Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        }).map_err(|e| e.to_string())?;

        for row in rows {
            let (path, count) = row.map_err(|e| e.to_string())?;
            // Skip if already organized (simple check: path contains year?)
            if path.contains("202") { continue; } 

            // Analyze this folder with AI
            if let Some(suggestion) = self.analyze_folder_structure(&path, count, &conn).await {
                suggestions.push(suggestion);
            }
        }

        Ok(suggestions)
    }

    async fn analyze_folder_structure(&self, path: &str, count: i64, conn: &rusqlite::Connection) -> Option<Suggestion> {
        // Fetch sample files
        let mut stmt = conn.prepare(
            "SELECT name FROM files WHERE parent_path = ?1 LIMIT 20"
        ).ok()?;
        
        let file_names: Vec<String> = stmt.query_map([path], |row| row.get(0)).ok()?
            .filter_map(Result::ok)
            .collect();

        if file_names.is_empty() { return None; }

        let prompt = format!(
            "Analyze this list of files from folder '{}': {:?}. \
            Suggest a reorganization strategy (e.g. by date, by type, by project). \
            Return JSON with 'category', 'title', 'description', 'confidence' (0.0-1.0), and 'reason'. \
            Do not list individual moves, just the strategy.",
            path, file_names
        );

        // Call LLM
        if let Ok(response) = self.call_llm(&prompt).await {
             // Parse simplified response for prototype
             // In production: Parse rigorous JSON schema
             Some(Suggestion {
                id: None,
                category: "sort".to_string(),
                title: format!("Organize {}", Path::new(path).file_name()?.to_string_lossy()),
                description: response.description.unwrap_or_else(|| "AI suggests organizing this folder".to_string()),
                plan_json: "{}".to_string(), // TODO: meaningful plan
                file_count: count,
                confidence: response.confidence.unwrap_or(0.5),
                status: "pending".to_string(),
                created_at: Utc::now().to_rfc3339(),
                resolved_at: None,
            })
        } else {
            None
        }
    }

    async fn call_llm(&self, prompt: &str) -> Result<LLMResponse, String> {
        // Mock LLM call or use reqwest to local/remote API
        // For this task, we'll assume a local Ollama instance or compatible
        
        let client = reqwest::Client::new();
        let res = client.post("http://localhost:11434/api/generate")
            .json(&json!({
                "model": "llama3", // or similar
                "prompt": prompt,
                "stream": false,
                "format": "json"
            }))
            .send()
            .await;

        match res {
            Ok(response) => {
                 let text = response.text().await.map_err(|e| e.to_string())?;
                 let val: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                 // Ollama returns { "response": "{...json...}" }
                 if let Some(inner_json) = val.get("response").and_then(|v| v.as_str()) {
                      serde_json::from_str(inner_json).map_err(|e| e.to_string())
                 } else {
                     Err("Failed to parse LLM response".to_string())
                 }
            }
            Err(_) => {
                // Fallback / Mock for when LLM is offline
                Ok(LLMResponse {
                    category: Some("sort".to_string()),
                    title: Some("Organize Folder".to_string()),
                    description: Some("Organize by file type".to_string()),
                    confidence: Some(0.7),
                    reason: Some("Files have diverse extensions".to_string()),
                })
            }
        }
    }
}

#[derive(Deserialize)]
struct LLMResponse {
    category: Option<String>,
    title: Option<String>,
    description: Option<String>,
    confidence: Option<f32>,
    reason: Option<String>,
}

// Commands

#[tauri::command]
pub async fn generate_suggestions(app: AppHandle) -> Result<Vec<Suggestion>, String> {
    let engine = SuggestionEngine::new(app.clone());
    let mut suggestions = engine.run_heuristics()?;
    
    // Run AI analysis
    match engine.run_ai_analysis().await {
        Ok(mut ai_suggestions) => suggestions.append(&mut ai_suggestions),
        Err(e) => eprintln!("AI Analysis failed: {}", e), // Non-fatal
    }
    
    // Save to DB
    let app_dir = app.path().app_data_dir().unwrap();
    let db_path = app_dir.join("filenova.db");
    let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

    for s in &suggestions {
        // Deduplicate? For now, just insert.
        conn.execute(
            "INSERT INTO suggestions (category, title, description, plan_json, file_count, confidence, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            (
                &s.category,
                &s.title,
                &s.description,
                &s.plan_json,
                &s.file_count,
                &s.confidence,
                "pending",
                &s.created_at,
            ),
        ).map_err(|e| e.to_string())?;
    }

    Ok(suggestions)
}

#[tauri::command]
pub fn get_pending_suggestions(app: AppHandle) -> Result<Vec<Suggestion>, String> {
    let app_dir = app.path().app_data_dir().unwrap();
    let db_path = app_dir.join("filenova.db");
    let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, category, title, description, plan_json, file_count, confidence, status, created_at, resolved_at FROM suggestions WHERE status = 'pending' ORDER BY confidence DESC"
    ).map_err(|e| e.to_string())?;

    let suggestion_iter = stmt.query_map([], |row| {
        Ok(Suggestion {
            id: Some(row.get(0)?),
            category: row.get(1)?,
            title: row.get(2)?,
            description: row.get(3)?,
            plan_json: row.get(4)?,
            file_count: row.get(5)?,
            confidence: row.get(6)?,
            status: row.get(7)?,
            created_at: row.get(8)?,
            resolved_at: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut suggestions = Vec::new();
    for s in suggestion_iter {
        suggestions.push(s.map_err(|e| e.to_string())?);
    }

    Ok(suggestions)
}

#[tauri::command]
pub async fn accept_suggestion(app: AppHandle, id: i64) -> Result<String, String> {
     let app_dir = app.path().app_data_dir().unwrap();
    let db_path = app_dir.join("filenova.db");
    let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

    // 1. Fetch plan
    let mut stmt = conn.prepare("SELECT plan_json FROM suggestions WHERE id = ?1").map_err(|e| e.to_string())?;
    let plan_json: String = stmt.query_row([id], |row| row.get(0)).map_err(|e| e.to_string())?;
    
    let plan: SuggestionPlan = serde_json::from_str(&plan_json).map_err(|e| e.to_string())?;

    // 2. Execute moves (Naive implementation)
    // In production, use `operations` journal and `undo` capabilities
    let batch_id = uuid::Uuid::new_v4().to_string();
    
    // In a real implementation:
    // 1. Validate paths
    // 2. Perform moves
    // 3. Log to operations table with batch_id
    
    for file_move in plan.moves {
        let src = Path::new(&file_move.file_path);
        let dst = Path::new(&file_move.new_path);
        
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        
        if src.exists() {
             std::fs::rename(src, dst).map_err(|e| format!("Failed to move {}: {}", src.display(), e))?;
        } else {
            eprintln!("Source file not found: {}", src.display());
            // Continue or error? For now continue
        }
        
        // Update DB paths... (omitted for brevity in this stage, but critical for real app)
        // Log to operations...
    }

    // 3. Mark as accepted
    conn.execute(
        "UPDATE suggestions SET status = 'accepted', resolved_at = ?2 WHERE id = ?1",
        (id, Utc::now().to_rfc3339()),
    ).map_err(|e| e.to_string())?;

    Ok(batch_id)
}

#[tauri::command]
pub fn reject_suggestion(app: AppHandle, id: i64) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().unwrap();
    let db_path = app_dir.join("filenova.db");
    let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE suggestions SET status = 'rejected', resolved_at = ?2 WHERE id = ?1",
        (id, Utc::now().to_rfc3339()),
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn modify_suggestion(app: AppHandle, id: i64, updated_plan: String) -> Result<(), String> {
     let app_dir = app.path().app_data_dir().unwrap();
    let db_path = app_dir.join("filenova.db");
    let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE suggestions SET plan_json = ?2, status = 'modified' WHERE id = ?1",
        (id, updated_plan),
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Serialize)]
pub struct StructureAnalysis {
    pub path: String,
    pub file_count: i64,
    pub subfolder_count: i64,
    pub depth: i64,
    pub clutter_score: f32,
    pub suggestions: Vec<String>,
}

#[tauri::command]
pub fn get_folder_structure_analysis(path: &str) -> Result<StructureAnalysis, String> {
    // Basic analysis stub
    let p = Path::new(path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }

    let walker = WalkDir::new(p).max_depth(3);
    let mut file_count = 0;
    let mut subfolder_count = 0;

    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            file_count += 1;
        } else if entry.file_type().is_dir() && entry.path() != p {
            subfolder_count += 1;
        }
    }

    Ok(StructureAnalysis {
        path: path.to_string(),
        file_count,
        subfolder_count,
        depth: 0, // Simplified
        clutter_score: if file_count > 50 { 0.8 } else { 0.2 },
        suggestions: vec!["Consider grouping by date".to_string()],
    })
}
