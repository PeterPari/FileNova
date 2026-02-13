use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use async_openai::{
    types::{CreateEmbeddingRequestArgs, EncodingFormat},
    Client as OpenAiClient,
    config::OpenAIConfig,
};

use crate::db::get_setting;

#[derive(Clone, Debug, PartialEq)]
pub enum AiProvider {
    Ollama,
    OpenAI,
}

impl ToString for AiProvider {
    fn to_string(&self) -> String {
        match self {
            AiProvider::Ollama => "ollama".to_string(),
            AiProvider::OpenAI => "openai".to_string(),
        }
    }
}

impl From<&str> for AiProvider {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "openai" => AiProvider::OpenAI,
            _ => AiProvider::Ollama,
        }
    }
}

#[derive(Clone)]
pub struct EmbeddingConfig {
    pub provider: AiProvider,
    pub ollama_url: String,
    pub openai_api_key: Option<String>,
    pub model: String,
    pub chunk_size: usize,
    pub chunk_overlap: usize,
    pub dimensions: usize,
}

impl EmbeddingConfig {
    pub fn default_config() -> Self {
        Self {
            provider: AiProvider::Ollama,
            ollama_url: "http://localhost:11434".to_string(),
            openai_api_key: None,
            model: "nomic-embed-text".to_string(),
            chunk_size: 512,
            chunk_overlap: 50,
            dimensions: 768,
        }
    }

    pub fn from_settings(conn: &Connection) -> Self {
        let mut config = Self::default_config();

        if let Ok(Some(provider_str)) = get_setting(conn, "ai_provider") {
            config.provider = AiProvider::from(provider_str.as_str());
        }

        if let Ok(Some(url)) = get_setting(conn, "ollama_url") {
            if !url.is_empty() {
                config.ollama_url = url;
            }
        } else if let Ok(Some(url)) = get_setting(conn, "ai_provider_url") {
            if !url.is_empty() {
                config.ollama_url = url;
            }
        }

        // Security note: API keys must come from OS credential store first.
        // We keep DB fallback only for backward compatibility during migration.
        if let Ok(Some(key)) = crate::db::get_secret("openai_api_key") {
            if !key.is_empty() {
                config.openai_api_key = Some(key);
            }
        } else if let Ok(Some(key)) = get_setting(conn, "openai_api_key") {
            if !key.is_empty() {
                config.openai_api_key = Some(key);
            }
        }

        // Set defaults based on provider if model not manually overridden
        // or read model from settings
        if let Ok(Some(model)) = get_setting(conn, "ai_embedding_model") {
            if !model.is_empty() {
                config.model = model;
            }
        } else {
            match config.provider {
                AiProvider::Ollama => config.model = "nomic-embed-text".to_string(),
                AiProvider::OpenAI => config.model = "text-embedding-3-small".to_string(),
            }
        }

        // Set dimensions based on model
        config.dimensions = match config.model.as_str() {
            "nomic-embed-text" => 768,
            "text-embedding-3-small" => 1536,
            "text-embedding-3-large" => 3072,
            _ => 768, // Default fallback
        };

        config
    }
}

#[derive(Clone)]
pub struct EmbeddingChunk {
    pub file_id: i64,
    pub file_path: String,
    pub chunk_index: u32,
    pub chunk_text: String,
    pub char_offset: usize,
    pub embedding: Vec<f32>,
}

#[derive(Serialize)]
struct OllamaEmbedRequest {
    model: String,
    prompt: String,
}

#[derive(Deserialize)]
struct OllamaEmbedResponse {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Option<Vec<OllamaModel>>,
}

#[derive(Deserialize)]
struct OllamaModel {
    name: String,
}

/// Split text into overlapping token chunks and return (chunk_text, char_offset).
pub fn chunk_text_with_offsets(
    text: &str,
    chunk_size: usize,
    overlap: usize,
) -> Vec<(String, usize)> {
    let text = text.trim();
    if text.is_empty() {
        return vec![];
    }

    let mut tokens = Vec::new();
    let mut in_token = false;
    let mut token_start = 0usize;

    for (idx, ch) in text.char_indices() {
        if ch.is_whitespace() {
            if in_token {
                tokens.push((token_start, idx));
                in_token = false;
            }
        } else if !in_token {
            in_token = true;
            token_start = idx;
        }
    }
    if in_token {
        tokens.push((token_start, text.len()));
    }

    if tokens.is_empty() {
        return vec![];
    }

    let mut chunks = Vec::new();
    let mut start_idx = 0usize;
    let step = chunk_size.saturating_sub(overlap).max(1);

    while start_idx < tokens.len() {
        let end_idx = (start_idx + chunk_size).min(tokens.len());
        let start_char = tokens[start_idx].0;
        let end_char = tokens[end_idx - 1].1;
        let chunk = text[start_char..end_char].trim();
        if !chunk.is_empty() {
            chunks.push((chunk.to_string(), start_char));
        }

        if end_idx >= tokens.len() {
            break;
        }

        start_idx = start_idx.saturating_add(step);
    }

    chunks
}

/// Generate embedding using chosen provider
pub async fn generate_embedding(
    client: &reqwest::Client,
    config: &EmbeddingConfig,
    text: &str,
) -> Result<Vec<f32>, String> {
    match config.provider {
        AiProvider::Ollama => generate_ollama_embedding(client, config, text).await,
        AiProvider::OpenAI => generate_openai_embedding(config, text).await,
    }
}

async fn generate_ollama_embedding(
    client: &reqwest::Client,
    config: &EmbeddingConfig,
    text: &str,
) -> Result<Vec<f32>, String> {
    let request = OllamaEmbedRequest {
        model: config.model.clone(),
        prompt: text.to_string(),
    };
    let url = format!("{}/api/embeddings", config.ollama_url);

    let response = client
        .post(&url)
        .json(&request)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama returned {}: {}", status, body));
    }

    let embed_response: OllamaEmbedResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    if embed_response.embedding.is_empty() {
        return Err("No embedding in response".to_string());
    }

    Ok(embed_response.embedding)
}

async fn generate_openai_embedding(
    config: &EmbeddingConfig,
    text: &str,
) -> Result<Vec<f32>, String> {
    let api_key = config.openai_api_key.as_ref().ok_or("OpenAI API key not set")?;
    let openai_config = OpenAIConfig::new().with_api_key(api_key);
    let client = OpenAiClient::with_config(openai_config);

    let request = CreateEmbeddingRequestArgs::default()
        .model(&config.model)
        .input(text)
        .encoding_format(EncodingFormat::Float)
        .build()
        .map_err(|e| format!("Failed to build OpenAI request: {}", e))?;

    let response = client
        .embeddings()
        .create(request)
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    // Only take the first embedding (input was single string)
    if let Some(data) = response.data.first() {
         Ok(data.embedding.clone())
    } else {
        Err("No embedding returned from OpenAI".to_string())
    }
}

pub async fn check_provider_health(config: &EmbeddingConfig) -> Result<bool, String> {
    match config.provider {
        AiProvider::Ollama => check_ollama_health(config).await,
        AiProvider::OpenAI => check_openai_health(config).await,
    }
}

pub async fn check_ollama_health(config: &EmbeddingConfig) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/tags", config.ollama_url);

    let response = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Cannot connect to Ollama: {}", e))?;

    if !response.status().is_success() {
        return Ok(false);
    }

    let tags: OllamaTagsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama tags: {}", e))?;

    if let Some(models) = tags.models {
        // Check if model name matches (Ollama may include :latest suffix)
        let model_lower = config.model.to_lowercase();
        let found = models.iter().any(|m| {
            let name = m.name.to_lowercase();
            name == model_lower || name.starts_with(&format!("{}:", model_lower))
        });
        Ok(found)
    } else {
        Ok(false)
    }
}

pub async fn check_openai_health(config: &EmbeddingConfig) -> Result<bool, String> {
    if config.openai_api_key.is_none() {
        return Ok(false);
    }
    
    // Simple models list check
    let api_key = config.openai_api_key.as_ref().unwrap();
    let openai_config = OpenAIConfig::new().with_api_key(api_key);
    let client = OpenAiClient::with_config(openai_config);
    
    match client.models().list().await {
        Ok(_) => Ok(true),
        Err(e) => {
             // If error is 401, key is bad. If connection error, network down.
             // For now just return err as string if strictly needed, or false.
             Err(format!("OpenAI check failed: {}", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── AiProvider ─────────────────────────────────────────────────
    #[test]
    fn provider_round_trip() {
        assert_eq!(AiProvider::Ollama.to_string(), "ollama");
        assert_eq!(AiProvider::OpenAI.to_string(), "openai");
        assert!(matches!(AiProvider::from("ollama"), AiProvider::Ollama));
        assert!(matches!(AiProvider::from("openai"), AiProvider::OpenAI));
        assert!(matches!(AiProvider::from("OPENAI"), AiProvider::OpenAI));
        assert!(matches!(AiProvider::from("unknown"), AiProvider::Ollama));
    }

    // ── EmbeddingConfig defaults ───────────────────────────────────
    #[test]
    fn default_config_values() {
        let c = EmbeddingConfig::default_config();
        assert_eq!(c.chunk_size, 512);
        assert_eq!(c.chunk_overlap, 50);
        assert_eq!(c.dimensions, 768);
        assert_eq!(c.model, "nomic-embed-text");
        assert!(matches!(c.provider, AiProvider::Ollama));
    }

    // ── chunk_text_with_offsets ─────────────────────────────────────
    #[test]
    fn chunk_empty_text() {
        assert!(chunk_text_with_offsets("", 100, 10).is_empty());
        assert!(chunk_text_with_offsets("   ", 100, 10).is_empty());
    }

    #[test]
    fn chunk_short_text_single_chunk() {
        let chunks = chunk_text_with_offsets("hello world", 100, 10);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].0, "hello world");
        assert_eq!(chunks[0].1, 0);
    }

    #[test]
    fn chunk_text_produces_overlap() {
        // 10 words, chunk_size=3 tokens, overlap=1
        let text = "one two three four five six seven eight nine ten";
        let chunks = chunk_text_with_offsets(text, 3, 1);
        assert!(chunks.len() > 1);

        // Each chunk (except the first) should start with a token from the previous chunk's tail
        // due to overlap
        for i in 1..chunks.len() {
            let prev_words: Vec<&str> = chunks[i - 1].0.split_whitespace().collect();
            let curr_words: Vec<&str> = chunks[i].0.split_whitespace().collect();
            // Last word of previous chunk should overlap with first word of current
            assert_eq!(prev_words.last().unwrap(), &curr_words[0]);
        }
    }

    #[test]
    fn chunk_offsets_are_valid() {
        let text = "The quick brown fox jumps over the lazy dog";
        let chunks = chunk_text_with_offsets(text, 3, 1);
        for (chunk_text, offset) in &chunks {
            // The chunk text should start at the given offset in the original text
            assert!(text[*offset..].starts_with(chunk_text.split_whitespace().next().unwrap()));
        }
    }
}
