use std::collections::HashMap;

use crate::embeddings::{self, EmbeddingConfig};
use crate::search_index::IndexManager;
use crate::vector_store::VectorStore;

#[derive(Clone, serde::Serialize)]
pub struct HybridSearchResult {
    pub path: String,
    pub name: String,
    pub extension: Option<String>,
    pub size_bytes: i64,
    pub modified_at: i64,
    pub keyword_score: Option<f32>,
    pub semantic_score: Option<f32>,
    pub combined_score: f32,
    pub snippet: Option<String>,
    pub chunk_index: Option<u32>,
    pub char_offset: Option<u32>,
    pub source: String, // "keyword" | "semantic" | "hybrid"
}

pub struct SearchConfig {
    pub keyword_weight: f32,
    pub semantic_weight: f32,
    pub keyword_limit: usize,
    pub semantic_limit: usize,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            keyword_weight: 0.4,
            semantic_weight: 0.6,
            keyword_limit: 50,
            semantic_limit: 30,
        }
    }
}

/// Wraps existing Tantivy search results into HybridSearchResult format.
pub fn search_keyword_only(
    index_manager: &IndexManager,
    query: &str,
    limit: usize,
) -> Result<Vec<HybridSearchResult>, String> {
    let results = index_manager.search(query, limit).map_err(|e| e.to_string())?;

    Ok(results
        .into_iter()
        .map(|r| HybridSearchResult {
            path: r.path,
            name: r.name,
            extension: r.extension,
            size_bytes: r.size_bytes,
            modified_at: r.modified_at,
            keyword_score: Some(r.score),
            semantic_score: None,
            combined_score: r.score,
            snippet: None,
            chunk_index: None,
            char_offset: None,
            source: "keyword".to_string(),
        })
        .collect())
}

/// Semantic-only search: embed query, search LanceDB, deduplicate by file path.
pub async fn search_semantic_only(
    vector_store: &VectorStore,
    config: &EmbeddingConfig,
    query: &str,
    limit: usize,
) -> Result<Vec<HybridSearchResult>, String> {
    let client = reqwest::Client::new();
    let query_embedding = embeddings::generate_embedding(&client, config, query).await?;

    let vector_results = vector_store.search(&query_embedding, limit * 2).await?;

    // Deduplicate by file_path (keep best chunk per file)
    let mut best_per_file: HashMap<String, (f32, String, u32, u32)> = HashMap::new();
    for vr in &vector_results {
        let score = 1.0 - vr.distance; // Convert distance to similarity
        let entry = best_per_file.entry(vr.file_path.clone()).or_insert((
            score,
            vr.chunk_text.clone(),
            vr.chunk_index,
            vr.char_offset,
        ));
        if score > entry.0 {
            *entry = (score, vr.chunk_text.clone(), vr.chunk_index, vr.char_offset);
        }
    }

    // Build results sorted by score
    let mut results: Vec<HybridSearchResult> = best_per_file
        .into_iter()
        .map(|(path, (score, snippet, chunk_index, char_offset))| {
            let name = std::path::Path::new(&path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let extension = std::path::Path::new(&path)
                .extension()
                .map(|e| e.to_string_lossy().to_string());

            HybridSearchResult {
                path,
                name,
                extension,
                size_bytes: 0,
                modified_at: 0,
                keyword_score: None,
                semantic_score: Some(score),
                combined_score: score,
                snippet: Some(truncate_snippet(&snippet, 200)),
                chunk_index: Some(chunk_index),
                char_offset: Some(char_offset),
                source: "semantic".to_string(),
            }
        })
        .collect();

    results.sort_by(|a, b| {
        b.combined_score
            .partial_cmp(&a.combined_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(limit);

    Ok(results)
}

/// Hybrid search: run keyword + semantic in parallel, normalize, merge, re-rank.
pub async fn search_hybrid(
    index_manager: &IndexManager,
    vector_store: &VectorStore,
    embed_config: &EmbeddingConfig,
    query: &str,
    search_config: &SearchConfig,
) -> Result<Vec<HybridSearchResult>, String> {
    // Run keyword search (sync)
    let keyword_results =
        search_keyword_only(index_manager, query, search_config.keyword_limit)?;

    // Run semantic search (async)
    let semantic_results =
        search_semantic_only(vector_store, embed_config, query, search_config.semantic_limit)
            .await
            .unwrap_or_default(); // Gracefully handle Ollama being down

    if keyword_results.is_empty() && semantic_results.is_empty() {
        return Ok(vec![]);
    }

    // Normalize keyword scores to 0-1
    let max_keyword = keyword_results
        .iter()
        .map(|r| r.combined_score)
        .fold(0.0f32, f32::max);

    let keyword_map: HashMap<String, HybridSearchResult> = keyword_results
        .into_iter()
        .map(|mut r| {
            if max_keyword > 0.0 {
                r.keyword_score = Some(r.combined_score / max_keyword);
            }
            (r.path.clone(), r)
        })
        .collect();

    // Semantic scores are already ~0-1 (1 - cosine_distance)
    let semantic_map: HashMap<String, HybridSearchResult> = semantic_results
        .into_iter()
        .map(|r| (r.path.clone(), r))
        .collect();

    // Merge
    let mut all_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
    all_paths.extend(keyword_map.keys().cloned());
    all_paths.extend(semantic_map.keys().cloned());

    let kw = search_config.keyword_weight;
    let sw = search_config.semantic_weight;

    let mut merged: Vec<HybridSearchResult> = all_paths
        .into_iter()
        .map(|path| {
            let k_result = keyword_map.get(&path);
            let s_result = semantic_map.get(&path);

            match (k_result, s_result) {
                (Some(kr), Some(sr)) => HybridSearchResult {
                    path: kr.path.clone(),
                    name: kr.name.clone(),
                    extension: kr.extension.clone(),
                    size_bytes: kr.size_bytes,
                    modified_at: kr.modified_at,
                    keyword_score: kr.keyword_score,
                    semantic_score: sr.semantic_score,
                    combined_score: kw * kr.keyword_score.unwrap_or(0.0)
                        + sw * sr.semantic_score.unwrap_or(0.0),
                    snippet: sr.snippet.clone(),
                    chunk_index: sr.chunk_index,
                    char_offset: sr.char_offset,
                    source: "hybrid".to_string(),
                },
                (Some(kr), None) => HybridSearchResult {
                    combined_score: kw * kr.keyword_score.unwrap_or(0.0),
                    source: "keyword".to_string(),
                    ..kr.clone()
                },
                (None, Some(sr)) => HybridSearchResult {
                    combined_score: sw * sr.semantic_score.unwrap_or(0.0),
                    source: "semantic".to_string(),
                    ..sr.clone()
                },
                (None, None) => unreachable!(),
            }
        })
        .collect();

    merged.sort_by(|a, b| {
        b.combined_score
            .partial_cmp(&a.combined_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(merged)
}

fn truncate_snippet(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        text.to_string()
    } else {
        let truncated: String = text.chars().take(max_len).collect();
        format!("{}...", truncated)
    }
}
