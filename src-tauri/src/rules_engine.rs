use crate::batch_rename;
use crate::execution;
use crate::long_path::safe_path;
use crate::trash;
use rusqlite::{params, Connection, OptionalExtension, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio_cron_scheduler::{Job, JobScheduler};
use zip::write::FileOptions;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Rule {
    pub id: i64,
    pub name: String,
    pub condition_json: String,
    pub action_json: String,
    pub enabled: bool,
    pub trigger: String,
    pub schedule_cron: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", content = "value")]
pub enum Condition {
    And(Vec<Condition>),
    Or(Vec<Condition>),
    Not(Box<Condition>),
    NameMatches(String),
    ExtensionEquals(String),
    SizeGreaterThan(u64),
    SizeLessThan(u64),
    SizeEquals(u64),
    ModifiedBefore(i64),
    ModifiedAfter(i64),
    PathContains(String),
    HasTag(String),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", content = "value")]
pub enum Action {
    Move { destination: String },
    Copy { destination: String },
    Rename { pattern: String },
    Archive { destination: String },
    Delete,
    Trash,
    AddTag { tag: String },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RuleResult {
    pub rule_id: i64,
    pub files_matched: usize,
    pub files_processed: usize,
    pub errors: Vec<String>,
    pub batch_id: Option<String>,
    pub requires_resolution: bool,
    pub conflicts: Vec<RuleConflict>,
    pub planned_actions: Vec<RulePlanExecution>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RuleConflict {
    pub source_path: String,
    pub dest_path: String,
    pub action: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RulePlanExecution {
    pub action: String,
    pub source_path: String,
    pub dest_path: Option<String>,
    pub overwrite: bool,
    pub skip: bool,
    pub tag: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RuleConflictBatch {
    pub rule_id: i64,
    pub batch_id: String,
    pub conflicts: Vec<RuleConflict>,
    pub planned_actions: Vec<RulePlanExecution>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RuleConfig {
    pub name: String,
    pub condition_json: String,
    pub action_json: String,
    pub enabled: bool,
    pub trigger: String,
    pub schedule_cron: Option<String>,
}

pub struct RuleSchedulerState {
    pub scheduler: JobScheduler,
    pub job_map: Mutex<HashMap<i64, uuid::Uuid>>,
}

pub async fn init_rule_scheduler(app: AppHandle) -> Result<RuleSchedulerState, String> {
    let scheduler = JobScheduler::new().await.map_err(|e| e.to_string())?;
    scheduler.start().await.map_err(|e| e.to_string())?;

    let state = RuleSchedulerState {
        scheduler,
        job_map: Mutex::new(HashMap::new()),
    };

    refresh_rule_scheduler_internal(app, &state).await?;

    Ok(state)
}

pub async fn refresh_rule_scheduler(app: AppHandle) -> Result<(), String> {
    let state = app.state::<RuleSchedulerState>();
    // We need a reference to state that outlives the app move, so use a raw pointer approach
    // Instead, pass a cloned AppHandle for internal use and keep the borrow alive
    let app_clone = app.clone();
    refresh_rule_scheduler_internal(app_clone, &state).await
}

async fn refresh_rule_scheduler_internal(
    app: AppHandle,
    state: &RuleSchedulerState,
) -> Result<(), String> {
    // Do all DB work upfront (non-async, non-Send) before any .await
    let rules = {
        let conn = crate::db::get_conn(&app)?;

        let mut stmt = conn
            .prepare_cached(
                "SELECT id, schedule_cron FROM rules WHERE enabled = 1 AND trigger = 'schedule' AND schedule_cron IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;

        let mut rules = Vec::new();
        for row in rows {
            if let Ok(item) = row {
                rules.push(item);
            }
        }
        rules
    }; // conn is dropped here before any .await

    let existing_job_ids: Vec<uuid::Uuid> = {
        let map = state.job_map.lock().unwrap();
        map.values().cloned().collect()
    };

    for job_id in existing_job_ids {
        let _ = state.scheduler.remove(&job_id).await;
    }

    {
        let mut map = state.job_map.lock().unwrap();
        map.clear();
    }

    for (rule_id, cron) in rules {
        let app_clone = app.clone();
        let job = Job::new_async(cron.as_str(), move |_uuid, _l| {
            let app_inner = app_clone.clone();
            Box::pin(async move {
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = run_rule(app_inner, rule_id, false);
                });
            })
        })
        .map_err(|e| e.to_string())?;

        let job_id = state.scheduler.add(job).await.map_err(|e| e.to_string())?;
        let mut map = state.job_map.lock().unwrap();
        map.insert(rule_id, job_id);
    }

    Ok(())
}

pub fn trigger_scheduler_refresh(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let _ = refresh_rule_scheduler(app).await;
    });
}

#[tauri::command]
pub fn get_rules(app: AppHandle) -> Result<Vec<Rule>, String> {
    let conn = crate::db::get_conn(&app)?;

    let mut stmt = conn
        .prepare_cached("SELECT id, name, condition_json, action_json, enabled, trigger, schedule_cron FROM rules ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rules = stmt
        .query_map([], |row| {
            Ok(Rule {
                id: row.get(0)?,
                name: row.get(1)?,
                condition_json: row.get(2)?,
                action_json: row.get(3)?,
                enabled: row.get(4)?,
                trigger: row.get(5)?,
                schedule_cron: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rules)
}

#[tauri::command]
pub fn save_rule(app: AppHandle, rule: Rule) -> Result<(), String> {
    let conn = crate::db::get_conn(&app)?;

    if rule.id > 0 {
        conn.execute(
            "UPDATE rules SET name = ?1, condition_json = ?2, action_json = ?3, enabled = ?4, trigger = ?5, schedule_cron = ?6 WHERE id = ?7",
            params![rule.name, rule.condition_json, rule.action_json, rule.enabled, rule.trigger, rule.schedule_cron, rule.id],
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO rules (name, condition_json, action_json, enabled, trigger, schedule_cron, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
            params![rule.name, rule.condition_json, rule.action_json, rule.enabled, rule.trigger, rule.schedule_cron],
        ).map_err(|e| e.to_string())?;
    }

    trigger_scheduler_refresh(app);
    Ok(())
}

#[tauri::command]
pub fn create_rule(app: AppHandle, rule: RuleConfig) -> Result<i64, String> {
    let conn = crate::db::get_conn(&app)?;

    conn.execute(
        "INSERT INTO rules (name, condition_json, action_json, enabled, trigger, schedule_cron, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
        params![
            rule.name,
            rule.condition_json,
            rule.action_json,
            rule.enabled,
            rule.trigger,
            rule.schedule_cron
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    trigger_scheduler_refresh(app);
    Ok(id)
}

#[tauri::command]
pub fn update_rule(app: AppHandle, id: i64, rule: RuleConfig) -> Result<(), String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE rules SET name = ?1, condition_json = ?2, action_json = ?3, enabled = ?4, trigger = ?5, schedule_cron = ?6 WHERE id = ?7",
        params![
            rule.name,
            rule.condition_json,
            rule.action_json,
            rule.enabled,
            rule.trigger,
            rule.schedule_cron,
            id
        ],
    )
    .map_err(|e| e.to_string())?;

    trigger_scheduler_refresh(app);
    Ok(())
}

#[tauri::command]
pub fn delete_rule(app: AppHandle, rule_id: i64) -> Result<(), String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM rules WHERE id = ?1", [rule_id])
        .map_err(|e| e.to_string())?;

    trigger_scheduler_refresh(app);
    Ok(())
}

#[derive(Debug, Clone, Copy)]
enum TextMatchMode {
    Contains,
    Equals,
    Regex,
    Wildcard,
}

fn parse_text_matcher(pattern: &str) -> (TextMatchMode, String) {
    let raw = pattern.trim();
    let lower = raw.to_lowercase();

    if let Some(stripped) = lower.strip_prefix("regex:") {
        let value = raw[raw.len() - stripped.len()..].trim().to_string();
        return (TextMatchMode::Regex, value);
    }
    if let Some(stripped) = lower.strip_prefix("equals:") {
        let value = raw[raw.len() - stripped.len()..].trim().to_string();
        return (TextMatchMode::Equals, value);
    }
    if let Some(stripped) = lower.strip_prefix("contains:") {
        let value = raw[raw.len() - stripped.len()..].trim().to_string();
        return (TextMatchMode::Contains, value);
    }
    if let Some(stripped) = lower.strip_prefix("wildcard:") {
        let value = raw[raw.len() - stripped.len()..].trim().to_string();
        return (TextMatchMode::Wildcard, value);
    }

    if raw.contains('*') {
        return (TextMatchMode::Wildcard, raw.to_string());
    }

    (TextMatchMode::Contains, raw.to_string())
}

fn matches_text(value: &str, mode: TextMatchMode, pattern: &str) -> bool {
    if pattern.is_empty() {
        return false;
    }

    match mode {
        TextMatchMode::Contains => value.to_lowercase().contains(&pattern.to_lowercase()),
        TextMatchMode::Equals => value.eq_ignore_ascii_case(pattern),
        TextMatchMode::Regex => Regex::new(pattern)
            .map(|re| re.is_match(value))
            .unwrap_or(false),
        TextMatchMode::Wildcard => {
            let value_lower = value.to_lowercase();
            let pattern_lower = pattern.to_lowercase();
            if pattern_lower.starts_with('*') && pattern_lower.ends_with('*') {
                value_lower.contains(&pattern_lower[1..pattern_lower.len() - 1])
            } else if pattern_lower.starts_with('*') {
                value_lower.ends_with(&pattern_lower[1..])
            } else if pattern_lower.ends_with('*') {
                value_lower.starts_with(&pattern_lower[..pattern_lower.len() - 1])
            } else {
                value_lower == pattern_lower
            }
        }
    }
}

fn evaluate_condition(
    condition: &Condition,
    file_path: &Path,
    metadata: &std::fs::Metadata,
    conn: &Connection,
    file_id: i64,
) -> bool {
    match condition {
        Condition::And(conds) => conds
            .iter()
            .all(|c| evaluate_condition(c, file_path, metadata, conn, file_id)),
        Condition::Or(conds) => conds
            .iter()
            .any(|c| evaluate_condition(c, file_path, metadata, conn, file_id)),
        Condition::Not(cond) => !evaluate_condition(cond, file_path, metadata, conn, file_id),
        Condition::NameMatches(pattern) => {
            if let Some(name) = file_path.file_name().and_then(|n| n.to_str()) {
                let (mode, value) = parse_text_matcher(pattern);
                matches_text(name, mode, &value)
            } else {
                false
            }
        }
        Condition::ExtensionEquals(ext) => {
            if let Some(e) = file_path.extension().and_then(|s| s.to_str()) {
                e.eq_ignore_ascii_case(ext)
            } else {
                false
            }
        }
        Condition::SizeGreaterThan(size) => metadata.len() > *size,
        Condition::SizeLessThan(size) => metadata.len() < *size,
        Condition::SizeEquals(size) => metadata.len() == *size,
        Condition::ModifiedBefore(ts) => {
            if let Ok(m) = metadata.modified() {
                m.duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs() < *ts as u64)
                    .unwrap_or(false)
            } else {
                false
            }
        }
        Condition::ModifiedAfter(ts) => {
            if let Ok(m) = metadata.modified() {
                m.duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs() > *ts as u64)
                    .unwrap_or(false)
            } else {
                false
            }
        }
        Condition::PathContains(part) => {
            let path_str = file_path.to_string_lossy().to_string();
            let (mode, value) = parse_text_matcher(part);
            matches_text(&path_str, mode, &value)
        }
        Condition::HasTag(tag_name) => {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM tags WHERE file_id = ?1 AND tag = ?2",
                    params![file_id, tag_name],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            count > 0
        }
    }
}

fn parse_datetime_to_timestamp(value: &str) -> Option<i64> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(value) {
        return Some(dt.timestamp());
    }

    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S") {
        return Some(dt.and_utc().timestamp());
    }

    None
}

fn fetch_tags_for_file(conn: &Connection, file_id: i64) -> Vec<String> {
    let mut stmt = match conn.prepare_cached("SELECT tag FROM tags WHERE file_id = ?1") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    stmt.query_map([file_id], |row| row.get::<_, String>(0))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

fn archive_file(src_path: &Path, dest_archive: &Path) -> Result<(), String> {
    let file = File::create(safe_path(dest_archive)).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);

    let options = FileOptions::<'_, ()>::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let file_name = src_path.file_name().unwrap_or_default().to_string_lossy();
    zip.start_file(file_name, options)
        .map_err(|e| e.to_string())?;

    let mut f = File::open(safe_path(src_path)).map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    f.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
    zip.write_all(&buffer).map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| e.to_string())?;

    std::fs::remove_file(safe_path(src_path)).map_err(|e| e.to_string())?;

    Ok(())
}

fn resolve_path_pattern(
    path_template: &str,
    file: &batch_rename::FileMetadata,
    _conn: &Connection,
    counter: usize,
) -> String {
    batch_rename::apply_rename_pattern_single(
        &file.name,
        &file.extension.clone().unwrap_or_default(),
        file.exif_date.or(file.created_at),
        &file.tags,
        path_template,
        counter,
    )
}

fn build_rule_plan(
    _rule_id: i64,
    files: &[batch_rename::FileMetadata],
    actions: &[Action],
    conn: &Connection,
) -> Vec<RulePlanExecution> {
    let mut plan = Vec::new();
    let mut counter = 1;

    for file in files {
        let path = Path::new(&file.path);
        if !path.exists() {
            continue;
        }

        for action in actions {
            match action {
                Action::Move { destination } => {
                    let resolved_dest_dir = resolve_path_pattern(destination, file, conn, counter);
                    if destination.contains("{counter}") || destination.contains("{seq}") {
                        counter += 1;
                    }

                    let dest_path = Path::new(&resolved_dest_dir).join(&file.name);
                    plan.push(RulePlanExecution {
                        action: "move".to_string(),
                        source_path: file.path.clone(),
                        dest_path: Some(dest_path.to_string_lossy().to_string()),
                        overwrite: false,
                        skip: false,
                        tag: None,
                    });
                }
                Action::Copy { destination } => {
                    let resolved_dest_dir = resolve_path_pattern(destination, file, conn, counter);
                    if destination.contains("{counter}") || destination.contains("{seq}") {
                        counter += 1;
                    }

                    let dest_path = Path::new(&resolved_dest_dir).join(&file.name);
                    plan.push(RulePlanExecution {
                        action: "copy".to_string(),
                        source_path: file.path.clone(),
                        dest_path: Some(dest_path.to_string_lossy().to_string()),
                        overwrite: false,
                        skip: false,
                        tag: None,
                    });
                }
                Action::Rename { pattern } => {
                    let new_name = batch_rename::apply_rename_pattern_single(
                        &file.name,
                        &file.extension.clone().unwrap_or_default(),
                        file.exif_date.or(file.created_at),
                        &file.tags,
                        pattern,
                        counter,
                    );
                    counter += 1;

                    let parent = Path::new(&file.path).parent().unwrap_or(Path::new(""));
                    let new_path = parent.join(new_name);

                    plan.push(RulePlanExecution {
                        action: "rename".to_string(),
                        source_path: file.path.clone(),
                        dest_path: Some(new_path.to_string_lossy().to_string()),
                        overwrite: false,
                        skip: false,
                        tag: None,
                    });
                }
                Action::Archive { destination } => {
                    let resolved_dest = resolve_path_pattern(destination, file, conn, counter);
                    if destination.contains("{counter}") || destination.contains("{seq}") {
                        counter += 1;
                    }

                    let dest_path = Path::new(&resolved_dest);
                    let final_zip_path = if dest_path.extension().is_none() {
                        dest_path.join(format!(
                            "{}.zip",
                            Path::new(&file.name).file_stem().unwrap().to_string_lossy()
                        ))
                    } else {
                        dest_path.to_path_buf()
                    };

                    plan.push(RulePlanExecution {
                        action: "archive".to_string(),
                        source_path: file.path.clone(),
                        dest_path: Some(final_zip_path.to_string_lossy().to_string()),
                        overwrite: false,
                        skip: false,
                        tag: None,
                    });
                }
                Action::Trash => {
                    plan.push(RulePlanExecution {
                        action: "trash".to_string(),
                        source_path: file.path.clone(),
                        dest_path: None,
                        overwrite: false,
                        skip: false,
                        tag: None,
                    });
                }
                Action::Delete => {
                    plan.push(RulePlanExecution {
                        action: "delete".to_string(),
                        source_path: file.path.clone(),
                        dest_path: None,
                        overwrite: false,
                        skip: false,
                        tag: None,
                    });
                }
                Action::AddTag { tag } => {
                    plan.push(RulePlanExecution {
                        action: "tag".to_string(),
                        source_path: file.path.clone(),
                        dest_path: None,
                        overwrite: false,
                        skip: false,
                        tag: Some(tag.clone()),
                    });
                }
            }
        }
    }

    plan
}

fn detect_rule_conflicts(plan: &[RulePlanExecution]) -> Vec<RuleConflict> {
    let mut conflicts = Vec::new();

    for item in plan {
        let action = item.action.as_str();
        if !matches!(action, "move" | "rename" | "copy" | "archive") {
            continue;
        }

        let dest_path = match &item.dest_path {
            Some(path) => Path::new(path),
            None => continue,
        };

        let src_path = Path::new(&item.source_path);
        if dest_path.exists() && dest_path != src_path {
            conflicts.push(RuleConflict {
                source_path: item.source_path.clone(),
                dest_path: dest_path.to_string_lossy().to_string(),
                action: item.action.clone(),
                message: "A file already exists at the destination.".to_string(),
            });
        }
    }

    conflicts
}

fn execute_rule_plan_internal(
    app: &AppHandle,
    conn: &Connection,
    rule_id: i64,
    batch_id: &str,
    plan: &[RulePlanExecution],
    files_matched: usize,
) -> Result<RuleResult, String> {
    let mut errors = Vec::new();
    let mut processed_sources: HashSet<String> = HashSet::new();

    for item in plan {
        if item.skip {
            continue;
        }

        match item.action.as_str() {
            "move" | "rename" => {
                let dest_path = match &item.dest_path {
                    Some(p) => p.clone(),
                    None => {
                        errors.push(format!("Missing destination for {}", item.source_path));
                        continue;
                    }
                };

                let dst = Path::new(&dest_path);
                if dst.exists() && dst.to_string_lossy() != item.source_path {
                    if item.overwrite {
                        if let Err(e) = std::fs::remove_file(safe_path(dst)) {
                            errors.push(format!("Failed to overwrite {}: {}", dest_path, e));
                            continue;
                        }
                    } else {
                        errors.push(format!("Conflict: destination exists for {}", dest_path));
                        continue;
                    }
                }

                let move_op = execution::FileMove {
                    file_path: item.source_path.clone(),
                    new_path: dest_path.clone(),
                    reason: Some(format!("rule_{}", rule_id)),
                };

                if let Err(e) = execution::execute_moves_with_operation(
                    Some(app),
                    conn,
                    vec![move_op],
                    batch_id,
                    if item.action == "rename" { "rename" } else { "move" },
                ) {
                    errors.push(format!("Failed to {} {}: {}", item.action, item.source_path, e));
                    continue;
                }

                processed_sources.insert(item.source_path.clone());
            }
            "copy" => {
                let dest_path = match &item.dest_path {
                    Some(p) => p.clone(),
                    None => {
                        errors.push(format!("Missing destination for {}", item.source_path));
                        continue;
                    }
                };

                let dst = Path::new(&dest_path);
                if dst.exists() {
                    if item.overwrite {
                        if let Err(e) = std::fs::remove_file(safe_path(dst)) {
                            errors.push(format!("Failed to overwrite {}: {}", dest_path, e));
                            continue;
                        }
                    } else {
                        errors.push(format!("Conflict: destination exists for {}", dest_path));
                        continue;
                    }
                }

                if let Some(parent) = dst.parent() {
                    if let Err(e) = std::fs::create_dir_all(safe_path(parent)) {
                        errors.push(format!("Failed to create folder for {}: {}", dest_path, e));
                        continue;
                    }
                }

                if let Err(e) = std::fs::copy(safe_path(Path::new(&item.source_path)), safe_path(Path::new(&dest_path))) {
                    errors.push(format!("Failed to copy {}: {}", item.source_path, e));
                    continue;
                }

                processed_sources.insert(item.source_path.clone());
            }
            "archive" => {
                let dest_path = match &item.dest_path {
                    Some(p) => p.clone(),
                    None => {
                        errors.push(format!("Missing archive destination for {}", item.source_path));
                        continue;
                    }
                };

                let dst = Path::new(&dest_path);
                if dst.exists() {
                    if item.overwrite {
                        let _ = std::fs::remove_file(dst);
                    } else {
                        errors.push(format!("Conflict: destination exists for {}", dest_path));
                        continue;
                    }
                }

                if let Some(parent) = dst.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }

                if let Err(e) = archive_file(Path::new(&item.source_path), dst) {
                    errors.push(format!("Failed to archive {}: {}", item.source_path, e));
                    continue;
                }

                let _ = conn.execute("DELETE FROM files WHERE path = ?1", [&item.source_path]);
                processed_sources.insert(item.source_path.clone());
            }
            "trash" => {
                if let Err(e) = trash::move_to_trash(app, conn, &item.source_path, batch_id) {
                    errors.push(format!("Failed to trash {}: {}", item.source_path, e));
                    continue;
                }
                processed_sources.insert(item.source_path.clone());
            }
            "delete" => {
                if let Err(e) = std::fs::remove_file(&item.source_path) {
                    errors.push(format!("Failed to delete {}: {}", item.source_path, e));
                    continue;
                }
                let _ = conn.execute("DELETE FROM files WHERE path = ?1", [&item.source_path]);
                processed_sources.insert(item.source_path.clone());
            }
            "tag" => {
                let tag = item.tag.clone().unwrap_or_default();
                if tag.is_empty() {
                    errors.push(format!("Missing tag for {}", item.source_path));
                    continue;
                }

                let tag_target: Option<i64> = conn
                    .query_row(
                        "SELECT id FROM files WHERE path = ?1",
                        [&item.source_path],
                        |row| row.get(0),
                    )
                    .optional()
                    .unwrap_or(None);

                if let Some(file_id) = tag_target {
                    let normalized_tag = tag.trim().to_lowercase();
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO tags (file_id, tag, source, confidence, created_at) VALUES (?1, ?2, 'rule', 1.0, datetime('now'))",
                        params![file_id, normalized_tag],
                    );
                    processed_sources.insert(item.source_path.clone());
                }
            }
            _ => {}
        }
    }

    let processed_files = processed_sources.len();

    // Log execution (Stage 9)
    let success = errors.is_empty();
    let error_msg = if success { None } else { Some(errors.join("; ")) };
    
    let _ = conn.execute(
        "INSERT INTO rule_executions (rule_id, executed_at, files_affected, success, error_message) VALUES (?1, datetime('now'), ?2, ?3, ?4)",
        params![rule_id, processed_files as i64, success, error_msg],
    );

    Ok(RuleResult {
        rule_id,
        files_matched,
        files_processed: processed_files,
        errors,
        batch_id: Some(batch_id.to_string()),
        requires_resolution: false,
        conflicts: Vec::new(),
        planned_actions: Vec::new(),
    })
}

#[tauri::command]
pub fn run_rule(app: AppHandle, rule_id: i64, dry_run: bool) -> Result<RuleResult, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    // Fetch rule
    let mut stmt = conn
        .prepare_cached("SELECT condition_json, action_json, enabled, trigger, schedule_cron FROM rules WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let (cond_json, act_json, rule_enabled, rule_trigger, schedule_cron): (String, String, bool, String, Option<String>) = stmt
        .query_row([rule_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)))
        .map_err(|e| e.to_string())?;

    let rule = Rule {
        id: rule_id,
        name: "".to_string(),
        condition_json: cond_json.clone(),
        action_json: act_json.clone(),
        enabled: rule_enabled,
        trigger: rule_trigger,
        schedule_cron,
    };

    let condition: Condition =
        serde_json::from_str(&cond_json).map_err(|e| format!("Invalid condition JSON: {}", e))?;
    let actions: Vec<Action> = if act_json.trim().starts_with('[') {
        serde_json::from_str(&act_json).map_err(|e| format!("Invalid actions JSON: {}", e))?
    } else {
        vec![serde_json::from_str(&act_json).map_err(|e| format!("Invalid action JSON: {}", e))?]
    };

    let mut stmt = conn
        .prepare_cached("SELECT id, path, name, extension, created_at FROM files WHERE is_directory = 0")
        .map_err(|e| e.to_string())?;

    let mut files: Vec<batch_rename::FileMetadata> = stmt
        .query_map([], |row| {
            let created_at: Option<String> = row.get(4)?;
            let mut ts = None;
            if let Some(s) = created_at {
                ts = parse_datetime_to_timestamp(&s);
            }

            Ok(batch_rename::FileMetadata {
                id: Some(row.get(0)?),
                path: row.get(1)?,
                name: row.get(2)?,
                extension: row.get(3)?,
                created_at: ts,
                exif_date: None,
                tags: Vec::new(),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for file in &mut files {
        if let Some(file_id) = file.id {
            file.tags = fetch_tags_for_file(&conn, file_id);
        }
    }

    let mut matched_files: Vec<batch_rename::FileMetadata> = Vec::new();

    for file in files {
        let path = Path::new(&file.path);
        if !path.exists() {
            continue;
        }

        if let Ok(metadata) = std::fs::metadata(safe_path(path)) {
            if evaluate_condition(&condition, path, &metadata, &conn, file.id.unwrap()) {
                matched_files.push(file);
            }
        }
    }

    if dry_run {
        return Ok(RuleResult {
            rule_id,
            files_matched: matched_files.len(),
            files_processed: 0,
            errors: Vec::new(),
            batch_id: None,
            requires_resolution: false,
            conflicts: Vec::new(),
            planned_actions: Vec::new(),
        });
    }

    if !rule.enabled {
        return Ok(RuleResult {
            rule_id,
            files_matched: matched_files.len(),
            files_processed: 0,
            errors: Vec::new(),
            batch_id: None,
            requires_resolution: false,
            conflicts: Vec::new(),
            planned_actions: Vec::new(),
        });
    }

    let plan = build_rule_plan(rule_id, &matched_files, &actions, &conn);
    let conflicts = detect_rule_conflicts(&plan);
    let batch_id = format!("rule_{}_exec_{}", rule_id, Uuid::new_v4());

    if !conflicts.is_empty() {
        let _ = app.emit(
            "rule-conflicts",
            RuleConflictBatch {
                rule_id,
                batch_id: batch_id.clone(),
                conflicts: conflicts.clone(),
                planned_actions: plan.clone(),
            },
        );
        return Ok(RuleResult {
            rule_id,
            files_matched: matched_files.len(),
            files_processed: 0,
            errors: Vec::new(),
            batch_id: Some(batch_id),
            requires_resolution: true,
            conflicts,
            planned_actions: plan,
        });
    }

    execute_rule_plan_internal(&app, &conn, rule_id, &batch_id, &plan, matched_files.len())
}

#[tauri::command]
pub fn execute_rule_plan(
    app: AppHandle,
    rule_id: i64,
    batch_id: String,
    actions: Vec<RulePlanExecution>,
) -> Result<RuleResult, String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let mut sources = HashSet::new();
    for action in &actions {
        sources.insert(action.source_path.clone());
    }

    execute_rule_plan_internal(&app, &conn, rule_id, &batch_id, &actions, sources.len())
}

#[tauri::command]
pub fn process_event_rules(app: AppHandle, file_paths: Vec<String>) -> Result<(), String> {
    if file_paths.is_empty() {
        return Ok(());
    }

    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT id, condition_json, action_json FROM rules
             WHERE enabled = 1 AND trigger IN ('event', 'file_change')",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut rules: Vec<(i64, Condition, Vec<Action>)> = Vec::new();

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let rule_id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let cond_json: String = row.get(1).map_err(|e| e.to_string())?;
        let act_json: String = row.get(2).map_err(|e| e.to_string())?;

        let condition: Condition = serde_json::from_str(&cond_json)
            .map_err(|e| format!("Invalid condition JSON: {}", e))?;

        let actions: Vec<Action> = if act_json.trim().starts_with('[') {
            serde_json::from_str(&act_json)
                .map_err(|e| format!("Invalid actions JSON: {}", e))?
        } else {
            vec![serde_json::from_str(&act_json)
                .map_err(|e| format!("Invalid action JSON: {}", e))?]
        };

        rules.push((rule_id, condition, actions));
    }

    if rules.is_empty() {
        return Ok(());
    }

    let batch_id = format!("event_{}", Uuid::new_v4());
    let mut counters: std::collections::HashMap<i64, usize> = std::collections::HashMap::new();

    for path_str in file_paths {
        let path = Path::new(&path_str);
        if !path.exists() {
            continue;
        }

        let metadata = match std::fs::metadata(safe_path(path)) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let row: Option<(i64, String, Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT id, name, extension, created_at FROM files WHERE path = ?1",
                params![path_str],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let (file_id, name, extension, created_at) = if let Some(row) = row {
            (Some(row.0), row.1, row.2, row.3)
        } else {
            (
                None,
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                path.extension().map(|e| e.to_string_lossy().to_string()),
                None,
            )
        };

        let created_at_ts = created_at.as_deref().and_then(parse_datetime_to_timestamp);
        let tags = file_id.map(|id| fetch_tags_for_file(&conn, id)).unwrap_or_default();

        let file_meta = batch_rename::FileMetadata {
            id: file_id,
            name,
            path: path_str.clone(),
            extension,
            created_at: created_at_ts,
            exif_date: None,
            tags,
        };

        for (rule_id, condition, actions) in &rules {
            if !evaluate_condition(condition, path, &metadata, &conn, file_id.unwrap_or(-1)) {
                continue;
            }

            let counter = counters.entry(*rule_id).or_insert(1);
            let mut file_processed = false;

            for action in actions {
                match action {
                    Action::Move { destination } => {
                        let resolved_dest_dir =
                            resolve_path_pattern(destination, &file_meta, &conn, *counter);
                        if destination.contains("{counter}") || destination.contains("{seq}") {
                            *counter += 1;
                        }

                        let dest_path = Path::new(&resolved_dest_dir).join(&file_meta.name);
                        let move_op = execution::FileMove {
                            file_path: file_meta.path.clone(),
                            new_path: dest_path.to_string_lossy().to_string(),
                            reason: Some(format!("rule_{}_event", rule_id)),
                        };

                        if execution::execute_moves_with_operation(
                            Some(&app),
                            &conn,
                            vec![move_op],
                            &batch_id,
                            "move",
                        )
                        .is_ok()
                        {
                            file_processed = true;
                        }
                    }
                    Action::Rename { pattern } => {
                        let new_name = batch_rename::apply_rename_pattern_single(
                            &file_meta.name,
                            &file_meta.extension.clone().unwrap_or_default(),
                            file_meta.exif_date.or(file_meta.created_at),
                            &file_meta.tags,
                            pattern,
                            *counter,
                        );
                        *counter += 1;

                        let parent = Path::new(&file_meta.path).parent().unwrap_or(Path::new(""));
                        let new_path = parent.join(new_name);

                        let move_op = execution::FileMove {
                            file_path: file_meta.path.clone(),
                            new_path: new_path.to_string_lossy().to_string(),
                            reason: Some(format!("rule_{}_event_rename", rule_id)),
                        };

                        if execution::execute_moves_with_operation(
                            Some(&app),
                            &conn,
                            vec![move_op],
                            &batch_id,
                            "rename",
                        )
                        .is_ok()
                        {
                            file_processed = true;
                        }
                    }
                    Action::AddTag { tag } => {
                        let normalized_tag = tag.trim().to_lowercase();
                        if let Some(file_id) = file_meta.id {
                            let _ = conn.execute(
                                "INSERT OR IGNORE INTO tags (file_id, tag, source, confidence, created_at) VALUES (?1, ?2, 'rule', 1.0, datetime('now'))",
                                params![file_id, normalized_tag],
                            );
                            file_processed = true;
                        }
                    }
                    Action::Trash => {
                        if trash::move_to_trash(&app, &conn, &file_meta.path, &batch_id).is_ok() {
                            file_processed = true;
                        }
                    }
                    Action::Delete => {
                        if std::fs::remove_file(safe_path(path)).is_ok() {
                            if let Some(file_id) = file_meta.id {
                                let _ = conn.execute("DELETE FROM files WHERE id = ?1", [file_id]);
                            }
                            file_processed = true;
                        }
                    }
                    Action::Copy { destination } => {
                        let resolved_dest_dir =
                            resolve_path_pattern(destination, &file_meta, &conn, *counter);
                        if destination.contains("{counter}") || destination.contains("{seq}") {
                            *counter += 1;
                        }

                        let dest_path = Path::new(&resolved_dest_dir).join(&file_meta.name);
                        if let Some(parent) = dest_path.parent() {
                            std::fs::create_dir_all(safe_path(parent)).ok();
                        }

                        if std::fs::copy(safe_path(path), safe_path(&dest_path)).is_ok() {
                            file_processed = true;
                        }
                    }
                    Action::Archive { destination } => {
                        let resolved_dest = resolve_path_pattern(destination, &file_meta, &conn, *counter);
                        if destination.contains("{counter}") || destination.contains("{seq}") {
                            *counter += 1;
                        }

                        let dest_path = Path::new(&resolved_dest);
                        let final_zip_path = if dest_path.extension().is_none() {
                            std::fs::create_dir_all(safe_path(dest_path)).ok();
                            dest_path.join(format!(
                                "{}.zip",
                                Path::new(&file_meta.name).file_stem().unwrap().to_string_lossy()
                            ))
                        } else {
                            if let Some(p) = dest_path.parent() {
                                std::fs::create_dir_all(safe_path(p)).ok();
                            }
                            dest_path.to_path_buf()
                        };

                        if archive_file(path, &final_zip_path).is_ok() {
                            if let Some(file_id) = file_meta.id {
                                let _ = conn.execute("DELETE FROM files WHERE id = ?1", [file_id]);
                            }
                            file_processed = true;
                        }
                    }
                }
            }

            if file_processed {
                let _ = app.emit("file-changed", ());
            }
        }
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RuleExecution {
    pub id: i64,
    pub rule_id: i64,
    pub executed_at: String,
    pub files_affected: i64,
    pub success: bool,
    pub error_message: Option<String>,
}

#[tauri::command]
pub fn schedule_rule(app: AppHandle, rule_id: i64, cron_expression: String) -> Result<(), String> {
    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE rules SET schedule_cron = ?1 WHERE id = ?2",
        [&cron_expression, &rule_id.to_string()],
    ).map_err(|e| e.to_string())?;

    trigger_scheduler_refresh(app);

    Ok(())
}

#[tauri::command]
pub fn get_rule_execution_history(app: AppHandle, rule_id: i64) -> Result<Vec<RuleExecution>, String> {
     let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare_cached(
        "SELECT id, rule_id, executed_at, files_affected, success, error_message 
         FROM rule_executions WHERE rule_id = ?1 ORDER BY executed_at DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([rule_id], |row| {
         Ok(RuleExecution {
            id: row.get(0)?,
            rule_id: row.get(1)?,
            executed_at: row.get(2)?,
            files_affected: row.get(3)?,
            success: row.get(4)?,
            error_message: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut history = Vec::new();
    for row in rows {
        history.push(row.map_err(|e| e.to_string())?);
    }
    Ok(history)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_text_matcher ─────────────────────────────────────────
    #[test]
    fn parse_matcher_contains() {
        let (mode, val) = parse_text_matcher("contains:hello");
        assert!(matches!(mode, TextMatchMode::Contains));
        assert_eq!(val, "hello");
    }

    #[test]
    fn parse_matcher_regex() {
        let (mode, val) = parse_text_matcher("regex:^test\\d+$");
        assert!(matches!(mode, TextMatchMode::Regex));
        assert!(val.contains("test"));
    }

    #[test]
    fn parse_matcher_equals() {
        let (mode, val) = parse_text_matcher("equals:exact");
        assert!(matches!(mode, TextMatchMode::Equals));
        assert_eq!(val, "exact");
    }

    #[test]
    fn parse_matcher_wildcard_explicit() {
        let (mode, val) = parse_text_matcher("wildcard:*.pdf");
        assert!(matches!(mode, TextMatchMode::Wildcard));
        assert_eq!(val, "*.pdf");
    }

    #[test]
    fn parse_matcher_implicit_wildcard() {
        let (mode, _) = parse_text_matcher("*.txt");
        assert!(matches!(mode, TextMatchMode::Wildcard));
    }

    #[test]
    fn parse_matcher_plain() {
        let (mode, val) = parse_text_matcher("report");
        assert!(matches!(mode, TextMatchMode::Contains));
        assert_eq!(val, "report");
    }

    // ── matches_text ───────────────────────────────────────────────
    #[test]
    fn matches_contains_case_insensitive() {
        assert!(matches_text("MyReport.pdf", TextMatchMode::Contains, "report"));
        assert!(!matches_text("photo.jpg", TextMatchMode::Contains, "report"));
    }

    #[test]
    fn matches_equals() {
        assert!(matches_text("test.txt", TextMatchMode::Equals, "test.txt"));
        assert!(matches_text("TEST.TXT", TextMatchMode::Equals, "test.txt"));
        assert!(!matches_text("test.txt.bak", TextMatchMode::Equals, "test.txt"));
    }

    #[test]
    fn matches_regex() {
        assert!(matches_text("file123.txt", TextMatchMode::Regex, r"file\d+\.txt"));
        assert!(!matches_text("file.txt", TextMatchMode::Regex, r"file\d+\.txt"));
    }

    #[test]
    fn matches_wildcard_prefix() {
        assert!(matches_text("photo.jpg", TextMatchMode::Wildcard, "*.jpg"));
        assert!(!matches_text("photo.png", TextMatchMode::Wildcard, "*.jpg"));
    }

    #[test]
    fn matches_wildcard_suffix() {
        assert!(matches_text("report_2024.pdf", TextMatchMode::Wildcard, "report*"));
        assert!(!matches_text("invoice.pdf", TextMatchMode::Wildcard, "report*"));
    }

    #[test]
    fn matches_wildcard_both() {
        assert!(matches_text("my_report_final.pdf", TextMatchMode::Wildcard, "*report*"));
    }

    #[test]
    fn matches_empty_pattern_false() {
        assert!(!matches_text("anything", TextMatchMode::Contains, ""));
    }

    // ── parse_datetime_to_timestamp (rules) ────────────────────────
    #[test]
    fn rules_parse_rfc3339() {
        assert!(parse_datetime_to_timestamp("2024-01-01T00:00:00+00:00").is_some());
    }

    #[test]
    fn rules_parse_ymd_hms() {
        assert!(parse_datetime_to_timestamp("2024-01-01 12:00:00").is_some());
    }

    #[test]
    fn rules_parse_invalid() {
        assert!(parse_datetime_to_timestamp("bad").is_none());
    }
}