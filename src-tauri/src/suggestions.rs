use chrono::Utc;
use log::{info, warn, error};
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
    pub total_size_bytes: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SuggestionPlan {
    pub moves: Vec<FileMove>,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenameFileContext {
    pub name: String,
    pub date: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenameExample {
    pub old: String,
    pub new: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenamePatternSuggestion {
    pub pattern: String,
    pub examples: Vec<RenameExample>,
}

pub struct SuggestionEngine {
    app_handle: AppHandle,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct AiFileInfo {
    name: String,
    path: String,
    modified_at: Option<i64>,
    tags: Vec<String>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
struct AiTarget {
    path: String,
    count: i64,
    files: Vec<AiFileInfo>,
}

impl SuggestionEngine {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    fn common_root(paths: &[String]) -> Option<PathBuf> {
        if paths.is_empty() {
            return None;
        }

        let mut common: Vec<std::ffi::OsString> = Path::new(&paths[0])
            .components()
            .map(|c| c.as_os_str().to_os_string())
            .collect();

        for p in paths.iter().skip(1) {
            let comps: Vec<std::ffi::OsString> = Path::new(p)
                .components()
                .map(|c| c.as_os_str().to_os_string())
                .collect();

            let mut i = 0;
            while i < common.len() && i < comps.len() && common[i] == comps[i] {
                i += 1;
            }
            common.truncate(i);
            if common.is_empty() {
                break;
            }
        }

        if common.is_empty() {
            return None;
        }

        let mut root = PathBuf::new();
        for c in common {
            root.push(c);
        }
        Some(root)
    }

    fn normalize_stem(name: &str) -> String {
        let stem = Path::new(name)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let lower = stem.to_lowercase();
        lower
            .chars()
            .filter(|c| c.is_ascii_alphabetic())
            .collect::<String>()
    }

    fn extract_tags(raw: Option<String>) -> Vec<String> {
        raw.unwrap_or_default()
            .split(',')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect()
    }

    pub fn run_heuristics(&self) -> Result<Vec<Suggestion>, String> {
        let mut suggestions = Vec::new();

        // 1. Declutter Downloads (Old files)
        if let Some(s) = self.check_downloads_declutter() {
            suggestions.push(s);
        }

        // 1b. Declutter Temp folders
        if let Some(s) = self.check_temp_declutter() {
            suggestions.push(s);
        }

        // 1c. Declutter flat folders with 50+ files
        if let Some(s) = self.check_flat_folder_declutter() {
            suggestions.push(s);
        }

        // 2. Consolidation (scattered types)
        if let Some(s) = self.check_consolidation_scattered_types() {
            suggestions.push(s);
        }

        // 2b. Consolidation (similar names)
        if let Some(s) = self.check_similar_named_files() {
            suggestions.push(s);
        }

        // 2c. Consolidation (same tag across folders)
        if let Some(s) = self.check_tag_consolidation() {
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

        // 6. Desktop Declutter
        if let Some(s) = self.check_desktop_declutter() {
            suggestions.push(s);
        }

        // 7. Large Old Folders
        if let Some(s) = self.check_large_old_folders() {
            suggestions.push(s);
        }

        Ok(suggestions)
    }

    fn check_downloads_declutter(&self) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;
        
        // Find files in "Downloads" folder created > 30 days ago
        let mut stmt = conn.prepare_cached(
            "SELECT path, name FROM files 
             WHERE parent_path LIKE '%Downloads%' 
             AND COALESCE(created_at, modified_at) < strftime('%s','now','-30 days')
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
                total_size_bytes: None,
            });
        }
        None
    }

    fn check_temp_declutter(&self) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;

        let mut stmt = conn
            .prepare_cached(
                "SELECT path, name FROM files 
                 WHERE (parent_path LIKE '%\\\\Temp%' OR parent_path LIKE '%/Temp%' OR parent_path LIKE '%\\\\tmp%' OR parent_path LIKE '%/tmp%')
                 AND COALESCE(modified_at, created_at) < strftime('%s','now','-30 days')
                 LIMIT 100",
            )
            .ok()?;

        let files: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .ok()?
            .filter_map(Result::ok)
            .collect();

        if files.len() > 10 {
            let mut moves = Vec::new();
            for (path, name) in &files {
                let p = Path::new(path);
                if let Some(parent) = p.parent() {
                    let new_path = parent.join("Temp_Cleanup").join(name);
                    moves.push(FileMove {
                        file_path: path.clone(),
                        new_path: new_path.to_string_lossy().to_string(),
                        reason: Some("Temp folder file is old".to_string()),
                    });
                }
            }

            let plan = SuggestionPlan {
                moves,
                reason: "Temp folders contain old files that can be cleaned up.".to_string(),
            };

            return Some(Suggestion {
                id: None,
                category: "declutter".to_string(),
                title: "Clean Up Temp Files".to_string(),
                description: format!(
                    "Found {} files in Temp folders older than 30 days.",
                    files.len()
                ),
                plan_json: serde_json::to_string(&plan).unwrap_or_default(),
                file_count: files.len() as i64,
                confidence: 0.8,
                status: "pending".to_string(),
                created_at: Utc::now().to_rfc3339(),
                resolved_at: None,
                total_size_bytes: None,
            });
        }

        None
    }

    fn check_flat_folder_declutter(&self) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;

        let mut stmt = conn
            .prepare_cached(
                "SELECT parent_path, COUNT(*) as c
                 FROM files
                 WHERE is_directory = 0
                 GROUP BY parent_path
                 HAVING c >= 50
                 ORDER BY c DESC
                 LIMIT 5",
            )
            .ok()?;

        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
            .ok()?;

        for row in rows.filter_map(Result::ok) {
            let (path, count) = row;

            let subfolder_files: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM files WHERE parent_path LIKE ?1 OR parent_path LIKE ?2",
                    [format!("{}\\%", path), format!("{}/%", path)],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            if subfolder_files > 0 {
                continue;
            }

            let mut file_stmt = conn
                .prepare_cached(
                    "SELECT path, name, extension FROM files WHERE parent_path = ?1 AND is_directory = 0 LIMIT 80",
                )
                .ok()?;
            let files = file_stmt
                .query_map([&path], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })
                .ok()?
                .filter_map(Result::ok);

            let mut moves = Vec::new();
            for (f_path, f_name, ext_opt) in files {
                let ext = ext_opt.unwrap_or_else(|| "Misc".to_string());
                let new_path = Path::new(&path).join(&ext).join(&f_name);
                moves.push(FileMove {
                    file_path: f_path,
                    new_path: new_path.to_string_lossy().to_string(),
                    reason: Some("Folder has no subfolders".to_string()),
                });
            }

            if moves.is_empty() {
                continue;
            }

            let plan = SuggestionPlan {
                moves,
                reason: "Flat folder with many files. Grouping by type will reduce clutter.".to_string(),
            };

            return Some(Suggestion {
                id: None,
                category: "declutter".to_string(),
                title: "Declutter Crowded Folder".to_string(),
                description: format!(
                    "The folder '{}' has {} files and no subfolders.",
                    path, count
                ),
                plan_json: serde_json::to_string(&plan).unwrap_or_default(),
                file_count: plan.moves.len() as i64,
                confidence: 0.77,
                status: "pending".to_string(),
                created_at: Utc::now().to_rfc3339(),
                resolved_at: None,
                total_size_bytes: None,
            });
        }

        None
    }

    fn check_consolidation_scattered_types(&self) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;

        let mut stmt = conn
            .prepare_cached(
                "SELECT extension, COUNT(*) as c, COUNT(DISTINCT parent_path) as folders
                 FROM files
                 WHERE extension IS NOT NULL AND extension != '' AND is_directory = 0
                 GROUP BY extension
                 HAVING folders >= 4 AND c >= 20
                 ORDER BY folders DESC, c DESC
                 LIMIT 1",
            )
            .ok()?;

        let result: Option<(String, i64, i64)> = stmt
            .query_row([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .ok();

        let (extension, _count, folder_count) = result?;

        let mut file_stmt = conn
            .prepare_cached(
                "SELECT path, name, parent_path FROM files WHERE extension = ?1 AND is_directory = 0 LIMIT 80",
            )
            .ok()?;
        let files: Vec<(String, String, String)> = file_stmt
            .query_map([&extension], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .ok()?
            .filter_map(Result::ok)
            .collect();

        if files.len() < 10 {
            return None;
        }

        let parent_paths: Vec<String> = files.iter().map(|f| f.2.clone()).collect();
        let base = Self::common_root(&parent_paths)
            .unwrap_or_else(|| PathBuf::from(&files[0].2));

        let target_dir = base.join(format!("Consolidated_{}s", extension.to_uppercase()));
        let mut moves = Vec::new();
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
            reason: format!(
                "Found {} files scattered across {} folders.",
                extension.to_uppercase(),
                folder_count
            ),
        };

        Some(Suggestion {
            id: None,
            category: "consolidate".to_string(),
            title: format!("Consolidate {} Files", extension.to_uppercase()),
            description: format!(
                "{} files are spread across {} folders.",
                extension.to_uppercase(),
                folder_count
            ),
            plan_json: serde_json::to_string(&plan).unwrap_or_default(),
            file_count: files.len() as i64,
            confidence: 0.78,
            status: "pending".to_string(),
            created_at: Utc::now().to_rfc3339(),
            resolved_at: None,
            total_size_bytes: None,
        })
    }

    fn check_similar_named_files(&self) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;

        let mut stmt = conn
            .prepare_cached(
                "SELECT path, name, parent_path FROM files WHERE is_directory = 0 LIMIT 2000",
            )
            .ok()?;

        let files: Vec<(String, String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .ok()?
            .filter_map(Result::ok)
            .collect();

        let mut groups: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
        for (path, name, parent) in files {
            let key = Self::normalize_stem(&name);
            if key.len() < 4 {
                continue;
            }
            groups.entry(key).or_default().push((path, name, parent));
        }

        let mut best: Option<(String, Vec<(String, String, String)>)> = None;
        for (key, items) in groups {
            if items.len() < 5 {
                continue;
            }
            let distinct_folders: std::collections::HashSet<String> =
                items.iter().map(|i| i.2.clone()).collect();
            if distinct_folders.len() < 3 {
                continue;
            }
            if best.as_ref().map(|b| items.len() > b.1.len()).unwrap_or(true) {
                best = Some((key, items));
            }
        }

        let (_key, items) = best?;
        let parent_paths: Vec<String> = items.iter().map(|i| i.2.clone()).collect();
        let base = Self::common_root(&parent_paths).unwrap_or_else(|| PathBuf::from(&items[0].2));

        let target_dir = base.join("Consolidated_Similar_Names");
        let mut moves = Vec::new();
        for (path, name, _) in &items {
            let new_path = target_dir.join(name);
            moves.push(FileMove {
                file_path: path.clone(),
                new_path: new_path.to_string_lossy().to_string(),
                reason: Some("Similar naming detected across folders".to_string()),
            });
        }

        let plan = SuggestionPlan {
            moves,
            reason: "Similar-named files are spread across multiple folders.".to_string(),
        };

        Some(Suggestion {
            id: None,
            category: "consolidate".to_string(),
            title: "Consolidate Similar-Named Files".to_string(),
            description: format!(
                "Found {} similar-named files across multiple folders.",
                plan.moves.len()
            ),
            plan_json: serde_json::to_string(&plan).unwrap_or_default(),
            file_count: plan.moves.len() as i64,
            confidence: 0.7,
            status: "pending".to_string(),
            created_at: Utc::now().to_rfc3339(),
            resolved_at: None,
            total_size_bytes: None,
        })
    }

    fn check_tag_consolidation(&self) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;

        let mut stmt = conn
            .prepare_cached(
                "SELECT t.tag, COUNT(*) as c, COUNT(DISTINCT f.parent_path) as folders
                 FROM tags t
                 JOIN files f ON f.id = t.file_id
                 WHERE f.is_directory = 0
                 GROUP BY t.tag
                 HAVING folders >= 4 AND c >= 12
                 ORDER BY folders DESC, c DESC
                 LIMIT 1",
            )
            .ok()?;

        let result: Option<(String, i64, i64)> = stmt
            .query_row([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .ok();
        let (tag, _count, folder_count) = result?;

        let mut file_stmt = conn
            .prepare_cached(
                "SELECT f.path, f.name, f.parent_path
                 FROM tags t
                 JOIN files f ON f.id = t.file_id
                 WHERE t.tag = ?1 AND f.is_directory = 0
                 LIMIT 80",
            )
            .ok()?;

        let files: Vec<(String, String, String)> = file_stmt
            .query_map([&tag], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .ok()?
            .filter_map(Result::ok)
            .collect();

        if files.len() < 10 {
            return None;
        }

        let parent_paths: Vec<String> = files.iter().map(|f| f.2.clone()).collect();
        let base = Self::common_root(&parent_paths).unwrap_or_else(|| PathBuf::from(&files[0].2));
        let target_dir = base.join("Tagged").join(&tag);

        let mut moves = Vec::new();
        for (path, name, _) in &files {
            let new_path = target_dir.join(name);
            moves.push(FileMove {
                file_path: path.clone(),
                new_path: new_path.to_string_lossy().to_string(),
                reason: Some(format!("Consolidate files tagged '{}'", tag)),
            });
        }

        let plan = SuggestionPlan {
            moves,
            reason: format!(
                "Files tagged '{}' are spread across {} folders.",
                tag, folder_count
            ),
        };

        Some(Suggestion {
            id: None,
            category: "consolidate".to_string(),
            title: format!("Consolidate '{}' Files", tag),
            description: format!(
                "Tagged files are scattered across {} folders.",
                folder_count
            ),
            plan_json: serde_json::to_string(&plan).unwrap_or_default(),
            file_count: plan.moves.len() as i64,
            confidence: 0.74,
            status: "pending".to_string(),
            created_at: Utc::now().to_rfc3339(),
            resolved_at: None,
            total_size_bytes: None,
        })
    }

    fn check_archive_suggestions(&self) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;
        
        // Find folders not accessed in 6 months (simulated by Modified date for now as Access time is tricky on some OS)
        // Group by parent_path to find "dead projects"
        let mut stmt = conn.prepare_cached(
            "SELECT parent_path, Count(*) as c, MAX(modified_at) as last_mod 
             FROM files 
             GROUP BY parent_path 
               HAVING c > 10 AND last_mod < strftime('%s','now','-6 months')
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
                 let mut file_stmt = conn.prepare_cached("SELECT path, name FROM files WHERE parent_path = ?1").ok()?;
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
                    total_size_bytes: None,
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
        let mut stmt = conn
            .prepare_cached(
                "SELECT parent_path, COUNT(*) as c FROM files 
                 WHERE is_directory = 0
                 GROUP BY parent_path HAVING c >= 100 LIMIT 1",
            )
            .ok()?;
        
        let result: Option<(String, i64)> = stmt.query_row([], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }).ok();

        if let Some((path, count)) = result {
            // Suggest grouping by Extension
            // Get files
             let mut file_stmt = conn.prepare_cached("SELECT path, name, extension FROM files WHERE parent_path = ?1 LIMIT 100").ok()?;
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
                file_count: plan.moves.len() as i64,
                confidence: 0.8,
                status: "pending".to_string(),
                created_at: Utc::now().to_rfc3339(),
                resolved_at: None,
                total_size_bytes: None,
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
        
        let mut stmt = conn
            .prepare_cached(
                "SELECT parent_path, COUNT(*) as c,
                    SUM(CASE WHEN name LIKE '% %' THEN 1 ELSE 0 END) as space_count,
                    SUM(CASE WHEN name LIKE '%_%' THEN 1 ELSE 0 END) as underscore_count,
                    SUM(CASE WHEN name LIKE '%-%' THEN 1 ELSE 0 END) as dash_count
                 FROM files
                 WHERE is_directory = 0
                 GROUP BY parent_path
                 HAVING c > 10 AND space_count > 0 AND (underscore_count > 0 OR dash_count > 0)
                 LIMIT 1",
            )
            .ok()?;
        
            let result: Option<(String, i64)> = stmt
                .query_row([], |row| Ok((row.get(0)?, row.get(1)?)))
                .ok();

        if let Some((path, count)) = result {
             // If we have files with spaces, suggest replacing with underscores
             // But only if there are also files with underscores? Or just as a standardizer.
             
             let mut file_stmt = conn.prepare_cached("SELECT path, name FROM files WHERE parent_path = ?1 AND name LIKE '% %'").ok()?;
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
                    total_size_bytes: None,
                });
             }
        }

        None
    }

    fn check_desktop_declutter(&self) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;
        
        let mut stmt = conn.prepare_cached(
            "SELECT path, name FROM files 
             WHERE parent_path LIKE '%Desktop%' 
             AND is_directory = 0
             LIMIT 50"
        ).ok()?;
        
        let files: Vec<(String, String)> = stmt.query_map([], |row| {
             Ok((row.get(0)?, row.get(1)?))
        }).ok()?.filter_map(Result::ok).collect();
        
        if files.len() > 20 {
             let mut moves = Vec::new();
             for (path, name) in &files {
                 let p = Path::new(path);
                 if let Some(parent) = p.parent() {
                     let new_path = parent.join("Desktop_Cleanup").join(name);
                     moves.push(FileMove {
                         file_path: path.clone(),
                         new_path: new_path.to_string_lossy().to_string(),
                         reason: Some("Desktop is cluttered".to_string()),
                     });
                 }
             }
             
             let plan = SuggestionPlan {
                moves,
                reason: "Desktop has too many loose files.".to_string(),
            };
            
            return Some(Suggestion {
                id: None,
                category: "declutter".to_string(),
                title: "Clean Up Desktop".to_string(),
                description: format!("Found {} files on your Desktop. Moving them to a folder will keep your workspace clean.", files.len()),
                plan_json: serde_json::to_string(&plan).unwrap_or_default(),
                file_count: files.len() as i64,
                confidence: 0.85,
                status: "pending".to_string(),
                created_at: Utc::now().to_rfc3339(),
                resolved_at: None,
                total_size_bytes: None,
            });
        }
        None
    }

    fn check_large_old_folders(&self) -> Option<Suggestion> {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = db::init_db(&db_path).ok()?;
        
        // Find folders > 1GB (relaxed from 10GB for testing) with old content
            let mut stmt = conn
                .prepare_cached(
                     "SELECT parent_path, Count(*) as c, SUM(size_bytes) as total_size, MAX(modified_at) as last_mod 
                      FROM files 
                      GROUP BY parent_path 
                      HAVING total_size > 10000000000 AND last_mod < strftime('%s','now','-6 months')
                      LIMIT 1",
                )
                .ok()?;
        
        let result: Option<(String, i64, i64)> = stmt.query_row([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get::<_, i64>(2)?))
        }).ok();

        if let Some((path, count, size)) = result {
             let mut moves = Vec::new();
             let p = Path::new(&path);
             
             if let Some(parent) = p.parent() {
                 let archive_dir = parent.join("_Archive").join(p.file_name().unwrap());
                 
                 // Get files
                 let mut file_stmt = conn.prepare_cached("SELECT path, name FROM files WHERE parent_path = ?1").ok()?;
                 let files = file_stmt.query_map([&path], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                    .ok()?.filter_map(Result::ok);

                 for (f_path, f_name) in files {
                     moves.push(FileMove {
                         file_path: f_path,
                         new_path: archive_dir.join(f_name).to_string_lossy().to_string(),
                         reason: Some("Large old folder".to_string()),
                     });
                 }

                 let size_gb = size as f64 / 1_000_000_000.0;
                 let plan = SuggestionPlan {
                    moves,
                    reason: format!("Folder '{}' is large ({:.1} GB) and old.", path, size_gb),
                };

                return Some(Suggestion {
                    id: None,
                    category: "archive".to_string(),
                    title: format!("Archive Large Folder: {}", p.file_name().unwrap().to_string_lossy()),
                    description: format!("The folder '{}' takes up {:.1} GB and hasn't been touched in 6 months.", p.file_name().unwrap().to_string_lossy(), size_gb),
                    plan_json: serde_json::to_string(&plan).unwrap_or_default(),
                    file_count: count,
                    confidence: 0.9,
                    status: "pending".to_string(),
                    created_at: Utc::now().to_rfc3339(),
                    resolved_at: None,
                    total_size_bytes: Some(size),
                });
             }
        }
        None
    }

    #[allow(private_interfaces)]
    pub async fn run_ai_analysis(
        &self,
        target_folders: Vec<AiTarget>,
        config: EmbeddingConfig,
    ) -> Result<Vec<Suggestion>, String> {
        let mut suggestions = Vec::new();
        
        for target in target_folders {
            if let Some(suggestion) =
                self.analyze_folder_structure(&target, &config).await
            {
                suggestions.push(suggestion);
            }
        }

        Ok(suggestions)
    }

    async fn analyze_folder_structure(
        &self,
        target: &AiTarget,
        config: &EmbeddingConfig,
    ) -> Option<Suggestion> {
        if target.files.is_empty() {
            return None;
        }

        let file_lines: Vec<String> = target
            .files
            .iter()
            .map(|f| {
                let tags = if f.tags.is_empty() {
                    "tags: none".to_string()
                } else {
                    format!("tags: {}", f.tags.join(", "))
                };
                let modified = f
                    .modified_at
                    .map(|m| format!("modified: {}", m))
                    .unwrap_or_else(|| "modified: unknown".to_string());
                format!("- {} ({}, {})", f.path, modified, tags)
            })
            .collect();

        let existing_structure = self.fetch_structure_summary();

        let prompt = format!(
            "Analyze these file groups and suggest organization:\n\n\
            Files: [\n{}\n]\n\n\
            Current state: All in {}\n\
            User's existing structure: {}\n\n\
            Suggest:\n\
            1. What category these files belong to\n\
            2. Where they should be moved\n\
            3. Any naming improvements\n\
            4. Confidence level (0-1)\n\n\
            Return JSON:\n\
            {{\n\
              \"suggestion\": \"Move 23 invoices to Documents/Invoices/2024\",\n\
              \"reasoning\": \"These are all invoices based on content analysis\",\n\
              \"plan\": [\n\
                {{\"file\": \"/path/file.pdf\", \"move_to\": \"/path/Invoices/2024/file.pdf\"}}\n\
              ],\n\
              \"confidence\": 0.85\n\
            }}",
            file_lines.join("\n"),
            target.path,
            existing_structure
        );

        match self.call_llm(config, &prompt).await {
            Ok(response) => {
                let plan = SuggestionPlan {
                    moves: response
                        .plan
                        .iter()
                        .filter_map(|p| {
                            let src = if Path::new(&p.file).is_absolute() {
                                p.file.clone()
                            } else {
                                Path::new(&target.path)
                                    .join(&p.file)
                                    .to_string_lossy()
                                    .to_string()
                            };

                            let dst = if Path::new(&p.move_to).is_absolute() {
                                p.move_to.clone()
                            } else {
                                Path::new(&target.path)
                                    .join(&p.move_to)
                                    .to_string_lossy()
                                    .to_string()
                            };

                            Some(FileMove {
                                file_path: src,
                                new_path: dst,
                                reason: Some(response.reasoning.clone()),
                            })
                        })
                        .collect(),
                    reason: response.reasoning.clone(),
                };

                if plan.moves.is_empty() {
                    return None;
                }

                let is_documents = target.path.to_lowercase().ends_with("documents")
                    || target.path.to_lowercase().contains("\\documents")
                    || target.path.to_lowercase().contains("/documents");
                let title = if is_documents {
                    "Optimize Documents Folder Structure".to_string()
                } else {
                    response.suggestion.clone()
                };
                let description = if is_documents {
                    format!("{}", response.reasoning)
                } else {
                    response.reasoning.clone()
                };

                Some(Suggestion {
                    id: None,
                    category: "sort".to_string(),
                    title,
                    description,
                    plan_json: serde_json::to_string(&plan).unwrap_or_default(),
                    file_count: plan.moves.len() as i64,
                    confidence: response.confidence,
                    status: "pending".to_string(),
                    created_at: Utc::now().to_rfc3339(),
                    resolved_at: None,
                    total_size_bytes: None,
                })
            }
            Err(e) => {
                error!("LLM Call failed: {}", e);
                None
            }
        }
    }

    async fn internal_call_llm(&self, config: &EmbeddingConfig, prompt: &str) -> Result<String, String> {
        let client = reqwest::Client::new();
        
        match config.provider {
            embeddings::AiProvider::Ollama => {
                 let url = format!("{}/api/generate", config.ollama_url);
                 // Fallback to "llama3" if model is embed-specific
                 let model = if config.model.contains("embed") { "llama3" } else { &config.model };
                 
                 let res = client.post(&url)
                    .json(&json!({
                        "model": model,
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
                 // Ollama returns { "response": "{...}" } or just the JSON object?
                 // Usually /api/generate returns { "response": "actual response text", ... }
                 let val: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                 
                 if let Some(inner) = val.get("response").and_then(|v| v.as_str()) {
                     Ok(inner.to_string())
                 } else {
                     // Try to parse the whole body as the response if 'response' field missing?
                     // No, Ollama API structure is consistent.
                     Err(format!("No response field in Ollama output: {}", text))
                 }
            },
            embeddings::AiProvider::OpenAI => {
                 Err("OpenAI Chat implementation pending".to_string())
            }
        }
    }

    async fn call_llm(&self, config: &EmbeddingConfig, prompt: &str) -> Result<LLMResponse, String> {
        let json_str = self.internal_call_llm(config, prompt).await?;
        let clean_json = json_str
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();
        serde_json::from_str(clean_json)
            .map_err(|e| format!("Failed to parse LLMResponse: {}. Content: {}", e, clean_json))
    }

    fn fetch_structure_summary(&self) -> String {
        let app_dir = self.app_handle.path().app_data_dir().unwrap();
        let db_path = app_dir.join("filenova.db");
        let conn = match db::init_db(&db_path) {
            Ok(c) => c,
            Err(_) => return "Unknown".to_string(),
        };

        let mut stmt = match conn.prepare_cached(
            "SELECT parent_path, COUNT(*) as c FROM files GROUP BY parent_path ORDER BY c DESC LIMIT 5",
        ) {
            Ok(s) => s,
            Err(_) => return "Unknown".to_string(),
        };

        let rows_result = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)));

        let rows = match rows_result {
            Ok(r) => r,
            Err(_) => return "Unknown".to_string(),
        };

        let mut parts = Vec::new();
        for row in rows {
            if let Ok((path, count)) = row {
                parts.push(format!("{} ({} files)", path, count));
            }
        }

        if parts.is_empty() {
            "Unknown".to_string()
        } else {
            parts.join("; ")
        }
    }

    pub async fn propose_structure_reorganization(&self, path: &str, config: &EmbeddingConfig) -> Result<SuggestionPlan, String> {
        let p = Path::new(path);
        if !p.exists() || !p.is_dir() {
            return Err("Invalid directory".to_string());
        }

        let mut files = Vec::new();
        let mut extensions: HashMap<String, i64> = HashMap::new();
        let mut subfolders = 0i64;
        // Only analyze direct children to avoid overwhelming context
        let walker = WalkDir::new(p).max_depth(1); 
        for entry in walker.into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    files.push(name.to_string());
                    if let Some(ext) = entry.path().extension() {
                        let ext_str = ext.to_string_lossy().to_lowercase();
                        *extensions.entry(ext_str).or_insert(0) += 1;
                    }
                }
            } else if entry.file_type().is_dir() && entry.path() != p {
                subfolders += 1;
            }
        }
        
        if files.is_empty() {
             return Err("No files to organize".to_string());
        }
        
        // Cap at 50 files for speed and context limits
        let files_subset: Vec<String> = files.iter().take(50).cloned().collect();

                let prompt = format!(
                        "Analyze these {} files from folder '{}':\n{:?}\n\n\
                        Structure summary: {} subfolders, extensions: {:?}.\n\
                        Goal: Propose a reorganization structure (subfolders) to declutter this folder.\n\
                        Context: The user wants to organize files by logical groups (PROJECT, DATE, TYPE, or TOPIC).\n\
                        Return valid JSON with this schema:\n\
                        {{\n  \
                            \"strategy\": \"extension|date|topic|project\",\n  \
                            \"reason\": \"Explanation of the strategy\",\n  \
                            \"moves\": [ {{ \"file\": \"filename.ext\", \"move_to\": \"Subfolder/filename.ext\", \"reason\": \"optional reason\" }} ]\n\
                        }}\n\
                        Cover as many files as possible. Return ONLY JSON.",
                        files_subset.len(),
                        path,
                        files_subset,
                        subfolders,
                        extensions
                );

        let json_str = self.internal_call_llm(config, &prompt).await?;
        
        // Clean markdown code blocks if present
        let clean_json = json_str.trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```");

        #[derive(Deserialize)]
        struct ProposeMoveInternal {
            file: String,
            move_to: String,
            reason: Option<String>
        }
        #[derive(Deserialize)]
        struct ProposalResponse {
            reason: String,
            moves: Vec<ProposeMoveInternal>
        }

        let resp: ProposalResponse = serde_json::from_str(clean_json)
            .map_err(|e| format!("Failed to parse proposal JSON: {}. Content: {}", e, clean_json))?;

        let mut file_moves = Vec::new();
        for m in resp.moves {
            // Validate file exists in original list (simple check)
            if files.contains(&m.file) {
                 file_moves.push(FileMove {
                     file_path: p.join(&m.file).to_string_lossy().to_string(),
                     new_path: p.join(&m.move_to).to_string_lossy().to_string(),
                     reason: m.reason.or(Some(resp.reason.clone())),
                 });
            }
        }

        Ok(SuggestionPlan {
            moves: file_moves,
            reason: resp.reason,
        })
    }

    pub async fn detect_pattern_with_context(
        &self,
        files: &[RenameFileContext],
        location: &str,
        config: &EmbeddingConfig,
    ) -> Result<RenamePatternSuggestion, String> {
        let file_lines: Vec<String> = files
            .iter()
            .map(|f| {
                let date_part = f
                    .date
                    .as_ref()
                    .map(|d| format!("date: {}", d))
                    .unwrap_or_else(|| "date: unknown".to_string());
                let tags_part = if f.tags.is_empty() {
                    "tags: none".to_string()
                } else {
                    format!("tags: {}", f.tags.join(", "))
                };
                format!("- {} ({}; {})", f.name, date_part, tags_part)
            })
            .collect();

        let prompt = format!(
            "Files to rename:\n{}\n\n\
            Current location: {}\n\n\
            Suggest a consistent, descriptive naming pattern.\n\
            Include: date, event/description, sequence number.\n\
            Use only these tokens: {{YYYY}}, {{MM}}, {{DD}}, {{filename}}, {{tag}}, {{counter}}, {{ext}}.\n\n\
            Return JSON ONLY with this schema:\n\
            {{\n  \"pattern\": \"{{YYYY}}-{{MM}}-{{DD}}_{{tag}}_{{counter}}\",\n  \"examples\": [\n    {{\"old\": \"oldname.jpg\", \"new\": \"2024-03-15_beach_01.jpg\"}}\n  ]\n}}",
            file_lines.join("\n"),
            location
        );

        let json_str = self.internal_call_llm(config, &prompt).await?;
        let clean_json = json_str
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        serde_json::from_str(clean_json)
            .map_err(|e| format!("Failed to parse rename pattern JSON: {}. Content: {}", e, clean_json))
    }

    #[allow(dead_code)]
    pub async fn detect_pattern(&self, files: &[String], config: &EmbeddingConfig) -> Result<String, String> {
        let contexts: Vec<RenameFileContext> = files
            .iter()
            .map(|name| RenameFileContext {
                name: name.clone(),
                date: None,
                tags: Vec::new(),
            })
            .collect();

        let suggestion = self.detect_pattern_with_context(&contexts, "Unknown", config).await?;
        Ok(suggestion.pattern)
    }
}

#[derive(Deserialize)]
struct LLMPlanItem {
    file: String,
    move_to: String,
}

#[derive(Deserialize)]
struct LLMResponse {
    suggestion: String,
    reasoning: String,
    plan: Vec<LLMPlanItem>,
    confidence: f32,
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
        let mut ai_targets: Vec<AiTarget> = Vec::new();
        
        // 1. Identify "Messy Checkpoint"
        let mut stmt = conn.prepare_cached(
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
        
        // Ensure Documents folder is considered for optimizer suggestions
        if let Ok(mut doc_stmt) = conn.prepare_cached(
            "SELECT parent_path, COUNT(*) as c FROM files WHERE parent_path LIKE '%Documents' GROUP BY parent_path ORDER BY c DESC LIMIT 1",
        ) {
            if let Ok(doc_row) = doc_stmt.query_row([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))) {
                if !folder_candidates.iter().any(|(p, _)| p == &doc_row.0) {
                    folder_candidates.push(doc_row);
                }
            }
        }

        for (path, count) in folder_candidates {
            if path.contains("202") {
                continue;
            }

            let mut file_stmt = conn
                .prepare_cached(
                    "SELECT f.path, f.name, f.modified_at, GROUP_CONCAT(t.tag)
                     FROM files f
                     LEFT JOIN tags t ON t.file_id = f.id
                     WHERE f.parent_path = ?1 AND f.is_directory = 0
                     GROUP BY f.id
                     LIMIT 50",
                )
                .map_err(|e| e.to_string())?;

            let files: Vec<AiFileInfo> = file_stmt
                .query_map([&path], |row| {
                    let raw_tags: Option<String> = row.get(3)?;
                    Ok(AiFileInfo {
                        path: row.get(0)?,
                        name: row.get(1)?,
                        modified_at: row.get(2).ok(),
                        tags: SuggestionEngine::extract_tags(raw_tags),
                    })
                })
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();

            if !files.is_empty() {
                ai_targets.push(AiTarget {
                    path,
                    count,
                    files,
                });
            }
        }
        
        let config = EmbeddingConfig::from_settings(&conn);
        
        (heuristics, ai_targets, config)
    }; // conn dropped here

    // Phase 2: Async AI Analysis
    // Now we are safe to await
    match engine.run_ai_analysis(ai_targets, config).await {
         Ok(mut ai_res) => suggestions.append(&mut ai_res),
         Err(e) => warn!("AI Analysis warning: {}", e),
    }

    // Phase 3: Save results (Sync/Blocking)
    save_suggestions(&app, suggestions.clone());

    Ok(suggestions)
}

#[tauri::command]
pub fn get_pending_suggestions(app: AppHandle) -> Result<Vec<Suggestion>, String> {
    let app_dir = app.path().app_data_dir().unwrap();
    let db_path = app_dir.join("filenova.db");
    let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT id, category, title, description, plan_json, file_count, confidence, status, created_at, resolved_at 
             FROM suggestions 
             WHERE status = 'pending' 
             ORDER BY confidence DESC 
             LIMIT 5",
        )
        .map_err(|e| e.to_string())?;

    let suggestion_iter = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, f32>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut suggestions = Vec::new();
    for s in suggestion_iter {
        let (id, category, title, description, plan_json, file_count, confidence, status, created_at, resolved_at) =
            s.map_err(|e| e.to_string())?;

        let total_size_bytes = match serde_json::from_str::<SuggestionPlan>(&plan_json) {
            Ok(plan) => {
                let mut total: i64 = 0;
                for mv in plan.moves {
                    let size: i64 = conn
                        .query_row(
                            "SELECT size_bytes FROM files WHERE path = ?1",
                            [&mv.file_path],
                            |r| r.get(0),
                        )
                        .unwrap_or(0);
                    total += size;
                }
                Some(total)
            }
            Err(_) => None,
        };

        suggestions.push(Suggestion {
            id: Some(id),
            category,
            title,
            description,
            plan_json,
            file_count,
            confidence,
            status,
            created_at,
            resolved_at,
            total_size_bytes,
        });
    }

    Ok(suggestions)
}

#[tauri::command]
pub async fn accept_suggestion(app: AppHandle, id: i64) -> Result<String, String> {
     let app_dir = app.path().app_data_dir().unwrap();
    let db_path = app_dir.join("filenova.db");
    let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

    // 1. Fetch plan
    let mut stmt = conn.prepare_cached("SELECT plan_json FROM suggestions WHERE id = ?1").map_err(|e| e.to_string())?;
    let plan_json: String = stmt.query_row([id], |row| row.get(0)).map_err(|e| e.to_string())?;
    
    let plan: SuggestionPlan = serde_json::from_str(&plan_json).map_err(|e| e.to_string())?;

    // 2. Validate conflicts
    let conflicts: Vec<String> = plan
        .moves
        .iter()
        .filter(|mv| {
            let dst = Path::new(&mv.new_path);
            let src = Path::new(&mv.file_path);
            dst.exists() && dst != src
        })
        .map(|mv| mv.new_path.clone())
        .collect();

    if !conflicts.is_empty() {
        let sample = conflicts.iter().take(5).cloned().collect::<Vec<_>>().join("; ");
        return Err(format!(
            "Naming conflicts detected for {} destinations. Example: {}",
            conflicts.len(),
            sample
        ));
    }

    // 3. Execute moves via execution module
    let batch_id = uuid::Uuid::new_v4().to_string();
    execution::execute_moves_with_operation(Some(&app), &conn, plan.moves.clone(), &batch_id, "move")?;


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
            info!("Starting daily suggestion analysis...");
            let engine = SuggestionEngine::new(app.clone());
            
            // Phase 1: Heuristics & Data Collection (Sync)
            let (heuristics, ai_targets, config) = {
                let app_dir = app.path().app_data_dir().unwrap();
                let db_path = app_dir.join("filenova.db");
                
                if let Ok(conn) = db::init_db(&db_path) {
                    let h = engine.run_heuristics().unwrap_or_default();
                    
                    let mut ai_t: Vec<AiTarget> = Vec::new();
                    // Identify targets
                     if let Ok(mut stmt) = conn.prepare_cached("SELECT parent_path, COUNT(*) as c FROM files GROUP BY parent_path HAVING c > 15 ORDER BY c DESC LIMIT 3") {
                        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))).unwrap();
                        for r in rows {
                            if let Ok((path, count)) = r {
                                if path.contains("202") { continue; }
                                if let Ok(mut f_stmt) = conn.prepare_cached(
                                    "SELECT f.path, f.name, f.modified_at, GROUP_CONCAT(t.tag)
                                     FROM files f
                                     LEFT JOIN tags t ON t.file_id = f.id
                                     WHERE f.parent_path = ?1 AND f.is_directory = 0
                                     GROUP BY f.id
                                     LIMIT 50",
                                ) {
                                    let files: Vec<AiFileInfo> = f_stmt
                                        .query_map([&path], |row| {
                                            let raw_tags: Option<String> = row.get(3)?;
                                            Ok(AiFileInfo {
                                                path: row.get(0)?,
                                                name: row.get(1)?,
                                                modified_at: row.get(2).ok(),
                                                tags: SuggestionEngine::extract_tags(raw_tags),
                                            })
                                        })
                                        .unwrap()
                                        .filter_map(Result::ok)
                                        .collect();

                                    if !files.is_empty() {
                                        ai_t.push(AiTarget { path, count, files });
                                    }
                                }
                            }
                        }
                     }

                     if let Ok(mut doc_stmt) = conn.prepare_cached(
                        "SELECT parent_path, COUNT(*) as c FROM files WHERE parent_path LIKE '%Documents' GROUP BY parent_path ORDER BY c DESC LIMIT 1",
                     ) {
                        if let Ok(doc_row) = doc_stmt.query_row([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))) {
                            if !ai_t.iter().any(|t| t.path == doc_row.0) {
                                if let Ok(mut f_stmt) = conn.prepare_cached(
                                    "SELECT f.path, f.name, f.modified_at, GROUP_CONCAT(t.tag)
                                     FROM files f
                                     LEFT JOIN tags t ON t.file_id = f.id
                                     WHERE f.parent_path = ?1 AND f.is_directory = 0
                                     GROUP BY f.id
                                     LIMIT 50",
                                ) {
                                    let files: Vec<AiFileInfo> = f_stmt
                                        .query_map([&doc_row.0], |row| {
                                            let raw_tags: Option<String> = row.get(3)?;
                                            Ok(AiFileInfo {
                                                path: row.get(0)?,
                                                name: row.get(1)?,
                                                modified_at: row.get(2).ok(),
                                                tags: SuggestionEngine::extract_tags(raw_tags),
                                            })
                                        })
                                        .unwrap()
                                        .filter_map(Result::ok)
                                        .collect();

                                    if !files.is_empty() {
                                        ai_t.push(AiTarget {
                                            path: doc_row.0,
                                            count: doc_row.1,
                                            files,
                                        });
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
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM suggestions WHERE title = ?1 AND category = ?2 AND status = 'pending'",
                    [&s.title, &s.category],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            if count > 0 {
                continue;
            }

            let pending_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM suggestions WHERE status = 'pending'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            if pending_count >= 5 {
                let lowest: Option<(i64, f32)> = conn
                    .query_row(
                        "SELECT id, confidence FROM suggestions WHERE status = 'pending' ORDER BY confidence ASC, created_at ASC LIMIT 1",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .ok();

                if let Some((lowest_id, lowest_conf)) = lowest {
                    if s.confidence <= lowest_conf {
                        continue;
                    }

                    let _ = conn.execute("DELETE FROM suggestions WHERE id = ?1", [lowest_id]);
                }
            }

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
    let mut max_depth_reached = 0;
    let mut dir_stats: HashMap<String, (i64, i64)> = HashMap::new();

    let walker = WalkDir::new(p).max_depth(3);
    
    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        if entry.path() == p { continue; }
        
        max_depth_reached = max_depth_reached.max(entry.depth() as i64);

        if entry.file_type().is_file() {
            file_count += 1;

            if let Some(parent) = entry.path().parent() {
                let key = parent.to_string_lossy().to_string();
                let entry_stats = dir_stats.entry(key).or_insert((0, 0));
                entry_stats.0 += 1;
            }
            
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

            if let Some(parent) = entry.path().parent() {
                let key = parent.to_string_lossy().to_string();
                let entry_stats = dir_stats.entry(key).or_insert((0, 0));
                entry_stats.1 += 1;
            }
        }
    }

    // Heuristic Suggestions
    let mut suggestions = Vec::new();
    if file_count >= 100 && subfolder_count == 0 {
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

    let redundant_nesting = dir_stats
        .values()
        .filter(|(files, subs)| *files == 0 && *subs == 1)
        .count();
    if redundant_nesting > 0 {
        suggestions.push(format!(
            "Detected {} redundant nesting folders (only one subfolder).",
            redundant_nesting
        ));
    }

    Ok(StructureAnalysis {
        path: path.to_string(),
        file_count,
        subfolder_count,
        depth: max_depth_reached, 
        clutter_score: if file_count >= 100 { 0.85 } else { 0.25 },
        suggestions,
        extensions,
        huge_files,
    })
}

// Global state for debounce
use std::sync::Mutex;
use std::time::Instant;

lazy_static::lazy_static! {
    static ref LAST_ANALYSIS_TRIGGER: Mutex<Option<Instant>> = Mutex::new(None);
    static ref FILE_CHANGE_COUNT: Mutex<usize> = Mutex::new(0);
}

pub fn on_file_change(app: AppHandle) {
    let mut count = FILE_CHANGE_COUNT.lock().unwrap();
    *count += 1;

    let mut last_trigger = LAST_ANALYSIS_TRIGGER.lock().unwrap();
    let should_trigger = match *last_trigger {
        Some(last) => {
            // Trigger if > 50 changes OR > 10 minutes since last analysis
            *count > 50 || last.elapsed().as_secs() > 600
        },
        None => *count > 10, // First time: trigger after 10 changes
    };

    if should_trigger {
        info!("Triggering background suggestion analysis due to file changes...");
        *count = 0;
        *last_trigger = Some(Instant::now());
        
        // Spawn analysis
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            // Wait a bit for file operations to settle
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            
            let engine = SuggestionEngine::new(app_clone.clone());
            // Run lightweight heuristics only
            if let Ok(suggestions) = engine.run_heuristics() {
                save_suggestions(&app_clone, suggestions);
            }
        });
    }
}

#[tauri::command]
pub async fn get_structure_proposal(app: AppHandle, path: String) -> Result<SuggestionPlan, String> {
    let engine = SuggestionEngine::new(app.clone());
    let app_dir = app.path().app_data_dir().unwrap();
    let db_path = app_dir.join("filenova.db");
    let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;
    let config = EmbeddingConfig::from_settings(&conn);

    engine.propose_structure_reorganization(&path, &config).await
}

#[tauri::command]
pub async fn apply_structure_plan(app: AppHandle, plan: SuggestionPlan) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().unwrap();
    let db_path = app_dir.join("filenova.db");
    let conn = db::init_db(&db_path).map_err(|e| e.to_string())?;

    let conflicts: Vec<String> = plan
        .moves
        .iter()
        .filter(|mv| {
            let dst = Path::new(&mv.new_path);
            let src = Path::new(&mv.file_path);
            dst.exists() && dst != src
        })
        .map(|mv| mv.new_path.clone())
        .collect();

    if !conflicts.is_empty() {
        let sample = conflicts.iter().take(5).cloned().collect::<Vec<_>>().join("; ");
        return Err(format!(
            "Naming conflicts detected for {} destinations. Example: {}",
            conflicts.len(),
            sample
        ));
    }

    let batch_id = uuid::Uuid::new_v4().to_string();
    
    crate::execution::execute_moves_with_operation(Some(&app), &conn, plan.moves, &batch_id, "move")?;
    
    Ok(batch_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── common_root ────────────────────────────────────────────────
    #[test]
    fn common_root_empty_list() {
        assert!(SuggestionEngine::common_root(&[]).is_none());
    }

    #[test]
    fn common_root_single_path() {
        let paths = vec!["C:\\Users\\test\\Documents".to_string()];
        let root = SuggestionEngine::common_root(&paths).unwrap();
        assert!(root.to_string_lossy().contains("Users"));
    }

    #[test]
    fn common_root_two_paths_shared_prefix() {
        let paths = vec![
            "C:\\Users\\test\\Documents\\a.txt".to_string(),
            "C:\\Users\\test\\Documents\\b.txt".to_string(),
        ];
        let root = SuggestionEngine::common_root(&paths).unwrap();
        let s = root.to_string_lossy().replace('\\', "/");
        assert!(s.contains("Documents"), "got: {}", s);
    }

    #[test]
    fn common_root_no_overlap() {
        let paths = vec![
            "C:\\Alpha\\file.txt".to_string(),
            "D:\\Beta\\file.txt".to_string(),
        ];
        // Different drive letters → no common root
        assert!(SuggestionEngine::common_root(&paths).is_none());
    }

    // ── normalize_stem ─────────────────────────────────────────────
    #[test]
    fn normalize_stem_basic() {
        assert_eq!(SuggestionEngine::normalize_stem("Report_2024.pdf"), "report");
    }

    #[test]
    fn normalize_stem_digits_stripped() {
        assert_eq!(SuggestionEngine::normalize_stem("IMG_0001.jpg"), "img");
    }

    #[test]
    fn normalize_stem_all_digits() {
        assert_eq!(SuggestionEngine::normalize_stem("12345.txt"), "");
    }

    #[test]
    fn normalize_stem_mixed_case() {
        assert_eq!(SuggestionEngine::normalize_stem("MyDocument.DOCX"), "mydocument");
    }

    // ── extract_tags ───────────────────────────────────────────────
    #[test]
    fn extract_tags_none() {
        let tags = SuggestionEngine::extract_tags(None);
        assert!(tags.is_empty());
    }

    #[test]
    fn extract_tags_empty_string() {
        let tags = SuggestionEngine::extract_tags(Some("".to_string()));
        assert!(tags.is_empty());
    }

    #[test]
    fn extract_tags_comma_separated() {
        let tags = SuggestionEngine::extract_tags(Some("work, finance, 2024".to_string()));
        assert_eq!(tags, vec!["work", "finance", "2024"]);
    }

    #[test]
    fn extract_tags_trims_whitespace() {
        let tags = SuggestionEngine::extract_tags(Some("  a ,  b  , c ".to_string()));
        assert_eq!(tags, vec!["a", "b", "c"]);
    }

    #[test]
    fn extract_tags_filters_empty_segments() {
        let tags = SuggestionEngine::extract_tags(Some(",,,a,,b,,,".to_string()));
        assert_eq!(tags, vec!["a", "b"]);
    }
}