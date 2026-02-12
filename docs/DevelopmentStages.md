# FileNova Development - Sequential Execution Stages

## Stage 1: Project Foundation & Basic File Browser

### Specific Task
Build the foundational Tauri v2 application shell with a functional file browser that can navigate the local filesystem.

### Deliverables
1. **Tauri Project Structure**
   - Tauri v2 initialized with Rust backend and React 18 + TypeScript frontend
   - Dependencies configured: Tailwind CSS, Zustand (state management), Lucide React (icons), TanStack Virtual (list virtualization)
   - Build and dev server working

2. **Database Foundation**
   - SQLite database initialized with the `files` table schema:
     ```sql
     CREATE TABLE files (
       id INTEGER PRIMARY KEY,
       path TEXT UNIQUE NOT NULL,
       name TEXT NOT NULL,
       extension TEXT,
       size_bytes INTEGER NOT NULL,
       created_at DATETIME,
       modified_at DATETIME,
       accessed_at DATETIME,
       parent_path TEXT NOT NULL,
       hash_blake3 TEXT,
       content_extracted BOOLEAN DEFAULT FALSE,
       is_directory BOOLEAN DEFAULT FALSE,
       indexed_at DATETIME NOT NULL
     );
     ```
   - Indexes on: parent_path, extension, modified_at, name

3. **Core Tauri Commands** (Rust → Frontend):
   ```rust
   #[tauri::command] fn list_directory(path: &str) -> Vec<FileEntry>
   #[tauri::command] fn get_file_info(path: &str) -> FileInfo
   ```

4. **UI Layout Shell**
   - Three-column layout: Sidebar (drives/tree) | Main content area | Preview panel (togglable)
   - Tab bar for multiple folder views
   - Breadcrumb navigation with clickable segments
   - Grid view and list view toggle (use TanStack Virtual for smooth scrolling)

5. **File Browser Core Features**
   - Display files/folders in current directory (name, size, modified date, type)
   - Click to navigate into folders
   - Breadcrumb navigation and back/forward buttons
   - Column sorting (name, size, date, type)
   - Keyboard navigation (arrow keys, Enter to open, Backspace to go up)
   - Basic file metadata in preview panel when file selected

### Performance Targets
- Directory listing: <50ms for 10,000 files
- App startup: <1 second
- UI should feel snappy with virtual scrolling

### Pre-requisites
None. This is the first stage.

### Integration Hook for Next Stage
**What Stage 2 needs from this stage:**
- The `list_directory()` Tauri command that reads filesystem
- The `files` table schema in SQLite (empty for now)
- The UI layout structure where indexing progress will be displayed
- The file path handling logic that will be reused during indexing

**Stage 2 will build:** The background indexing engine that populates this database by recursively walking selected directories and storing file metadata.

---

## Stage 2: File Indexing Engine

### Specific Task
Build a high-performance background indexing system that recursively scans user-selected directories and populates the SQLite database with file metadata and content hashes.

### Pre-requisites from Stage 1
- **Database Schema**: The `files` table exists in SQLite with all required columns
- **Filesystem Access**: The `list_directory()` command demonstrates Rust can read directories
- **UI Shell**: Main layout exists where progress indicators can be displayed
- **Tauri IPC**: Communication pipeline between Rust backend and React frontend is working

### Deliverables

1. **Settings Interface**
   - Settings page/modal where users select which drives/folders to index
   - Store indexed locations in a `settings` table:
     ```sql
     CREATE TABLE settings (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     );
     ```

2. **Rust Indexing Pipeline**
   - Recursive directory walker using `walkdir` crate
   - Parallel traversal with `rayon` for speed
   - For each file discovered:
     - Extract metadata (name, size, created/modified dates, extension)
     - Calculate BLAKE3 hash for files under 500MB (configurable threshold)
     - Batch insert into `files` table (1000 rows at a time for speed)
   - Skip/handle gracefully: permission errors, symlinks, hidden system files

3. **Tauri Commands**:
   ```rust
   #[tauri::command] fn start_indexing(paths: Vec<String>) -> ()
   #[tauri::command] fn get_index_status() -> IndexStatus
   #[tauri::command] fn pause_indexing() -> ()
   #[tauri::command] fn resume_indexing() -> ()
   ```
   - `IndexStatus` includes: total files found, files processed, current file path, percentage complete, estimated time remaining

4. **Progress Reporting**
   - Use Tauri events to stream progress updates to frontend every 100ms
   - Frontend displays: "Indexing 234,567 files... 45%" with current file path

5. **Filesystem Watcher**
   - Integrate `notify` crate to watch all indexed directories
   - When files are created/modified/deleted/moved:
     - Update the `files` table incrementally
     - Emit events to frontend for real-time UI updates
   - Should handle 1M+ files comfortably

6. **Activity Table** (for later use):
   ```sql
   CREATE TABLE activity (
     id INTEGER PRIMARY KEY,
     file_path TEXT NOT NULL,
     action TEXT NOT NULL,
     old_path TEXT,
     detected_at DATETIME NOT NULL
   );
   CREATE INDEX idx_activity_time ON activity(detected_at);
   ```
   - Filesystem watcher logs all changes here

### Performance Targets
- Initial indexing: 100,000 files in <60 seconds
- File watcher latency: <1 second from filesystem change to database update
- BLAKE3 hashing: Multi-GB/s throughput (using multi-threaded implementation)

### Integration Hook for Next Stage
**What Stage 3 needs from this stage:**
- **Populated Database**: The `files` table now contains all indexed files with metadata
- **File Watcher**: Running in background, keeping index current
- **Indexed Locations**: Settings table stores which directories are being tracked
- **Core Infrastructure**: Async Tokio runtime for concurrent operations

**Stage 3 will build:** Full-text search using Tantivy (indexing the file names/paths from this database) and storage analytics visualizations (reading from this database).

---

## Stage 3: Fast Search & Storage Analytics

### Specific Task
Implement instant keyword search using Tantivy full-text indexing and build comprehensive storage analytics dashboards.

### Pre-requisites from Stage 2
- **Populated Database**: The `files` table contains all indexed files with complete metadata (path, name, size, dates, extension, parent_path)
- **File Watcher**: Real-time updates to the database when files change
- **Settings Table**: Tracks which directories are indexed
- **Rust Backend**: Tokio async runtime established, can query SQLite efficiently

### Deliverables

1. **Tantivy Search Index**
   - Create Tantivy schema with fields: `path`, `name`, `extension`, `parent_path`, `modified_at`, `size_bytes`
   - On initial launch after Stage 2: bulk index all files from SQLite into Tantivy
   - Wire into file watcher: when files added/modified/deleted, update Tantivy index in real-time
   - Store Tantivy index on disk (separate from SQLite)

2. **Search UI Component**
   - Persistent search bar at top of every view (Ctrl+P / Ctrl+K to focus)
   - As-you-type search results (debounced to avoid lag)
   - Results display: file name, path, size, modified date, icon
   - Click result to navigate to file location
   - Display result count ("234 results")

3. **Tauri Search Commands**:
   ```rust
   #[tauri::command] 
   fn search_keyword(query: &str, filters: SearchFilters) -> Vec<SearchResult>
   
   // SearchFilters struct includes:
   // - file_types: Vec<String> (e.g., ["pdf", "docx"])
   // - size_range: Option<(u64, u64)> (min, max bytes)
   // - date_range: Option<(DateTime, DateTime)>
   // - location: Option<String> (path prefix)
   ```

4. **Advanced Search Syntax**
   - Parser that handles: `type:pdf size:>10mb modified:last-week path:Documents`
   - Operators: `>`, `<`, `=` for size; date helpers like `today`, `last-week`, `last-month`
   - Multiple filters combinable: `type:pdf,docx size:1mb-50mb modified:2024`

5. **Search History**
   - Save searches to `search_history` table:
     ```sql
     CREATE TABLE search_history (
       id INTEGER PRIMARY KEY,
       query TEXT NOT NULL,
       search_type TEXT NOT NULL,
       result_count INTEGER,
       searched_at DATETIME NOT NULL
     );
     ```
   - Show recent searches in dropdown when search bar focused

6. **Storage Analytics Dashboard**
   - New tab/view called "Dashboard"
   - **Treemap Visualization** (using D3.js):
     - Hierarchical view of disk usage by folder
     - Click to drill down into subdirectories
     - Color-coded by file type or age
   - **Top 50 Largest Files**:
     - Sortable list with size, path, type
     - Click to navigate to file
   - **Storage by File Type** (Pie/Donut chart using Recharts):
     - Videos, Images, Documents, Code, Archives, Other
     - Show percentage and total GB for each
   - **Folder Size Comparison** (Bar chart):
     - Shows all direct subfolders of current directory
     - Sorted by size
   - **Optional: Storage Over Time**:
     - Line chart if historical data available (using activity feed later)

7. **Analytics Tauri Commands**:
   ```rust
   #[tauri::command] fn get_storage_breakdown() -> StorageBreakdown
   #[tauri::command] fn get_largest_files(limit: usize) -> Vec<FileEntry>
   #[tauri::command] fn get_folder_sizes(path: &str) -> Vec<FolderSize>
   ```

### Performance Targets
- Keyword search: <100ms for result display
- Tantivy index build (100k files): <30 seconds
- Analytics queries: <500ms (use indexed columns, aggregate carefully)

### Integration Hook for Next Stage
**What Stage 4 needs from this stage:**
- **Tantivy Index**: The full-text search infrastructure (will be extended for content search later)
- **Hash Column**: `hash_blake3` in the `files` table is populated (from Stage 2)
- **Storage Analytics**: The folder/file size calculation logic will be reused
- **UI Pattern**: Dashboard tab pattern established for adding new analysis views

**Stage 4 will build:** Duplicate file detection by comparing BLAKE3 hashes and adding perceptual hashing for images.

---

## Stage 4: Duplicate File Detection

### Specific Task
Build a duplicate detection system that finds exact duplicates via hash comparison and near-duplicate images via perceptual hashing, with a safe bulk cleanup interface.

### Pre-requisites from Stage 3
- **Hash Data**: The `files` table has `hash_blake3` column populated for files under 500MB
- **Database Infrastructure**: SQLite with proper indexes, can efficiently query by hash
- **Analytics UI**: Dashboard tab exists where duplicate analysis can be displayed
- **File Operations**: Can read file metadata and display in lists

### Deliverables

1. **Duplicate Groups Table**
   ```sql
   CREATE TABLE duplicate_groups (
     id INTEGER PRIMARY KEY,
     hash_blake3 TEXT NOT NULL,
     file_count INTEGER NOT NULL,
     total_wasted_bytes INTEGER NOT NULL
   );
   ```

2. **Exact Duplicate Detection**
   - SQL query to find files with identical `hash_blake3`:
     ```sql
     SELECT hash_blake3, COUNT(*) as count, SUM(size_bytes) as total_size
     FROM files 
     WHERE hash_blake3 IS NOT NULL
     GROUP BY hash_blake3 
     HAVING count > 1
     ORDER BY total_size DESC;
     ```
   - Populate `duplicate_groups` table
   - Calculate wasted space: `(file_count - 1) * file_size`

3. **Perceptual Hashing for Images**
   - Use `image-hasher` Rust crate
   - For image files (.jpg, .png, .gif, .webp):
     - Generate perceptual hash (pHash or dHash)
     - Store in a new column: `perceptual_hash TEXT` in `files` table
     - Compare hashes using Hamming distance
     - Threshold: distance ≤ 5 = "near duplicate"
   - Add to schema:
     ```sql
     ALTER TABLE files ADD COLUMN perceptual_hash TEXT;
     CREATE INDEX idx_files_phash ON files(perceptual_hash);
     ```

4. **"Smart Duplicates" Detection**
   - Files with same name but different locations
   - Files with similar names (edit distance < 3) in different folders

5. **Duplicate Review UI**
   - New section in Dashboard: "Duplicates Found: 47 groups (23.4 GB wasted)"
   - Click to see grouped view:
     - Each group shows: file preview (thumbnail for images), path, size, modified date
     - Files sorted by: newest first, or preferred location first
   - **Preview Before Action**: Show what will be kept vs deleted
   - **Bulk Actions**:
     - "Keep newest, delete others"
     - "Keep in [preferred location], delete others"
     - "Delete all but one (select manually)"
     - Manual selection: checkboxes next to each file

6. **Tauri Commands**:
   ```rust
   #[tauri::command] fn get_duplicates() -> Vec<DuplicateGroup>
   #[tauri::command] fn get_duplicate_group_files(group_id: i64) -> Vec<FileEntry>
   #[tauri::command] fn delete_duplicate_files(
     file_ids: Vec<i64>, 
     keep_file_id: i64
   ) -> Result<BatchId>
   ```

7. **Operations Journal** (for undo):
   ```sql
   CREATE TABLE operations (
     id INTEGER PRIMARY KEY,
     batch_id TEXT NOT NULL,
     operation TEXT NOT NULL,
     source_path TEXT,
     dest_path TEXT,
     metadata_json TEXT,
     performed_at DATETIME NOT NULL,
     undone BOOLEAN DEFAULT FALSE
   );
   CREATE INDEX idx_ops_batch ON operations(batch_id);
   ```
   - Every file deletion logged here
   - Files moved to FileNova trash (separate from OS trash) initially
   - Trash retention: configurable (default 30 days)

8. **Undo Support**
   - "Undo" button after any bulk delete
   - Restores files from FileNova trash back to original locations
   - Operations journal tracks batch_id for group undo

### Performance Targets
- Duplicate scan (100k files): <2 minutes
- Perceptual hash generation: ~100 images/second
- UI should remain responsive during scan (run in background thread)

### Integration Hook for Next Stage
**What Stage 5 needs from this stage:**
- **Operations Journal**: The undo system infrastructure will be expanded
- **Batch Operations Pattern**: The UI for reviewing and approving bulk actions
- **FileNova Trash**: Safe deletion mechanism that will be used for all AI-suggested moves
- **Background Job Pattern**: Long-running scans in separate threads with progress updates

**Stage 5 will build:** Content extraction from documents and PDFs, embedding generation, and vector database integration for semantic search.

---

## Stage 5: Content Extraction & Semantic Search

### Specific Task
Build a content extraction pipeline that reads text from PDFs and documents, generates embeddings, stores them in LanceDB, and enables natural language semantic search.

### Pre-requisites from Stage 4
- **Populated Database**: The `files` table with complete file metadata
- **Background Job Infrastructure**: Pattern for long-running tasks with progress reporting
- **Tantivy Search**: Keyword search already working (will be augmented with semantic search)
- **Settings System**: Can store user preferences (will add AI provider choice)

### Deliverables

1. **Content Extraction Pipeline** (Rust)
   - **PDF Text Extraction**:
     - Use `pdf-extract` or `poppler` Rust bindings
     - Extract all text content from PDFs
     - Handle multi-page documents, preserve some structure
   - **Document Text Extraction**:
     - `.txt`, `.md`: Direct file read
     - `.docx`: Use `docx-rs` crate
     - `.csv`: Read as text or parse with `csv` crate
     - Code files (`.rs`, `.py`, `.js`, etc.): Read full text
   - **Image Metadata**:
     - Extract EXIF data using `kamadak-exif` crate
     - Store location, camera model, date taken
     - Optional: AI-generated descriptions (batched, see below)

2. **Database Schema Updates**
   ```sql
   ALTER TABLE files ADD COLUMN extracted_text TEXT;
   ALTER TABLE files ADD COLUMN extraction_completed BOOLEAN DEFAULT FALSE;
   ALTER TABLE files ADD COLUMN extraction_error TEXT;
   
   -- Track which files have been embedded
   ALTER TABLE files ADD COLUMN embedding_generated BOOLEAN DEFAULT FALSE;
   ```

3. **AI Provider Configuration**
   - Add to `settings` table:
     - `ai_provider`: "local" (Ollama) or "cloud" (OpenAI)
     - `embedding_model`: "nomic-embed-text" (local) or "text-embedding-3-small" (cloud)
     - `ollama_url`: default "http://localhost:11434"
     - `openai_api_key`: encrypted storage
   - UI: Settings page with radio buttons for provider choice, API key input

4. **Embedding Generation**
   - **For Local (Ollama)**:
     - HTTP client to call Ollama API: `POST /api/embeddings`
     - Request body: `{"model": "nomic-embed-text", "prompt": "text content"}`
   - **For Cloud (OpenAI)**:
     - Use `async-openai` Rust crate
     - Call `embeddings.create()` with model `text-embedding-3-small`
   - **Chunking Strategy** for large files:
     - Split text into ~512 token chunks with 50 token overlap
     - Generate embedding for each chunk
     - Store chunk metadata (chunk_index, char_offset) alongside embedding
   - **Batch Processing**:
     - Process 100 files at a time
     - Rate limiting: respect API limits (3000 req/min for OpenAI)
     - Progress indicator: "Generating embeddings... 1,234 / 5,678 files"

5. **LanceDB Integration**
   - Install `lancedb` Rust crate
   - Create embedded database in app data directory
   - Schema:
     ```rust
     struct FileEmbedding {
       file_id: i64,           // Links to files.id
       chunk_index: i32,       // 0 for single chunk, 1,2,3... for split files
       text_content: String,   // The actual chunk text
       vector: Vec<f32>,       // Embedding (1536 dims for OpenAI, 768 for nomic)
       char_offset: i32,       // Where in original text this chunk starts
     }
     ```
   - Indexes: ANN index on `vector` column for fast similarity search

6. **Semantic Search Implementation**
   - **Query Flow**:
     1. User enters natural language query: "that presentation about Q3 revenue from last summer"
     2. Generate embedding for the query text
     3. LanceDB vector similarity search (cosine similarity)
     4. Returns top-k files/chunks with similarity scores
   - **Hybrid Search** (combining keyword + semantic):
     1. Tantivy keyword search → get results with scores
     2. LanceDB semantic search → get results with scores
     3. Normalize scores to 0-1 range
     4. Merge and re-rank: `final_score = 0.5 * keyword_score + 0.5 * semantic_score`
     5. Sort by final score, return top results

7. **Tauri Commands**:
   ```rust
   #[tauri::command] 
   fn start_content_extraction(file_ids: Vec<i64>) -> ()
   
   #[tauri::command] 
   fn get_extraction_status() -> ExtractionStatus
   
   #[tauri::command] 
   fn search_semantic(query: &str, limit: usize) -> Vec<SearchResult>
   
   #[tauri::command] 
   fn search_hybrid(query: &str, filters: SearchFilters) -> Vec<SearchResult>
   ```

8. **Search Results Display**
   - Show relevance score (0-100%)
   - Highlight which content matched (show text snippet with query terms highlighted)
   - Display source: "Keyword match" vs "Semantic match" vs "Hybrid"
   - Click result → open file and jump to matched section (if chunk data available)

9. **Background Processing**
   - After initial index complete (Stage 2), trigger content extraction automatically
   - Run in background thread, pausable/resumable
   - Handle failures gracefully: log error, skip file, continue

### Performance Targets
- Semantic search: <500ms for top-20 results (LanceDB ANN search is very fast)
- Content extraction: ~10 PDFs/second (varies by size)
- Embedding generation (local Ollama): ~50 files/second with batching
- Memory usage: <500MB for vector database with 100k files

### Integration Hook for Next Stage
**What Stage 6 needs from this stage:**
- **Extracted Text**: The `extracted_text` column is populated
- **LanceDB Infrastructure**: Vector database is set up and working
- **AI Provider Configuration**: The settings system for choosing local vs cloud AI
- **Background Processing Pattern**: Will be reused for AI tagging jobs

**Stage 6 will build:** AI-powered automatic tagging of files based on their content and an activity feed showing recent file changes.

---

## Stage 6: AI Tagging & Activity Tracking

### Specific Task
Implement AI-powered automatic tagging that analyzes file content and assigns meaningful tags, plus build an activity feed that tracks all file system changes.

### Pre-requisites from Stage 5
- **Extracted Content**: The `extracted_text` column contains text from PDFs/documents
- **AI Infrastructure**: Ollama or OpenAI client configured and working
- **Background Jobs**: Pattern for running long tasks with progress updates
- **Activity Table**: Already created in Stage 2, ready to be populated and queried

### Deliverables

1. **Tags Schema**
   ```sql
   CREATE TABLE tags (
     id INTEGER PRIMARY KEY,
     file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
     tag TEXT NOT NULL,
     source TEXT NOT NULL,  -- 'ai', 'user', 'rule'
     confidence REAL,        -- AI confidence 0-1
     created_at DATETIME NOT NULL
   );
   CREATE INDEX idx_tags_file ON tags(file_id);
   CREATE INDEX idx_tags_tag ON tags(tag);
   ```

2. **AI Tagging Pipeline**
   - **Analysis Prompt** sent to LLM:
     ```
     Analyze this file and suggest 2-5 relevant tags.
     
     Filename: {filename}
     File type: {extension}
     Content preview: {first_2000_chars}
     
     Examples of good tags:
     - invoice, receipt, tax-2024
     - vacation-photos, beach, summer-2024
     - python-code, machine-learning, project-xyz
     - resume, job-search, 2024
     
     Return ONLY a JSON array of tags: ["tag1", "tag2", "tag3"]
     ```
   - **For Local (Ollama)**:
     - Use `llama3` or `mistral` model
     - POST to `/api/generate` endpoint
   - **For Cloud**:
     - Use Claude API or OpenAI GPT-4o-mini (cheaper for bulk tagging)
   - **Batch Processing**:
     - Tag 50 files at a time
     - Rate limiting
     - Parse JSON response, validate tags
   - **Confidence Scoring**:
     - If AI provides confidence → store it
     - Otherwise: default to 0.7 for AI-generated tags

3. **Tag Storage**
   - Store each tag separately (normalized: lowercase, trim whitespace)
   - Track source: "ai" for AI-generated
   - Allow duplicates across files but not within a file (unique constraint on file_id + tag)

4. **User Tag Management**
   - UI to view tags on a file (in preview panel or file info popup)
   - Add/edit/delete tags manually
   - Manual tags have `source='user'` and `confidence=1.0`
   - Tag suggestions while typing (autocomplete from existing tags)

5. **Tag-Based Search & Filtering**
   - Search syntax: `tag:invoice` or `tag:"vacation photos"`
   - Multiple tags: `tag:invoice tag:2024`
   - Combine with other filters: `tag:python type:py modified:2024`
   - Update search UI to show tag chips as filter options

6. **Custom Tag Rules** (UI only, execution comes in Stage 8)
   - Rule creation UI in settings:
     - "If [file matches condition] → apply tag [X]"
     - Conditions: location pattern, file type, name pattern, age, size
     - Example: "Files in /Downloads matching *.pdf → tag as 'document'"
   - Store in `rules` table (from Stage 4):
     ```sql
     CREATE TABLE rules (
       id INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       condition_json TEXT NOT NULL,
       action_json TEXT NOT NULL,
       enabled BOOLEAN DEFAULT TRUE,
       trigger TEXT NOT NULL,
       schedule_cron TEXT,
       created_at DATETIME NOT NULL
     );
     ```

7. **Activity Feed Implementation**
   - The `activity` table is already being populated by file watcher (Stage 2)
   - **Activity Feed UI**:
     - New tab called "Activity"
     - Timeline view (grouped by day)
     - Each entry shows: icon, action, file name, time, path
     - Actions color-coded: green (created), blue (modified), orange (moved), red (deleted)
   - **Filters**:
     - Quick filters: "Today", "This Week", "This Month"
     - Filter by action type: created/modified/deleted/moved
     - Filter by folder: "Show only changes in Documents/"
     - Filter by file type: "Show only .pdf changes"
   - **Suspicious Activity Detection**:
     - Heuristic: if 100+ files modified in <1 minute → flag as suspicious
     - Display warning banner: "Unusual activity detected - possible ransomware?"
     - Allow user to investigate or dismiss

8. **Tauri Commands**:
   ```rust
   #[tauri::command] fn start_auto_tagging(file_ids: Vec<i64>) -> ()
   #[tauri::command] fn get_ai_tags(file_id: i64) -> Vec<Tag>
   #[tauri::command] fn add_user_tag(file_id: i64, tag: &str) -> Result<()>
   #[tauri::command] fn remove_tag(tag_id: i64) -> Result<()>
   #[tauri::command] fn get_activity_feed(filters: ActivityFilters) -> Vec<Activity>
   #[tauri::command] fn get_all_tags() -> Vec<String>  // For autocomplete
   ```

9. **Tag Visualization**
   - In file browser: show tag chips next to/below file name
   - Click tag → filter view to show all files with that tag
   - Tag cloud view in Dashboard: most common tags sized by frequency

### Performance Targets
- AI tagging: ~20 files/second with batching (depends on AI provider)
- Activity feed query: <100ms for 10,000 entries
- Tag autocomplete: <50ms

### Integration Hook for Next Stage
**What Stage 7 needs from this stage:**
- **Tags System**: AI can analyze content and assign labels (will be used for organization suggestions)
- **Activity Data**: Historical file operations tracked (will inform AI about user patterns)
- **Rules Table**: Structure for storing automation rules (will be expanded)
- **Tag Search**: The ability to find files by semantic categories

**Stage 7 will build:** The core AI Organization Engine that analyzes folder structures, detects clutter, and suggests reorganizations.

---

## Stage 7: AI Organization Engine - Core

### Specific Task
Build the AI-powered suggestion system that analyzes folder structures, detects disorganization, and proposes reorganization plans with full preview and approval workflow.

### Pre-requisites from Stage 6
- **Complete File Index**: All files, metadata, content extracted, and tagged
- **Tags System**: AI can understand what files are about via tags and content
- **Activity Data**: Historical file operations to learn user patterns
- **Rules Infrastructure**: The `rules` table exists (will be expanded)
- **Operations Journal**: From Stage 4, will be expanded for all move/rename operations

### Deliverables

1. **Suggestions Schema**
   ```sql
   CREATE TABLE suggestions (
     id INTEGER PRIMARY KEY,
     category TEXT NOT NULL,  -- 'declutter', 'consolidate', 'rename', 'archive', 'sort'
     title TEXT NOT NULL,
     description TEXT NOT NULL,
     plan_json TEXT NOT NULL,  -- Detailed move/rename plan
     file_count INTEGER NOT NULL,
     confidence REAL NOT NULL,  -- 0.0-1.0
     status TEXT DEFAULT 'pending',  -- 'pending', 'accepted', 'rejected', 'modified'
     created_at DATETIME NOT NULL,
     resolved_at DATETIME
   );
   ```

2. **Suggestion Generation Engine** (Rust)
   - **Analysis Heuristics**:
     - **Declutter Detection**:
       - Files in Downloads folder older than 30 days
       - Folders with 50+ files in root (no subfolders)
       - Desktop with 20+ files
       - Temp folders with old files
     - **Consolidation Detection**:
       - Same file type scattered across 4+ folders (e.g., 50 PDFs in 8 different locations)
       - Similar-named files in different places (e.g., "Invoice_Jan.pdf" in Downloads, "Invoice_Feb.pdf" in Documents)
       - Files with same tag in different folders
     - **Naming Pattern Detection**:
       - Inconsistent naming in same folder (e.g., "IMG_1234.jpg", "Photo-May-15.jpg", "vacation pic.jpg")
       - Detect pattern from user's existing organized folders
     - **Archive Suggestions**:
       - Project folders not accessed in 6+ months
       - Large folders (>10GB) with old content
     - **Sorting Opportunities**:
       - Flat folders with 100+ files that could be organized by date/type/tag

3. **AI-Enhanced Analysis** (for complex suggestions)
   - **Prompt to LLM**:
     ```
     Analyze these file groups and suggest organization:
     
     Files: [{list of 50 files with name, path, tags, dates}]
     
     Current state: All in /Downloads folder
     User's existing structure: /Documents/Invoices/2024/, /Documents/Receipts/
     
     Suggest:
     1. What category these files belong to
     2. Where they should be moved
     3. Any naming improvements
     4. Confidence level (0-1)
     
     Return JSON:
     {
       "suggestion": "Move 23 PDF invoices to Documents/Invoices/2024",
       "reasoning": "These are all invoices based on content analysis...",
       "plan": [
         {"file": "/Downloads/invoice_jan.pdf", "move_to": "/Documents/Invoices/2024/invoice_jan.pdf"},
         ...
       ],
       "confidence": 0.85
     }
     ```

4. **Suggestion Card UI**
   - New "Organize" tab with list of suggestion cards
   - **Each card shows**:
     - Category icon/badge (declutter/consolidate/rename/archive/sort)
     - Title: "Move 23 invoice PDFs to organized structure"
     - Description: "These are all PDF invoices from 2024, currently scattered across 4 folders"
     - File count & total size affected
     - Confidence score as colored badge (high/medium/low)
     - Before/After preview (toggle button)
     - Actions: [Accept] [Reject] [Modify]
   - **Preview Mode**:
     - Side-by-side view or tree view
     - Left: Current locations (highlighted in red)
     - Right: Proposed locations (highlighted in green)
     - Can expand folders to see file lists

5. **Suggestion Modification UI**
   - Click "Modify" → opens editor
   - Can drag files between source and destination
   - Can edit destination paths
   - Can remove files from the plan
   - "Save Changes" updates the `plan_json`

6. **Folder Structure Optimizer**
   - Special suggestion type: "Optimize Documents folder structure"
   - **Analysis**:
     - Count files by type/tag in folder and all subfolders
     - Detect clutter (flat organization of 100+ files)
     - Detect redundant nesting (folders with only 1 subfolder)
   - **AI Proposal**:
     - Sends current structure to LLM with user's file distribution
     - LLM proposes ideal hierarchy
   - **UI**:
     - Tree view of current structure
     - Tree view of proposed structure
     - Drag-and-drop to adjust before accepting
     - Handles conflicts: "What if two files would have same name?"
     - Shows detailed move plan (can review line-by-line)
     - "Dry Run" mode: shows exactly what would happen without doing it

7. **Suggestion Execution**
   - When user clicks "Accept":
     1. Validate all target paths exist (create directories if needed)
     2. Check for naming conflicts → prompt user to resolve
     3. Generate `batch_id` for this operation
     4. For each file in plan:
        - Move file to new location
        - Log to `operations` table with batch_id
        - Update `files` table (path, parent_path)
        - Update Tantivy index
     5. Mark suggestion as `status='accepted'`
     6. Show success notification with "Undo" button

8. **Tauri Commands**:
   ```rust
   #[tauri::command] fn generate_suggestions() -> Vec<Suggestion>
   #[tauri::command] fn get_pending_suggestions() -> Vec<Suggestion>
   #[tauri::command] fn accept_suggestion(id: i64) -> Result<BatchId>
   #[tauri::command] fn reject_suggestion(id: i64) -> ()
   #[tauri::command] fn modify_suggestion(id: i64, updated_plan: String) -> ()
   #[tauri::command] fn get_folder_structure_analysis(path: &str) -> StructureAnalysis
   ```

9. **Background Suggestion Generation**
   - Run analysis every 24 hours automatically
   - After new files added (detected via file watcher), trigger lightweight analysis
   - Queue suggestions, don't spam user (max 5 pending at a time)
   - Order by confidence score descending

### Performance Targets
- Suggestion generation: <5 seconds for 100k file corpus
- Preview rendering: <200ms for structure with 1000 files
- Execution: <1 second per 100 files moved

### Integration Hook for Next Stage
**What Stage 8 needs from this stage:**
- **Suggestion Infrastructure**: The suggestion generation, preview, and execution pipeline
- **Operations Journal**: Fully functional undo system for all file operations
- **Batch Operations**: Pattern for executing multi-file operations safely
- **Preview UI Pattern**: The before/after preview component

**Stage 8 will build:** Advanced organization features including AI-powered batch rename, automated rules engine, and enhanced undo/redo.

---

## Stage 8: AI Organization Engine - Advanced

### Specific Task
Implement AI-powered batch rename, build the rules automation engine, and create a comprehensive undo/redo system with FileNova trash management.

### Pre-requisites from Stage 7
- **Suggestions System**: Can generate and execute organization plans
- **Operations Journal**: Tracks all file operations with batch_id
- **Preview UI**: Pattern for showing before/after of operations
- **Rules Table**: Schema exists, ready to be made functional

### Deliverables

1. **AI-Powered Batch Rename**
   - **Selection Interface**:
     - In file browser: multi-select files (Ctrl+Click, Shift+Click, or Select All)
     - Right-click → "Smart Rename" or toolbar button
   - **AI Pattern Detection**:
     - Analyze selected files' current names
     - Detect existing patterns (e.g., IMG_1234.jpg, IMG_1235.jpg)
     - Extract metadata: dates from EXIF, content from tags
     - **Prompt to LLM**:
       ```
       Files to rename:
       - IMG_1234.jpg (taken: 2024-03-15, tags: beach, vacation)
       - IMG_1235.jpg (taken: 2024-03-15, tags: beach, vacation)
       - IMG_1236.jpg (taken: 2024-03-16, tags: sunset, vacation)
       
       Current location: /Photos/Summer 2024/
       
       Suggest a consistent, descriptive naming pattern.
       Include: date, location/event, sequence number.
       
       Return JSON with pattern template and examples:
       {
         "pattern": "{YYYY-MM-DD}_{event}_{sequence}",
         "examples": [
           {"old": "IMG_1234.jpg", "new": "2024-03-15_beach_01.jpg"},
           ...
         ]
       }
       ```
   - **Pattern Templates**:
     - User can choose or modify: `{date}_{description}_{sequence}`
     - Available tokens: `{YYYY}`, `{MM}`, `{DD}`, `{filename}`, `{tag}`, `{counter}`, `{ext}`
     - Live preview: shows all renames before applying
   - **Rename Execution**:
     - Validate: check for conflicts, ensure no duplicates
     - Execute batch with same batch_id
     - Log to operations journal
     - Update database and indexes
     - Undo support

2. **Rules Engine - Execution**
   - **Rule Structure** (already defined in `rules` table):
     ```json
     {
       "name": "Organize Screenshots",
       "condition": {
         "type": "and",
         "rules": [
           {"field": "name", "operator": "matches", "value": "Screenshot*.png"},
           {"field": "location", "operator": "equals", "value": "/Desktop"}
         ]
       },
       "action": {
         "type": "move",
         "destination": "/Pictures/Screenshots/{YYYY-MM}/",
         "create_folders": true
       }
     }
     ```
   - **Rule Types**:
     - **Move**: Move files to destination (with path templates)
     - **Rename**: Apply naming pattern
     - **Tag**: Add tag to matching files
     - **Archive**: Compress to .zip and move
   - **Triggers**:
     - `manual`: User runs rule on-demand
     - `event`: Trigger when file created/modified (via file watcher)
     - `schedule`: Cron-based (e.g., "daily at 2am")
   - **Rule Builder UI**:
     - Visual no-code interface
     - Condition builder: drag-and-drop logical operators (AND/OR)
     - Field dropdowns: name, extension, size, date, location, tag
     - Operator dropdowns: equals, contains, matches (regex), >, <, =
     - Action selector with parameters
     - "Test Rule" button: shows which files would match (dry run)
     - Enable/disable toggle

3. **Rule Execution Engine** (Rust)
   - **Event-Triggered Rules**:
     - File watcher detects new file → check if any rules match
     - Evaluate conditions against file metadata
     - If match: queue action (don't execute immediately, batch)
     - Every 5 seconds: execute queued actions
   - **Scheduled Rules**:
     - Use `tokio-cron-scheduler` crate
     - Parse cron expression, schedule job
     - At trigger time: query database for matching files, execute actions
   - **Manual Rules**:
     - User clicks "Run Rule" → immediate execution
     - Show progress: "Processing 234 files..."
     - Result summary: "Moved 234 files, 2 conflicts"

4. **AI-Suggested Rules**
   - Monitor user's manual organization actions (from operations journal)
   - Detect patterns:
     - "User moved 10 screenshots from Desktop to /Pictures/Screenshots/"
     - "User renamed 5 vacation photos with YYYY-MM-DD pattern"
   - **After 3+ similar actions**:
     - Generate suggestion: "Create a rule to automatically move screenshots?"
     - Show suggested rule configuration
     - User can accept (creates rule) or reject

5. **Enhanced Undo/Redo System**
   - **Operations Journal Enhancements**:
     ```sql
     -- Add undo data
     ALTER TABLE operations ADD COLUMN undo_data_json TEXT;
     -- For moves: stores old location
     -- For renames: stores old name
     -- For deletes: stores file hash (to restore from trash)
     ```
   - **Undo Stack UI**:
     - Accessible from toolbar: "Undo" dropdown
     - Shows last 20 operations with descriptions:
       - "Tuesday 3pm: Moved 23 files from Downloads → Invoices"
       - "Monday 10am: Renamed 15 photos"
     - Can undo individual batches or undo last N operations
   - **Redo Support**:
     - If user undoes → operation marked `undone=TRUE`
     - "Redo" button appears → re-executes the operation
     - Redo stack clears if new operations performed

6. **FileNova Trash System**
   - **Separate from OS Trash**:
     - Location: App data directory `/filenova-trash/`
     - Structure: Preserve path hierarchy for easy restoration
   - **When files deleted**:
     1. Move to FileNova trash (not OS recycle bin)
     2. Store metadata: original path, deleted date, batch_id
     3. Update database: mark `is_deleted=TRUE` (don't remove from index)
   - **Trash Management UI**:
     - "Trash" view showing deleted files
     - Can restore individual files or entire batches
     - Automatic cleanup: files older than 30 days permanently deleted
     - Manual "Empty Trash" button
   - **Permanent Delete**:
     - After 30 days (configurable) or manual empty
     - Actually delete file from disk
     - Remove from database

7. **Conflict Resolution**
   - When move/rename would create conflict:
     - Pause operation
     - Show dialog: "File exists at destination: /Documents/report.pdf"
     - Options:
       - "Skip this file"
       - "Rename to report (1).pdf"
       - "Overwrite" (with warning)
       - "Apply to all conflicts" checkbox
   - For batch operations: queue conflicts, resolve all at once

8. **Tauri Commands**:
   ```rust
   #[tauri::command] fn batch_rename(
     file_ids: Vec<i64>,
     pattern: &str
   ) -> Result<Vec<RenamePreview>>
   
   #[tauri::command] fn execute_batch_rename(
     renames: Vec<RenameOperation>
   ) -> Result<BatchId>
   
   #[tauri::command] fn create_rule(rule: RuleConfig) -> Result<i64>
   #[tauri::command] fn update_rule(id: i64, rule: RuleConfig) -> Result<()>
   #[tauri::command] fn delete_rule(id: i64) -> Result<()>
   #[tauri::command] fn run_rule(id: i64, dry_run: bool) -> RuleResult
   #[tauri::command] fn get_rules() -> Vec<Rule>
   
   #[tauri::command] fn undo_operation(batch_id: &str) -> Result<()>
   #[tauri::command] fn redo_operation(batch_id: &str) -> Result<()>
   #[tauri::command] fn get_operation_history() -> Vec<Operation>
   
   #[tauri::command] fn get_trash_contents() -> Vec<FileEntry>
   #[tauri::command] fn restore_from_trash(file_ids: Vec<i64>) -> Result<()>
   #[tauri::command] fn empty_trash() -> Result<()>
   ```

### Performance Targets
- Batch rename (1000 files): <3 seconds
- Rule evaluation per file: <1ms
- Undo operation: <2 seconds for batch of 1000 files

### Integration Hook for Next Stage
**What Stage 9 needs from this stage:**
- **Rules Engine**: The automation infrastructure (will be extended for AI suggestions)
- **AI Pattern Recognition**: The system for detecting user behavior patterns
- **Batch Operations**: Fully tested move/rename/delete with undo
- **Conflict Resolution**: The UI patterns for handling edge cases

**Stage 9 will build:** Natural language chat interface for querying files and triggering actions, plus advanced rule automation with behavior learning.

---

## Stage 9: Chat Interface & Rule Automation

### Specific Task
Build a conversational AI chat interface that lets users query their filesystem in natural language and trigger organization actions, plus implement intelligent rule suggestions based on learned behavior patterns.

### Pre-requisites from Stage 8
- **Rules Engine**: Fully functional automation system
- **AI Infrastructure**: LLM integration (Ollama/Claude/OpenAI) working
- **Search Systems**: Keyword, semantic, and hybrid search operational
- **Operations System**: All file operations (move/rename/delete) with undo
- **Suggestions**: AI can generate and execute organization plans

### Deliverables

1. **Chat UI Component**
   - **New "Chat" Tab**:
     - Chat interface similar to ChatGPT
     - Message input at bottom, conversation history above
     - Auto-scroll to latest message
     - "Clear conversation" button
   - **Message Display**:
     - User messages: right-aligned, blue background
     - Assistant messages: left-aligned, gray background
     - File previews embedded in messages (thumbnails, metadata cards)
     - Action confirmations with [Undo] buttons
   - **Conversation Persistence**:
     ```sql
     CREATE TABLE chat_sessions (
       id INTEGER PRIMARY KEY,
       started_at DATETIME NOT NULL,
       last_message_at DATETIME NOT NULL
     );
     
     CREATE TABLE chat_messages (
       id INTEGER PRIMARY KEY,
       session_id INTEGER REFERENCES chat_sessions(id),
       role TEXT NOT NULL,  -- 'user', 'assistant'
       content TEXT NOT NULL,
       metadata_json TEXT,  -- File references, action results
       created_at DATETIME NOT NULL
     );
     ```
   - Sessions saved, can access conversation history

2. **Natural Language Query Understanding**
   - **Query Types**:
     - **Information queries**: "How much space are my video files taking up?"
     - **Search queries**: "Find all Python files that import pandas"
     - **Analysis queries**: "Which folders haven't been accessed in over a year?"
     - **Comparison queries**: "Compare the contents of these two folders"
     - **Action queries**: "Move all PDFs from last month to the archive"
   
3. **Query Processing Pipeline**
   - **Intent Classification** (LLM):
     ```
     Classify this user query:
     
     Query: "How much space are my video files using?"
     
     Intent categories:
     - search: Find specific files
     - analyze: Calculate statistics
     - compare: Compare folders/files
     - organize: Move/rename/delete files
     - question: General questions about filesystem
     
     Return JSON:
     {
       "intent": "analyze",
       "entities": {
         "file_type": "video",
         "metric": "storage_space"
       },
       "requires_confirmation": false
     }
     ```
   - **Query Execution**:
     - **For search**: Call appropriate search function (keyword/semantic/hybrid)
     - **For analyze**: Query database with SQL
     - **For organize**: Generate suggestion, ask for confirmation
   - **Response Generation** (LLM):
     - Include actual data: "Your video files use 234.5 GB across 1,234 files. The largest ones are..."
     - Offer next actions: "Would you like me to show the 10 largest videos, or organize them by date?"

4. **Actionable Responses**
   - **When action needed**:
     - Assistant: "I found 47 PDFs from last month in Downloads. Move them to Documents/Archive/2024-01?"
     - Show preview of files
     - Buttons: [Confirm] [Cancel] [Modify]
   - **After action executed**:
     - "✅ Moved 47 files to Documents/Archive/2024-01/"
     - [Undo] button
     - Log to operations journal
   - **Conversation context**:
     - Remember previous queries in session
     - "Show me the largest ones" → knows referring to video files from earlier

5. **Advanced Query Examples**
   - **Complex searches**:
     - "Find all Python files in my projects folder that were modified in the last week and import pandas or numpy"
     - Process: Semantic search for keywords + file type filter + date filter + content search
   - **Comparative analysis**:
     - "Compare ~/Projects/old-version with ~/Projects/new-version"
     - Show: files only in old, only in new, modified, unchanged
     - Visualize as side-by-side tree or table
   - **Trend analysis**:
     - "Show me how my storage usage has changed over the last 3 months"
     - Query activity log for file additions/deletions
     - Generate line chart

6. **Rule Suggestion from Behavior**
   - **Pattern Detection**:
     - Monitor operations journal for repeated manual actions
     - Example patterns:
       - User moves screenshots from Desktop to /Pictures/Screenshots/ 3+ times
       - User renames downloaded PDFs to YYYY-MM-DD_description format
       - User deletes files from /Temp/ older than 7 days
   - **Suggestion Generation**:
     - After detecting pattern: "I noticed you often move screenshots. Create an automatic rule?"
     - Show suggested rule configuration
     - User can accept, modify, or reject
   - **Learning Preferences**:
     - Track which suggestions accepted/rejected
     - Adjust confidence thresholds
     - Don't re-suggest rejected patterns

7. **Scheduled Rule Execution**
   - **Cron Scheduler**:
     - Use `tokio-cron-scheduler` crate in Rust
     - Parse cron expressions from rules table
     - Execute rules at scheduled times
   - **Rule Templates**:
     - "Daily cleanup": Remove files from Downloads older than 30 days
     - "Weekly archive": Move old project folders to archive
     - "Monthly report": Generate storage usage report
   - **Execution Logging**:
     ```sql
     CREATE TABLE rule_executions (
       id INTEGER PRIMARY KEY,
       rule_id INTEGER REFERENCES rules(id),
       executed_at DATETIME NOT NULL,
       files_affected INTEGER,
       success BOOLEAN,
       error_message TEXT
     );
     ```
   - View execution history per rule

8. **Tauri Commands**:
   ```rust
   #[tauri::command] fn chat_query(
     session_id: i64,
     message: &str
   ) -> ChatResponse
   
   #[tauri::command] fn get_chat_sessions() -> Vec<ChatSession>
   #[tauri::command] fn get_chat_messages(session_id: i64) -> Vec<ChatMessage>
   #[tauri::command] fn create_chat_session() -> i64
   
   #[tauri::command] fn suggest_rules_from_behavior() -> Vec<RuleSuggestion>
   #[tauri::command] fn accept_rule_suggestion(suggestion_id: i64) -> Result<i64>
   
   #[tauri::command] fn schedule_rule(
     rule_id: i64,
     cron_expression: &str
   ) -> Result<()>
   #[tauri::command] fn get_rule_execution_history(rule_id: i64) -> Vec<RuleExecution>
   ```

9. **Error Handling in Chat**
   - **Graceful failures**:
     - If query too complex: "I'm having trouble understanding. Could you rephrase?"
     - If no results: "I couldn't find any files matching that description."
     - If action fails: "I couldn't move those files because [reason]. Would you like to try something else?"
   - **Helpful suggestions**:
     - "Did you mean [alternative query]?"
     - "I can help you with: [list of capabilities]"

### Performance Targets
- Chat response latency: <3 seconds (including LLM call)
- Query execution: <1 second for database queries
- Rule execution: Background job, doesn't block UI

### Integration Hook for Next Stage
**What Stage 10 needs from this stage:**
- **Chat Interface**: The UI pattern for interactive assistants
- **Query System**: The ability to search and analyze filesystem via natural language
- **Automation**: Fully functional scheduled and event-driven rules
- **Behavior Learning**: Pattern detection system

**Stage 10 will build:** Rich file preview system, Quick Look functionality, command palette for power users, and workspace/bookmark management.

---

## Stage 10: File Preview & Power Features

### Specific Task
Implement comprehensive file preview system with Quick Look, build a VS Code-style command palette, and add power user features like bookmarks, workspaces, and advanced keyboard navigation.

### Pre-requisites from Stage 9
- **File Browser**: Core navigation and selection working
- **Database**: File metadata including paths, types, sizes
- **UI Components**: Preview panel exists in layout (togglable sidebar)
- **Keyboard Shortcuts**: Basic navigation (arrow keys, Enter, Backspace)

### Deliverables

1. **File Preview System**
   - **Preview Panel Component** (right sidebar):
     - Shows when a single file is selected
     - Toggleable with keyboard shortcut (Ctrl+P) or button
     - Responsive: collapses on small screens
   
2. **Preview Renderers by Type**:
   
   **Images** (`.jpg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg`):
   - Display full image (scaled to fit panel)
   - EXIF overlay (togglable):
     - Camera model, date taken, ISO, shutter speed, location
     - Use `kamadak-exif` crate
   - Basic info: dimensions (1920x1080), file size, color space
   
   **PDFs**:
   - Render first page as preview image
   - Use `pdf-render` or `poppler` via WASM
   - Show page count: "Page 1 of 47"
   - "Open Full PDF" button → launches external viewer or inline viewer
   
   **Markdown** (`.md`):
   - Render as HTML with syntax highlighting
   - Use `comrak` crate in Rust or `react-markdown` in frontend
   - Show preview and raw toggle
   
   **Code** (`.rs`, `.py`, `.js`, `.ts`, `.cpp`, `.java`, etc.):
   - Syntax highlighting via `Shiki` or `highlight.js`
   - Line numbers
   - Show file language and line count
   - "Copy to Clipboard" button
   
   **CSV/JSON**:
   - Formatted table view (first 100 rows)
   - Use `ag-grid` or custom table component
   - Column headers, sortable
   - Show row count: "Showing 100 of 10,000 rows"
   
   **Video** (`.mp4`, `.mov`, `.avi`, `.mkv`):
   - Video thumbnail (extract from first frame)
   - Duration, resolution, codec info via `ffprobe`
   - Basic HTML5 video player (play/pause, seek, volume)
   
   **Audio** (`.mp3`, `.wav`, `.flac`, `.m4a`):
   - Waveform visualization (use `wavesurfer.js` or similar)
   - ID3 tags: artist, album, title, year
   - Basic audio player controls
   
   **Text** (`.txt`, `.log`, `.cfg`, `.ini`):
   - Display as plain text with line numbers
   - Search within file (Ctrl+F in preview)
   - Syntax detection if possible (e.g., JSON in .txt file)
   
   **Office Docs** (`.docx`, `.xlsx`, `.pptx`):
   - Extract preview via external library or show metadata
   - "Open in Office" button
   - Future: inline viewer using WASM-based libraries
   
   **Archives** (`.zip`, `.tar`, `.gz`, `.7z`):
   - List contents (file tree)
   - Show compressed vs uncompressed size
   - "Extract" button
   
   **Unsupported Types**:
   - Show file icon, metadata only
   - "Open With..." button to launch external app

3. **Quick Look Feature** (macOS-style)
   - **Trigger**: Press `Space` key when file selected
   - **Modal Preview**:
     - Full-screen overlay (dark background, 80% opacity)
     - Large preview in center (uses same renderers as preview panel)
     - Navigation arrows: prev/next file in current folder
     - Close with `Space` or `Esc`
   - **Keyboard navigation**:
     - Arrow keys to navigate between files while in Quick Look
     - Enter to open file
   - **Performance**: Lazy-load previews (don't render until opened)

4. **Command Palette** (VS Code style)
   - **Trigger**: `Ctrl+K` or `Cmd+K` (macOS)
   - **UI**:
     - Centered modal overlay
     - Search input at top (autofocused)
     - Results list below (keyboard navigable)
     - Fuzzy matching on command names
   - **Command Categories**:
     - **Navigation**: "Go to Downloads", "Go to Documents", "Open Recent"
     - **Search**: "Search Files", "Search by Tag", "Find Duplicates"
     - **Actions**: "Run Rule", "Generate Suggestions", "New Folder"
     - **View**: "Toggle Preview Panel", "Switch to Grid View", "Toggle Dark Mode"
     - **Settings**: "Open Settings", "Manage Rules", "View Activity"
   - **Recent Commands**: Last 5 used commands shown first
   - **Pinned Commands**: User can pin favorites (star icon)
   - **Implementation**:
     - Use `cmdk` React component library
     - Register commands in a central registry
     - Each command has: id, label, icon, category, action function

5. **Bookmarks & Quick Access**
   - **Bookmarked Folders**:
     - Right-click folder → "Add to Bookmarks"
     - Shows in sidebar under "★ Quick Access"
     - Drag to reorder
     - Stored in `settings` table as JSON array
   - **Recent Files**:
     - Track last 20 accessed files in a `recent_files` table:
       ```sql
       CREATE TABLE recent_files (
         file_id INTEGER REFERENCES files(id),
         accessed_at DATETIME NOT NULL,
         PRIMARY KEY (file_id)
       );
       ```
     - "Recent" section in sidebar
     - Smart ranking: combine frequency + recency
       - Score = (access_count * 0.3) + (days_since_access * -0.7)
   - **Pinned Files**:
     - Pin important files (star icon in file browser)
     - Always show at top of folder view

6. **Workspaces**
   - **Concept**: Save the current state of open tabs and panel layout
   - **Workspace Structure**:
     ```json
     {
       "name": "Work Project X",
       "tabs": [
         {"path": "/Projects/X/src", "view_mode": "list"},
         {"path": "/Projects/X/docs", "view_mode": "grid"}
       ],
       "preview_panel_open": true,
       "active_tab_index": 0
     }
     ```
   - **UI**:
     - "Save Workspace" button → prompts for name
     - Workspace switcher in toolbar (dropdown)
     - "Load Workspace" → restores tabs and layout
   - **Storage**:
     ```sql
     CREATE TABLE workspaces (
       id INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       config_json TEXT NOT NULL,
       created_at DATETIME NOT NULL
     );
     ```

7. **Tab Management**
   - **Multiple Tabs**:
     - Tab bar below toolbar (like browser)
     - Each tab = a folder view
     - Can open folder in new tab (Ctrl+Click or right-click → "Open in New Tab")
   - **Tab Actions**:
     - Close tab (X button or Ctrl+W)
     - Pin tab (prevents accidental close)
     - Duplicate tab (right-click → "Duplicate")
   - **Tab Persistence**:
     - On app restart, restore last open tabs
     - Store in `settings` table: `last_open_tabs`

8. **Keyboard Shortcuts System**
   - **Configurable Shortcuts**:
     - Settings page: "Keyboard Shortcuts"
     - Table of all actions with current shortcut
     - Click to edit, type new shortcut
     - Conflict detection (warn if already used)
   - **Default Shortcuts**:
     - Navigation: `Arrow Keys`, `Enter`, `Backspace`
     - Search: `Ctrl+F` (in-page), `Ctrl+K` (global)
     - Views: `Ctrl+1` (Grid), `Ctrl+2` (List)
     - Preview: `Ctrl+P` (toggle panel), `Space` (Quick Look)
     - Tabs: `Ctrl+T` (new), `Ctrl+W` (close), `Ctrl+Tab` (next)
     - Selection: `Ctrl+A` (all), `Ctrl+Click` (multi), `Shift+Click` (range)
     - File ops: `Delete` (delete), `F2` (rename), `Ctrl+C/V` (copy/paste)
   - **Shortcuts Overlay**:
     - Press `?` to show keyboard shortcuts cheat sheet
     - Modal with categorized shortcuts

9. **Tauri Commands**:
   ```rust
   #[tauri::command] fn generate_file_preview(
     file_id: i64,
     preview_type: &str  // 'thumbnail', 'full', 'metadata'
   ) -> FilePreview
   
   #[tauri::command] fn extract_pdf_preview(path: &str, page: i32) -> Vec<u8>
   #[tauri::command] fn get_video_thumbnail(path: &str) -> Vec<u8>
   #[tauri::command] fn get_audio_waveform(path: &str) -> Vec<f32>
   
   #[tauri::command] fn get_bookmarks() -> Vec<Bookmark>
   #[tauri::command] fn add_bookmark(path: &str) -> Result<()>
   #[tauri::command] fn remove_bookmark(path: &str) -> Result<()>
   
   #[tauri::command] fn get_recent_files(limit: usize) -> Vec<FileEntry>
   #[tauri::command] fn record_file_access(file_id: i64) -> ()
   
   #[tauri::command] fn save_workspace(name: &str, config: &str) -> Result<i64>
   #[tauri::command] fn load_workspace(id: i64) -> WorkspaceConfig
   #[tauri::command] fn get_workspaces() -> Vec<Workspace>
   ```

### Performance Targets
- Preview generation: <200ms for images, <500ms for PDFs
- Quick Look open: <100ms
- Command palette: <50ms to open, fuzzy search <20ms
- Workspace switch: <300ms

### Integration Hook for Next Stage
**What Stage 11 needs from this stage:**
- **Complete UI**: All major features implemented and working
- **Preview System**: Will need polish for edge cases
- **Keyboard Shortcuts**: System in place for customization
- **Performance Baseline**: Current metrics to optimize against

**Stage 11 will build:** Final polish including themes, performance optimization, comprehensive error handling, and production readiness.

---

## Stage 11: Polish & Production Readiness

### Specific Task
Apply final polish to the application with themes, comprehensive error handling, performance optimizations, edge case handling, and create a smooth onboarding experience for new users.

### Pre-requisites from Stage 10
- **Complete Feature Set**: All core features (browser, search, AI, organization, preview) implemented
- **UI Components**: All major views and interfaces built
- **Database**: Schema finalized with all tables
- **Performance Baseline**: Current metrics for loading, search, and operations

### Deliverables

1. **Theme System**
   
   **Theme Infrastructure**:
   - CSS variables for all colors, spacing, borders
   - Theme files: `dark.css`, `light.css`
   - System theme detection: `window.matchMedia('(prefers-color-scheme: dark)')`
   
   **Dark Mode**:
   - Background: `#1a1a1a`, `#2a2a2a`, `#3a3a3a` (layered)
   - Text: `#e0e0e0`, `#b0b0b0` (primary, secondary)
   - Accents: Blue `#3b82f6`, Green `#10b981`, Red `#ef4444`
   - Syntax highlighting: Appropriate dark theme colors
   
   **Light Mode**:
   - Background: `#ffffff`, `#f5f5f5`, `#e0e0e0`
   - Text: `#1a1a1a`, `#4a4a4a`
   - Same accent colors (adjusted for contrast)
   
   **Theme Switcher**:
   - Settings page: "Theme" dropdown (Light / Dark / System)
   - Store preference in `settings` table
   - Apply immediately without reload
   - Persist across sessions

2. **Customization Options**
   
   **Sidebar Customization**:
   - Drag sections to reorder (Bookmarks, Drives, Recent)
   - Toggle visibility of sections
   - Resizable sidebar width (drag divider)
   - Collapse/expand sidebar
   
   **View Defaults**:
   - Set default view per folder: Grid or List
   - Store in `folder_preferences` table:
     ```sql
     CREATE TABLE folder_preferences (
       path TEXT PRIMARY KEY,
       view_mode TEXT,
       sort_column TEXT,
       sort_direction TEXT
     );
     ```
   - Remember column widths in list view
   - Remember icon size in grid view
   
   **Appearance Settings**:
   - Font size: Small / Medium / Large
   - Compact mode: Reduced padding, smaller icons
   - Show/hide file extensions
   - Show/hide hidden files (toggle)
   - Date format: Relative ("2 days ago") vs Absolute ("Feb 5, 2024")

3. **Performance Optimizations**
   
   **Initial Load Optimization**:
   - Lazy-load tabs: Don't populate all tabs on startup
   - Index loading: Load in background, show cached results immediately
   - Image thumbnails: Generate on-demand, cache aggressively
   - Target: <1 second to interactive
   
   **Virtual Scrolling Tuning**:
   - TanStack Virtual configuration:
     - Overscan: 5 items above/below viewport
     - Dynamic row heights for list view
     - Batch DOM updates
   - Target: Smooth 60fps scrolling for 100k+ files
   
   **Memory Management**:
   - Bounded caches: LRU eviction for thumbnails (max 500)
   - Unload unused tabs if >10 open
   - Periodic SQLite `VACUUM` (weekly)
   - Monitor with `window.performance.memory`
   - Target: <150MB idle, <500MB active
   
   **Database Optimization**:
   - Analyze query plans: Use `EXPLAIN QUERY PLAN`
   - Add missing indexes if slow queries found
   - Connection pooling (via `r2d2` crate)
   - Prepared statements for common queries
   - WAL mode for concurrent reads
   
   **Search Optimization**:
   - Tantivy: Tune commit strategy (batch writes)
   - LanceDB: Optimize ANN index parameters
   - Result caching: Cache last 10 search results
   - Debounce search input (300ms)

4. **Comprehensive Error Handling**
   
   **Permission Errors**:
   - Gracefully skip inaccessible files during indexing
   - Show notification: "Skipped 12 files due to permissions"
   - Log details for user to review
   - Don't crash or hang
   
   **Network Drives**:
   - Detect offline drives, show indicator
   - Timeout for unresponsive drives (5 seconds)
   - Option to pause indexing network drives
   - Retry logic with exponential backoff
   
   **Symlinks & Loops**:
   - Detect circular symlinks (max depth 50)
   - Skip after warning: "Symlink loop detected at [path]"
   - Track visited inodes to prevent cycles
   
   **Large Files**:
   - Don't attempt to hash files >5GB (configurable)
   - Don't extract text from files >100MB
   - Show warning: "File too large for preview"
   - Offer to open in external app
   
   **Corrupted Files**:
   - Handle invalid image/PDF/video files gracefully
   - Show error message in preview: "Unable to render preview"
   - Log error for debugging
   - Continue indexing other files
   
   **Index Corruption**:
   - On startup: integrity check (`PRAGMA integrity_check`)
   - If corrupt: Offer to rebuild index
   - Backup old index before rebuilding
   - Progress indicator during rebuild
   
   **Out of Disk Space**:
   - Check available space before operations
   - Warning if <1GB free
   - Block operations if <100MB free
   - Suggest cleanup (duplicates, trash)
   
   **AI Service Failures**:
   - Network timeout: 30 seconds
   - Retry with exponential backoff (3 attempts)
   - Fallback to local Ollama if cloud fails
   - User-friendly error: "AI service unavailable. Try again later?"
   - Queue operations for retry

5. **Edge Case Handling**
   
   **File Name Conflicts**:
   - During rename/move, detect conflicts
   - Auto-suggest: "file (1).txt", "file (2).txt"
   - User can choose: Skip, Rename, Overwrite
   
   **Very Long Paths** (>260 chars on Windows):
   - Use long path prefix `\\?\` on Windows
   - Truncate display paths in UI: "...folder/file.txt"
   - Full path in tooltip
   
   **Special Characters in Names**:
   - Validate file names before operations
   - Warn about problematic chars: `/ \ : * ? " < > |`
   - Auto-sanitize in suggestions
   
   **Empty Folders**:
   - Option to delete empty folders
   - "Find Empty Folders" command in analytics
   - Exclude from some visualizations
   
   **Rapid File Changes**:
   - File watcher: Batch events (100ms window)
   - Avoid thrashing database with rapid updates
   - Debounce UI updates

6. **Onboarding Flow**
   
   **First Launch Wizard**:
   - Welcome screen with app overview
   - Step 1: Select folders to index
     - Suggestions: Documents, Downloads, Desktop, Pictures
     - Warning about indexing whole drives
   - Step 2: Choose AI provider
     - Local (Ollama) vs Cloud (OpenAI/Claude)
     - Show pros/cons
   - Step 3: Initial settings
     - Theme preference
     - Default view mode
   - Start indexing with progress indicator
   
   **Feature Discovery**:
   - Tooltips on first use (dismissible)
   - "Tips" panel with keyboard shortcuts
   - "What's New" dialog on updates (optional)
   
   **Sample Data** (for demo):
   - Option to create sample folders/files
   - Demonstrates features (tags, organization, etc.)
   - "Try FileNova with sample data" button

7. **Application Packaging**
   
   **App Icon**:
   - Professional icon in multiple sizes
   - Formats: .ico (Windows), .icns (macOS), .png (Linux)
   - Branded, recognizable
   
   **Installer Configuration** (Tauri):
   - Windows: NSIS installer
     - Start menu shortcut
     - Desktop shortcut (optional)
     - File associations (optional: .filenova workspace files)
   - macOS: DMG with drag-to-Applications
     - Code signing (for distribution)
     - Notarization (Apple requirement)
   - Linux: .deb, .AppImage
     - Desktop entry file
     - Icon in application menu
   
   **Versioning**:
   - Semantic versioning: `1.0.0`
   - Auto-update check (Tauri updater)
   - Release notes display
   - User can opt-out of updates

8. **Logging & Diagnostics**
   
   **Application Logs**:
   - Use `log` crate (Rust) and `console` (frontend)
   - Levels: ERROR, WARN, INFO, DEBUG
   - Rotate logs daily, keep last 7 days
   - Location: App data directory `/logs/`
   
   **Error Reporting** (optional, privacy-conscious):
   - Crash reporter: capture stack trace
   - User consent before sending
   - Anonymize paths in reports
   - Use Sentry or similar service
   
   **Diagnostics Command**:
   - "Generate Diagnostic Report" in settings
   - Includes: version, OS, indexed file count, database size, error logs
   - Output as text file for support/debugging

9. **Final Testing Checklist**
   
   **Functional Testing**:
   - [ ] File browser: navigate, sort, filter
   - [ ] Search: keyword, semantic, hybrid
   - [ ] Duplicates: detect, preview, delete
   - [ ] AI suggestions: generate, accept, undo
   - [ ] Rules: create, test, execute
   - [ ] Chat: query, action, history
   - [ ] Preview: all file types
   - [ ] Themes: light, dark, system
   - [ ] Keyboard shortcuts: all work
   - [ ] Multi-tab, workspaces
   
   **Performance Testing**:
   - [ ] Index 100k files in <60 seconds
   - [ ] Search <100ms
   - [ ] Directory listing <50ms
   - [ ] App startup <1 second
   - [ ] Memory usage <150MB idle
   
   **Edge Case Testing**:
   - [ ] Permissions errors
   - [ ] Network drives offline
   - [ ] Symlink loops
   - [ ] Very long paths
   - [ ] Special characters in names
   - [ ] File conflicts
   - [ ] Corrupted files
   - [ ] Out of disk space
   
   **Cross-Platform Testing**:
   - [ ] Windows 10/11
   - [ ] macOS (Intel + Apple Silicon)
   - [ ] Linux (Ubuntu, Fedora)
   
   **Accessibility**:
   - [ ] Keyboard navigation complete
   - [ ] Screen reader labels (aria-label)
   - [ ] High contrast mode support
   - [ ] Focus indicators visible

10. **Documentation**
    
    **User Guide**:
    - Getting started
    - Feature walkthroughs (with screenshots)
    - Keyboard shortcuts reference
    - FAQ
    - Troubleshooting
    
    **Developer Docs** (if open source):
    - Architecture overview
    - Build instructions
    - Contribution guidelines
    - API reference for Tauri commands

### Performance Targets (Final)
- App startup: <1 second
- Directory listing: <50ms for 10k files
- Keyword search: <100ms
- Semantic search: <500ms
- Memory (idle): <150MB
- Memory (active): <500MB

### Integration Hook for Next Stage
**Stage 11 is the final stage.** The application is now production-ready.

**Optional Future Work** (if continuing):
- Cloud sync awareness (OneDrive, Dropbox detection)
- Multi-machine index syncing
- Plugin system for custom rules
- Mobile companion app
- Advanced features (AI-powered "Find Similar", version detection)

---

## Usage Instructions for Each Stage

To use these briefs effectively:

1. **Start a new chat session** for each stage
2. **Paste the entire stage brief** (including "Specific Task", "Pre-requisites", "Deliverables", etc.)
3. **The AI has full context** to execute without needing the master plan
4. **After completion**, the "Integration Hook" section tells you what to pass to the next stage
5. **Maintain continuity** by referencing completed stages when needed

Each brief is designed to be completely self-contained while maintaining logical progression through the project.