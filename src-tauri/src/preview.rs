// Stage 10: File Preview System
use base64::{engine::general_purpose, Engine};
use crate::long_path::safe_path;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FilePreview {
    pub file_id: i64,
    pub preview_type: String,
    pub content: Option<String>,
    pub metadata: PreviewMetadata,
    pub thumbnail: Option<String>, // base64 encoded
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PreviewMetadata {
    pub file_type: String,
    pub size_bytes: u64,
    pub dimensions: Option<(u32, u32)>,
    pub duration: Option<f64>,
    pub page_count: Option<u32>,
    pub line_count: Option<usize>,
    pub encoding: Option<String>,
    pub exif: Option<ExifData>,
    pub waveform: Option<Vec<f32>>,
    pub archive_entries: Option<Vec<ArchiveEntry>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArchiveEntry {
    pub name: String,
    pub is_directory: bool,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExifData {
    pub camera_model: Option<String>,
    pub date_taken: Option<String>,
    pub iso: Option<u32>,
    pub shutter_speed: Option<String>,
    pub aperture: Option<String>,
    pub focal_length: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Bookmark {
    pub path: String,
    pub name: String,
    pub order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceConfig {
    pub id: i64,
    pub name: String,
    pub tabs: Vec<WorkspaceTab>,
    pub preview_panel_open: bool,
    pub active_tab_index: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceTab {
    pub path: String,
    pub view_mode: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Workspace {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

pub fn generate_file_preview(
    conn: &Connection,
    file_id: i64,
    preview_type: &str,
) -> Result<FilePreview, String> {
    // Get file info from database
    let mut stmt = conn
        .prepare_cached("SELECT path, extension, size_bytes FROM files WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let file_info: (String, Option<String>, i64) = stmt
        .query_row([file_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| e.to_string())?;

    let (path, extension, size_bytes) = file_info;
    let path_obj = Path::new(&path);

    if !path_obj.exists() {
        return Err(format!("File not found: {}", path));
    }

    let ext = extension.as_deref().unwrap_or("").to_lowercase();
    let mut metadata = PreviewMetadata {
        file_type: ext.clone(),
        size_bytes: size_bytes as u64,
        ..Default::default()
    };

    let (content, thumbnail) = match ext.as_str() {
        "txt" | "log" | "md" | "json" | "xml" | "csv" | "yaml" | "yml" | "toml" | "ini"
        | "cfg" => {
            // Text-based files
            let text = fs::read_to_string(safe_path(Path::new(&path))).unwrap_or_else(|_| {
                String::from("[Binary content or encoding error]")
            });
            metadata.line_count = Some(text.lines().count());
            metadata.encoding = Some(String::from("UTF-8"));

            let preview_text = if preview_type == "full" || text.len() < 50000 {
                text
            } else {
                // Limit to first 10000 characters for thumbnail
                text.chars().take(10000).collect::<String>() + "\n... (truncated)"
            };

            (Some(preview_text), None)
        }
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "svg" => {
            // Image files
            let thumbnail = generate_image_thumbnail(&path)?;
            metadata.dimensions = get_image_dimensions(&path);
            metadata.exif = extract_exif_data(&path);
            (None, Some(thumbnail))
        }
        "pdf" => {
            // PDF files — extract page count and text content
            metadata.page_count = get_pdf_page_count(&path);
            let text_content = extract_pdf_text(&path, 5000);
            match text_content {
                Ok(text) => {
                    metadata.line_count = Some(text.lines().count());
                    (Some(text), None)
                }
                Err(_) => {
                    (Some("[Could not extract PDF text]".to_string()), None)
                }
            }
        }
        "mp4" | "mov" | "avi" | "mkv" | "webm" => {
            // Video files
            metadata.duration = get_video_duration(&path);
            metadata.dimensions = get_video_dimensions(&path);
            match extract_video_thumbnail(&path) {
                Ok(thumb) => (None, Some(thumb)),
                Err(_) => {
                    // Fallback: return metadata-only preview (no thumbnail)
                    (Some(format!("Video: {}\nDuration: {}\nResolution: {}",
                        Path::new(&path).file_name().unwrap_or_default().to_string_lossy(),
                        metadata.duration.map(|d| {
                            let mins = (d / 60.0).floor() as u64;
                            let secs = (d % 60.0).floor() as u64;
                            format!("{}:{:02}", mins, secs)
                        }).unwrap_or_else(|| "Unknown".to_string()),
                        metadata.dimensions.map(|(w, h)| format!("{}x{}", w, h)).unwrap_or_else(|| "Unknown".to_string()),
                    )), None)
                }
            }
        }
        "mp3" | "wav" | "flac" | "m4a" | "ogg" | "aac" => {
            // Audio files
            metadata.duration = get_audio_duration(&path);
            metadata.waveform = get_audio_waveform(&path).ok().filter(|w| !w.is_empty());
            (None, None)
        }
        "zip" | "tar" | "gz" | "7z" | "rar" => {
            // Archive files
            match list_archive_contents(&path) {
                Ok((entries, summary)) => {
                    metadata.archive_entries = Some(entries);
                    (Some(summary), None)
                }
                Err(e) => {
                    (Some(format!("Could not read archive: {}", e)), None)
                }
            }
        }
        _ => {
            // Unsupported or binary files
            (Some(format!("Unsupported file type: {}", ext)), None)
        }
    };

    Ok(FilePreview {
        file_id,
        preview_type: preview_type.to_string(),
        content,
        metadata,
        thumbnail,
    })
}

fn generate_image_thumbnail(path: &str) -> Result<String, String> {
    // Read image and encode as base64
    let img_data = fs::read(safe_path(Path::new(path))).map_err(|e| e.to_string())?;

    // Use image crate to decode and resize if needed
    if let Ok(img) = image::load_from_memory(&img_data) {
        // Resize to max 800x800 for preview
        let thumbnail = img.thumbnail(800, 800);
        let mut buf = Vec::new();
        let mut cursor = std::io::Cursor::new(&mut buf);

        thumbnail
            .write_to(&mut cursor, image::ImageFormat::Jpeg)
            .map_err(|e| e.to_string())?;

        let encoded = general_purpose::STANDARD.encode(&buf);
        Ok(format!("data:image/jpeg;base64,{}", encoded))
    } else {
        // If can't decode, return original as base64
        let encoded = general_purpose::STANDARD.encode(&img_data);
        let mime = match Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
        {
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            _ => "image/jpeg",
        };
        Ok(format!("data:{};base64,{}", mime, encoded))
    }
}

fn get_image_dimensions(path: &str) -> Option<(u32, u32)> {
    if let Ok(img) = image::open(path) {
        Some((img.width(), img.height()))
    } else {
        None
    }
}

fn extract_exif_data(path: &str) -> Option<ExifData> {
    let file = std::fs::File::open(safe_path(Path::new(path))).ok()?;
    let mut bufreader = std::io::BufReader::new(&file);
    let exif_reader = exif::Reader::new();
    let exif = exif_reader.read_from_container(&mut bufreader).ok()?;

    let camera_model = exif.get_field(exif::Tag::Model, exif::In::PRIMARY)
        .map(|f| f.display_value().to_string());

    let date_taken = exif.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)
        .or_else(|| exif.get_field(exif::Tag::DateTime, exif::In::PRIMARY))
        .map(|f| f.display_value().to_string());

    let iso = exif.get_field(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY)
        .and_then(|f| match f.value {
            exif::Value::Short(ref v) => v.first().map(|&x| x as u32),
            exif::Value::Long(ref v) => v.first().copied(),
            _ => f.display_value().to_string().parse::<u32>().ok(),
        });

    let shutter_speed = exif.get_field(exif::Tag::ExposureTime, exif::In::PRIMARY)
        .map(|f| f.display_value().to_string());

    let aperture = exif.get_field(exif::Tag::FNumber, exif::In::PRIMARY)
        .map(|f| format!("f/{}", f.display_value()));

    let focal_length = exif.get_field(exif::Tag::FocalLength, exif::In::PRIMARY)
        .map(|f| f.display_value().to_string());

    // Only return if we got at least one field
    if camera_model.is_none() && date_taken.is_none() && iso.is_none()
        && shutter_speed.is_none() && aperture.is_none() && focal_length.is_none() {
        return None;
    }

    Some(ExifData {
        camera_model,
        date_taken,
        iso,
        shutter_speed,
        aperture,
        focal_length,
    })
}

/// Extract text from a specific page of a PDF (1-indexed). Returns the text bytes.
pub fn extract_pdf_preview(path: &str, page: i32) -> Result<Vec<u8>, String> {
    let file_bytes = std::fs::read(safe_path(Path::new(path))).map_err(|e| format!("Cannot read file: {}", e))?;
    let metadata = std::fs::metadata(safe_path(Path::new(path))).map_err(|e| e.to_string())?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("PDF too large (>50MB)".into());
    }

    // Extract full text first
    let full_text = pdf_extract::extract_text_from_mem(&file_bytes)
        .map_err(|e| format!("Failed to extract PDF text: {}", e))?;

    if full_text.trim().is_empty() {
        return Err("PDF contains no extractable text (scanned/image-only)".to_string());
    }

    // Get page count for validation
    let page_count = {
        let doc = lopdf::Document::load_mem(&file_bytes).map_err(|e| e.to_string())?;
        doc.get_pages().len() as i32
    };

    if page < 1 || page > page_count {
        return Err(format!("Page {} out of range (1-{})", page, page_count));
    }

    // Approximate page splitting by form-feed characters or proportional split
    let pages: Vec<&str> = full_text.split('\u{0C}').collect(); // form-feed
    if pages.len() >= page as usize {
        // Have form-feed page breaks
        let page_text = pages[(page - 1) as usize];
        Ok(page_text.as_bytes().to_vec())
    } else {
        // Fallback: proportional split
        let chars_per_page = full_text.len() / page_count.max(1) as usize;
        let start = (page as usize - 1) * chars_per_page;
        let end = (start + chars_per_page).min(full_text.len());
        Ok(full_text[start..end].as_bytes().to_vec())
    }
}

#[allow(dead_code)]
fn extract_pdf_thumbnail(_path: &str, _page: i32) -> Result<String, String> {
    // PDF pixel rendering requires a native library (poppler/mupdf/pdfium)
    // Text-based preview is provided via extract_pdf_text instead
    Err("PDF thumbnail rendering requires a native PDF library".to_string())
}

fn get_pdf_page_count(path: &str) -> Option<u32> {
    let bytes = std::fs::read(safe_path(Path::new(path))).ok()?;
    let doc = lopdf::Document::load_mem(&bytes).ok()?;
    Some(doc.get_pages().len() as u32)
}

/// Extract text from a PDF, truncated to max_chars
fn extract_pdf_text(path: &str, max_chars: usize) -> Result<String, String> {
    let metadata = std::fs::metadata(safe_path(Path::new(path))).map_err(|e| e.to_string())?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("PDF too large (>50MB)".into());
    }
    let bytes = std::fs::read(safe_path(Path::new(path))).map_err(|e| e.to_string())?;
    let text = pdf_extract::extract_text_from_mem(&bytes).map_err(|e| e.to_string())?;
    if text.trim().is_empty() {
        return Err("PDF contains no extractable text (scanned/image-only)".to_string());
    }
    // Truncate
    if text.len() > max_chars {
        Ok(text.chars().take(max_chars).collect::<String>() + "\n... (truncated)")
    } else {
        Ok(text)
    }
}

fn extract_video_thumbnail(path: &str) -> Result<String, String> {
    // Use ffmpeg to extract a frame at 1 second (or 0 if very short)
    let temp_dir = std::env::temp_dir();
    let thumb_path = temp_dir.join(format!("filenova_vthumb_{}.jpg",
        std::path::Path::new(path).file_stem().unwrap_or_default().to_string_lossy()
    ));

    let output = std::process::Command::new("ffmpeg")
        .args([
            "-y",           // overwrite
            "-i", path,
            "-ss", "1",     // seek to 1 second
            "-vframes", "1",
            "-vf", "scale=800:-2", // max width 800, maintain aspect ratio
            "-q:v", "5",    // quality
            thumb_path.to_str().unwrap_or_default(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("ffmpeg not found or failed to start: {}. Install ffmpeg for video thumbnails.", e))?;

    if !output.status.success() {
        // Try at 0 seconds for very short videos
        let retry = std::process::Command::new("ffmpeg")
            .args([
                "-y", "-i", path,
                "-ss", "0",
                "-vframes", "1",
                "-vf", "scale=800:-2",
                "-q:v", "5",
                thumb_path.to_str().unwrap_or_default(),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .output();

        if retry.is_err() || !retry.unwrap().status.success() {
            return Err("ffmpeg failed to extract video frame".to_string());
        }
    }

    // Read the generated thumbnail and convert to base64
    let img_data = std::fs::read(safe_path(&thumb_path)).map_err(|e| format!("Failed to read thumbnail: {}", e))?;
    let _ = std::fs::remove_file(safe_path(&thumb_path)); // cleanup

    let encoded = general_purpose::STANDARD.encode(&img_data);
    Ok(format!("data:image/jpeg;base64,{}", encoded))
}

/// Standalone command: extract a video thumbnail as raw JPEG bytes
pub fn get_video_thumbnail(path: &str) -> Result<Vec<u8>, String> {
    let temp_dir = std::env::temp_dir();
    let thumb_path = temp_dir.join(format!("filenova_vthumb_cmd_{}.jpg",
        std::path::Path::new(path).file_stem().unwrap_or_default().to_string_lossy()
    ));

    let output = std::process::Command::new("ffmpeg")
        .args([
            "-y", "-i", path,
            "-ss", "1",
            "-vframes", "1",
            "-vf", "scale=800:-2",
            "-q:v", "5",
            thumb_path.to_str().unwrap_or_default(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("ffmpeg not found: {}", e))?;

    if !output.status.success() {
        // Retry at 0s for very short videos
        let retry = std::process::Command::new("ffmpeg")
            .args([
                "-y", "-i", path,
                "-ss", "0",
                "-vframes", "1",
                "-vf", "scale=800:-2",
                "-q:v", "5",
                thumb_path.to_str().unwrap_or_default(),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .output();

        if retry.is_err() || !retry.unwrap().status.success() {
            return Err("ffmpeg failed to extract video frame".to_string());
        }
    }

    let img_data = std::fs::read(safe_path(&thumb_path)).map_err(|e| format!("Failed to read thumbnail: {}", e))?;
    let _ = std::fs::remove_file(safe_path(&thumb_path));
    Ok(img_data)
}

fn get_video_duration(path: &str) -> Option<f64> {
    // Use ffprobe to get duration
    let output = std::process::Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let duration_str = String::from_utf8_lossy(&output.stdout);
    duration_str.trim().parse::<f64>().ok()
}

fn get_video_dimensions(path: &str) -> Option<(u32, u32)> {
    // Use ffprobe to get width and height
    let output = std::process::Command::new("ffprobe")
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0:s=x",
            path,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let dims_str = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = dims_str.trim().split('x').collect();
    if parts.len() == 2 {
        let w = parts[0].parse::<u32>().ok()?;
        let h = parts[1].parse::<u32>().ok()?;
        Some((w, h))
    } else {
        None
    }
}

fn get_audio_duration(path: &str) -> Option<f64> {
    // Use ffprobe to get audio duration (same approach as video)
    let output = std::process::Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let duration_str = String::from_utf8_lossy(&output.stdout);
    duration_str.trim().parse::<f64>().ok()
}

fn list_archive_contents(path: &str) -> Result<(Vec<ArchiveEntry>, String), String> {
    let file = fs::File::open(safe_path(Path::new(path))).map_err(|e| format!("Cannot open archive: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid zip archive: {}", e))?;

    let mut entries: Vec<ArchiveEntry> = Vec::new();
    let mut total_compressed: u64 = 0;
    let mut total_uncompressed: u64 = 0;
    let mut file_count: usize = 0;
    let mut dir_count: usize = 0;

    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| format!("Error reading entry: {}", e))?;
        let name = entry.name().to_string();
        let is_dir = entry.is_dir();
        let compressed = entry.compressed_size();
        let uncompressed = entry.size();

        if is_dir {
            dir_count += 1;
        } else {
            file_count += 1;
            total_compressed += compressed;
            total_uncompressed += uncompressed;
        }

        entries.push(ArchiveEntry {
            name,
            is_directory: is_dir,
            compressed_size: compressed,
            uncompressed_size: uncompressed,
        });
    }

    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    // Limit to first 500 entries for huge archives
    let truncated = entries.len() > 500;
    if truncated {
        entries.truncate(500);
    }

    let ratio = if total_uncompressed > 0 {
        ((1.0 - (total_compressed as f64 / total_uncompressed as f64)) * 100.0).round()
    } else {
        0.0
    };

    let summary = format!(
        "{} files, {} folders | Compressed: {} → {} ({:.0}% saved){}",
        file_count,
        dir_count,
        format_size(total_uncompressed),
        format_size(total_compressed),
        ratio,
        if truncated { " (showing first 500 entries)" } else { "" }
    );

    Ok((entries, summary))
}

fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * 1024;
    const GB: u64 = 1024 * 1024 * 1024;
    match bytes {
        b if b >= GB => format!("{:.1} GB", b as f64 / GB as f64),
        b if b >= MB => format!("{:.1} MB", b as f64 / MB as f64),
        b if b >= KB => format!("{:.1} KB", b as f64 / KB as f64),
        b => format!("{} B", b),
    }
}

// Waveform generation
pub fn get_audio_waveform(path: &str) -> Result<Vec<f32>, String> {
    const NUM_BARS: usize = 200;
    const SAMPLE_RATE: u32 = 8000;

    // Use ffmpeg to decode audio to raw mono f32le PCM at low sample rate
    let output = std::process::Command::new("ffmpeg")
        .args([
            "-i", path,
            "-ac", "1",              // mono
            "-ar", &SAMPLE_RATE.to_string(),
            "-f", "f32le",           // raw 32-bit float little-endian
            "-v", "error",
            "pipe:1",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {}", stderr.chars().take(200).collect::<String>()));
    }

    let bytes = &output.stdout;
    if bytes.len() < 4 {
        return Ok(vec![0.0; NUM_BARS]);
    }

    // Convert raw bytes to f32 samples
    let total_samples = bytes.len() / 4;
    let samples: Vec<f32> = (0..total_samples)
        .map(|i| {
            let offset = i * 4;
            f32::from_le_bytes([
                bytes[offset],
                bytes[offset + 1],
                bytes[offset + 2],
                bytes[offset + 3],
            ])
        })
        .collect();

    // Compute RMS amplitude per chunk to produce NUM_BARS peaks
    let chunk_size = (samples.len() / NUM_BARS).max(1);
    let mut peaks: Vec<f32> = samples
        .chunks(chunk_size)
        .take(NUM_BARS)
        .map(|chunk| {
            let rms = (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt();
            rms
        })
        .collect();

    // Normalize to 0.0 - 1.0 range
    let max_peak = peaks.iter().cloned().fold(0.0f32, f32::max);
    if max_peak > 0.0 {
        for p in &mut peaks {
            *p /= max_peak;
        }
    }

    // Pad if we got fewer than NUM_BARS
    while peaks.len() < NUM_BARS {
        peaks.push(0.0);
    }

    Ok(peaks)
}

// Bookmarks functions
pub fn get_bookmarks(conn: &Connection) -> Result<Vec<Bookmark>, String> {
    let bookmarks_json = crate::db::get_setting(conn, "bookmarks")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "[]".to_string());

    serde_json::from_str(&bookmarks_json).map_err(|e| e.to_string())
}

pub fn add_bookmark(conn: &Connection, path: &str, name: &str) -> Result<(), String> {
    let mut bookmarks = get_bookmarks(conn)?;

    // Check if already exists
    if bookmarks.iter().any(|b| b.path == path) {
        return Err("Bookmark already exists".to_string());
    }

    let order = bookmarks.len() as i32;
    bookmarks.push(Bookmark {
        path: path.to_string(),
        name: name.to_string(),
        order,
    });

    let json = serde_json::to_string(&bookmarks).map_err(|e| e.to_string())?;
    crate::db::save_setting(conn, "bookmarks", &json).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn remove_bookmark(conn: &Connection, path: &str) -> Result<(), String> {
    let mut bookmarks = get_bookmarks(conn)?;
    bookmarks.retain(|b| b.path != path);

    // Reorder
    for (i, bookmark) in bookmarks.iter_mut().enumerate() {
        bookmark.order = i as i32;
    }

    let json = serde_json::to_string(&bookmarks).map_err(|e| e.to_string())?;
    crate::db::save_setting(conn, "bookmarks", &json).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn reorder_bookmarks(conn: &Connection, ordered_paths: &[String]) -> Result<(), String> {
    let bookmarks = get_bookmarks(conn)?;

    // Rebuild bookmarks list in the new order
    let mut reordered: Vec<Bookmark> = Vec::new();
    for (i, path) in ordered_paths.iter().enumerate() {
        if let Some(mut bm) = bookmarks.iter().find(|b| &b.path == path).cloned() {
            bm.order = i as i32;
            reordered.push(bm);
        }
    }

    // Append any bookmarks not in the ordered list (shouldn't happen, but safety)
    for bm in &bookmarks {
        if !ordered_paths.contains(&bm.path) {
            let mut bm = bm.clone();
            bm.order = reordered.len() as i32;
            reordered.push(bm);
        }
    }

    let json = serde_json::to_string(&reordered).map_err(|e| e.to_string())?;
    crate::db::save_setting(conn, "bookmarks", &json).map_err(|e| e.to_string())?;

    Ok(())
}

// Recent files functions

// Pinned files functions
pub fn get_pinned_files(conn: &Connection) -> Result<Vec<String>, String> {
    let pinned_json = crate::db::get_setting(conn, "pinned_files")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "[]".to_string());

    serde_json::from_str(&pinned_json).map_err(|e| e.to_string())
}

pub fn pin_file(conn: &Connection, path: &str) -> Result<(), String> {
    let mut pinned = get_pinned_files(conn)?;

    if pinned.iter().any(|p| p == path) {
        return Err("File is already pinned".to_string());
    }

    pinned.push(path.to_string());
    let json = serde_json::to_string(&pinned).map_err(|e| e.to_string())?;
    crate::db::save_setting(conn, "pinned_files", &json).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn unpin_file(conn: &Connection, path: &str) -> Result<(), String> {
    let mut pinned = get_pinned_files(conn)?;
    pinned.retain(|p| p != path);
    let json = serde_json::to_string(&pinned).map_err(|e| e.to_string())?;
    crate::db::save_setting(conn, "pinned_files", &json).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn toggle_pin_file(conn: &Connection, path: &str) -> Result<bool, String> {
    let pinned = get_pinned_files(conn)?;
    if pinned.iter().any(|p| p == path) {
        unpin_file(conn, path)?;
        Ok(false) // now unpinned
    } else {
        pin_file(conn, path)?;
        Ok(true) // now pinned
    }
}

// Recent files query
pub fn get_recent_files(conn: &Connection, limit: usize) -> Result<Vec<crate::commands::FileEntry>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT f.name, f.path, f.is_directory, f.size_bytes, 
                    CAST(strftime('%s', f.modified_at) AS INTEGER) as modified_at,
                    rf.accessed_at, rf.access_count
             FROM recent_files rf
             JOIN files f ON rf.file_id = f.id
             WHERE f.is_deleted = 0
             ORDER BY rf.accessed_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let files = stmt
        .query_map([limit], |row| {
            Ok(crate::commands::FileEntry {
                name: row.get(0)?,
                path: row.get(1)?,
                is_directory: row.get(2)?,
                size: row.get::<_, i64>(3)? as u64,
                modified_at: row.get::<_, i64>(4)? as u64,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(files)
}

pub fn record_file_access(conn: &Connection, file_id: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO recent_files (file_id, accessed_at, access_count)
         VALUES (?1, datetime('now'), 1)
         ON CONFLICT(file_id) DO UPDATE SET
            accessed_at = datetime('now'),
            access_count = access_count + 1",
        [file_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// Workspace functions
pub fn save_workspace(conn: &Connection, name: &str, config: &str) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO workspaces (name, config_json, created_at)
         VALUES (?1, ?2, datetime('now'))",
        rusqlite::params![name, config],
    )
    .map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

pub fn load_workspace(conn: &Connection, id: i64) -> Result<WorkspaceConfig, String> {
    let mut stmt = conn
        .prepare_cached("SELECT name, config_json FROM workspaces WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let (name, config_json): (String, String) = stmt
        .query_row([id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;

    let mut config: WorkspaceConfig =
        serde_json::from_str(&config_json).map_err(|e| e.to_string())?;
    config.id = id;
    config.name = name;

    Ok(config)
}

pub fn get_workspaces(conn: &Connection) -> Result<Vec<Workspace>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, name, strftime('%Y-%m-%d %H:%M:%S', created_at) as created_at
             FROM workspaces
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let workspaces = stmt
        .query_map([], |row| {
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(workspaces)
}
