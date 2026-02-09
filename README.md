# FileNova

FileNova is a powerful, AI-driven file organization and search tool built with Tauri, Rust, and React. It helps you regain control over your digital chaos by providing intelligent organization suggestions, advanced search capabilities, and detailed storage analytics.

## 🚀 Features

### 🧠 AI Organization Engine
- **Intelligent Suggestions**: Analyzes your file content and metadata to suggest optimal folder structures and file locations.
- **Automated Rules**: Create custom rules for auto-tagging and moving files based on patterns and AI analysis.
- **Duplicate Detection**: Identifies duplicate files, including similar images using perceptual hashing.

### 🔍 Advanced Search
- **Full-Text Search**: Lightning-fast search across your documents using [Tantivy](https://github.com/quickwit-oss/tantivy).
- **Semantic Search**: Find files by meaning and context, not just keywords, powered by [LanceDB](https://lancedb.com/) and vector embeddings.
- **Content Indexing**: Automatically extracts and indexes text from PDFs, DOCX files, code, and more.
- **Tag-Based Filtering**: Filter results by auto-generated or manual tags.

### 📊 Deep Analytics
- **Storage Dashboard**: Visualize your disk usage with interactive charts and graphs.
- **File Type Analysis**: Understand what's taking up space on your drive.

### ⚡ Performance & Security
- **Rust Backend**: Built on a high-performance, memory-safe Rust core.
- **Local-First**: All processing happens on your machine. Your data never leaves your device unless you strictly enable cloud features.
- **Real-time Monitoring**: Automatically updates the index when files are changed, added, or deleted.

## 🛠️ Technology Stack

- **Frontend**: React, TypeScript, TailwindCSS, Zustand, Lucide React
- **Backend**: Rust, Tauri
- **Database**: SQLite (metadata), LanceDB (vectors), Tantivy (search index)

## 📦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16+)
- [Rust](https://www.rust-lang.org/) (latest stable)
- [VS Code](https://code.visualstudio.com/) (recommended)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/filenova.git
   cd filenova
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Run the application**
   ```bash
   npm run tauri dev
   ```
   This will start the frontend dev server and compile the Rust backend.
