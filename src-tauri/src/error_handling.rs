#![allow(dead_code)]
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::timeout;

/// Capture a non-fatal error to Sentry (if initialized).
/// Call this for important errors that should be tracked but don't crash the app.
pub fn capture_error(error: &dyn std::fmt::Display) {
    sentry::capture_message(&error.to_string(), sentry::Level::Error);
}

/// Capture a warning-level event to Sentry.
pub fn capture_warning(msg: &str) {
    sentry::capture_message(msg, sentry::Level::Warning);
}

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}

impl AppError {
    pub fn new(code: &str, message: &str, details: Option<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            details,
        }
    }

    pub fn permission_denied(path: &str) -> Self {
        Self::new(
            "PERMISSION_DENIED",
            &format!("Permission denied for: {}", path),
            None,
        )
    }

    pub fn network_error(message: &str) -> Self {
        Self::new("NETWORK_ERROR", message, None)
    }

    pub fn filesystem_error(message: &str) -> Self {
        Self::new("FILESYSTEM_ERROR", message, None)
    }

    pub fn ai_service_error(message: &str) -> Self {
        Self::new("AI_SERVICE_ERROR", message, None)
    }

    pub fn index_corruption(message: &str) -> Self {
        Self::new("INDEX_CORRUPTION", message, None)
    }

    pub fn insufficient_disk_space(available_bytes: u64) -> Self {
        Self::new(
            "INSUFFICIENT_DISK_SPACE",
            &format!("Insufficient disk space. Available: {} bytes", available_bytes),
            Some(available_bytes.to_string()),
        )
    }
}

// Retry with exponential backoff
pub async fn retry_with_backoff<F, T, E>(
    mut operation: F,
    max_attempts: u32,
    initial_delay_ms: u64,
) -> Result<T, E>
where
    F: FnMut() -> Result<T, E>,
{
    let mut delay = Duration::from_millis(initial_delay_ms);
    let mut last_error = None;

    for attempt in 1..=max_attempts {
        match operation() {
            Ok(result) => return Ok(result),
            Err(err) => {
                last_error = Some(err);
                
                if attempt < max_attempts {
                    tokio::time::sleep(delay).await;
                    delay = delay * 2; // Exponential backoff
                }
            }
        }
    }

    Err(last_error.unwrap())
}

// Timeout wrapper
pub async fn with_timeout<F, T>(
    future: F,
    timeout_secs: u64,
) -> Result<T, String>
where
    F: std::future::Future<Output = T>,
{
    match timeout(Duration::from_secs(timeout_secs), future).await {
        Ok(result) => Ok(result),
        Err(_) => Err("Operation timed out".to_string()),
    }
}

// Validate filename
pub fn validate_filename(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Filename cannot be empty".to_string());
    }

    if name.len() > 255 {
        return Err("Filename is too long (max 255 characters)".to_string());
    }

    let invalid_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    if name.chars().any(|c| invalid_chars.contains(&c)) {
        return Err("Filename contains invalid characters".to_string());
    }

    let reserved_names = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3",
    ];
    if reserved_names.contains(&name.to_uppercase().as_str()) {
        return Err("Filename is a reserved system name".to_string());
    }

    Ok(())
}

// Sanitize filename
pub fn sanitize_filename(name: &str) -> String {
    let invalid_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    name.chars()
        .map(|c| if invalid_chars.contains(&c) { '_' } else { c })
        .collect()
}

// Disk-space thresholds
pub const DISK_SPACE_WARN_BYTES: u64 = 1_073_741_824; // 1 GB
pub const DISK_SPACE_BLOCK_BYTES: u64 = 104_857_600; // 100 MB

/// Result of a disk-space check.
#[derive(Debug, Clone, Serialize)]
pub struct DiskSpaceStatus {
    pub available_bytes: u64,
    pub warn: bool,
    pub block: bool,
    pub message: Option<String>,
}

// Check disk space
pub fn check_disk_space(path: &PathBuf) -> Result<DiskSpaceStatus, String> {
    use sysinfo::Disks;

    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.clone());
    let disks = Disks::new_with_refreshed_list();

    // Find the disk whose mount point is the longest prefix of the path
    let mut best_match: Option<&sysinfo::Disk> = None;
    let mut best_len = 0;

    for disk in disks.list() {
        let mount = disk.mount_point();
        if canonical.starts_with(mount) {
            let len = mount.to_string_lossy().len();
            if len > best_len {
                best_len = len;
                best_match = Some(disk);
            }
        }
    }

    let available = best_match
        .map(|d| d.available_space())
        .unwrap_or(u64::MAX); // If we can't determine, don't block

    let block = available < DISK_SPACE_BLOCK_BYTES;
    let warn = available < DISK_SPACE_WARN_BYTES;

    let message = if block {
        Some(format!(
            "Critically low disk space: {} available. Operation blocked.",
            format_bytes(available)
        ))
    } else if warn {
        Some(format!(
            "Low disk space warning: {} available.",
            format_bytes(available)
        ))
    } else {
        None
    };

    Ok(DiskSpaceStatus {
        available_bytes: available,
        warn,
        block,
        message,
    })
}

/// Guard that blocks an operation when disk space is critically low.
/// Returns Ok(DiskSpaceStatus) when the operation may proceed (even if warn is true).
pub fn require_disk_space(path: &PathBuf) -> Result<DiskSpaceStatus, String> {
    let status = check_disk_space(path)?;
    if status.block {
        return Err(status.message.clone().unwrap_or_else(|| {
            "Insufficient disk space (<100 MB). Operation blocked.".to_string()
        }));
    }
    Ok(status)
}

// Handle symlink loops
pub fn detect_symlink_loop(path: &PathBuf, visited: &mut std::collections::HashSet<PathBuf>) -> Result<(), String> {
    let canonical = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => return Ok(()), // Not a symlink or doesn't exist
    };

    if visited.contains(&canonical) {
        return Err(format!("Symlink loop detected at: {:?}", path));
    }

    visited.insert(canonical);
    Ok(())
}

// Truncate path for display
pub fn truncate_path(path: &str, max_length: usize) -> String {
    if path.len() <= max_length {
        return path.to_string();
    }

    format!("...{}", &path[path.len() - (max_length - 3)..])
}

// Format bytes
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut unit_index = 0;

    while size >= 1024.0 && unit_index < UNITS.len() - 1 {
        size /= 1024.0;
        unit_index += 1;
    }

    format!("{:.2} {}", size, UNITS[unit_index])
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── AppError constructors ──────────────────────────────────────
    #[test]
    fn app_error_new() {
        let e = AppError::new("E001", "something broke", Some("ctx".into()));
        assert_eq!(e.code, "E001");
        assert_eq!(e.message, "something broke");
        assert_eq!(e.details.as_deref(), Some("ctx"));
    }

    #[test]
    fn app_error_variants() {
        assert_eq!(AppError::permission_denied("/tmp").code, "PERMISSION_DENIED");
        assert_eq!(AppError::network_error("timeout").code, "NETWORK_ERROR");
        assert_eq!(AppError::filesystem_error("full").code, "FILESYSTEM_ERROR");
        assert_eq!(AppError::ai_service_error("down").code, "AI_SERVICE_ERROR");
        assert_eq!(AppError::index_corruption("bad").code, "INDEX_CORRUPTION");
        assert_eq!(AppError::insufficient_disk_space(500).code, "INSUFFICIENT_DISK_SPACE");
    }

    // ── validate_filename ──────────────────────────────────────────
    #[test]
    fn validate_filename_valid() {
        assert!(validate_filename("report.pdf").is_ok());
        assert!(validate_filename("my file (1).docx").is_ok());
        assert!(validate_filename("日本語ファイル.txt").is_ok());
    }

    #[test]
    fn validate_filename_empty() {
        assert!(validate_filename("").is_err());
    }

    #[test]
    fn validate_filename_too_long() {
        let long = "a".repeat(256);
        assert!(validate_filename(&long).is_err());
        assert!(validate_filename(&"b".repeat(255)).is_ok());
    }

    #[test]
    fn validate_filename_invalid_chars() {
        for ch in ['/', '\\', ':', '*', '?', '"', '<', '>', '|'] {
            let name = format!("file{}name.txt", ch);
            assert!(validate_filename(&name).is_err(), "should reject '{}'", ch);
        }
    }

    #[test]
    fn validate_filename_reserved_names() {
        for name in ["CON", "con", "PRN", "AUX", "NUL", "COM1", "LPT1"] {
            assert!(validate_filename(name).is_err(), "should reject '{}'", name);
        }
    }

    // ── sanitize_filename ──────────────────────────────────────────
    #[test]
    fn sanitize_filename_replaces_invalid() {
        assert_eq!(sanitize_filename("a:b*c?.txt"), "a_b_c_.txt");
        assert_eq!(sanitize_filename("normal.txt"), "normal.txt");
    }

    #[test]
    fn sanitize_filename_all_bad() {
        assert_eq!(sanitize_filename("<>|"), "___");
    }

    // ── truncate_path ──────────────────────────────────────────────
    #[test]
    fn truncate_path_short_unchanged() {
        assert_eq!(truncate_path("/a/b", 20), "/a/b");
    }

    #[test]
    fn truncate_path_long_truncated() {
        let long = "/".to_string() + &"x".repeat(100);
        let t = truncate_path(&long, 20);
        assert!(t.starts_with("..."));
        assert_eq!(t.len(), 20);
    }

    // ── format_bytes ───────────────────────────────────────────────
    #[test]
    fn format_bytes_units() {
        assert_eq!(format_bytes(0), "0.00 B");
        assert_eq!(format_bytes(1023), "1023.00 B");
        assert_eq!(format_bytes(1024), "1.00 KB");
        assert_eq!(format_bytes(1_048_576), "1.00 MB");
        assert_eq!(format_bytes(1_073_741_824), "1.00 GB");
        assert_eq!(format_bytes(1_099_511_627_776), "1.00 TB");
    }
}
