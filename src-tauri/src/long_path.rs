//! Windows extended-length path support.
//!
//! Paths longer than 260 characters fail on Windows unless prefixed with
//! `\\?\`.  The [`safe_path`] function transparently adds the prefix when
//! necessary and is a no-op on non-Windows platforms.

use std::path::{Path, PathBuf};

/// Threshold (in bytes of the string representation) above which we add the
/// extended-length prefix.  The Windows `MAX_PATH` is 260 for files and 248
/// for directories; we use the lower value so directory operations are safe
/// too.
const LONG_PATH_THRESHOLD: usize = 248;

/// Return a path that is safe to use with `std::fs` operations on Windows.
///
/// * If the path is shorter than [`LONG_PATH_THRESHOLD`] it is returned
///   unchanged.
/// * If the platform is not Windows it is returned unchanged.
/// * Otherwise the path is made absolute (if relative) and prefixed with
///   `\\?\` so that the Windows API bypasses the `MAX_PATH` limit.
///
/// Already-prefixed paths (`\\?\` or `\\.\`) are returned as-is.
pub fn safe_path<P: AsRef<Path>>(path: P) -> PathBuf {
    _safe_path(path.as_ref())
}

#[cfg(target_os = "windows")]
fn _safe_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();

    // Already extended-length or device path — nothing to do.
    if s.starts_with(r"\\?\") || s.starts_with(r"\\.\") {
        return path.to_path_buf();
    }

    // Short enough — leave as-is.
    if s.len() < LONG_PATH_THRESHOLD {
        return path.to_path_buf();
    }

    // Make absolute so the prefix is valid.
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_default()
            .join(path)
    };

    // Build \\?\<absolute_path>
    let abs_str = absolute.to_string_lossy();
    PathBuf::from(format!(r"\\?\{}", abs_str))
}

#[cfg(not(target_os = "windows"))]
fn _safe_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// Convenience wrapper: convert a string-like value to a safe [`PathBuf`].
#[allow(dead_code)]
pub fn safe_path_string(s: &str) -> PathBuf {
    safe_path(Path::new(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_path_unchanged() {
        let p = PathBuf::from(r"C:\Users\test\file.txt");
        assert_eq!(safe_path(&p), p);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn long_path_gets_prefix() {
        let long = format!(r"C:\Users\test\{}", "a".repeat(260));
        let result = safe_path(Path::new(&long));
        assert!(result.to_string_lossy().starts_with(r"\\?\"));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn already_prefixed_unchanged() {
        let p = PathBuf::from(r"\\?\C:\Very\Long\Path");
        assert_eq!(safe_path(&p), p);
    }
}
