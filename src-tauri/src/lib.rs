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

use duplicates::DuplicateScanState;
use extraction::ExtractionState;
use indexer::IndexerState;
use search_index::IndexManager;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(IndexerState::new())
        .manage(DuplicateScanState::new())
        .manage(ExtractionState::new())
        .setup(|app| {
            // Initialize database
            let app_handle = app.handle();
            let app_dir = app_handle.path().app_data_dir().unwrap();
            let db_path = app_dir.join("filenova.db");
            let index_path = app_dir.join("search_index");

            db::init_db(&db_path).expect("Failed to initialize database");

            // Create trash directory
            let trash_dir = app_dir.join("trash");
            std::fs::create_dir_all(&trash_dir).ok();

            // Cleanup old trash on startup (background thread)
            let cleanup_app = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = trash::cleanup_old_trash(&cleanup_app, 30) {
                    eprintln!("Failed to cleanup old trash: {}", e);
                }
            });

            // Initialize Search Index
            let index_manager =
                IndexManager::new(&index_path).expect("Failed to init search index");
            app.manage(Arc::new(index_manager));

            // Initialize Vector Store (LanceDB)
            let vector_path = app_dir.join("vector_store");
            let vector_path_str = vector_path.to_string_lossy().to_string();
            let vector_store = tauri::async_runtime::block_on(async {
                vector_store::VectorStore::new(&vector_path_str)
                    .await
                    .expect("Failed to init vector store")
            });
            app.manage(Arc::new(vector_store));

            // Spawn initial indexing in background
            let index_manager = app.state::<Arc<IndexManager>>();
            let index_manager_clone = Arc::clone(&index_manager);
            let db_path_clone = db_path.clone();

            std::thread::spawn(move || {
                if let Err(e) = index_manager_clone.rebuild_index(&db_path_clone) {
                    eprintln!("Failed to rebuild index: {:?}", e);
                }
            });

            // Start background suggestion scanner
            suggestions::start_background_scanner(app.handle().clone());

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_directory,
            commands::get_file_info,
            commands::start_indexing,
            commands::pause_indexing,
            commands::resume_indexing,
            commands::get_index_status,
            commands::get_app_setting,
            commands::save_app_setting,
            commands::search_keyword,
            commands::get_storage_breakdown,
            commands::get_largest_files,
            commands::get_folder_sizes,
            commands::scan_duplicates,
            commands::get_duplicate_scan_status,
            commands::get_duplicate_summary,
            commands::get_duplicates,
            commands::delete_duplicate_files,
            commands::undo_batch,
            commands::get_recent_operations,
            // Stage 5: Content Extraction & Semantic Search
            commands::start_content_extraction,
            commands::get_extraction_status,
            commands::get_extraction_stats,
            commands::search_semantic,
            commands::search_hybrid,
            commands::check_ai_status,
            // Stage 6: Tagging
            commands::get_tags,
            commands::add_tag,
            commands::remove_tag,
            commands::get_all_tags,
            commands::get_tag_stats,
            commands::auto_tag_file,
            commands::get_rules,
            commands::save_rule,
            commands::delete_rule,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
