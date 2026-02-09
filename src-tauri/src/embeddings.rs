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
            chunk_size: 1000, // Reduced for better granularity
            chunk_overlap: 100,
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
        }

        if let Ok(Some(key)) = get_setting(conn, "openai_api_key") {
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
    pub embedding: Vec<f32>,
}

#[derive(Serialize)]
struct OllamaEmbedRequest {
    model: String,
    input: String,
}

#[derive(Deserialize)]
struct OllamaEmbedResponse {
    embeddings: Vec<Vec<f32>>,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Option<Vec<OllamaModel>>,
}

#[derive(Deserialize)]
struct OllamaModel {
    name: String,
}

/// Split text into overlapping chunks, snapping to sentence boundaries.
pub fn chunk_text(text: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    let text = text.trim();
    if text.is_empty() {
        return vec![];
    }
    if text.len() <= chunk_size {
        return vec![text.to_string()];
    }

    let _step = chunk_size.saturating_sub(overlap).max(1);
    let mut chunks = Vec::new();
    let mut start = 0;

    while start < text.len() {
        let end = (start + chunk_size).min(text.len());

        // Try to snap to a sentence boundary in the last 20% of the chunk
        let snap_start = start + (chunk_size * 4 / 5).min(end - start);
        let mut snap_pos = end;

        if end < text.len() {
            // Look for sentence boundaries: '. ', '? ', '! ', '\n'
            let segment = &text[snap_start..end];
            let candidates = [". ", "? ", "! ", "\n"];
            let mut best = None;
            for delim in &candidates {
                if let Some(pos) = segment.rfind(delim) {
                    let abs_pos = snap_start + pos + delim.len();
                    match best {
                        None => best = Some(abs_pos),
                        Some(b) if abs_pos > b => best = Some(abs_pos),
                        _ => {}
                    }
                }
            }
            if let Some(bp) = best {
                snap_pos = bp;
            }
        }

        let chunk = text[start..snap_pos].trim();
        if !chunk.is_empty() {
            chunks.push(chunk.to_string());
        }

        if snap_pos >= text.len() {
            break;
        }

        start = snap_pos.saturating_sub(overlap);
        if start >= snap_pos {
            break;
        }
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
    let url = format!("{}/api/embed", config.ollama_url);

    let request = OllamaEmbedRequest {
        model: config.model.clone(),
        input: text.to_string(),
    };

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

    embed_response
        .embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "No embedding in response".to_string())
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
