use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::env;
use log::info;
use tauri::AppHandle;

use crate::db;

#[derive(Debug, Serialize, Deserialize)]
pub struct SuggestedFolder {
    pub path: String,
    pub selected: bool,
    pub estimated_files: Option<u64>,
}

#[tauri::command]
pub fn get_suggested_folders() -> Vec<SuggestedFolder> {
    let mut folders = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(user_profile) = env::var("USERPROFILE") {
            let base = PathBuf::from(user_profile);
            
            folders.push(SuggestedFolder {
                path: base.join("Documents").to_string_lossy().to_string(),
                selected: true,
                estimated_files: None,
            });
            
            folders.push(SuggestedFolder {
                path: base.join("Downloads").to_string_lossy().to_string(),
                selected: true,
                estimated_files: None,
            });
            
            folders.push(SuggestedFolder {
                path: base.join("Desktop").to_string_lossy().to_string(),
                selected: false,
                estimated_files: None,
            });
            
            folders.push(SuggestedFolder {
                path: base.join("Pictures").to_string_lossy().to_string(),
                selected: false,
                estimated_files: None,
            });
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = env::var("HOME") {
            let base = PathBuf::from(home);
            
            folders.push(SuggestedFolder {
                path: base.join("Documents").to_string_lossy().to_string(),
                selected: true,
                estimated_files: None,
            });
            
            folders.push(SuggestedFolder {
                path: base.join("Downloads").to_string_lossy().to_string(),
                selected: true,
                estimated_files: None,
            });
            
            folders.push(SuggestedFolder {
                path: base.join("Desktop").to_string_lossy().to_string(),
                selected: false,
                estimated_files: None,
            });
            
            folders.push(SuggestedFolder {
                path: base.join("Pictures").to_string_lossy().to_string(),
                selected: false,
                estimated_files: None,
            });
        }
    }

    folders
}

#[tauri::command]
pub async fn select_folder_dialog() -> Result<String, String> {
    // This is a placeholder - actual implementation would use Tauri dialog plugin
    // The frontend should use the Tauri dialog API directly instead
    Err("Use frontend dialog API instead".to_string())
}

#[tauri::command]
pub async fn start_initial_indexing(
    app: AppHandle,
    folders: Vec<String>,
    ai_provider: String,
) -> Result<(), String> {
    info!("Starting initial indexing for folders: {:?}", folders);
    info!("Using AI provider: {}", ai_provider);

    let conn = db::get_conn(&app)?;

    let folders_json = serde_json::to_string(&folders)
        .map_err(|e| format!("Failed to serialize folder list: {}", e))?;

    db::save_setting(&conn, "indexed_paths", &folders_json)
        .map_err(|e| e.to_string())?;
    db::save_setting(&conn, "ai_provider", &ai_provider)
        .map_err(|e| e.to_string())?;
    db::save_setting(&conn, "onboarding_started", "true")
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub async fn set_onboarding_completed(app: AppHandle, completed: bool) -> Result<(), String> {
    info!("Onboarding completed: {}", completed);
    let conn = db::get_conn(&app)?;
    db::save_setting(
        &conn,
        "onboarding_completed",
        if completed { "true" } else { "false" },
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_onboarding_status(app: AppHandle) -> Result<bool, String> {
    let conn = db::get_conn(&app)?;
    let completed = db::get_setting(&conn, "onboarding_completed")
        .map_err(|e| e.to_string())?
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    Ok(completed)
}

// ─── Sample Data Generation ──────────────────────────────────────────────────

/// Information returned after generating sample data.
#[derive(Debug, Serialize, Deserialize)]
pub struct SampleDataResult {
    pub root_path: String,
    pub files_created: usize,
    pub folders_created: usize,
}

/// Create a realistic folder tree with sample files for demo / testing.
///
/// The tree is placed under `<Documents>/FileNova Sample Data/` and contains:
///   - Text documents, Markdown, JSON, CSV
///   - Simulated images (small PNGs with a single‑colour pixel)
///   - A few intentional "duplicates" (identical content, different names)
///   - A messy "Downloads" folder to trigger declutter suggestions
///   - Nested project folders to exercise semantic search & tagging
#[tauri::command]
pub fn generate_sample_data() -> Result<SampleDataResult, String> {
    let base = resolve_sample_root()?;

    if base.exists() {
        return Err(format!(
            "Sample data folder already exists: {}. Delete it first to regenerate.",
            base.display()
        ));
    }

    let mut files_created: usize = 0;
    let mut folders_created: usize = 0;

    // Helper closure: create a directory and count it.
    let mut mk = |p: &PathBuf| -> Result<(), String> {
        fs::create_dir_all(p).map_err(|e| format!("mkdir {}: {}", p.display(), e))?;
        folders_created += 1;
        Ok(())
    };

    // ── Folder skeleton ──────────────────────────────────────────────────

    let documents = base.join("Documents");
    let photos    = base.join("Photos");
    let photos_vacation = photos.join("Vacation 2025");
    let photos_family   = photos.join("Family");
    let projects  = base.join("Projects");
    let proj_web  = projects.join("website-redesign");
    let proj_data = projects.join("data-analysis");
    let downloads = base.join("Downloads");
    let music     = base.join("Music");
    let receipts  = base.join("Receipts");

    for d in [
        &base, &documents, &photos, &photos_vacation, &photos_family,
        &projects, &proj_web, &proj_data, &downloads, &music, &receipts,
    ] {
        mk(d)?;
    }

    // ── Helper: write a text file ────────────────────────────────────────
    let write = |path: &PathBuf, content: &str| -> Result<(), String> {
        let mut f = fs::File::create(path)
            .map_err(|e| format!("create {}: {}", path.display(), e))?;
        f.write_all(content.as_bytes())
            .map_err(|e| format!("write {}: {}", path.display(), e))?;
        Ok(())
    };

    // ── Documents ────────────────────────────────────────────────────────
    write(&documents.join("Meeting Notes.md"), "\
# Team Meeting — 2025-06-15\n\n\
## Attendees\n- Alice\n- Bob\n- Carol\n\n\
## Agenda\n1. Q2 review\n2. Product roadmap\n3. Hiring plan\n\n\
## Action Items\n- [ ] Alice: finalize budget\n- [ ] Bob: update roadmap deck\n")?;
    files_created += 1;

    write(&documents.join("README.txt"), "\
Welcome to FileNova Sample Data!\n\n\
This folder was auto-generated to showcase FileNova features.\n\
Feel free to browse, search, tag, and organize these files.\n")?;
    files_created += 1;

    write(&documents.join("Project Proposal.md"), "\
# Project Proposal: FileNova\n\n\
## Summary\nAn AI-powered file organizer for Windows / macOS / Linux.\n\n\
## Goals\n- Reduce digital clutter\n- Intelligent duplicate detection\n- Semantic search across documents\n\n\
## Timeline\n| Phase | Dates |\n|-------|-------|\n| Alpha | Jan 2025 |\n| Beta  | Apr 2025 |\n| GA    | Jul 2025 |\n")?;
    files_created += 1;

    write(&documents.join("contacts.csv"), "\
Name,Email,Phone,Department\n\
Alice Johnson,alice@example.com,555-0101,Engineering\n\
Bob Smith,bob@example.com,555-0102,Design\n\
Carol White,carol@example.com,555-0103,Marketing\n\
Dave Brown,dave@example.com,555-0104,Engineering\n\
Eve Davis,eve@example.com,555-0105,Sales\n")?;
    files_created += 1;

    write(&documents.join("report-2024.json"), r#"{
  "title": "Annual Report 2024",
  "revenue": 1250000,
  "expenses": 980000,
  "profit": 270000,
  "departments": ["Engineering", "Sales", "Marketing"],
  "headcount": 42
}"#)?;
    files_created += 1;

    write(&documents.join("todo.txt"), "\
- Buy groceries\n- Fix leaky faucet\n- Call dentist\n- Renew passport\n- Update resume\n")?;
    files_created += 1;

    // ── Photos (tiny 1×1 PNGs) ───────────────────────────────────────────
    // Minimal valid PNG: 1×1 pixel, different colours per "photo".
    let png_red   = make_1px_png(0xFF, 0x00, 0x00);
    let png_green = make_1px_png(0x00, 0xFF, 0x00);
    let png_blue  = make_1px_png(0x00, 0x00, 0xFF);
    let png_white = make_1px_png(0xFF, 0xFF, 0xFF);

    for (name, data) in [
        ("beach_sunset.png",   &png_red),
        ("mountain_view.png",  &png_green),
        ("hotel_lobby.png",    &png_blue),
    ] {
        fs::write(photos_vacation.join(name), data)
            .map_err(|e| format!("write photo: {}", e))?;
        files_created += 1;
    }

    for (name, data) in [
        ("birthday_party.png", &png_white),
        ("graduation.png",     &png_green),
    ] {
        fs::write(photos_family.join(name), data)
            .map_err(|e| format!("write photo: {}", e))?;
        files_created += 1;
    }

    // ── Projects ─────────────────────────────────────────────────────────
    write(&proj_web.join("index.html"), "\
<!DOCTYPE html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><title>Redesign</title></head>\n\
<body><h1>Website Redesign</h1><p>Coming soon.</p></body>\n</html>\n")?;
    files_created += 1;

    write(&proj_web.join("styles.css"), "\
body { font-family: sans-serif; margin: 2rem; color: #333; }\nh1 { color: #0066cc; }\n")?;
    files_created += 1;

    write(&proj_web.join("app.js"), "\
console.log('Hello from the redesign project');\ndocument.addEventListener('DOMContentLoaded', () => {\n  console.log('DOM ready');\n});\n")?;
    files_created += 1;

    write(&proj_data.join("analysis.py"), "\
import pandas as pd\nimport numpy as np\n\ndef load_data(path: str) -> pd.DataFrame:\n    return pd.read_csv(path)\n\ndef summarize(df: pd.DataFrame):\n    print(df.describe())\n    print(f'Rows: {len(df)}')\n\nif __name__ == '__main__':\n    df = load_data('sales.csv')\n    summarize(df)\n")?;
    files_created += 1;

    write(&proj_data.join("sales.csv"), "\
Date,Product,Quantity,Price\n\
2025-01-10,Widget A,50,12.99\n\
2025-01-11,Widget B,30,24.50\n\
2025-01-12,Widget A,45,12.99\n\
2025-01-13,Gadget X,10,99.00\n\
2025-02-01,Widget A,60,12.99\n\
2025-02-02,Widget B,25,24.50\n")?;
    files_created += 1;

    write(&proj_data.join("README.md"), "\
# Data Analysis Project\n\nSales data analysis for Q1 2025.\n\n## Usage\n```\npython analysis.py\n```\n")?;
    files_created += 1;

    // ── Downloads (intentionally messy) ──────────────────────────────────
    let messy_files = [
        ("setup_v2.1.exe.txt",       "Fake installer placeholder"),
        ("document (1).pdf.txt",     "Duplicate download placeholder"),
        ("document (2).pdf.txt",     "Duplicate download placeholder"),  // intentional duplicate content
        ("IMG_20250301_142356.png",  ""),  // will use png bytes
        ("screenshot_2025-03-15.png",""),
        ("invoice_march.pdf.txt",    "Invoice #1234 — March 2025 — $450.00"),
        ("notes_draft_FINAL_v3.txt", "This is the FINAL version (maybe).\nTODO: review section 3\n"),
        ("random_archive.zip.txt",   "Not a real zip — placeholder"),
        ("presentation.pptx.txt",    "Slide deck placeholder for Q2 planning"),
        ("budget_2025.xlsx.txt",     "Spreadsheet placeholder — budget data"),
    ];
    for (name, content) in messy_files {
        if name.ends_with(".png") {
            fs::write(downloads.join(name), &png_blue)
                .map_err(|e| format!("write dl: {}", e))?;
        } else {
            write(&downloads.join(name), content)?;
        }
        files_created += 1;
    }

    // ── Music (small text placeholders) ──────────────────────────────────
    for (i, title) in ["Morning Run", "Evening Jazz", "Focus Mode", "Chill Vibes"].iter().enumerate() {
        write(&music.join(format!("{:02} - {}.txt", i + 1, title)),
            &format!("Audio placeholder: {}\nDuration: {}:00\nArtist: Sample Artist\n", title, 3 + i))?;
        files_created += 1;
    }

    // ── Receipts ─────────────────────────────────────────────────────────
    for (month, amount) in [("January", "89.50"), ("February", "142.30"), ("March", "67.00")] {
        write(&receipts.join(format!("receipt_{}_2025.txt", month.to_lowercase())),
            &format!("Receipt — {} 2025\nAmount: ${}\nStore: Sample Mart\nItems: groceries, supplies\n", month, amount))?;
        files_created += 1;
    }

    Ok(SampleDataResult {
        root_path: base.to_string_lossy().to_string(),
        files_created,
        folders_created,
    })
}

/// Remove previously generated sample data.
#[tauri::command]
pub fn remove_sample_data() -> Result<(), String> {
    let base = resolve_sample_root()?;
    if !base.exists() {
        return Err("Sample data folder does not exist.".to_string());
    }
    fs::remove_dir_all(&base)
        .map_err(|e| format!("Failed to remove sample data: {}", e))?;
    Ok(())
}

// ── Internal helpers ─────────────────────────────────────────────────────────

fn resolve_sample_root() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        env::var("USERPROFILE")
            .map(|p| PathBuf::from(p).join("Documents").join("FileNova Sample Data"))
            .map_err(|_| "Cannot determine user profile directory".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        env::var("HOME")
            .map(|p| PathBuf::from(p).join("Documents").join("FileNova Sample Data"))
            .map_err(|_| "Cannot determine home directory".to_string())
    }
}

/// Produce a minimal valid 1×1 pixel PNG with the given RGB colour.
fn make_1px_png(r: u8, g: u8, b: u8) -> Vec<u8> {
    // PNG structure: signature + IHDR + IDAT + IEND
    let mut out = Vec::with_capacity(80);

    // Signature
    out.extend_from_slice(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);

    // IHDR chunk (13 bytes data)
    let ihdr_data: [u8; 13] = [
        0, 0, 0, 1, // width = 1
        0, 0, 0, 1, // height = 1
        8,          // bit depth
        2,          // colour type = RGB
        0,          // compression
        0,          // filter
        0,          // interlace
    ];
    write_png_chunk(&mut out, b"IHDR", &ihdr_data);

    // IDAT chunk — zlib-deflate of the raw scanline [filter_byte, R, G, B]
    // We use a stored (uncompressed) deflate block.
    let raw = [0u8, r, g, b]; // filter=None, then RGB
    let mut zlib = Vec::new();
    zlib.push(0x78); // CMF
    zlib.push(0x01); // FLG
    // Deflate stored block: BFINAL=1, BTYPE=00
    zlib.push(0x01);
    let len = raw.len() as u16;
    zlib.extend_from_slice(&len.to_le_bytes());
    zlib.extend_from_slice(&(!len).to_le_bytes());
    zlib.extend_from_slice(&raw);
    // Adler-32 of raw
    let adler = adler32(&raw);
    zlib.extend_from_slice(&adler.to_be_bytes());
    write_png_chunk(&mut out, b"IDAT", &zlib);

    // IEND
    write_png_chunk(&mut out, b"IEND", &[]);

    out
}

fn write_png_chunk(out: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
    let len = data.len() as u32;
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(chunk_type);
    out.extend_from_slice(data);
    let mut crc_input = Vec::with_capacity(4 + data.len());
    crc_input.extend_from_slice(chunk_type);
    crc_input.extend_from_slice(data);
    let crc = crc32(&crc_input);
    out.extend_from_slice(&crc.to_be_bytes());
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB8_8320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in data {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}
