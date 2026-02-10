use crate::search_index::IndexManager;
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection};
use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

// Suspicious activity thresholds
const SUSPICIOUS_THRESHOLD: usize = 100;
const SUSPICIOUS_WINDOW: Duration = Duration::from_secs(60);

pub fn start_watcher(app: AppHandle, paths: Vec<String>) {
    thread::spawn(move || {
        let (tx, rx) = channel();

        // Initialize watcher
        let mut watcher =
            RecommendedWatcher::new(tx, Config::default()).expect("Failed to create watcher");

        for path_str in paths {
            let path = Path::new(&path_str);
            if let Err(e) = watcher.watch(path, RecursiveMode::Recursive) {
                eprintln!("Failed to watch {:?}: {}", path, e);
            }
        }

        // Suspicious activity tracking
        let mut recent_events: VecDeque<Instant> = VecDeque::new();
        let mut alert_cooldown = Instant::now();

        // Event loop
        for res in rx {
            match res {
                Ok(event) => {
                    let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
                    let conn = Connection::open(&db_path).ok();

                    if let Some(conn) = conn {
                        // Log to activity table
                        let kind = format!("{:?}", event.kind);
                        for path in &event.paths {
                            let path_str = path.to_string_lossy().to_string();

                            // Log activity
                            let _ = conn.execute(
                                "INSERT INTO activity (file_path, action, detected_at) VALUES (?1, ?2, datetime('now'))",
                                [&path_str, &kind],
                            );

                            // Track for suspicious activity (Modify/Remove)
                            match event.kind {
                                EventKind::Modify(_) | EventKind::Remove(_) => {
                                    let now = Instant::now();
                                    recent_events.push_back(now);

                                    // Remove old events
                                    while let Some(front) = recent_events.front() {
                                        if now.duration_since(*front) > SUSPICIOUS_WINDOW {
                                            recent_events.pop_front();
                                        } else {
                                            break;
                                        }
                                    }

                                    // Check threshold
                                    if recent_events.len() >= SUSPICIOUS_THRESHOLD {
                                        if now.duration_since(alert_cooldown)
                                            > Duration::from_secs(300)
                                        {
                                            let _ = app
                                                .emit("suspicious-activity", recent_events.len());
                                            alert_cooldown = now;
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }

                        // Update Index
                        let index_manager = app.state::<Arc<IndexManager>>();

                        for path in &event.paths {
                            let path_str = path.to_string_lossy().to_string();

                            match event.kind {
                                EventKind::Create(_) | EventKind::Modify(_) => {
                                    if let Ok(metadata) = fs::metadata(path) {
                                        if metadata.is_file() {
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
                                                .as_secs()
                                                as i64;

                                            // Update SQLite
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
                                        }
                                    }
                                }
                                EventKind::Remove(_) => {
                                    // Update SQLite
                                    let _ = conn
                                        .execute("DELETE FROM files WHERE path = ?1", [&path_str]);

                                    let _ = index_manager.remove_file(&path_str);
                                    let _ = index_manager.commit();
                                }
                                _ => {}
                            }
                        }

                        let _ = app.emit("file-changed", event); // Forward to frontend
                    }
                }
                Err(e) => eprintln!("Watch error: {:?}", e),
            }
        }
    });
}
