use image_hasher::{HashAlg, HasherConfig, ImageHash};
use rayon::prelude::*;
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// DuplicateScanState — managed Tauri state (follows IndexerState pattern)
// ---------------------------------------------------------------------------

#[derive(Clone, serde::Serialize)]
pub struct DuplicateScanStatus {
    pub phase: String,
    pub total_groups: u64,
    pub total_wasted_bytes: u64,
    pub files_processed: u64,
    pub total_files: u64,
    pub is_scanning: bool,
}

#[derive(Clone)]
pub struct DuplicateScanState {
    pub is_scanning: Arc<AtomicBool>,
    pub phase: Arc<Mutex<String>>,
    pub total_groups: Arc<AtomicU64>,
    pub total_wasted_bytes: Arc<AtomicU64>,
    pub files_processed: Arc<AtomicU64>,
    pub total_files: Arc<AtomicU64>,
}

impl DuplicateScanState {
    pub fn new() -> Self {
        Self {
            is_scanning: Arc::new(AtomicBool::new(false)),
            phase: Arc::new(Mutex::new(String::new())),
            total_groups: Arc::new(AtomicU64::new(0)),
            total_wasted_bytes: Arc::new(AtomicU64::new(0)),
            files_processed: Arc::new(AtomicU64::new(0)),
            total_files: Arc::new(AtomicU64::new(0)),
        }
    }
}

pub fn get_status(state: &DuplicateScanState) -> DuplicateScanStatus {
    DuplicateScanStatus {
        phase: state.phase.lock().unwrap().clone(),
        total_groups: state.total_groups.load(Ordering::Relaxed),
        total_wasted_bytes: state.total_wasted_bytes.load(Ordering::Relaxed),
        files_processed: state.files_processed.load(Ordering::Relaxed),
        total_files: state.total_files.load(Ordering::Relaxed),
        is_scanning: state.is_scanning.load(Ordering::Relaxed),
    }
}

// ---------------------------------------------------------------------------
// Perceptual hashing (public — used by indexer hook too)
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp"];

pub fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn compute_perceptual_hash(path: &Path) -> Option<String> {
    let img = image::open(path).ok()?;
    let hasher = HasherConfig::new()
        .hash_alg(HashAlg::DoubleGradient)
        .hash_size(8, 8)
        .to_hasher();
    let hash = hasher.hash_image(&img);
    Some(hash.to_base64())
}

// ---------------------------------------------------------------------------
// Union-Find for grouping near-duplicates
// ---------------------------------------------------------------------------

struct UnionFind {
    parent: Vec<usize>,
    rank: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> Self {
        Self {
            parent: (0..n).collect(),
            rank: vec![0; n],
        }
    }

    fn find(&mut self, x: usize) -> usize {
        if self.parent[x] != x {
            self.parent[x] = self.find(self.parent[x]);
        }
        self.parent[x]
    }

    fn union(&mut self, x: usize, y: usize) {
        let rx = self.find(x);
        let ry = self.find(y);
        if rx == ry {
            return;
        }
        if self.rank[rx] < self.rank[ry] {
            self.parent[rx] = ry;
        } else if self.rank[rx] > self.rank[ry] {
            self.parent[ry] = rx;
        } else {
            self.parent[ry] = rx;
            self.rank[rx] += 1;
        }
    }
}

// ---------------------------------------------------------------------------
// Main scan entry point
// ---------------------------------------------------------------------------

pub fn scan_duplicates(app: AppHandle, state: DuplicateScanState) {
    if state.is_scanning.swap(true, Ordering::SeqCst) {
        return; // Already scanning
    }

    // Reset counters
    state.total_groups.store(0, Ordering::SeqCst);
    state.total_wasted_bytes.store(0, Ordering::SeqCst);
    state.files_processed.store(0, Ordering::SeqCst);
    state.total_files.store(0, Ordering::SeqCst);

    std::thread::spawn(move || {
        let db_path = app.path().app_data_dir().unwrap().join("filenova.db");
        let mut conn = Connection::open(&db_path).expect("Failed to open DB for duplicate scan");
        let _ = conn.execute("PRAGMA journal_mode = WAL;", []);
        let _ = conn.execute("PRAGMA synchronous = NORMAL;", []);
        let _ = conn.execute("PRAGMA foreign_keys = ON;", []);

        // Phase 1: Exact duplicates
        *state.phase.lock().unwrap() = "exact".to_string();
        let _ = app.emit("duplicate-scan-progress", get_status(&state));
        let exact_groups = scan_exact_duplicates(&conn, &state).unwrap_or(0);
        state.total_groups.fetch_add(exact_groups, Ordering::SeqCst);
        let _ = app.emit("duplicate-scan-progress", get_status(&state));

        // Phase 2: Perceptual duplicates
        *state.phase.lock().unwrap() = "perceptual".to_string();
        state.files_processed.store(0, Ordering::SeqCst);
        state.total_files.store(0, Ordering::SeqCst);
        let _ = app.emit("duplicate-scan-progress", get_status(&state));
        let perceptual_groups = scan_perceptual_duplicates(&mut conn, &state, &app).unwrap_or(0);
        state
            .total_groups
            .fetch_add(perceptual_groups, Ordering::SeqCst);

        // Phase 3: Smart Duplicates (Name similarity)
        *state.phase.lock().unwrap() = "smart".to_string();
        state.files_processed.store(0, Ordering::SeqCst);
        state.total_files.store(0, Ordering::SeqCst);
        let _ = app.emit("duplicate-scan-progress", get_status(&state));
        let smart_groups = scan_smart_duplicates(&mut conn, &state).unwrap_or(0);
        state.total_groups.fetch_add(smart_groups, Ordering::SeqCst);

        // Done
        *state.phase.lock().unwrap() = "complete".to_string();
        state.is_scanning.store(false, Ordering::SeqCst);
        let _ = app.emit("duplicate-scan-finished", get_status(&state));
    });
}

// ---------------------------------------------------------------------------
// Phase 1: Exact duplicate detection
// ---------------------------------------------------------------------------

fn scan_exact_duplicates(conn: &Connection, state: &DuplicateScanState) -> rusqlite::Result<u64> {
    // Clear previous exact duplicate groups
    conn.execute(
        "DELETE FROM duplicate_group_files WHERE group_id IN (SELECT id FROM duplicate_groups WHERE group_type = 'exact')",
        [],
    )?;
    conn.execute(
        "DELETE FROM duplicate_groups WHERE group_type = 'exact'",
        [],
    )?;

    let now = chrono::Utc::now().to_rfc3339();

    // Find all hashes with more than one file
    let mut stmt = conn.prepare_cached(
        "SELECT hash_blake3, COUNT(*) as cnt, MIN(size_bytes) as single_size
         FROM files
         WHERE hash_blake3 IS NOT NULL AND is_directory = 0
         GROUP BY hash_blake3
         HAVING cnt > 1
         ORDER BY single_size * (cnt - 1) DESC",
    )?;

    let groups: Vec<(String, i64, i64)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut group_count = 0u64;
    let mut total_wasted = 0u64;

    for (hash, count, single_size) in &groups {
        let wasted = (count - 1) * single_size;

        conn.execute(
            "INSERT INTO duplicate_groups (group_type, hash_blake3, file_count, total_wasted_bytes, scanned_at)
             VALUES ('exact', ?1, ?2, ?3, ?4)",
            params![hash, count, wasted, &now],
        )?;
        let group_id = conn.last_insert_rowid();

        // Insert member files
        let mut file_stmt =
            conn.prepare_cached("SELECT id, path FROM files WHERE hash_blake3 = ?1 AND is_directory = 0")?;
        let files: Vec<(i64, String)> = file_stmt
            .query_map([hash], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        for (file_id, file_path) in &files {
            conn.execute(
                "INSERT INTO duplicate_group_files (group_id, file_id, file_path) VALUES (?1, ?2, ?3)",
                params![group_id, file_id, file_path],
            )?;
        }

        group_count += 1;
        total_wasted += wasted as u64;
    }

    state
        .total_wasted_bytes
        .fetch_add(total_wasted, Ordering::SeqCst);

    Ok(group_count)
}

// ---------------------------------------------------------------------------
// Phase 2: Perceptual duplicate detection
// ---------------------------------------------------------------------------

const PHASH_HAMMING_THRESHOLD: u32 = 5;

fn scan_perceptual_duplicates(
    conn: &mut Connection,
    state: &DuplicateScanState,
    app: &AppHandle,
) -> rusqlite::Result<u64> {
    // Clear previous perceptual duplicate groups
    conn.execute(
        "DELETE FROM duplicate_group_files WHERE group_id IN (SELECT id FROM duplicate_groups WHERE group_type = 'perceptual')",
        [],
    )?;
    conn.execute(
        "DELETE FROM duplicate_groups WHERE group_type = 'perceptual'",
        [],
    )?;

    // Step 1: Find image files needing perceptual hashing
    let unhashed: Vec<(i64, String)> = {
        let mut stmt = conn.prepare_cached(
            "SELECT id, path FROM files
             WHERE extension IN ('jpg','jpeg','png','gif','webp','bmp')
               AND is_directory = 0
               AND perceptual_hash IS NULL
               AND size_bytes < 104857600",
        )?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    state
        .total_files
        .store(unhashed.len() as u64, Ordering::SeqCst);

    // Step 2: Compute hashes in parallel
    let processed_counter = &state.files_processed;
    let results: Vec<(i64, String)> = unhashed
        .par_iter()
        .filter_map(|(id, path)| {
            let hash = compute_perceptual_hash(Path::new(path))?;
            processed_counter.fetch_add(1, Ordering::Relaxed);
            Some((*id, hash))
        })
        .collect();

    // Step 3: Write hashes back to DB
    {
        let tx = conn.transaction()?;
        {
            let mut update_stmt =
                tx.prepare_cached("UPDATE files SET perceptual_hash = ?1 WHERE id = ?2")?;
            for (id, hash) in &results {
                let _ = update_stmt.execute(params![hash, id]);
            }
        }
        tx.commit()?;
    }

    let _ = app.emit("duplicate-scan-progress", get_status(state));

    // Step 4: Load all perceptual hashes and find near-duplicate groups
    let mut all_stmt = conn.prepare_cached(
        "SELECT id, path, perceptual_hash, size_bytes FROM files
         WHERE perceptual_hash IS NOT NULL AND is_directory = 0",
    )?;
    let all_images: Vec<(i64, String, String, i64)> = all_stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .filter_map(|r| r.ok())
        .collect();

    if all_images.len() < 2 {
        return Ok(0);
    }

    // Parse hashes once
    let parsed_hashes: Vec<Option<ImageHash<Vec<u8>>>> = all_images
        .iter()
        .map(|(_, _, hash_str, _)| ImageHash::from_base64(hash_str).ok())
        .collect();

    // Union-Find grouping
    let n = all_images.len();
    let mut uf = UnionFind::new(n);

    for i in 0..n {
        if let Some(ref hi) = parsed_hashes[i] {
            for j in (i + 1)..n {
                if let Some(ref hj) = parsed_hashes[j] {
                    if hi.dist(hj) <= PHASH_HAMMING_THRESHOLD {
                        uf.union(i, j);
                    }
                }
            }
        }
    }

    // Collect groups (only groups with 2+ members)
    let mut group_map: std::collections::HashMap<usize, Vec<usize>> =
        std::collections::HashMap::new();
    for i in 0..n {
        let root = uf.find(i);
        group_map.entry(root).or_default().push(i);
    }

    // Filter out groups that are already covered by exact duplicates
    // (same blake3 hash) — avoid double-counting
    let now = chrono::Utc::now().to_rfc3339();
    let mut group_count = 0u64;
    let mut total_wasted = 0u64;

    for (_root, members) in &group_map {
        if members.len() < 2 {
            continue;
        }

        // Check if all members share the same blake3 hash (already covered by exact)
        // We only want perceptual groups that are NOT exact duplicates
        let mut has_distinct_hashes = false;
        {
            let mut exact_check = conn.prepare_cached("SELECT hash_blake3 FROM files WHERE id = ?1")?;
            let mut first_hash: Option<Option<String>> = None;
            for &idx in members {
                let file_id = all_images[idx].0;
                let hash: Option<String> = exact_check.query_row([file_id], |row| row.get(0)).ok();
                if let Some(ref fh) = first_hash {
                    if &hash != fh {
                        has_distinct_hashes = true;
                        break;
                    }
                } else {
                    first_hash = Some(hash);
                }
            }
        }

        if !has_distinct_hashes {
            continue; // All same blake3 hash — already handled by exact scan
        }

        // Calculate wasted bytes (smallest file size * (count - 1))
        let min_size = members
            .iter()
            .map(|&idx| all_images[idx].3)
            .min()
            .unwrap_or(0);
        let wasted = (members.len() as i64 - 1) * min_size;

        conn.execute(
            "INSERT INTO duplicate_groups (group_type, file_count, total_wasted_bytes, scanned_at)
             VALUES ('perceptual', ?1, ?2, ?3)",
            params![members.len() as i64, wasted, &now],
        )?;
        let group_id = conn.last_insert_rowid();

        for &idx in members {
            let (file_id, ref file_path, _, _) = all_images[idx];
            conn.execute(
                "INSERT INTO duplicate_group_files (group_id, file_id, file_path) VALUES (?1, ?2, ?3)",
                params![group_id, file_id, file_path],
            )?;
        }

        group_count += 1;
        total_wasted += wasted as u64;
    }

    state
        .total_wasted_bytes
        .fetch_add(total_wasted, Ordering::SeqCst);

    Ok(group_count)
}

// ---------------------------------------------------------------------------
// Phase 3: Smart duplicate detection (Name similarity)
// ---------------------------------------------------------------------------

fn levenshtein(s1: &str, s2: &str) -> usize {
    let v1: Vec<char> = s1.chars().collect();
    let v2: Vec<char> = s2.chars().collect();
    let l1 = v1.len();
    let l2 = v2.len();

    if l1 == 0 {
        return l2;
    }
    if l2 == 0 {
        return l1;
    }

    let mut matrix = vec![vec![0; l2 + 1]; l1 + 1];

    for i in 0..=l1 {
        matrix[i][0] = i;
    }
    for j in 0..=l2 {
        matrix[0][j] = j;
    }

    for i in 1..=l1 {
        for j in 1..=l2 {
            let cost = if v1[i - 1] == v2[j - 1] { 0 } else { 1 };
            matrix[i][j] = std::cmp::min(
                std::cmp::min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1),
                matrix[i - 1][j - 1] + cost,
            );
        }
    }

    matrix[l1][l2]
}

fn scan_smart_duplicates(
    conn: &mut Connection,
    state: &DuplicateScanState,
) -> rusqlite::Result<u64> {
    // Clear previous smart duplicate groups
    conn.execute(
        "DELETE FROM duplicate_group_files WHERE group_id IN (SELECT id FROM duplicate_groups WHERE group_type = 'smart')",
        [],
    )?;
    conn.execute(
        "DELETE FROM duplicate_groups WHERE group_type = 'smart'",
        [],
    )?;

    // Step 1: Fetch all files to memory (grouped by extension)
    // We only care about files that are NOT exact duplicates (optional optimization, but let's just fetch all and filter later)
    // Actually, to avoid O(N^2), let's limit to files < 500MB to avoid massive files being part of this check if we were doing content checks,
    // but for name checks, size doesn't matter much.
    let mut stmt = conn.prepare_cached(
        "SELECT id, name, extension, path, size_bytes, hash_blake3 FROM files
         WHERE is_directory = 0 AND extension IS NOT NULL",
    )?;

    // (id, name, path, size, hash)
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?.to_lowercase(),
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    })?;

    let mut by_extension: std::collections::HashMap<
        String,
        Vec<(i64, String, String, i64, Option<String>)>,
    > = std::collections::HashMap::new();
    let mut total_files = 0;

    for row in rows {
        if let Ok((id, name, ext, path, size, hash)) = row {
            by_extension
                .entry(ext)
                .or_default()
                .push((id, name, path, size, hash));
            total_files += 1;
        }
    }

    state.total_files.store(total_files, Ordering::SeqCst);
    let processed_counter = &state.files_processed;

    let now = chrono::Utc::now().to_rfc3339();
    let mut group_count = 0u64;
    let mut total_wasted = 0u64;

    // Process each extension group
    for (_ext, mut files) in by_extension {
        let n = files.len();
        if n < 2 {
            processed_counter.fetch_add(n as u64, Ordering::Relaxed);
            continue;
        }

        let mut uf = UnionFind::new(n);

        // Sort by name length then name to optimize comparisons?
        // Or just sort by name to make similar names adjacent?
        // Sorting by name puts "file.txt" and "file (1).txt" close.
        files.sort_by(|a, b| a.1.cmp(&b.1));

        // Window-based comparison to avoid O(N^2)
        // We only check files within a certain window of indices,
        // assuming similar names will be close after sorting.
        // But "Copy of File.txt" vs "File.txt" might be far apart alphabetically.
        // So a full check is safer but slower.
        // For < 200 items in extension, full check is fine.
        // For > 1000, maybe limit window.
        // Let's do a sliding window of 50 for now, plus exact checks.

        let window_size = 50;

        for i in 0..n {
            let _start = if i > window_size { i - window_size } else { 0 };

            if i < files.len() {
                let (_id1, name1, _path1, _size1, hash1) = &files[i];

                for j in (i + 1)..files.len() {
                    let (_id2, name2, _path2, _size2, hash2) = &files[j];

                    if hash1.is_some() && hash2.is_some() && hash1 == hash2 {
                        continue;
                    }

                    if name1.eq_ignore_ascii_case(name2) {
                        uf.union(i, j);
                        continue;
                    }

                    let len_diff = (name1.len() as i32 - name2.len() as i32).abs();
                    if len_diff < 3 {
                        if levenshtein(name1, name2) < 3 {
                            uf.union(i, j);
                        }
                    }
                }
            }

            processed_counter.fetch_add(1, Ordering::Relaxed);
        }

        // Collect groups
        let mut group_map: std::collections::HashMap<usize, Vec<usize>> =
            std::collections::HashMap::new();
        for i in 0..n {
            let root = uf.find(i);
            group_map.entry(root).or_default().push(i);
        }

        for (_root, members) in group_map {
            if members.len() < 2 {
                continue;
            }

            // Double check: ensure not ALL members are same hash (already covered)
            // If at least one pair is NOT exact duplicate, it's a smart group?
            // Or if the group contains files that are not all exact duplicates of each other.
            // Let's just add it. The user can decide.

            // Calculate wasted bytes
            // Smart duplicates: we don't know which one is "original", so we assume
            // the user might keep one. Wasted = sum of all sizes - max size (conservative)
            // or sum - min size (aggressive).
            // Let's use sum - largest.
            let total_size: i64 = members.iter().map(|&idx| files[idx].3).sum();
            let max_size: i64 = members.iter().map(|&idx| files[idx].3).max().unwrap_or(0);
            let wasted = total_size - max_size;

            conn.execute(
                "INSERT INTO duplicate_groups (group_type, file_count, total_wasted_bytes, scanned_at)
                 VALUES ('smart', ?1, ?2, ?3)",
                params![members.len() as i64, wasted, &now],
            )?;
            let group_id = conn.last_insert_rowid();

            for idx in members {
                let (file_id, _, ref file_path, _, _) = files[idx];
                conn.execute(
                    "INSERT INTO duplicate_group_files (group_id, file_id, file_path) VALUES (?1, ?2, ?3)",
                    params![group_id, file_id, file_path],
                )?;
            }

            group_count += 1;
            total_wasted += wasted as u64;
        }
    }

    state
        .total_wasted_bytes
        .fetch_add(total_wasted, Ordering::SeqCst);

    Ok(group_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_extensions_recognized() {
        for ext in ["jpg", "jpeg", "png", "gif", "webp", "bmp"] {
            assert!(is_image_file(Path::new(&format!("photo.{}", ext))));
        }
    }

    #[test]
    fn non_image_rejected() {
        for ext in ["txt", "pdf", "rs", "exe", "mp4"] {
            assert!(!is_image_file(Path::new(&format!("f.{}", ext))));
        }
    }

    #[test]
    fn image_case_insensitive() {
        assert!(is_image_file(Path::new("photo.JPG")));
        assert!(is_image_file(Path::new("photo.Png")));
    }

    #[test]
    fn no_extension_not_image() {
        assert!(!is_image_file(Path::new("Makefile")));
    }

    #[test]
    fn union_find_basic() {
        let mut uf = UnionFind::new(5);
        assert_ne!(uf.find(0), uf.find(1));
        uf.union(0, 1);
        assert_eq!(uf.find(0), uf.find(1));
    }

    #[test]
    fn union_find_transitive() {
        let mut uf = UnionFind::new(5);
        uf.union(0, 1);
        uf.union(1, 2);
        assert_eq!(uf.find(0), uf.find(2));
    }

    #[test]
    fn union_find_separate_groups() {
        let mut uf = UnionFind::new(4);
        uf.union(0, 1);
        uf.union(2, 3);
        assert_ne!(uf.find(0), uf.find(2));
    }

    #[test]
    fn union_find_self_union() {
        let mut uf = UnionFind::new(3);
        uf.union(1, 1);
        assert_eq!(uf.find(1), 1);
    }

    #[test]
    fn levenshtein_identical() {
        assert_eq!(levenshtein("hello", "hello"), 0);
    }

    #[test]
    fn levenshtein_empty() {
        assert_eq!(levenshtein("", "abc"), 3);
        assert_eq!(levenshtein("abc", ""), 3);
        assert_eq!(levenshtein("", ""), 0);
    }

    #[test]
    fn levenshtein_single_edit() {
        assert_eq!(levenshtein("cat", "bat"), 1);
        assert_eq!(levenshtein("cat", "cats"), 1);
        assert_eq!(levenshtein("cats", "cat"), 1);
    }

    #[test]
    fn levenshtein_known_distance() {
        assert_eq!(levenshtein("kitten", "sitting"), 3);
        assert_eq!(levenshtein("saturday", "sunday"), 3);
    }

    #[test]
    fn scan_state_defaults() {
        let state = DuplicateScanState::new();
        let status = get_status(&state);
        assert!(!status.is_scanning);
        assert_eq!(status.total_groups, 0);
        assert_eq!(status.total_wasted_bytes, 0);
    }
}