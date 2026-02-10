use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

use crate::db;
use crate::embeddings::{self, EmbeddingConfig};
use crate::execution::{self, FileMove};

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

pub struct SuggestionEngine {
    app_handle: AppHandle,
}

impl SuggestionEngine {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    pub fn run_heuristics(&self) -> Result<Vec<Suggestion>, String> {
        let mut suggestions = Vec::new();

        // 1. Declutter Downloads (Old files)
        if let Some(s) = self.check_downloads_declutter() {
            suggestions.push(s);
        }

        // 2. Consolidation (Scattered PDFs)
        if let Some(s) = self.check_consolidation("pdf", "Documents") {
            suggestions.push(s);
        }

        // 3. Archive (Old Projects)
        if let Some(s) = self.check_archive_suggestions() {
            suggestions.push(s);
        }

        // 4. Sorting (Crowded Folders)
        if let Some(s) = self.check_sorting_opportunities() {
            suggestions.push(s);
        }

        // 5. Naming Patterns
        if let Some(s) = self.check_naming_patterns() {
            suggestions.push(s);
        }

        Ok(suggestions)
    }

    fn check_downloads_declutter(&self) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;
        
        // Find files in "Downloads" folder created > 30 days ago
        let mut stmt = conn.prepare(
            "SELECT path, name FROM files 
             WHERE parent_path LIKE '%Downloads' 
             AND created_at < datetime('now', '-30 days')
             LIMIT 100"
        ).ok()?;
        
        let files: Vec<(String, String)> = stmt.query_map([], |row| {
             Ok((row.get(0)?, row.get(1)?))
        }).ok()?.filter_map(Result::ok).collect();
        
        if files.len() > 10 {
             let mut moves = Vec::new();
             for (path, name) in &files {
                 let p = Path::new(path);
                 if let Some(parent) = p.parent() {
                     let new_path = parent.join("Old_Downloads").join(name);
                     moves.push(FileMove {
                         file_path: path.clone(),
                         new_path: new_path.to_string_lossy().to_string(),
                         reason: Some("File is older than 30 days".to_string()),
                     });
                 }
             }
             
             let plan = SuggestionPlan {
                moves,
                reason: "Downloads folder contains many old files.".to_string(),
            };
            
            return Some(Suggestion {
                id: None,
                category: "declutter".to_string(),
                title: "Archive Old Downloads".to_string(),
                description: format!("Found {} files in Downloads older than 30 days.", files.len()),
                plan_json: serde_json::to_string(&plan).unwrap_or_default(),
                file_count: files.len() as i64,
                confidence: 0.9,
                status: "pending".to_string(),
                created_at: Utc::now().to_rfc3339(),
                resolved_at: None,
            });
        }
        None
    }

    fn check_consolidation(&self, extension: &str, target_folder_name: &str) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;

        let query = format!(
            "SELECT path, name, parent_path FROM files 
             WHERE extension = ?1 
             AND parent_path NOT LIKE '%{}%'
             LIMIT 50", 
             target_folder_name
        );

        let mut stmt = conn.prepare(&query).ok()?;
        let files: Vec<(String, String, String)> = stmt.query_map([extension], |row| {
             Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        }).ok()?.filter_map(Result::ok).collect();

        if files.len() > 10 {
             let folders: std::collections::HashSet<String> = files.iter().map(|f| f.2.clone()).collect();
             if folders.len() < 3 { return None; }

             let mut moves = Vec::new();
             let first_path = Path::new(&files[0].0);
             let target_dir = first_path.parent().unwrap().join(format!("Consolidated_{}s", extension.to_uppercase()));

             for (path, name, _) in &files {
                 let new_path = target_dir.join(name);
                 moves.push(FileMove {
                     file_path: path.clone(),
                     new_path: new_path.to_string_lossy().to_string(),
                     reason: Some(format!("Consolidating {} files", extension).to_string()),
                 });
             }

             let plan = SuggestionPlan {
                moves,
                reason: format!("Found {} files scattered across {} folders.", extension.to_uppercase(), folders.len()),
            };

            return Some(Suggestion {
                id: None,
                category: "consolidate".to_string(),
                title: format!("Consolidate {} Files", extension.to_uppercase()),
                description: format!("Found {} {} files scattered in different locations.", files.len(), extension),
                plan_json: serde_json::to_string(&plan).unwrap_or_default(),
                file_count: files.len() as i64,
                confidence: 0.75,
                status: "pending".to_string(),
                created_at: Utc::now().to_rfc3339(),
                resolved_at: None,
            });
        }
        None
    }

    fn check_archive_suggestions(&self) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;
        
        // Find folders not accessed in 6 months (simulated by Modified date for now as Access time is tricky on some OS)
        // Group by parent_path to find "dead projects"
        let mut stmt = conn.prepare(
            "SELECT parent_path, Count(*) as c, MAX(modified_at) as last_mod 
             FROM files 
             GROUP BY parent_path 
             HAVING c > 10 AND last_mod < datetime('now', '-6 months')
             LIMIT 1"
        ).ok()?;
        
        let result: Option<(String, i64)> = stmt.query_row([], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }).ok();

        if let Some((path, count)) = result {
             let mut moves = Vec::new();
             let p = Path::new(&path);
             
             // Move the entire folder to "Archive"
             // But we execute per-file.
             // Actually, we can suggest moving just the *files* or the folder itself?
             // Simplest: Move to an "_Archive" sibling folder.
             
             if let Some(parent) = p.parent() {
                 let archive_dir = parent.join("_Archive").join(p.file_name().unwrap());
                 
                 // Get all files in this folder to move
                 let mut file_stmt = conn.prepare("SELECT path, name FROM files WHERE parent_path = ?1").ok()?;
                 let files = file_stmt.query_map([&path], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                    .ok()?.filter_map(Result::ok);

                 for (f_path, f_name) in files {
                     moves.push(FileMove {
                         file_path: f_path,
                         new_path: archive_dir.join(f_name).to_string_lossy().to_string(),
                         reason: Some("Folder inactive for 6+ months".to_string()),
                     });
                 }

                 let plan = SuggestionPlan {
                    moves,
                    reason: format!("Folder '{}' hasn't been modified in 6 months.", path),
                };

                return Some(Suggestion {
                    id: None,
                    category: "archive".to_string(),
                    title: format!("Archive Inactive Folder: {}", p.file_name().unwrap().to_string_lossy()),
                    description: format!("The folder '{}' has {} files and hasn't been active recently.", p.file_name().unwrap().to_string_lossy(), count),
                    plan_json: serde_json::to_string(&plan).unwrap_or_default(),
                    file_count: count,
                    confidence: 0.85,
                    status: "pending".to_string(),
                    created_at: Utc::now().to_rfc3339(),
                    resolved_at: None,
                });
             }
        }
        None
    }

    fn check_sorting_opportunities(&self) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;

        // Find "Flat" folders with many files (> 50)
        let mut stmt = conn.prepare(
            "SELECT parent_path, COUNT(*) as c FROM files GROUP BY parent_path HAVING c > 50 LIMIT 1"
        ).ok()?;
        
        let result: Option<(String, i64)> = stmt.query_row([], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }).ok();

        if let Some((path, count)) = result {
            // Suggest grouping by Extension
            // Get files
             let mut file_stmt = conn.prepare("SELECT path, name, extension FROM files WHERE parent_path = ?1 LIMIT 100").ok()?;
             let files = file_stmt.query_map([&path], |row| {
                 Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?))
             }).ok()?.filter_map(Result::ok);

             let mut moves = Vec::new();
             for (f_path, f_name, ext_opt) in files {
                 let ext = ext_opt.unwrap_or("Misc".to_string());
                 let new_path = Path::new(&path).join(&ext).join(&f_name);
                 
                 moves.push(FileMove {
                     file_path: f_path,
                     new_path: new_path.to_string_lossy().to_string(),
                     reason: Some(format!("Group by type: {}", ext)),
                 });
             }

             let plan = SuggestionPlan {
                moves,
                reason: "Folder is crowded. Grouping by file type is recommended.".to_string(),
            };

            return Some(Suggestion {
                id: None,
                category: "sort".to_string(),
                title: format!("Organize '{}' by Type", Path::new(&path).file_name().unwrap_or_default().to_string_lossy()),
                description: format!("This folder has {} files. Grouping them by type (extension) will reduce clutter.", count),
                plan_json: serde_json::to_string(&plan).unwrap_or_default(),
                file_count: count,
                confidence: 0.8,
                status: "pending".to_string(),
                created_at: Utc::now().to_rfc3339(),
                resolved_at: None,
            });
        }
        None
    }

    fn check_naming_patterns(&self) -> Option<Suggestion> {
        // Placeholder for Naming Pattern Detection
        // "Inconsistent naming in same folder" is hard without complex string analysis.
        // For Stage 7 MVP, we might look for "IMG_*" mixed with "DSC_*" mixed with other things?
        // Or spaces vs underscores.
        
        // Let's implement a specific heuristic: "Spaces vs Underscores inconsistency"
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;
        
        let mut stmt = conn.prepare(
            "SELECT parent_path, COUNT(*) as c FROM files WHERE name LIKE '% %' GROUP BY parent_path HAVING c > 5 LIMIT 1"
        ).ok()?;
        
         let result: Option<(String, i64)> = stmt.query_row([], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }).ok();

        if let Some((path, count)) = result {
             // If we have files with spaces, suggest replacing with underscores
             // But only if there are also files with underscores? Or just as a standardizer.
             
             let mut file_stmt = conn.prepare("SELECT path, name FROM files WHERE parent_path = ?1 AND name LIKE '% %'").ok()?;
             let files = file_stmt.query_map([&path], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                .ok()?.filter_map(Result::ok);
            
             let mut moves = Vec::new();
             for (f_path, f_name) in files {
                 let new_name = f_name.replace(" ", "_");
                 let new_path = Path::new(&path).join(new_name);
                 
                 moves.push(FileMove {
                     file_path: f_path,
                     new_path: new_path.to_string_lossy().to_string(),
                     reason: Some("Standardize filename (spaces to underscores)".to_string()),
                 });
             }
             
             if !moves.is_empty() {
                 let plan = SuggestionPlan {
                    moves,
                    reason: "Inconsistent naming (spaces found).".to_string(),
                };

                return Some(Suggestion {
                    id: None,
                    category: "rename".to_string(),
                    title: "Standardize Filenames".to_string(),
                    description: format!("Found {} files with spaces in '{}'. Replacing with underscores improves compatibility.", count, path),
                    plan_json: serde_json::to_string(&plan).unwrap_or_default(),
                    file_count: count as i64,
                    confidence: 0.6,
                    status: "pending".to_string(),
                    created_at: Utc::now().to_rfc3339(),
                    resolved_at: None,
                });
             }
        }

        None
    }

    pub async fn run_ai_analysis(&self, target_folders: Vec<(String, i64, Vec<String>)>, config: EmbeddingConfig) -> Result<Vec<Suggestion>, String> {
        let mut suggestions = Vec::new();
        
        for (path, count, file_names) in target_folders {
            if let Some(suggestion) = self.analyze_folder_structure(&path, count, &file_names, &config).await {
                suggestions.push(suggestion);
            }
        }

        Ok(suggestions)
    }

    async fn analyze_folder_structure(&self, path: &str, count: i64, file_names: &[String], config: &EmbeddingConfig) -> Option<Suggestion> {
        if file_names.is_empty() { return None; }

        let prompt = format!(
            "Analyze these files from '{}' (Total {}): {:?}. \
            Suggest a reorganization strategy. \
            Return JSON with: \
            'title' (short title), \
            'description' (1 sentence), \
            'strategy' ('date', 'extension', 'project', 'topic'), \
            'confidence' (0.0-1.0), \
            'groups' (list of {{ 'name': 'group name', 'criteria': '...' }}). \
            Reasoning for the plan.",
            path, count, file_names
        );

        // Call LLM
        match self.call_llm(config, &prompt).await {
            Ok(response) => {
                 // Convert AI abstract plan into concrete FileMoves
                 let plan = self.generate_moves_from_strategy(&response, path, file_names);
                 
                 Some(Suggestion {
                    id: None,
                    category: "sort".to_string(), // Could vary based on AI response
                    title: response.title.unwrap_or_else(|| "Organize Folder".to_string()),
                    description: response.description.unwrap_or_else(|| "AI suggested organization".to_string()),
                    plan_json: serde_json::to_string(&plan).unwrap_or_default(),
                    file_count: count,
                    confidence: response.confidence.unwrap_or(0.5),
                    status: "pending".to_string(),
                    created_at: Utc::now().to_rfc3339(),
                    resolved_at: None,
                })
            }
            Err(e) => {
                eprintln!("LLM Call failed: {}", e);
                None
            }
        }
    }
    
    fn generate_moves_from_strategy(&self, ai_resp: &LLMResponse, base_path: &str, file_names: &[String]) -> SuggestionPlan {
        let mut moves = Vec::new();
        let strategy = ai_resp.strategy.as_deref().unwrap_or("extension");
        
        // Naive implementation of strategies to map AI intent to actual moves
        // Real implementation would pass specific file->group mapping to AI or ask AI to group them explicitly.
        // For now, we apply the *suggested strategy* ourselves using simple logic.
        
        for name in file_names {
            let src_path = Path::new(base_path).join(name);
            let subfolder = match strategy {
                "extension" => {
                    Path::new(name).extension().map(|e| e.to_string_lossy().to_string()).unwrap_or("Misc".to_string())
                },
                "date" => {
                    // We'd need file metadata here. Mocking "Unknown Date"
                    "Unknown_Date".to_string()
                },
                _ => "Misc".to_string()
            };
            
            let new_path = Path::new(base_path).join(subfolder).join(name);
            moves.push(FileMove {
                file_path: src_path.to_string_lossy().to_string(),
                new_path: new_path.to_string_lossy().to_string(),
                reason: Some(format!("Group by {}", strategy)),
            });
        }
        
        SuggestionPlan {
            moves,
            reason: ai_resp.reason.clone().unwrap_or_default(),
        }
    }

    async fn call_llm(&self, config: &EmbeddingConfig, prompt: &str) -> Result<LLMResponse, String> {
        // Reuse EmbeddingConfig to determine provider, but we need Chat/Generate endpoints
        let client = reqwest::Client::new();
        
        // This is a simplified "text generation" call. 
        // For OpenAI we need `chat/completions`. For Ollama `api/generate`.
        
        // For now, prototype with Ollama `api/generate` assuming local LLM if provider is Ollama
        // If OpenAI, use async_openai
        
        match config.provider {
            embeddings::AiProvider::Ollama => {
                 let url = format!("{}/api/generate", config.ollama_url);
                 let res = client.post(&url)
                    .json(&json!({
                        "model": config.model, // Note: embedding model might not be chat model. Should have separate setting?
                        // Fallback to "llama3" if model contains "embed"
                        "model": if config.model.contains("embed") { "llama3" } else { &config.model },
                        "prompt": prompt,
                        "stream": false,
                        "format": "json"
                    }))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                    
                 if !res.status().is_success() {
                     return Err(format!("Ollama error: {}", res.status()));
                 }
                 
                 let text = res.text().await.map_err(|e| e.to_string())?;
                 let val: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                 
                 if let Some(inner) = val.get("response").and_then(|v| v.as_str()) {
                     serde_json::from_str(inner).map_err(|e| e.to_string())
                 } else {
                     Err("No response field in Ollama output".to_string())
                 }
            },
            embeddings::AiProvider::OpenAI => {
                 // Stub for OpenAI Chat
                 Err("OpenAI Chat Check not implemented specifically in this stub yet".to_string())
            }
        }
    }
}

#[derive(Deserialize)]
struct LLMResponse {
    title: Option<String>,
    description: Option<String>,
    confidence: Option<f32>,
    reason: Option<String>,
    strategy: Option<String>, // 'date', 'extension', etc.
}

// Commands

#[tauri::command]
pub async fn generate_suggestions(app: AppHandle) -> Result<Vec<Suggestion>, String> {
    let engine = SuggestionEngine::new(app.clone());
    
    // Phase 1: Heuristics & Data Collection (Sync/Blocking)
    // We use a block to enforce dropping of connection before async calls
    let (mut suggestions, ai_targets, config) = {
        let app_dir = app.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

        let heuristics = engine.run_heuristics().unwrap_or_default(); // Modified run_heuristics to not need &self if possible, or new engine?
        // engine.run_heuristics creates its own connection internally currently.
        // Let's optimize: run_heuristics opens DB. That's fine as it is synchronous.
        
        // Prepare AI targets
        let mut ai_targets = Vec::new();
        
        // 1. Identify "Messy Checkpoint"
        let mut stmt = conn.prepare(
            "SELECT parent_path, COUNT(*) as c FROM files GROUP BY parent_path HAVING c > 15 ORDER BY c DESC LIMIT 3"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |row| {
             Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        }).map_err(|e| e.to_string())?;
        
        // Collect rows
        let mut folder_candidates = Vec::new();
        for r in rows {
            if let Ok(item) = r {
                folder_candidates.push(item);
            }
        }
        
        for (path, count) in folder_candidates {
             if path.contains("202") { continue; }
             
             // Fetch sample files for this path
             let mut file_stmt = conn.prepare("SELECT name FROM files WHERE parent_path = ?1 LIMIT 30").map_err(|e| e.to_string())?;
             let names: Vec<String> = file_stmt.query_map([&path], |row| row.get(0)).map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
                
             if !names.is_empty() {
                 ai_targets.push((path, count, names));
             }
        }
        
        let config = EmbeddingConfig::from_settings(&conn);
        
        (heuristics, ai_targets, config)
    }; // conn dropped here

    // Phase 2: Async AI Analysis
    // Now we are safe to await
    match engine.run_ai_analysis(ai_targets, config).await {
         Ok(mut ai_res) => suggestions.append(&mut ai_res),
         Err(e) => eprintln!("AI Analysis warning: {}", e),
    }

    // Phase 3: Save results (Sync/Blocking)
    {
         let app_dir = app.path().app_data_dir().unwrap();
         let db_path = app_dir.join("filenova.db");
         let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;
         
         for s in &suggestions {
             let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM suggestions WHERE title = ?1 AND category = ?2 AND status = 'pending'",
                [&s.title, &s.category],
                |row| row.get(0)
            ).unwrap_or(0);
            
            if count == 0 {
                let _ = conn.execute(
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
                );
            }
         }
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

    // 2. Execute moves via execution module
    let batch_id = uuid::Uuid::new_v4().to_string();
    
    execution::execute_moves(&conn, plan.moves.clone(), &batch_id)?;

    // 3. Update Tantivy Index
    // We do this after execution so files are in their new places
    let index_manager = app.state::<std::sync::Arc<crate::search_index::IndexManager>>();
    
    for mv in &plan.moves {
        // Remove old path
        let _ = index_manager.remove_file(&mv.file_path);
        
        // Add new path
        let p = std::path::Path::new(&mv.new_path);
        if p.exists() {
             if let Ok(metadata) = std::fs::metadata(p) {
                 let name = p.file_name().unwrap_or_default().to_string_lossy();
                 let ext = p.extension().map(|e| e.to_string_lossy());
                 let parent = p.parent().map(|p| p.to_string_lossy()).unwrap_or_default();
                 let size = metadata.len() as i64;
                 let modified = metadata.modified().unwrap_or(std::time::SystemTime::now())
                    .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
                 
                 let _ = index_manager.add_or_update_file(
                     &mv.new_path,
                     &name,
                     ext.as_deref(),
                     &parent,
                     size,
                     modified
                 );
             }
        }
    }
    // Commit changes
    let _ = index_manager.commit();


    // 4. Mark as accepted
    conn.execute(
        "UPDATE suggestions SET status = 'accepted', resolved_at = ?2 WHERE id = ?1",
        (id, Utc::now().to_rfc3339()),
    ).map_err(|e| e.to_string())?;

    Ok(batch_id)
}

pub fn start_background_scanner(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Initial delay to let app startup and index load
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;

        loop {
            println!("Starting daily suggestion analysis...");
            let engine = SuggestionEngine::new(app.clone());
            
            // Phase 1: Heuristics & Data Collection (Sync)
            let (heuristics, ai_targets, config) = {
                let app_dir = app.path().app_data_dir().unwrap();
                let db_path = app_dir.join("filenova.db");
                
                if let Ok(conn) = db::init_db(&db_path) {
                    let h = engine.run_heuristics().unwrap_or_default();
                    
                    let mut ai_t: Vec<(String, i64, Vec<String>)> = Vec::new();
                    // Identify targets
                     if let Ok(mut stmt) = conn.prepare("SELECT parent_path, COUNT(*) as c FROM files GROUP BY parent_path HAVING c > 15 ORDER BY c DESC LIMIT 3") {
                        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))).unwrap();
                        for r in rows {
                            if let Ok((path, count)) = r {
                                if path.contains("202") { continue; }
                                if let Ok(mut f_stmt) = conn.prepare("SELECT name FROM files WHERE parent_path = ?1 LIMIT 30") {
                                    let names: Vec<String> = f_stmt.query_map([&path], |row| row.get(0)).unwrap().filter_map(Result::ok).collect();
                                    if !names.is_empty() {
                                        ai_t.push((path, count, names));
                                    }
                                }
                            }
                        }
                     }
                     let c = EmbeddingConfig::from_settings(&conn);
                     (h, ai_t, c)
                } else {
                    (Vec::new(), Vec::new(), EmbeddingConfig::default_config())
                }
            };

            save_suggestions(&app, heuristics);

            // Phase 2: AI (Async)
            if !ai_targets.is_empty() {
                if let Ok(ai_suggestions) = engine.run_ai_analysis(ai_targets, config).await {
                     save_suggestions(&app, ai_suggestions);
                }
            }

            // Wait 24 hours
            tokio::time::sleep(tokio::time::Duration::from_secs(24 * 60 * 60)).await;
        }
    });
}

fn save_suggestions(app: &AppHandle, suggestions: Vec<Suggestion>) {
    let app_dir = app.path().app_data_dir().unwrap();
    let db_path = app_dir.join("filenova.db");
    if let Ok(conn) = db::init_db(&db_path) {
        for s in suggestions {
             let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM suggestions WHERE title = ?1 AND category = ?2 AND status = 'pending'",
                [&s.title, &s.category],
                |row| row.get(0)
            ).unwrap_or(0);
            
            if count == 0 {
                let _ = conn.execute(
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
                );
            }
        }
    }
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
    pub extensions: HashMap<String, i64>,
    pub huge_files: Vec<(String, u64)>, // Name, Size
}

#[tauri::command]
pub fn get_folder_structure_analysis(path: &str) -> Result<StructureAnalysis, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }

    let mut file_count = 0;
    let mut subfolder_count = 0;
    let mut extensions = HashMap::new();
    let mut huge_files = Vec::new();
    let max_depth_reached = 0; // TODO: Calculate actual depth

    let walker = WalkDir::new(p).max_depth(3);
    
    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        if entry.path() == p { continue; }
        
        if entry.file_type().is_file() {
            file_count += 1;
            
            // Extension stats
            if let Some(ext) = entry.path().extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                *extensions.entry(ext_str).or_insert(0) += 1;
            }
            
            // Large file check (> 100MB)
            if let Ok(metadata) = entry.metadata() {
                if metadata.len() > 100 * 1024 * 1024 {
                    huge_files.push((
                        entry.file_name().to_string_lossy().to_string(), 
                        metadata.len()
                    ));
                }
            }
        } else if entry.file_type().is_dir() {
            subfolder_count += 1;
        }
    }

    // Heuristic Suggestions
    let mut suggestions = Vec::new();
    if file_count > 50 && subfolder_count == 0 {
        suggestions.push("Folder is flat and crowded. Consider creating subfolders.".to_string());
    }
    
    let mut dominant_ext = None;
    for (ext, count) in &extensions {
        if *count > file_count / 2 && *count > 10 {
            dominant_ext = Some(ext.clone());
        }
    }
    
    if let Some(ext) = dominant_ext {
        suggestions.push(format!("Mostly {} files. Consider moving them to a dedicated library.", ext));
    }
    
    if !huge_files.is_empty() {
        suggestions.push(format!("Found {} large files (>100MB).", huge_files.len()));
    }

    Ok(StructureAnalysis {
        path: path.to_string(),
        file_count,
        subfolder_count,
        depth: max_depth_reached, 
        clutter_score: if file_count > 50 { 0.8 } else { 0.2 },
        suggestions,
        extensions,
        huge_files,
    })
}
