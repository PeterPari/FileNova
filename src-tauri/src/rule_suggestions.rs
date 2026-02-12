use crate::rules_engine::{Action, Condition};
use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tauri::AppHandle;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SuggestedRuleConfig {
    pub name: String,
    pub condition: Condition,
    pub actions: Vec<Action>,
    pub enabled: bool,
    pub trigger: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SuggestedRule {
    pub description: String,
    pub rule_config: SuggestedRuleConfig,
    pub confidence: f32,
    pub based_on_count: i64,
    pub signature: String,
}

#[tauri::command]
pub fn get_rule_suggestions(app: AppHandle) -> Result<Vec<SuggestedRule>, String> {
    let conn = crate::db::get_conn(&app)?;

    let mut suggestions = Vec::new();

    suggestions.extend(detect_move_patterns(&conn).map_err(|e| e.to_string())?);
    suggestions.extend(detect_rename_patterns(&conn).map_err(|e| e.to_string())?);
    suggestions.extend(detect_trash_patterns(&conn).map_err(|e| e.to_string())?);

    suggestions.sort_by(|a, b| b.based_on_count.cmp(&a.based_on_count));
    Ok(suggestions)
}

/// Alias for get_rule_suggestions — registered under the spec name
#[tauri::command]
pub fn suggest_rules_from_behavior(app: AppHandle) -> Result<Vec<SuggestedRule>, String> {
    get_rule_suggestions(app)
}

#[tauri::command]
pub fn record_rule_suggestion_feedback(
    app: AppHandle,
    signature: String,
    status: String,
) -> Result<(), String> {
    let conn = crate::db::get_conn(&app)?;

    conn.execute(
        "INSERT INTO rule_suggestion_feedback (signature, status, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(signature) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at",
        [&signature, &status],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Accept a rule suggestion: record feedback as "accepted" and create the rule in a single call.
/// Returns the new rule's ID.
#[tauri::command]
pub fn accept_rule_suggestion(app: AppHandle, suggestion: SuggestedRule) -> Result<i64, String> {
    let conn = crate::db::get_conn(&app)?;

    // 1. Record feedback as accepted
    conn.execute(
        "INSERT INTO rule_suggestion_feedback (signature, status, updated_at)
         VALUES (?1, 'accepted', datetime('now'))
         ON CONFLICT(signature) DO UPDATE SET status = 'accepted', updated_at = datetime('now')",
        [&suggestion.signature],
    ).map_err(|e| e.to_string())?;

    // 2. Convert SuggestedRuleConfig into a new rule
    let cfg = &suggestion.rule_config;
    let condition_json = serde_json::to_string(&cfg.condition).map_err(|e| e.to_string())?;
    let actions_json = serde_json::to_string(&cfg.actions).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO rules (name, condition_json, action_json, enabled, trigger, schedule_cron, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, datetime('now'))",
        params![cfg.name, condition_json, actions_json, cfg.enabled, cfg.trigger],
    ).map_err(|e| e.to_string())?;

    let rule_id = conn.last_insert_rowid();
    Ok(rule_id)
}

fn is_suggestion_allowed(conn: &Connection, signature: &str) -> bool {
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM rule_suggestion_feedback WHERE signature = ?1",
            [signature],
            |row| row.get(0),
        )
        .ok();

    match status.as_deref() {
        Some("rejected") => false,
        _ => true,
    }
}

fn detect_move_patterns(conn: &Connection) -> Result<Vec<SuggestedRule>> {
    // Analyze recent moves to detect patterns
    // We look for: Files with same extension moved to same parent folder
    let mut stmt = conn.prepare_cached(
        "SELECT source_path, dest_path FROM operations 
         WHERE operation = 'move' AND undone = 0
         ORDER BY performed_at DESC
         LIMIT 1000",
    )?;

    // (Extension, DestParent) -> Count
    let mut patterns: HashMap<(String, String), i64> = HashMap::new();

    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in rows {
        if let Ok((src, dst)) = row {
            let src_path = Path::new(&src);
            let dst_path = Path::new(&dst);

            if let (Some(ext), Some(parent)) = (src_path.extension(), dst_path.parent()) {
                let ext_str = ext.to_string_lossy().to_string().to_lowercase();
                let parent_str = parent.to_string_lossy().to_string();

                // Ignore if src parent is same as dest parent (rename in place)
                if let Some(src_parent) = src_path.parent() {
                    if src_parent == parent {
                        continue;
                    }
                }

                *patterns.entry((ext_str, parent_str)).or_insert(0) += 1;
            }
        }
    }

    let mut suggestions = Vec::new();

    // Threshold: 3 occurrences
    for ((ext, dest_folder), count) in patterns {
        if count >= 3 {
            let rule_name = format!("Auto-move .{} files", ext);
            let description = format!("You moved {} .{} files to {}", count, ext, dest_folder);
            let signature = format!("move:{}:{}", ext, dest_folder);

            if !is_suggestion_allowed(conn, &signature) {
                continue;
            }

            let condition = Condition::ExtensionEquals(ext.clone());

            let action = Action::Move {
                destination: dest_folder.clone(),
            };

            let config = SuggestedRuleConfig {
                name: rule_name,
                condition,
                actions: vec![action],
                enabled: true,
                trigger: "manual".to_string(),
            };

            suggestions.push(SuggestedRule {
                description,
                rule_config: config,
                confidence: 0.8, // Simple heuristic
                based_on_count: count,
                signature,
            });
        }
    }

    // Sort by count desc
    suggestions.sort_by(|a, b| b.based_on_count.cmp(&a.based_on_count));

    Ok(suggestions)
}

fn detect_rename_patterns(conn: &Connection) -> Result<Vec<SuggestedRule>> {
    let mut stmt = conn.prepare_cached(
        "SELECT source_path, dest_path, metadata_json FROM operations
         WHERE operation = 'rename' AND undone = 0
         ORDER BY performed_at DESC
         LIMIT 1000",
    )?;

    let mut pattern_counts: HashMap<(String, String, String), i64> = HashMap::new();

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let date_re = regex::Regex::new(r"^(\d{4})-(\d{2})-(\d{2})[_-]").unwrap();
    let seq_re = regex::Regex::new(r"_(\d{2,4})(\.[^.]+)?$").unwrap();

    for row in rows {
        if let Ok((src, dst, meta_json)) = row {
            let src_path = Path::new(&src);
            let dst_path = Path::new(&dst);
            let ext = dst_path
                .extension()
                .map(|e| e.to_string_lossy().to_string().to_lowercase())
                .unwrap_or_default();
            let parent = dst_path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            let new_name = serde_json::from_str::<serde_json::Value>(&meta_json)
                .ok()
                .and_then(|v| v.get("new_name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                .or_else(|| dst_path.file_name().map(|n| n.to_string_lossy().to_string()))
                .unwrap_or_default();

            if !date_re.is_match(&new_name) {
                continue;
            }

            let pattern = if seq_re.is_match(&new_name) {
                "{YYYY}-{MM}-{DD}_{filename}_{counter}".to_string()
            } else {
                "{YYYY}-{MM}-{DD}_{filename}".to_string()
            };

            let key = (parent.clone(), ext.clone(), pattern);
            if src_path != dst_path {
                *pattern_counts.entry(key).or_insert(0) += 1;
            }
        }
    }

    let mut suggestions = Vec::new();

    for ((parent, ext, pattern), count) in pattern_counts {
        if count < 3 {
            continue;
        }

        let signature = format!("rename:{}:{}:{}", parent, ext, pattern);
        if !is_suggestion_allowed(conn, &signature) {
            continue;
        }

        let description = if parent.is_empty() {
            format!("You renamed {} .{} files using a date pattern", count, ext)
        } else {
            format!("You renamed {} .{} files in {} using a date pattern", count, ext, parent)
        };

        let condition = if parent.is_empty() {
            Condition::ExtensionEquals(ext.clone())
        } else {
            Condition::And(vec![
                Condition::PathContains(parent.clone()),
                Condition::ExtensionEquals(ext.clone()),
            ])
        };

        let action = Action::Rename { pattern };

        let config = SuggestedRuleConfig {
            name: format!("Auto-rename .{} files", ext),
            condition,
            actions: vec![action],
            enabled: true,
            trigger: "manual".to_string(),
        };

        suggestions.push(SuggestedRule {
            description,
            rule_config: config,
            confidence: 0.75,
            based_on_count: count,
            signature,
        });
    }

    Ok(suggestions)
}

fn detect_trash_patterns(conn: &Connection) -> Result<Vec<SuggestedRule>> {
    let mut stmt = conn.prepare_cached(
        "SELECT source_path FROM operations
         WHERE operation = 'move_to_trash' AND undone = 0
         ORDER BY performed_at DESC
         LIMIT 1000",
    )?;

    let mut temp_count = 0;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;

    for row in rows {
        if let Ok(path) = row {
            if path.to_lowercase().contains("\\temp") || path.to_lowercase().contains("/temp") {
                temp_count += 1;
            }
        }
    }

    let mut suggestions = Vec::new();

    if temp_count >= 3 {
        let signature = "trash:temp".to_string();
        if is_suggestion_allowed(conn, &signature) {
            let condition = Condition::PathContains("Temp".to_string());
            let action = Action::Trash;

            let config = SuggestedRuleConfig {
                name: "Auto-trash Temp files".to_string(),
                condition,
                actions: vec![action],
                enabled: true,
                trigger: "manual".to_string(),
            };

            suggestions.push(SuggestedRule {
                description: format!("You trashed {} files from Temp folders", temp_count),
                rule_config: config,
                confidence: 0.7,
                based_on_count: temp_count,
                signature,
            });
        }
    }

    Ok(suggestions)
}