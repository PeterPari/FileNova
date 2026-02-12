# FileNova User Guide

> **Version 1.0.0** — The AI-powered file organizer for Windows, macOS, and Linux.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Interface Overview](#2-interface-overview)
3. [File Browsing](#3-file-browsing)
4. [Tabs](#4-tabs)
5. [Search](#5-search)
6. [Semantic Search (AI)](#6-semantic-search-ai)
7. [Preview & Quick Look](#7-preview--quick-look)
8. [Bookmarks & Quick Access](#8-bookmarks--quick-access)
9. [Tags](#9-tags)
10. [Batch Rename](#10-batch-rename)
11. [Duplicate Finder](#11-duplicate-finder)
12. [AI Organization](#12-ai-organization)
13. [Smart Assistant (AI Chat)](#13-smart-assistant-ai-chat)
14. [Automation Rules](#14-automation-rules)
15. [Analytics Dashboard](#15-analytics-dashboard)
16. [Trash Manager](#16-trash-manager)
17. [Undo & Redo](#17-undo--redo)
18. [Activity Feed](#18-activity-feed)
19. [Workspaces](#19-workspaces)
20. [Settings](#20-settings)
21. [Command Palette](#21-command-palette)
22. [Keyboard Shortcuts](#22-keyboard-shortcuts)
23. [Diagnostics & Troubleshooting](#23-diagnostics--troubleshooting)
24. [FAQ](#24-faq)

---

## 1. Getting Started

### First Launch — Onboarding Wizard

When you open FileNova for the first time, a step-by-step wizard guides you through setup:

| Step | What to do |
|------|------------|
| **Welcome** | Read the overview, then click **Next**. |
| **Select Folders** | Check the folders you want FileNova to index (Documents, Downloads, Desktop, Pictures are suggested). Click **Add Custom Folder** for additional directories. |
| **Choose AI Provider** | Pick **Local (Ollama)** for full privacy, or **Cloud (OpenAI)** for faster results (requires an API key). |
| **Initial Settings** | Choose a theme (Light / Dark / System) and enable Compact Mode if you prefer a denser UI. |
| **Indexing** | FileNova scans your selected folders. This may take several minutes depending on file count. You can start using the app once it finishes. |

> **Tip:** Start with just Documents and Downloads. You can always add more folders later in **Settings → General**.

### System Requirements

- Windows 10+ / macOS 12+ / Linux (Ubuntu 20.04+)
- 4 GB RAM minimum (8 GB recommended)
- 200 MB disk space for the app, plus space for indexes
- (Optional) [Ollama](https://ollama.ai/) installed for local AI features

---

## 2. Interface Overview

```
┌─────────────────────────────────────────────────────────┐
│  Tab Bar                                    [Settings]  │
├──────────┬──────────────────────────────┬───────────────┤
│          │  Search Bar                  │               │
│          ├──────────────────────────────┤   Preview     │
│ Sidebar  │                              │   Panel       │
│          │  File Browser                │               │
│          │  (Grid or List view)         │               │
│          │                              │               │
├──────────┴──────────────────────────────┴───────────────┤
│  Status Bar                                             │
└─────────────────────────────────────────────────────────┘
```

- **Sidebar** (left) — Navigation: Drives, Quick Access, Dashboard, Duplicates, Activity, Smart Assistant, Organize, Rules, Trash.
- **Tab Bar** (top) — Open multiple directories in tabs, like a browser.
- **Search Bar** — Keyword and semantic search across all indexed files.
- **File Browser** (center) — Browse, select, and manage files.
- **Preview Panel** (right) — View file contents without opening them externally. Toggle with `Ctrl+P`.

---

## 3. File Browsing

### View Modes

| Mode | Shortcut | Best for |
|------|----------|----------|
| **Grid** | `Ctrl+1` | Photos, visual browsing |
| **List** | `Ctrl+2` | Detailed info, sorting large folders |

### Sorting & Filtering

Click column headers in List view or use the sort dropdown to sort by:

- **Name** (A–Z or Z–A)
- **Size** (smallest or largest first)
- **Date Modified** (newest or oldest first)
- **File Type** (extension)

### Selecting Files

| Action | How |
|--------|-----|
| Select one file | Click it |
| Add to selection | `Ctrl+Click` |
| Range select | `Shift+Click` |
| Select all | `Ctrl+A` |

### File Operations

Right-click a file (or selection) to open the **Context Menu**:

- **Open** — Launch in the default system app.
- **Rename** / **Smart Rename** — Standard or AI-assisted rename.
- **Delete** — Move to FileNova's trash (recoverable).
- **Pin / Unpin** — Keep a file at the top for easy access.

### Navigation

- `Enter` — Open the selected folder or file.
- `Backspace` — Go up one directory.
- `Arrow Keys` — Move the selection cursor.

### Large Directories

FileNova uses **virtual scrolling** for folders with hundreds of thousands of files. Only visible items are rendered, so scrolling stays smooth at 60 fps regardless of folder size.

---

## 4. Tabs

Browse multiple locations simultaneously, just like browser tabs.

| Action | Shortcut |
|--------|----------|
| New tab | `Ctrl+T` |
| Close tab | `Ctrl+W` |
| Next tab | `Ctrl+Tab` |
| Previous tab | `Ctrl+Shift+Tab` |

- **Pin a tab** — Right-click the tab and select Pin. Pinned tabs stay on the left and can't be accidentally closed.
- **Duplicate a tab** — Right-click → Duplicate.
- **Smart unloading** — When more than 10 tabs are open, distant tabs are unloaded from memory to save resources. They reload instantly when you switch back.

---

## 5. Search

### Keyword Search

Press `Ctrl+F` to focus the search bar. Start typing to search across all indexed files. Results appear within 300 ms, ranked by relevance score.

### Special Syntax

| Prefix | Example | What it does |
|--------|---------|--------------|
| `tag:` | `tag:invoice` | Filter results to files with a specific tag |

### Search Filters

Click the filter icon next to the search bar to narrow results by:

- **File type** (Documents, Images, Code, etc.)
- **Size range** (e.g., 1 MB – 100 MB)
- **Date range** (modified between two dates)
- **Location** (specific folder)

### Search History

When you focus the search bar, your recent searches appear for quick reuse.

---

## 6. Semantic Search (AI)

Go beyond filenames — search by **meaning and content**.

1. Click the **Semantic Search** option in the sidebar or Command Palette.
2. Type a natural-language query (e.g., *"meeting notes about the Q2 budget"*).
3. Results show matches from three sources:
   - **Semantic** — AI-matched by meaning (vector similarity)
   - **Keyword** — Traditional text match
   - **Hybrid** — Combined score of both

Each result shows a **relevance percentage** and a text snippet with highlighted matching terms. Click **Jump to Section** to open the file at the exact matching offset.

> **Requires:** Content extraction must have run on your indexed files (Settings → Indexing → Start Content Extraction), and an AI provider must be configured.

---

## 7. Preview & Quick Look

### Preview Panel

Toggle with `Ctrl+P`. The right-side panel shows a live preview of the selected file:

| File Type | What you see |
|-----------|-------------|
| **Text / Code** | Syntax-highlighted content |
| **Images** | Thumbnail + EXIF metadata (camera, date, ISO, aperture, focal length) |
| **Video / Audio** | Duration, audio waveform visualization |
| **PDF** | Page count and extracted text |
| **Archives** (.zip) | File tree with compressed/uncompressed sizes |
| **Documents** | Page count, line count |

- **Raw Mode** — Toggle to see the underlying file bytes.
- **Copy Content** — Copy the preview text to clipboard.
- Previews are cached (LRU, 500 items) for instant re-display.

### Quick Look

Press `Space` on any selected file to open a macOS-style overlay preview.

- Use `←` / `→` arrow keys to browse through files without closing the overlay.
- Press `Space` or `Escape` to dismiss.
- Click **Open Externally** to launch in the system default app.

---

## 8. Bookmarks & Quick Access

- **Add a bookmark** — Right-click a folder and select **Bookmark**, or drag it to the Bookmarks section in the sidebar.
- **Recent files** — The sidebar shows the last 10 files you accessed.
- **Pinned files** — Pin important files so they always appear at the top of the browser.
- **Reorder bookmarks** — Drag and drop bookmarks in the sidebar to change their order.

---

## 9. Tags

Tags let you categorize files for quick filtering and retrieval.

### Manual Tags

1. Select a file and open the Tag Manager (via context menu or sidebar).
2. Type a tag name and press Enter.
3. Manual tags appear in **green**.

### AI Auto-Tags

1. Select files and click **Auto Tag**.
2. FileNova's AI analyzes file content and applies relevant tags automatically.
3. AI tags appear in **blue** to distinguish them from manual ones.

### Searching by Tag

Type `tag:tagname` in the search bar to find all files with a specific tag. The search bar also suggests existing tags as you type.

---

## 10. Batch Rename

Rename multiple files at once using patterns.

1. Select multiple files, then choose **Batch Rename** from the context menu (or Command Palette).
2. Enter a **pattern** using tokens:
   - `{name}` — Original filename (without extension)
   - `{counter}` — Sequential number (001, 002, ...)
   - `{ext}` — File extension
   - Example: `Vacation_{counter}.{ext}` → `Vacation_001.jpg`, `Vacation_002.jpg`
3. **Live preview** shows old → new names as you type.
4. **Conflict detection** warns if two files would get the same name.
5. Use **Smart Detect** to let AI analyze your filenames and suggest an optimal pattern.

---

## 11. Duplicate Finder

Find and clean up duplicate files to reclaim disk space.

1. Open **Duplicates** from the sidebar.
2. Click **Start Scan**. FileNova detects duplicates using three methods:

| Method | How it works |
|--------|-------------|
| **Exact** | Byte-identical files (BLAKE3 hash comparison) |
| **Similar Images** | Perceptual hashing — finds visually similar photos even if resized or recompressed |
| **Smart** | AI-driven similarity analysis |

3. Review results grouped by duplicate cluster. Each group shows:
   - Number of copies and wasted space
   - File paths, sizes, and modification dates
4. Select which copies to **keep** and which to **delete**.
5. Use **Batch operations** to handle multiple groups at once.
6. Deleted duplicates go to trash and can be **undone** via Recent Batches.

---

## 12. AI Organization

Let FileNova's AI suggest a better folder structure.

1. Open **Organize** from the sidebar.
2. Click **Generate Suggestions** for the current directory.
3. Review **Suggestion Cards** showing proposed changes (file moves, folder restructuring).
4. **Accept** individual suggestions to apply them, or **Dismiss** to skip.
5. All accepted moves can be **undone** with a single click (batch undo).

### Folder Structure Optimizer

For deeper analysis, the Folder Structure Optimizer examines your entire directory tree and proposes a reorganized layout by grouping related files.

---

## 13. Smart Assistant (AI Chat)

A natural-language interface for managing your files.

1. Open **Smart Assistant** from the sidebar.
2. Ask questions or give commands in plain English:
   - *"Find all PDF invoices from 2025"*
   - *"How much space do my video files take?"*
   - *"Compare Documents and Downloads folders"*
   - *"Move all screenshots to a Screenshots folder"*
   - *"What are my largest files?"*

### Key Features

- **Multi-session** — Create separate chat sessions for different tasks.
- **Action confirmation** — Before any file operation, the assistant shows exactly what it plans to do and waits for your approval.
- **Undo** — Revert any action the assistant performed.
- **Folder comparison** — See files only in Folder A, only in Folder B, and common to both.

---

## 14. Automation Rules

Create rules to automatically organize files as they arrive.

1. Open **Rules** from the sidebar.
2. Click **New Rule** to open the visual Rule Builder.

### Conditions

Build conditions using logical operators (**And**, **Or**, **Not**) with nestable groups:

| Condition | Example |
|-----------|---------|
| `NameMatches` | `*.pdf` |
| `ExtensionEquals` | `jpg` |
| `SizeGreaterThan` | `10 MB` |
| `SizeLessThan` | `1 KB` |
| `ModifiedBefore` | `2025-01-01` |
| `ModifiedAfter` | `2024-06-15` |
| `PathContains` | `Downloads` |
| `HasTag` | `invoice` |

### Actions

| Action | What it does |
|--------|-------------|
| `Move` | Move matching files to a target folder |
| `Copy` | Copy to another location |
| `Rename` | Rename using a pattern |
| `Archive` | Compress into a zip file |
| `Delete` | Permanently delete |
| `Trash` | Move to FileNova trash |
| `AddTag` | Apply a tag to the file |

### Triggers

- **Manual** — Run a rule on demand.
- **Scheduled** — Set a cron schedule (e.g., daily at midnight).
- **Watch** — Automatically trigger when files change in watched folders.

### Safety

- **Dry Run** — Preview what the rule would do without making changes.
- **Conflict Resolution** — If a rule conflicts with another, an interactive modal lets you choose which takes priority.
- **AI Rule Suggestions** — FileNova analyzes your file patterns and suggests rules you might want.

---

## 15. Analytics Dashboard

Visualize your storage usage. Open **Dashboard** from the sidebar.

| Widget | What it shows |
|--------|--------------|
| **Storage Breakdown** | Pie chart of disk usage by file type (Documents, Images, Code, etc.) |
| **Folder Sizes** | Bar chart of your largest folders |
| **Treemap** | Interactive D3 treemap — click folders to drill down |
| **Largest Files** | Sortable table of the biggest files on disk |
| **Duplicate Summary** | Total duplicate groups and space wasted |
| **Tag Statistics** | Most-used tags with file counts |

Click any folder in the charts to navigate directly to it in the File Browser.

---

## 16. Trash Manager

FileNova maintains its own recoverable trash, independent of the system recycle bin.

1. Open **Trash** from the sidebar.
2. View deleted files with their original path, size, and deletion date.
3. Select files and click **Restore** to move them back to their original location.
4. Click **Empty Trash** to permanently delete all items (confirmation required).

### Retention

By default, trashed files are automatically cleaned up after **30 days**. Change this in **Settings → General → Trash Retention Days**.

---

## 17. Undo & Redo

Every file operation (move, rename, delete) is tracked and reversible.

- **Undo** — Revert the last operation or a specific batch.
- **Redo** — Re-apply a previously undone operation.
- **Bulk undo** — Undo the last N operations at once.
- View the full **operation history** with timestamps, operation type, and file counts.

---

## 18. Activity Feed

Monitor file changes in real time.

1. Open **Activity** from the sidebar.
2. The feed auto-refreshes every 5 seconds (toggle auto-refresh off if desired).
3. Filter events by:
   - **Time range**
   - **Action type** — Create, Modify, Delete, Rename (color-coded icons)
   - **Folder**
   - **File type**

---

## 19. Workspaces

Save and restore your working context.

1. Open the Workspace Manager (via Command Palette or sidebar).
2. Click **Save Workspace** — captures your current open tabs, paths, view modes, preview panel state, and active tab.
3. Later, click **Load Workspace** to restore everything exactly as it was.
4. Create multiple workspaces for different projects or tasks.

---

## 20. Settings

Open with `Ctrl+,` or the gear icon. Settings are organized into seven tabs:

### General

| Setting | Description |
|---------|-------------|
| **Indexed Directories** | Add/remove folders that FileNova watches and indexes. |
| **Trash Retention** | Days to keep trashed files (default: 30). |
| **Feature Discovery** | Reset first-use tooltips. |
| **Sample Data** | Generate demo files to explore features, or remove them. |
| **Software Updates** | Check for new versions (auto-updater). |
| **Crash Reporting** | Opt-in to send anonymous crash reports (no personal data). |

### Indexing

- Start or resume **file indexing**.
- Start **content extraction** (extracts text from PDFs, DOCX, etc. for search).
- View extraction statistics (files processed, extracted, failed, skipped).

### AI

| Setting | Description |
|---------|-------------|
| **Provider** | Ollama (local, free, private) or OpenAI (cloud, requires API key). |
| **Provider URL** | Ollama endpoint (default: `http://localhost:11434`). |
| **API Key** | Your OpenAI API key (cloud provider only). |
| **Model** | Embedding model name (default: `nomic-embed-text`). |
| **Test Connection** | Verify AI provider is reachable. |

### Appearance

| Setting | Options |
|---------|---------|
| **Theme** | Light, Dark, System |
| **Font Size** | Small, Medium, Large |
| **Compact Mode** | On / Off — tighter spacing for smaller screens |
| **Show File Extensions** | On / Off |
| **Show Hidden Files** | On / Off |
| **Date Format** | Relative ("2 days ago") or Absolute ("Feb 10, 2026") |
| **Sidebar Sections** | Toggle visibility of individual sidebar sections |

### Diagnostics

Generate a diagnostic report containing OS info, app version, indexed file count, database size, memory usage, and recent errors. Export the report as a text file for bug reporting.

### Rules

Embedded Rules Manager — create, edit, enable/disable, and delete automation rules (see [Automation Rules](#14-automation-rules)).

### Trash

Embedded Trash Manager (see [Trash Manager](#16-trash-manager)).

---

## 21. Command Palette

Press `Ctrl+K` to open a VS Code-style command launcher. Start typing to fuzzy-search across all available commands:

| Category | Commands |
|----------|----------|
| **Navigation** | File Browser, Search, Duplicate Finder, Analytics, Organize, Trash |
| **Search** | Files by Name, Semantic Search, Search by Tags |
| **Actions** | Scan for Duplicates, Generate Organization Suggestions, Show Recent Files, Show Bookmarks |
| **View** | Grid View, List View, Toggle Preview Panel |
| **Settings** | Open Settings, Toggle Dark Mode, Show Keyboard Shortcuts |

- **Pin commands** you use frequently for quick access.
- **Recent commands** are tracked automatically.

---

## 22. Keyboard Shortcuts

Press `?` to view the full shortcuts cheat sheet. All shortcuts are customizable in Settings.

### Navigation

| Action | Shortcut |
|--------|----------|
| Go to parent directory | `Backspace` |
| Open file/folder | `Enter` |
| Move selection | `Arrow Keys` |

### Search

| Action | Shortcut |
|--------|----------|
| Focus search | `Ctrl+F` |
| Command palette | `Ctrl+K` |

### Views

| Action | Shortcut |
|--------|----------|
| Grid view | `Ctrl+1` |
| List view | `Ctrl+2` |
| Toggle sidebar | `Ctrl+B` |
| Toggle preview | `Ctrl+P` |
| Quick Look | `Space` |

### Tabs

| Action | Shortcut |
|--------|----------|
| New tab | `Ctrl+T` |
| Close tab | `Ctrl+W` |
| Next tab | `Ctrl+Tab` |

### File Operations

| Action | Shortcut |
|--------|----------|
| Select all | `Ctrl+A` |
| Rename | `F2` |
| Delete | `Delete` |
| Copy | `Ctrl+C` |
| Paste | `Ctrl+V` |

### Customizing Shortcuts

1. Open Settings → press `?` to view shortcuts.
2. Click any shortcut to edit it.
3. Press the new key combination.
4. **Conflict detection** warns you if the combo is already in use.
5. Click **Reset to Defaults** to restore original shortcuts.

---

## 23. Diagnostics & Troubleshooting

### Generating a Diagnostic Report

1. Open **Settings → Diagnostics**.
2. Click **Generate Report**.
3. Review: app version, OS, indexed file count, database size, memory usage, recent errors.
4. Click **Export Report** to save as a text file for bug reporting.

### Log Files

FileNova writes structured logs to disk automatically:

| Platform | Log location |
|----------|-------------|
| **Windows** | `%LOCALAPPDATA%\com.pariz.file-nova-app\logs\` |
| **macOS** | `~/Library/Logs/com.pariz.file-nova-app/` |
| **Linux** | `~/.local/share/com.pariz.file-nova-app/logs/` |

Logs rotate when they reach 5 MB and all previous files are kept.

### Common Issues

#### App Feels Slow

1. Check memory usage in **Diagnostics**.
2. Close unused tabs (aim for under 10 open).
3. Enable Compact Mode to reduce UI complexity.
4. Re-index if the database has grown very large.

#### Search Results Incomplete

1. Verify indexing is complete: **Settings → Indexing**.
2. Run **Content Extraction** if semantic search returns no results.
3. Generate a diagnostic report to check database integrity.

#### AI Features Not Working

1. Confirm your AI provider is running: **Settings → AI → Test Connection**.
2. For Ollama: ensure the service is started (`ollama serve`).
3. For OpenAI: verify your API key is valid and has available credits.
4. Check that content extraction has been run (required for semantic search).

#### Theme Not Applying

1. Go to **Settings → Appearance** and manually select Light or Dark.
2. If using System mode, verify your OS theme setting.

#### Files Missing from Index

1. Confirm the folder is listed in **Settings → General → Indexed Directories**.
2. Click **Start Indexing** to trigger a re-scan.
3. Hidden files are excluded by default — enable **Show Hidden Files** in Appearance settings.

---

## 24. FAQ

**Q: Where does FileNova store my data?**
A: All data stays on your machine. The database, search index, and vector store are in your OS app data directory. No files are uploaded unless you explicitly enable a cloud AI provider.

**Q: Is my data sent to the cloud?**
A: Only if you choose a cloud AI provider (OpenAI). With Ollama (local), all processing happens on your machine. Crash reporting is opt-in and sends no personal data or file contents.

**Q: Can I index network drives?**
A: Yes, but performance depends on network speed. FileNova uses a 5-second timeout to prevent freezing if a drive becomes unavailable. Reconnection uses exponential backoff.

**Q: What happens if I delete files through FileNova?**
A: Deleted files go to FileNova's internal trash (not the system recycle bin). You can restore them within the retention period (default: 30 days).

**Q: How do I back up my FileNova configuration?**
A: Use the Workspace Manager to save your current setup. The app database is in your OS app data directory.

**Q: What file formats does content extraction support?**
A: PDF, DOCX, plain text, CSV, JSON, Markdown, and most programming language source files.

**Q: How do I update FileNova?**
A: Go to **Settings → General → Check for Updates**. If an update is available, you'll be prompted to download and install it.

**Q: Can I use FileNova with 1 million+ files?**
A: Yes. FileNova uses virtual scrolling, r2d2 connection pooling, prepared statement caching, and background indexing to handle very large collections efficiently.

**Q: How do I generate sample data to try features?**
A: Go to **Settings → General → Generate Sample Data**. This creates a demo folder with realistic files. Add that folder in Indexed Directories to explore all features.

---

*For developer documentation and build instructions, see [README.md](README.md) and [DevelopmentStages.md](docs/DevelopmentStages.md).*
