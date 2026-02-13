use crate::long_path::safe_path;
use crate::search_index::IndexManager;
use log::{error, warn};
use notify::{event::ModifyKind, Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, OptionalExtension};
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

fn is_hidden_path(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if name.starts_with('.') {
            return true;
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if let Ok(metadata) = fs::metadata(safe_path(path)) {
            const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
            const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
            let attrs = metadata.file_attributes();
            return (attrs & FILE_ATTRIBUTE_HIDDEN) != 0 || (attrs & FILE_ATTRIBUTE_SYSTEM) != 0;
        }
    }

    false
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(safe_path(path))
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

// Suspicious activity thresholds
const SUSPICIOUS_THRESHOLD: usize = 100;
const SUSPICIOUS_WINDOW: Duration = Duration::from_secs(60);
static WATCHER_RUNNING: AtomicBool = AtomicBool::new(false);

pub fn start_watcher(app: AppHandle, paths: Vec<String>) {
    // Root-cause fix: `start_indexing` can be called repeatedly, so this guard
    // guarantees we only run one watcher loop and avoid duplicate event streams.
    if WATCHER_RUNNING.swap(true, Ordering::SeqCst) {
        warn!("Watcher already running; skipping duplicate startup");
        return;
    }

    thread::spawn(move || {
        let (tx, rx) = channel();

        let event_queue: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
        let queued_paths: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

        let queue_app = app.clone();
        let queue_ref = Arc::clone(&event_queue);
        let queue_set_ref = Arc::clone(&queued_paths);

        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(5));

            let mut paths_to_process = Vec::new();
            {
                let mut queue = queue_ref.lock().unwrap();
                while let Some(p) = queue.pop_front() {
                    paths_to_process.push(p);
                }
            }

            if !paths_to_process.is_empty() {
                let mut set = queue_set_ref.lock().unwrap();
                for p in &paths_to_process {
                    set.remove(p);
                }
                drop(set);

                if let Err(e) = crate::rules_engine::process_event_rules(queue_app.clone(), paths_to_process) {
                    error!("Failed to process event rules: {}", e);
                }
            }
        });

        // Initialize watcher
        let mut watcher =
            RecommendedWatcher::new(tx, Config::default()).expect("Failed to create watcher");

        for path_str in paths {
            let path = Path::new(&path_str);
            if let Err(e) = watcher.watch(path, RecursiveMode::Recursive) {
                warn!("Failed to watch {:?}: {}", path, e);
            }
        }

        // Suspicious activity tracking
        let mut recent_events: VecDeque<Instant> = VecDeque::new();
        let mut alert_cooldown = Instant::now();

        // Event loop
        for res in rx {
            match res {
                Ok(event) => {
                    let pool = app.state::<crate::db::DbPool>();
                    let conn = pool.main.get().ok();

                    if let Some(conn) = conn {
                        // Track for suspicious activity (Modify/Remove)
                        match event.kind {
                            EventKind::Modify(_) | EventKind::Remove(_) => {
                                let now = Instant::now();
                                recent_events.push_back(now);

                                while let Some(front) = recent_events.front() {
                                    if now.duration_since(*front) > SUSPICIOUS_WINDOW {
                                        recent_events.pop_front();
                                    } else {
                                        break;
                                    }
                                }

                                if recent_events.len() >= SUSPICIOUS_THRESHOLD {
                                    if now.duration_since(alert_cooldown) > Duration::from_secs(300)
                                    {
                                        let _ = app.emit("suspicious-activity", recent_events.len());
                                        alert_cooldown = now;
                                    }
                                }
                            }
                            _ => {}
                        }

                        // Update Index
                        let index_manager = app.state::<Arc<IndexManager>>();

                        match event.kind {
                            EventKind::Modify(ModifyKind::Name(_)) => {
                                if event.paths.len() >= 2 {
                                    let old_path = &event.paths[0];
                                    let new_path = &event.paths[1];

                                    if is_hidden_path(new_path) || is_symlink(new_path) {
                                        continue;
                                    }

                                    let old_path_str = old_path.to_string_lossy().to_string();
                                    let new_path_str = new_path.to_string_lossy().to_string();

                                    let _ = conn.execute(
                                        "INSERT INTO activity (file_path, action, old_path, detected_at) VALUES (?1, ?2, ?3, datetime('now'))",
                                        params![new_path_str, "Rename", old_path_str],
                                    );

                                    if let Ok(metadata) = fs::metadata(safe_path(new_path)) {
                                        let name = new_path
                                            .file_name()
                                            .unwrap_or_default()
                                            .to_string_lossy()
                                            .to_string();
                                        let extension = new_path
                                            .extension()
                                            .map(|e| e.to_string_lossy().to_string());
                                        let parent = new_path
                                            .parent()
                                            .map(|p| p.to_string_lossy().to_string())
                                            .unwrap_or_default();
                                        let size = metadata.len() as i64;
                                        let modified = metadata
                                            .modified()
                                            .unwrap_or(SystemTime::now())
                                            .duration_since(UNIX_EPOCH)
                                            .unwrap_or_default()
                                            .as_secs() as i64;

                                        let _ = conn.execute(
                                            "UPDATE files SET path = ?1, name = ?2, extension = ?3, parent_path = ?4, size_bytes = ?5, modified_at = ?6, indexed_at = datetime('now') WHERE path = ?7",
                                            params![new_path_str, name, extension, parent, size, modified, old_path_str],
                                        );

                                        let _ = index_manager.remove_file(&old_path_str);
                                        let _ = index_manager.add_or_update_file(
                                            &new_path_str,
                                            &name,
                                            extension.as_deref(),
                                            &parent,
                                            size,
                                            modified,
                                        );
                                        let _ = index_manager.commit();
                                    }
                                }
                            }
                            EventKind::Create(_) | EventKind::Modify(_) => {
                                for path in &event.paths {
                                    if is_hidden_path(path) || is_symlink(path) {
                                        continue;
                                    }

                                    if let Ok(metadata) = fs::metadata(safe_path(path)) {
                                        if metadata.is_file() {
                                            let path_str = path.to_string_lossy().to_string();
                                            let name = path
                                                .file_name()
                                                .unwrap_or_default()
                                                .to_string_lossy()
                                                .to_string();
                                            let extension = path
                                                .extension()
                                                .map(|e| e.to_string_lossy().to_string());
                                            let parent = path
                                                .parent()
                                                .map(|p| p.to_string_lossy().to_string())
                                                .unwrap_or_default();
                                            let size = metadata.len() as i64;
                                            let modified = metadata
                                                .modified()
                                                .unwrap_or(SystemTime::now())
                                                .duration_since(UNIX_EPOCH)
                                                .unwrap_or_default()
                                                .as_secs() as i64;

                                            let action = if matches!(event.kind, EventKind::Create(_)) {
                                                "Create"
                                            } else {
                                                "Modify"
                                            };

                                            let _ = conn.execute(
                                                "INSERT INTO activity (file_path, action, detected_at) VALUES (?1, ?2, datetime('now'))",
                                                params![path_str, action],
                                            );

                                            let _ = conn.execute(
                                                "INSERT INTO files (path, name, extension, size_bytes, modified_at, parent_path, indexed_at)
                                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
                                                 ON CONFLICT(path) DO UPDATE SET
                                                    size_bytes=excluded.size_bytes,
                                                    modified_at=excluded.modified_at,
                                                    indexed_at=excluded.indexed_at",
                                                params![path_str, name, extension, size, modified, parent],
                                            );

                                            let _ = index_manager.add_or_update_file(
                                                &path_str,
                                                &name,
                                                extension.as_deref(),
                                                &parent,
                                                size,
                                                modified,
                                            );
                                            let _ = index_manager.commit();

                                            let mut queue = event_queue.lock().unwrap();
                                            let mut set = queued_paths.lock().unwrap();
                                            if set.insert(path_str.clone()) {
                                                queue.push_back(path_str.clone());
                                            }
                                        }
                                    }
                                }
                            }
                            EventKind::Remove(_) => {
                                for path in &event.paths {
                                    let path_str = path.to_string_lossy().to_string();

                                    let is_deleted: Option<i64> = conn
                                        .query_row(
                                            "SELECT is_deleted FROM files WHERE path = ?1",
                                            [&path_str],
                                            |row| row.get(0),
                                        )
                                        .optional()
                                        .unwrap_or(None);

                                    if is_deleted.unwrap_or(0) == 1 {
                                        continue;
                                    }

                                    let _ = conn.execute(
                                        "INSERT INTO activity (file_path, action, detected_at) VALUES (?1, ?2, datetime('now'))",
                                        params![path_str, "Delete"],
                                    );

                                    let _ = conn.execute("DELETE FROM files WHERE path = ?1", [&path_str]);

                                    let _ = index_manager.remove_file(&path_str);
                                    let _ = index_manager.commit();
                                }
                            }
                            _ => {}
                        }

                        crate::suggestions::on_file_change(app.clone());
                        let _ = app.emit("file-changed", event); // Forward to frontend
                    }
                }
                Err(e) => error!("Watch error: {:?}", e),
            }
        }

        WATCHER_RUNNING.store(false, Ordering::SeqCst);
    });
}
