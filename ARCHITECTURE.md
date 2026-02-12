# FileNova — Developer Architecture Guide

> **Version 1.0.0** | Tauri 2 · Rust · React 19 · TypeScript

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Build & Run](#4-build--run)
5. [Backend Architecture (Rust)](#5-backend-architecture-rust)
6. [Frontend Architecture (React)](#6-frontend-architecture-react)
7. [Data Layer](#7-data-layer)
8. [IPC & Command Surface](#8-ipc--command-surface)
9. [AI Pipeline](#9-ai-pipeline)
10. [File System Integration](#10-file-system-integration)
11. [Plugin & Configuration](#11-plugin--configuration)
12. [Error Handling & Logging](#12-error-handling--logging)
13. [Performance Design](#13-performance-design)
14. [Module Reference](#14-module-reference)
15. [Adding a New Feature](#15-adding-a-new-feature)
16. [Environment Variables](#16-environment-variables)

---

## 1. Overview

FileNova is a cross-platform desktop application that uses AI to help users organize, search, and manage files. It follows Tauri's split-process architecture:

```
┌──────────────────────────────────────────────────────┐
│                   Tauri Webview                       │
│  React 19 + TypeScript + Tailwind CSS 4              │
│  Zustand stores · Lucide icons · D3 / Recharts       │
├──────────────────────────────────────────────────────┤
│                   IPC Bridge                          │
│  invoke() → #[tauri::command] functions               │
│  Events: app.emit() ↔ listen()                       │
├──────────────────────────────────────────────────────┤
│                   Rust Core                           │
│  Tauri 2 · SQLite (r2d2) · Tantivy · LanceDB        │
│  notify · rayon · blake3 · sentry                    │
└──────────────────────────────────────────────────────┘
```

- **Frontend** renders the UI in a webview; never touches the filesystem directly.
- **Backend** owns all file I/O, databases, indexing, AI calls, and business logic.
- **IPC** uses Tauri's `invoke()` (request/response) and `emit()`/`listen()` (events) for communication.

---

## 2. Technology Stack

### Backend (Rust)

| Crate | Purpose |
|-------|---------|
| `tauri` 2 | Application framework, windows, IPC |
| `rusqlite` 0.32 | SQLite database (bundled, WAL mode) |
| `r2d2` / `r2d2_sqlite` | Connection pooling (4 connections per pool) |
| `tantivy` 0.22 | Full-text search index (50 MB writer buffer) |
| `lancedb` 0.26 | Columnar vector database for embeddings |
| `arrow-array` / `arrow-schema` 57 | Arrow data format for LanceDB |
| `blake3` 1.5 | Fast file hashing for duplicate detection |
| `image` 0.25 / `image_hasher` 3.1 | Image processing + perceptual hashing |
| `rayon` 1.8 | Parallel iteration for indexing & extraction |
| `walkdir` 2 | Recursive directory traversal |
| `notify` 6 | Cross-platform filesystem watcher (inotify/FSEvents/ReadDirectoryChanges) |
| `reqwest` 0.12 | HTTP client for AI provider APIs |
| `async-openai` 0.23 | OpenAI SDK |
| `tokio` 1 | Async runtime |
| `tokio-cron-scheduler` 0.11 | Cron-based rule scheduling |
| `pdf-extract` / `lopdf` | PDF text extraction |
| `docx-rs` 0.4 | DOCX text extraction |
| `kamadak-exif` 0.6 | EXIF metadata reader |
| `zip` 7.4 | Archive inspection |
| `sysinfo` 0.31 | System memory / disk info |
| `sentry` 0.34 | Crash reporting (opt-in) |
| `log` 0.4 / `tauri-plugin-log` 2 | Structured logging with file rotation |
| `tauri-plugin-updater` 2 | Auto-update from GitHub Releases |
| `tauri-plugin-process` 2 | App relaunch after update |
| `tauri-plugin-dialog` 2 | Native file/folder dialogs |

### Frontend (TypeScript)

| Package | Purpose |
|---------|---------|
| `react` 19 / `react-dom` 19 | UI framework |
| `zustand` 5 | State management (5 stores) |
| `tailwindcss` 4 | Utility-first CSS |
| `lucide-react` | Icon library |
| `d3` 7 | Treemap visualization |
| `recharts` 3 | Charts (pie, bar) |
| `@dnd-kit/*` | Drag-and-drop (bookmarks, rules, sidebar) |
| `@tanstack/react-virtual` 3 | Virtual scrolling for large file lists |
| `@tauri-apps/api` 2 | IPC bridge (`invoke`, `listen`) |
| `@tauri-apps/plugin-dialog` 2 | Native folder picker |
| `@tauri-apps/plugin-updater` 2 | Update check from JS |
| `@tauri-apps/plugin-log` 2 | Frontend → log file forwarding |
| `@sentry/react` 8 | Frontend crash reporting |
| `vite` 7 | Build tool with HMR on port 1420 |

---

## 3. Project Structure

```
FileNova/
├── src/                          # Frontend source
│   ├── main.tsx                  # Entry point (Sentry init, theme init, render)
│   ├── App.tsx                   # Root component, view routing
│   ├── App.css                   # Global styles
│   ├── components/               # 40+ React components
│   │   ├── Layout.tsx            # Shell: sidebar + tabs + browser + preview
│   │   ├── FileBrowser.tsx       # Grid/List file browser with virtual scroll
│   │   ├── Sidebar.tsx           # Navigation sidebar
│   │   ├── TabBar.tsx            # Multi-tab system
│   │   ├── SearchBar.tsx         # Keyword search with filters
│   │   ├── SemanticSearch.tsx    # AI-powered semantic search
│   │   ├── PreviewPanel.tsx      # Side panel file preview
│   │   ├── QuickLookModal.tsx    # Space-key overlay preview
│   │   ├── CommandPalette.tsx    # Ctrl+K command launcher
│   │   ├── SettingsModal.tsx     # 7-tab settings dialog
│   │   ├── Chat.tsx              # AI assistant chat
│   │   ├── AnalyticsDashboard.tsx# Storage analytics
│   │   ├── Treemap.tsx           # D3 treemap visualization
│   │   ├── DuplicateReview.tsx   # Duplicate file reviewer
│   │   ├── RulesManager.tsx      # Automation rules UI
│   │   ├── TagManager.tsx        # File tagging interface
│   │   ├── BatchRenameModal.tsx  # Pattern-based batch rename
│   │   ├── TrashManager.tsx      # Trash / restore UI
│   │   ├── OnboardingFlow.tsx    # First-run wizard
│   │   ├── FeatureDiscovery.tsx  # Contextual tip tooltips
│   │   ├── Organize/            # AI organization sub-components
│   │   └── ...
│   ├── pages/
│   │   └── Organize.tsx          # Organize page container
│   ├── store/                    # Zustand state stores
│   │   ├── fileStore.ts          # Main store (728 lines)
│   │   ├── ruleStore.ts          # Rules CRUD
│   │   ├── duplicateStore.ts     # Duplicate scan state
│   │   ├── themeStore.ts         # Theme + display prefs (persisted)
│   │   └── customizationStore.ts # Sidebar + folder prefs (persisted)
│   ├── styles/themes/            # CSS themes (dark, light, compact)
│   └── utils/                    # Shared utilities
│       ├── errorHandling.ts      # FileNovaError class hierarchy
│       ├── formatters.ts         # File size, date formatters
│       ├── logger.ts             # Console log levels
│       ├── path.ts               # Path utilities
│       └── performance.ts        # Startup tracker
│
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # Tauri app config
│   ├── build.rs                  # Tauri build hook
│   ├── capabilities/
│   │   └── default.json          # IPC permissions
│   ├── icons/                    # App icons (.ico, .icns, .png)
│   └── src/
│       ├── main.rs               # Entry point (Sentry init → lib::run())
│       ├── lib.rs                # Tauri Builder: plugins, state, commands
│       ├── commands.rs           # All #[tauri::command] functions (2029 lines)
│       ├── db.rs                 # SQLite schema, r2d2 pool
│       ├── indexer.rs            # Parallel file indexer
│       ├── search_index.rs       # Tantivy full-text index
│       ├── duplicates.rs         # Hash + perceptual duplicate detection
│       ├── extraction.rs         # Content extraction pipeline
│       ├── embeddings.rs         # Embedding generation (Ollama/OpenAI)
│       ├── vector_store.rs       # LanceDB vector storage
│       ├── semantic_search.rs    # Hybrid keyword+vector search
│       ├── suggestions.rs        # AI organization engine (1993 lines)
│       ├── chat.rs               # AI chat assistant (1414 lines)
│       ├── rules_engine.rs       # Rules engine + cron scheduler (1293 lines)
│       ├── execution.rs          # File move/rename with undo
│       ├── watcher.rs            # Real-time FS event watcher
│       ├── preview.rs            # File preview generation
│       ├── tagging.rs            # Tag CRUD + AI auto-tagging
│       ├── trash.rs              # Soft-delete trash management
│       ├── batch_rename.rs       # Pattern-based batch rename
│       ├── onboarding.rs         # Onboarding + sample data generation
│       ├── diagnostics.rs        # System diagnostic report
│       ├── rule_suggestions.rs   # AI-generated rule suggestions
│       ├── folder_preferences.rs # Per-folder UI preferences
│       ├── long_path.rs          # Windows \\?\ long path support
│       └── error_handling.rs     # Error types, Sentry capture, disk checks
│
├── package.json                  # NPM dependencies & scripts
├── tsconfig.json                 # TypeScript configuration
├── vite.config.ts                # Vite + Tailwind + React config
├── docs/                         # Development history & stage summaries
├── USER_GUIDE.md                 # End-user documentation
├── ARCHITECTURE.md               # This file
└── Tasks.md                      # Audit checklist
```

---

## 4. Build & Run

### Prerequisites

- **Node.js** 16+ and npm
- **Rust** stable (latest, edition 2021)
- Platform build tools: MSVC (Windows), Xcode CLT (macOS), `build-essential` (Linux)
- (Optional) [Ollama](https://ollama.ai/) for local AI features

### Development

```bash
# 1. Clone and install
git clone https://github.com/AidanParis/FileNova.git
cd FileNova
npm install

# 2. Start dev mode (frontend HMR + Rust hot-reload)
npm run tauri dev
```

Vite serves the frontend on `http://localhost:1420`. Tauri compiles the Rust backend and opens the webview.

### Production Build

```bash
npm run tauri build
```

Outputs platform-specific installers in `src-tauri/target/release/bundle/`:
- Windows: `nsis/` (.exe) and `msi/` (.msi)
- macOS: `dmg/` (.dmg) and `macos/` (.app)
- Linux: `appimage/` (.AppImage) and `deb/` (.deb)

### Signing Updates

```bash
# Generate signing keys (one-time)
npm run tauri signer generate -- -w ~/.tauri/filenova.key

# Build with signing (set env vars before building)
set TAURI_SIGNING_PRIVATE_KEY=<path-or-content>
npm run tauri build
```

---

## 5. Backend Architecture (Rust)

### Startup Sequence (`lib.rs`)

```
main() → sentry::init() → lib::run()
  │
  ├── tauri::Builder::default()
  │     ├── .manage() — IndexerState, DuplicateScanState, ExtractionState
  │     ├── .setup() — runs once before the window opens:
  │     │     ├── init_db() — create SQLite tables, WAL mode
  │     │     ├── DbPool::new() — start r2d2 pools (main + preview)
  │     │     ├── init_folder_preferences_table()
  │     │     ├── create trash directory
  │     │     ├── spawn trash cleanup thread (startup + daily loop)
  │     │     ├── IndexManager::new() — create Tantivy index
  │     │     ├── VectorStore::new() — connect LanceDB
  │     │     ├── spawn index rebuild thread
  │     │     ├── start_background_scanner() — suggestion engine
  │     │     ├── init_rule_scheduler() — cron-based rules
  │     │     └── listen("indexing-finished") → auto-extract content
  │     │
  │     ├── .plugin() — log, opener, updater, process
  │     ├── .invoke_handler() — register all 90+ commands
  │     └── .run()
```

### Module Dependency Graph

```
commands.rs ──→ ALL modules (public API surface)
    │
    ├── indexer.rs ──→ db, long_path, search_index
    ├── duplicates.rs ──→ db, rayon, image_hasher
    ├── extraction.rs ──→ db, embeddings, vector_store, long_path
    ├── semantic_search.rs ──→ embeddings, search_index, vector_store
    ├── suggestions.rs ──→ db, embeddings, execution
    ├── chat.rs ──→ db, search_index
    ├── rules_engine.rs ──→ execution, batch_rename, tagging, trash, long_path
    ├── execution.rs ──→ db, search_index, long_path, error_handling
    ├── watcher.rs ──→ db, search_index, long_path, rules_engine
    ├── preview.rs ──→ db, long_path
    ├── tagging.rs ──→ db
    ├── trash.rs ──→ db, long_path
    ├── batch_rename.rs ──→ db, search_index, suggestions, embeddings
    └── diagnostics.rs ──→ sysinfo
```

### State Management (Backend)

Tauri's `.manage()` injects shared state accessible via `app.state::<T>()`:

| State | Type | Purpose |
|-------|------|---------|
| `IndexerState` | Atomics | Indexing progress (is_indexing, is_paused, total, processed) |
| `DuplicateScanState` | Atomics | Duplicate scan progress |
| `ExtractionState` | Atomics | Content extraction progress |
| `DbPool` | r2d2 pools | Connection pools for main + preview SQLite DBs |
| `Arc<IndexManager>` | Tantivy | Full-text search index (thread-safe) |
| `Arc<VectorStore>` | LanceDB | Vector embedding store (thread-safe) |

---

## 6. Frontend Architecture (React)

### Component Hierarchy

```
main.tsx
  └── Sentry.ErrorBoundary
        └── App.tsx
              ├── OnboardingFlow (conditional, first-run only)
              └── Layout
                    ├── FeatureDiscovery (tooltip overlay)
                    ├── Sidebar
                    ├── TabBar
                    ├── [currentView]:
                    │     ├── FileBrowser (default)
                    │     ├── AnalyticsDashboard
                    │     ├── DuplicateReview
                    │     ├── SemanticSearch
                    │     ├── Organize
                    │     ├── RulesManager
                    │     ├── TrashManager
                    │     ├── Chat
                    │     └── ActivityFeed
                    ├── PreviewPanel (toggle, right side)
                    ├── SearchBar
                    ├── CommandPalette (modal, Ctrl+K)
                    ├── QuickLookModal (modal, Space)
                    ├── SettingsModal (modal, Ctrl+,)
                    ├── BatchRenameModal
                    ├── KeyboardShortcuts (modal, ?)
                    └── Toast (notifications)
```

### Zustand Stores

| Store | Persisted | Key Responsibilities |
|-------|-----------|---------------------|
| `fileStore` | No | Files, navigation, tabs, indexing status, extraction stats, search, view mode |
| `ruleStore` | No | Rule CRUD, condition/action types |
| `duplicateStore` | No | Scan state, groups, summary |
| `themeStore` | Yes (localStorage) | Theme, font size, compact mode, file extensions, hidden files, date format |
| `customizationStore` | Yes (localStorage) | Sidebar width/sections, per-folder view preferences |

### View Routing

There is no client-side router. `fileStore.currentView` (string) determines which main component renders. The sidebar sets this value on click.

---

## 7. Data Layer

### SQLite Database (`filenova.db`)

Primary metadata store. WAL journal mode for concurrent reads. Key tables:

| Table | Purpose |
|-------|---------|
| `files` | Indexed file metadata — path (PK), name, extension, size, hash, parent_path, modified_at, is_deleted, extraction_status |
| `tags` | File tags — file_id, tag, source (ai/user/rule), confidence |
| `settings` | Key-value app settings |
| `operations` | Undo history — batch_id, operation type, source/dest paths, timestamp, is_undone |
| `activity` | File change log — path, action (Create/Modify/Delete/Rename), detected_at |
| `trash_items` | Soft-deleted files — original path, trash path, metadata |
| `rules` | Automation rules — name, condition_json, action_json, trigger, schedule_cron |
| `suggestions` | AI suggestions — category, title, plan_json, confidence, status |
| `folder_preferences` | Per-folder UI prefs — view_mode, sort, column widths |
| `bookmarks` | User-saved folder bookmarks |
| `workspaces` | Saved workspace configurations (tabs, paths, view state) |

### Preview Database (`file_nova.db`)

Separate SQLite database for preview caching and chat sessions. Isolates large preview data from the primary db.

### Tantivy Search Index (`search_index/`)

Full-text index on file metadata. Schema fields:

| Field | Type | Stored | Indexed |
|-------|------|--------|---------|
| `path` | TEXT | ✓ | Tokenized |
| `path_raw` | TEXT | ✓ | Raw (exact match) |
| `name` | TEXT | ✓ | Tokenized |
| `extension` | TEXT | ✓ | Raw |
| `parent_path` | TEXT | ✓ | Tokenized |
| `size_bytes` | I64 | ✓ | Indexed |
| `modified_at` | I64 | ✓ | Indexed |

Writer buffer: 50 MB. Manual reload policy for controlled reader refresh.

### LanceDB Vector Store (`vector_store/`)

Stores embedding vectors for semantic search. Arrow schema:

| Column | Type |
|--------|------|
| `file_id` | Int64 |
| `path` | Utf8 |
| `chunk_text` | Utf8 |
| `chunk_index` | Int32 |
| `char_offset` | Int32 |
| `vector` | FixedSizeList[Float32; 768] |

Default embedding dimensions: 768 (matches `nomic-embed-text`).

---

## 8. IPC & Command Surface

### How it works

Frontend calls `invoke('command_name', { args })` → Tauri deserializes args → routes to the matching `#[tauri::command]` function → serializes the return value back.

For long-running operations, the backend uses `app.emit("event-name", payload)` and the frontend listens with `listen("event-name", callback)`.

### Command Categories (~90 commands in `commands.rs` + module-level commands)

| Category | Example Commands |
|----------|-----------------|
| **File Browsing** | `list_directory`, `get_file_info`, `rename_file`, `delete_files` |
| **Indexing** | `start_indexing`, `pause_indexing`, `resume_indexing`, `get_index_status` |
| **Search** | `search_keyword`, `semantic_search`, `hybrid_search` |
| **Duplicates** | `scan_duplicates`, `get_duplicates`, `delete_duplicate_files` |
| **Extraction** | `start_content_extraction`, `get_extraction_stats` |
| **Tags** | `add_tag`, `remove_tag`, `get_tags_for_file`, `auto_tag_files` |
| **Suggestions** | `generate_suggestions`, `accept_suggestion`, `dismiss_suggestion` |
| **Chat** | `send_chat_message`, `get_chat_sessions`, `create_chat_session` |
| **Rules** | `create_rule`, `update_rule`, `delete_rule`, `run_rule`, `dry_run_rule` |
| **Preview** | `get_file_preview`, `get_bookmarks`, `save_workspace` |
| **Trash** | `trash_files`, `restore_trash_items`, `empty_trash`, `get_trash_items` |
| **Batch Rename** | `preview_batch_rename`, `apply_batch_rename`, `smart_detect_pattern` |
| **Undo** | `undo_batch`, `redo_batch`, `undo_operation`, `undo_last_operations` |
| **Settings** | `get_app_setting`, `save_app_setting` |
| **Analytics** | `get_storage_breakdown`, `get_largest_files`, `get_folder_sizes` |
| **Diagnostics** | `generate_diagnostics` |
| **Onboarding** | `get_suggested_folders`, `generate_sample_data`, `remove_sample_data` |
| **Watcher** | `start_watcher` (spawns background FS monitoring thread) |

### Event Names (Backend → Frontend)

| Event | Emitted by | Payload |
|-------|-----------|---------|
| `indexing-progress` | indexer | `IndexStatus` |
| `indexing-finished` | indexer | — |
| `extraction-progress` | extraction | `ExtractionStatus` |
| `duplicate-scan-progress` | duplicates | `DuplicateScanStatus` |
| `tagging-progress` | tagging | count |
| `file-changed` | watcher | `notify::Event` |
| `suspicious-activity` | watcher | event count |

---

## 9. AI Pipeline

### Embedding Flow

```
File on disk
  → extraction.rs (pdf-extract / docx-rs / plaintext)
  → embeddings.rs (chunk text: 512 chars, 50 overlap)
  → Ollama API or OpenAI API
  → vector_store.rs (store in LanceDB)
```

### Semantic Search Flow

```
User query
  → embeddings.rs (embed the query)
  → vector_store.rs (ANN search, top-K results)
  → + search_index.rs (Tantivy keyword search)
  → semantic_search.rs (merge & rank: 0.4 keyword + 0.6 semantic)
  → HybridSearchResult[]
```

### Chat Flow

```
User message
  → chat.rs: send to LLM with SYSTEM_PROMPT
  → LLM classifies intent (search/analyze/compare/organize/chat)
  → chat.rs: executes corresponding backend operations
  → Returns structured response with optional actions
  → Frontend shows results + action confirmation buttons
```

### Suggestion Flow

```
Heuristic analysis (file patterns, duplicates, stale files)
  → AI analysis via LLM (file structure → proposed moves)
  → SuggestionPlan with FileMove[] and confidence score
  → User accepts → execution.rs (with undo tracking)
```

### Configuration

AI settings are stored in the `settings` SQLite table:

| Key | Default | Purpose |
|-----|---------|---------|
| `ai_provider` | `ollama` | `ollama` or `openai` |
| `ollama_url` | `http://localhost:11434` | Ollama API endpoint |
| `openai_api_key` | (empty) | OpenAI API key |
| `ai_embedding_model` | `nomic-embed-text` | Embedding model name |

---

## 10. File System Integration

### Indexing (`indexer.rs`)

- Walks directory trees recursively using `walkdir` + `rayon` for parallelism.
- Computes BLAKE3 hashes for each file.
- Inserts/updates file records in SQLite.
- Adds documents to the Tantivy search index.
- Emits `indexing-progress` events with percentage and file counts.
- Supports pause/resume via atomic flags.

### Real-Time Watching (`watcher.rs`)

- Uses `notify::RecommendedWatcher` (inotify on Linux, FSEvents on macOS, ReadDirectoryChanges on Windows).
- Filters out hidden files (dot-prefix, Windows `HIDDEN`/`SYSTEM` attributes).
- Batches events via a debounce queue (2-second window) before processing.
- Updates SQLite + Tantivy on create/modify/delete/rename events.
- Detects suspicious activity (>100 events in 60 seconds → emits alert).
- Feeds changed paths to `rules_engine::process_event_rules()` for watch-triggered rules.

### Windows Long Paths (`long_path.rs`)

- `safe_path(path)` — prepends `\\?\` on Windows when path length > 248 characters.
- Used across all modules that interact with `std::fs`: indexer, watcher, extraction, execution, preview, trash, rules_engine.
- No-op on macOS / Linux.

---

## 11. Plugin & Configuration

### Tauri Plugins (registered in `lib.rs`)

| Plugin | Purpose |
|--------|---------|
| `tauri-plugin-log` | Structured logging: Stdout + LogDir + Webview targets, 5 MB rotation, local timezone |
| `tauri-plugin-opener` | Open files/URLs with system default app |
| `tauri-plugin-updater` | Auto-update via GitHub Releases (passive install on Windows) |
| `tauri-plugin-process` | App relaunch after update |
| `tauri-plugin-dialog` | Native file/folder picker dialogs |

### Capabilities (`capabilities/default.json`)

IPC permissions granted to the main window:

```json
["core:default", "opener:default", "updater:default", "process:default", "log:default"]
```

### `tauri.conf.json` Key Settings

| Setting | Value |
|---------|-------|
| `productName` | `file-nova-app` |
| `identifier` | `com.pariz.file-nova-app` |
| `version` | `1.0.0` |
| `build.devUrl` | `http://localhost:1420` |
| `bundle.createUpdaterArtifacts` | `true` |
| `plugins.updater.endpoints` | GitHub Releases (`latest.json`) |
| `plugins.updater.windows.installMode` | `passive` |
| `app.security.csp` | `null` (disabled) |

---

## 12. Error Handling & Logging

### Rust Logging

All modules use the `log` crate macros (`info!`, `warn!`, `error!`). The `tauri-plugin-log` plugin routes logs to:

1. **Stdout** — visible in terminal during development.
2. **Log file** — `filenova.log` in the platform log directory, 5 MB max, rotated with `KeepAll` strategy.
3. **Webview** — forwarded to browser console via `attachConsole()`.

| Platform | Log directory |
|----------|--------------|
| Windows | `%LOCALAPPDATA%\com.pariz.file-nova-app\logs\` |
| macOS | `~/Library/Logs/com.pariz.file-nova-app/` |
| Linux | `~/.local/share/com.pariz.file-nova-app/logs/` |

### Crash Reporting (Sentry)

- **Rust** (`main.rs`): `sentry::init()` with panic handler. DSN via `SENTRY_DSN` env var. No PII.
- **Frontend** (`main.tsx`): `@sentry/react` with `ErrorBoundary`. DSN via `VITE_SENTRY_DSN`. No PII, no replay, no performance tracing.
- **Opt-in** toggle in Settings → General → Crash Reporting (persisted in `settings` table).

### Error Types (`error_handling.rs`)

```rust
AppError { code, message, details }
  ├── ::permission_denied(path)
  ├── ::network_error(message)
  ├── ::filesystem_error(message)
  ├── ::ai_service_error(message)
  ├── ::index_corruption(message)
  └── ::insufficient_disk_space(available_bytes)
```

Utilities: `capture_error()`, `capture_warning()` (→ Sentry), `retry_with_backoff()`, `require_disk_space()`.

### Frontend Error Classes (`utils/errorHandling.ts`)

```typescript
FileNovaError extends Error
  ├── PermissionError
  ├── NetworkError
  ├── FileSystemError
  ├── AIServiceError
  ├── IndexCorruptionError
  └── DiskSpaceError
```

---

## 13. Performance Design

| Technique | Where | Impact |
|-----------|-------|--------|
| **r2d2 connection pooling** | `db.rs` | Eliminates SQLite connection overhead; 4 connections per pool |
| **Prepared statement caching** | `db.rs` | `prepare_cached()` avoids re-parsing SQL |
| **Rayon parallel iteration** | `indexer.rs`, `extraction.rs`, `duplicates.rs` | Multi-core file processing |
| **Tantivy 50 MB writer buffer** | `search_index.rs` | Batches index writes for throughput |
| **LRU preview cache** | Frontend (500 items) | Instant repeat previews |
| **Virtual scrolling** | `FileBrowser.tsx` via `@tanstack/react-virtual` | Handles 100K+ files at 60 fps |
| **Tab DOM unloading** | `TabBar.tsx` | Only nearby tabs rendered when >10 open |
| **Debounced search** | `SearchBar.tsx` (300 ms) | Prevents excessive backend calls |
| **Event batching** | `watcher.rs` (2-second queue) | Coalesces rapid FS events |
| **Background threads** | `lib.rs` | Trash cleanup, index rebuild, suggestion scanning won't block UI |
| **Disk space checks** | `execution.rs` | Fail-fast before large moves |

---

## 14. Module Reference

### Rust Modules (Quick Reference)

| Module | Lines | Purpose |
|--------|-------|---------|
| `commands.rs` | 2029 | Tauri command surface (IPC endpoint for all operations) |
| `suggestions.rs` | 1993 | AI-powered organization engine (heuristic + LLM analysis) |
| `chat.rs` | 1414 | Natural-language file management assistant |
| `rules_engine.rs` | 1293 | Declarative rules with composable conditions and actions |
| `preview.rs` | 897 | File preview, bookmarks, workspace config |
| `fileStore.ts` | 728 | (Frontend) Main Zustand store |
| `batch_rename.rs` | 653 | Pattern-based batch rename with AI suggestions |
| `duplicates.rs` | 641 | Hash + perceptual duplicate detection |
| `trash.rs` | 598 | Soft-delete trash with batch operations |
| `extraction.rs` | 412 | Content extraction pipeline |
| `tagging.rs` | 361 | Tag CRUD + AI auto-tagging |
| `embeddings.rs` | 332 | Embedding generation (Ollama / OpenAI) |
| `execution.rs` | 306 | Move/rename with full undo/redo |
| `vector_store.rs` | 302 | LanceDB vector storage |
| `watcher.rs` | 298 | Real-time filesystem event watcher |
| `error_handling.rs` | 255 | Error types, Sentry capture, retries |
| `semantic_search.rs` | 241 | Hybrid keyword + vector search |
| `indexer.rs` | ~200 | Parallel file indexer |
| `diagnostics.rs` | 131 | System diagnostic report |
| `long_path.rs` | 91 | Windows `\\?\` long path support |
| `folder_preferences.rs` | 71 | Per-folder UI preferences |
| `onboarding.rs` | 446 | Onboarding wizard + sample data generation |

### Frontend Components (40+ components)

See [Project Structure](#3-project-structure) for the full list. Key patterns:

- All backend communication goes through `invoke()` from `@tauri-apps/api/core`.
- Components subscribe to Zustand stores via `useFileStore()`, `useThemeStore()`, etc.
- Heavy lists use `@tanstack/react-virtual` for virtualization.
- Drag-and-drop uses `@dnd-kit` (bookmarks, rules, sidebar sections).

---

## 15. Adding a New Feature

### Checklist

1. **Rust module** — Create `src-tauri/src/your_feature.rs`.
2. **Declare module** — Add `mod your_feature;` in `lib.rs`.
3. **Add commands** — Write `#[tauri::command]` functions (or add to `commands.rs`).
4. **Register commands** — Add to `.invoke_handler(tauri::generate_handler![...])` in `lib.rs`.
5. **Frontend component** — Create `src/components/YourFeature.tsx`.
6. **Store** — Add state to an existing Zustand store or create a new one.
7. **Wire up IPC** — Use `invoke('your_command', { args })` and `listen('your-event', cb)`.
8. **Add to navigation** — Add entry to `Sidebar.tsx` and view routing in `App.tsx`.
9. **Log, don't print** — Use `log::info!()` / `log::error!()`, never `println!()`.
10. **Windows paths** — Wrap `std::fs` calls with `long_path::safe_path()`.
11. **Update Tasks.md** — Mark the feature as complete.

### Example: Adding a new Tauri command

```rust
// src-tauri/src/your_feature.rs
use serde::Serialize;

#[derive(Serialize)]
pub struct MyResult {
    pub value: String,
}

#[tauri::command]
pub fn my_new_command(input: String) -> Result<MyResult, String> {
    Ok(MyResult { value: format!("Hello, {}", input) })
}
```

```rust
// src-tauri/src/lib.rs — add to invoke_handler
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    your_feature::my_new_command,
])
```

```typescript
// Frontend usage
import { invoke } from '@tauri-apps/api/core';

const result = await invoke<{ value: string }>('my_new_command', { input: 'World' });
```

---

## 16. Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `SENTRY_DSN` | Rust build (compile-time) | Sentry DSN for backend crash reporting |
| `VITE_SENTRY_DSN` | `.env` / build env | Sentry DSN for frontend crash reporting |
| `TAURI_SIGNING_PRIVATE_KEY` | Build env | Private key for signing update artifacts |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Build env | Password for the signing key (optional) |

---

*For end-user documentation, see [USER_GUIDE.md](USER_GUIDE.md). For development history, see [DevelopmentStages.md](docs/DevelopmentStages.md).*
