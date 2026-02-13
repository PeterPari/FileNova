mod commands;
mod db;
mod duplicates;
mod embeddings;
mod extraction;
mod indexer;
mod search_index;
mod semantic_search;
mod trash;
mod vector_store;
mod execution;
mod suggestions;
mod tagging;
mod watcher;
mod rule_suggestions;
mod chat;
mod preview;

mod batch_rename;
mod long_path;
mod rules_engine;
mod error_handling;
mod folder_preferences;
mod onboarding;
mod diagnostics;
use duplicates::DuplicateScanState;
use extraction::ExtractionState;
use indexer::IndexerState;
use search_index::IndexManager;
use std::sync::Arc;
use tauri::{Listener, Manager};
use log::{info, error};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(IndexerState::new())
        .manage(DuplicateScanState::new())
        .manage(ExtractionState::new())
        .setup(|app| {
            let app_handle = app.handle();
            let paths = db::resolve_app_paths(&app_handle)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e))?;

            db::init_db(&paths.db_path)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("Failed to initialize database: {}", e)))?;

            // Initialize connection pool (r2d2)
            let pool = db::DbPool::new(&paths.db_path, &paths.preview_db_path)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("Failed to create connection pool: {}", e)))?;
            app.manage(pool);

            // Initialize folder preferences table
            if let Ok(conn) = rusqlite::Connection::open(&paths.db_path) {
                folder_preferences::init_folder_preferences_table(&conn)
                    .expect("Failed to initialize folder preferences table");
            }

            // Create trash directory
            std::fs::create_dir_all(&paths.trash_dir).ok();

            // Cleanup old trash on startup (background thread)
            let cleanup_app = app.handle().clone();
            std::thread::spawn(move || {
                let retention_days = if let Ok(paths) = db::resolve_app_paths(&cleanup_app) {
                    if let Ok(conn) = rusqlite::Connection::open(&paths.db_path) {
                        db::get_setting_i64(&conn, "trash_retention_days", 30)
                    } else {
                        30
                    }
                } else {
                    30
                };

                if let Err(e) = trash::cleanup_old_trash(&cleanup_app, retention_days) {
                    error!("Failed to cleanup old trash: {}", e);
                }
            });

            // Scheduled trash cleanup (daily)
            let cleanup_loop_app = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(60 * 60 * 24));

                let retention_days = if let Ok(paths) = db::resolve_app_paths(&cleanup_loop_app) {
                    if let Ok(conn) = rusqlite::Connection::open(&paths.db_path) {
                        db::get_setting_i64(&conn, "trash_retention_days", 30)
                    } else {
                        30
                    }
                } else {
                    30
                };

                if let Err(e) = trash::cleanup_old_trash(&cleanup_loop_app, retention_days) {
                    error!("Failed to cleanup old trash: {}", e);
                }
            });

            // Initialize Search Index
            let index_manager =
                IndexManager::new(&paths.index_path).expect("Failed to init search index");
            app.manage(Arc::new(index_manager));

            // Initialize Vector Store (LanceDB)
            let vector_path_str = paths.vector_path.to_string_lossy().to_string();
            let vector_store = tauri::async_runtime::block_on(async {
                vector_store::VectorStore::new(&vector_path_str)
                    .await
                    .expect("Failed to init vector store")
            });
            app.manage(Arc::new(vector_store));

            // Spawn initial indexing in background
            let index_manager = app.state::<Arc<IndexManager>>();
            let index_manager_clone = Arc::clone(&index_manager);
            let db_path_clone = paths.db_path.clone();

            std::thread::spawn(move || {
                if let Err(e) = index_manager_clone.rebuild_index(&db_path_clone) {
                    error!("Failed to rebuild index: {:?}", e);
                }
            });

            // Start background suggestion scanner
            suggestions::start_background_scanner(app.handle().clone());

            // Initialize scheduled rules engine
            match tauri::async_runtime::block_on(rules_engine::init_rule_scheduler(app.handle().clone())) {
                Ok(state) => {
                    app.manage(state);
                }
                Err(e) => {
                    error!("Failed to init rule scheduler: {}", e);
                }
            }

            // Listener for indexing finished to trigger extraction
            let app_handle_clone = app.handle().clone();
            app.listen("indexing-finished", move |_event| {
                info!("Indexing finished, triggering content extraction...");
                let state = app_handle_clone.state::<ExtractionState>();
                let vector_store = app_handle_clone.state::<Arc<vector_store::VectorStore>>();
                extraction::start_extraction(
                    app_handle_clone.clone(),
                    state.inner().clone(),
                    Arc::clone(&vector_store),
                    None,
                );
            });

            Ok(())
        })
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Stdout,
                    ),
                    tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::LogDir { file_name: Some("filenova".to_string()) },
                    ),
                    tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Webview,
                    ),
                ])
                .max_file_size(5_000_000) // 5 MB per log file
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .level(log::LevelFilter::Info)
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_directory,
            commands::get_file_info,
            commands::start_indexing,
            commands::pause_indexing,
            commands::resume_indexing,
            commands::get_index_status,
            commands::get_app_setting,
            commands::save_app_setting,
            commands::get_openai_api_key,
            commands::get_gemini_api_key,
            commands::save_openai_api_key,
            commands::save_gemini_api_key,
            commands::search_keyword,
            commands::get_storage_breakdown,
            commands::get_largest_files,
            commands::get_folder_sizes,
            commands::scan_duplicates,
            commands::get_duplicate_scan_status,
            commands::get_duplicate_summary,
            commands::get_duplicates,
            commands::get_duplicate_group_files,
            commands::delete_duplicate_files,
            commands::undo_batch,
            commands::redo_batch,
            commands::undo_operation,
            commands::undo_last_operations,
            commands::redo_operation,
            commands::get_recent_operations,
            commands::get_operation_history,
            // Stage 5: Content Extraction & Semantic Search
            commands::start_content_extraction,
            commands::pause_content_extraction,
            commands::resume_content_extraction,
            commands::get_extraction_status,
            commands::get_extraction_stats,
            commands::search_semantic,
            commands::search_hybrid,
            commands::check_ai_status,
            // Stage 6: Tagging
            commands::get_tags,
            commands::get_ai_tags,
            commands::add_tag,
            commands::add_user_tag,
            commands::remove_tag,
            commands::get_all_tags,
            commands::get_tag_stats,
            commands::auto_tag_file,
            commands::start_auto_tagging,
            commands::get_tags_for_directory,
            commands::get_activity_feed,
            commands::get_file_db_id,
            commands::get_directory_tree,
            commands::get_search_history,
            // Stage 7: Suggestions
            suggestions::generate_suggestions,
            suggestions::get_pending_suggestions,
            suggestions::accept_suggestion,
            suggestions::reject_suggestion,
            suggestions::modify_suggestion,
            suggestions::get_folder_structure_analysis,
            suggestions::get_structure_proposal,
            suggestions::apply_structure_plan,
            rule_suggestions::get_rule_suggestions,
            rule_suggestions::suggest_rules_from_behavior,
            rule_suggestions::record_rule_suggestion_feedback,
            rule_suggestions::accept_rule_suggestion,
            // Stage 8: Batch Rename
            batch_rename::batch_rename,
            batch_rename::batch_rename_preview,
            batch_rename::execute_batch_rename,
            batch_rename::detect_rename_pattern,
            trash::move_file_to_trash,
            trash::get_trash_items,
            trash::restore_trash_items,
            trash::empty_trash_bin,
            commands::get_trash_contents,
            commands::restore_from_trash,
            commands::empty_trash,
            // Stage 8: Rules Engine
            rules_engine::get_rules,
            rules_engine::save_rule,
            rules_engine::create_rule,
            rules_engine::update_rule,
            rules_engine::delete_rule,
            rules_engine::run_rule,
            rules_engine::execute_rule_plan,
            rules_engine::schedule_rule,
            rules_engine::get_rule_execution_history,
            // Stage 9: Chat Interface & Rule Automation
            chat::create_chat_session,
            chat::get_chat_sessions,
            chat::get_chat_messages,
            chat::chat_query,
            chat::chat_execute_action,
            chat::chat_undo_action,
            // Stage 10: File Preview & Power Features
            commands::generate_file_preview,
            commands::get_audio_waveform,
            commands::extract_pdf_preview,
            commands::get_video_thumbnail,
            commands::get_bookmarks,
            commands::add_bookmark,
            commands::remove_bookmark,
            commands::reorder_bookmarks,
            commands::get_pinned_files,
            commands::toggle_pin_file,
            commands::get_recent_files,
            commands::record_file_access,
            commands::save_workspace,
            commands::load_workspace,
            commands::get_workspaces,
            // Stage 11: Polish & Production Readiness
            onboarding::get_suggested_folders,
            onboarding::select_folder_dialog,
            onboarding::start_initial_indexing,
            onboarding::set_onboarding_completed,
            onboarding::get_onboarding_status,
            onboarding::generate_sample_data,
            onboarding::remove_sample_data,
            diagnostics::generate_diagnostics,
            diagnostics::write_diagnostic_report,
            diagnostics::check_index_integrity,
            diagnostics::vacuum_database,
            commands::check_disk_space,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
