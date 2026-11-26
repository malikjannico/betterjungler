use std::time::Duration;

use reqwest::Client;
use serde_json::{json, Value};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::storage::AiCoachConfig;

/// Dedicated HTTP client with 90s timeout for external AI APIs & local Ollama inference.
pub fn build_ai_client() -> AppResult<Client> {
    Client::builder()
        .use_rustls_tls()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| AppError::AiCoach(e.to_string()))
}

pub fn validate_ollama_endpoint(endpoint: &str) -> AppResult<Url> {
    let parsed = Url::parse(endpoint.trim())
        .map_err(|e| AppError::SecurityPolicy(format!("Invalid Ollama endpoint URL: {e}")))?;
    if parsed.scheme() != "http" {
        return Err(AppError::SecurityPolicy(
            "Local Ollama endpoint must use http:// loopback".to_string(),
        ));
    }
    let host = parsed.host_str().unwrap_or("");
    if host != "127.0.0.1" && host != "[::1]" && host != "::1" {
        return Err(AppError::SecurityPolicy(
            "Local Ollama endpoint must target 127.0.0.1 or [::1]".to_string(),
        ));
    }
    Ok(parsed)
}

fn validate_model_name(model: &str, default_model: &str) -> AppResult<String> {
    let candidate = if model.trim().is_empty() {
        default_model
    } else {
        model.trim()
    };
    if !candidate
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
    {
        return Err(AppError::SecurityPolicy(
            "AI model identifier contains unsupported characters".to_string(),
        ));
    }
    Ok(candidate.to_string())
}

pub async fn generate_ai_debrief(
    client: &Client,
    config: &AiCoachConfig,
    api_key: Option<String>,
    context: &str,
) -> AppResult<String> {
    let system_prompt = "You are a concise, constructive League of Legends jungle coach. Give 3-4 actionable bullet points focusing on pathing, objectives, vision, and macro. Never reference real summoner names.";

    match config.provider.as_str() {
        "gemini" => {
            let key = api_key.ok_or_else(|| {
                AppError::Credential("Save your Gemini API key in Settings first.".to_string())
            })?;
            let model = validate_model_name(&config.model, "gemini-2.5-flash")?;
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            );
            let res = client
                .post(&url)
                .header("x-goog-api-key", key)
                .json(&json!({
                    "systemInstruction": { "parts": [{ "text": system_prompt }] },
                    "contents": [{ "parts": [{ "text": context }] }]
                }))
                .send()
                .await
                .map_err(|e| AppError::AiCoach(format!("Gemini request failed: {e}")))?;

            if !res.status().is_success() {
                return Err(AppError::AiCoach(format!(
                    "Gemini API returned HTTP {}",
                    res.status()
                )));
            }
            let body: Value = res
                .json()
                .await
                .map_err(|e| AppError::AiCoach(e.to_string()))?;
            let text = body["candidates"][0]["content"]["parts"][0]["text"]
                .as_str()
                .unwrap_or("No coaching response generated.")
                .to_string();
            Ok(text)
        }
        "openai" => {
            let key = api_key.ok_or_else(|| {
                AppError::Credential("Save your OpenAI API key in Settings first.".to_string())
            })?;
            let model = validate_model_name(&config.model, "gpt-4o-mini")?;
            let res = client
                .post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(key)
                .json(&json!({
                    "model": model,
                    "messages": [
                        { "role": "system", "content": system_prompt },
                        { "role": "user", "content": context }
                    ],
                    "temperature": 0.4
                }))
                .send()
                .await
                .map_err(|e| AppError::AiCoach(format!("OpenAI request failed: {e}")))?;

            if !res.status().is_success() {
                return Err(AppError::AiCoach(format!(
                    "OpenAI API returned HTTP {}",
                    res.status()
                )));
            }
            let body: Value = res
                .json()
                .await
                .map_err(|e| AppError::AiCoach(e.to_string()))?;
            let text = body["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("No coaching response generated.")
                .to_string();
            Ok(text)
        }
        "ollama" => {
            let base = validate_ollama_endpoint(&config.endpoint)?;
            let url = base
                .join("api/generate")
                .map_err(|e| AppError::AiCoach(e.to_string()))?;
            let model = validate_model_name(&config.model, "llama3.1")?;
            let res = client
                .post(url)
                .json(&json!({
                    "model": model,
                    "prompt": format!("{system_prompt}\n\n{context}"),
                    "stream": false
                }))
                .send()
                .await
                .map_err(|e| AppError::AiCoach(format!("Ollama request failed: {e}")))?;

            if !res.status().is_success() {
                return Err(AppError::AiCoach(format!(
                    "Ollama returned HTTP {}",
                    res.status()
                )));
            }
            let body: Value = res
                .json()
                .await
                .map_err(|e| AppError::AiCoach(e.to_string()))?;
            let text = body["response"]
                .as_str()
                .unwrap_or("No coaching response generated.")
                .to_string();
            Ok(text)
        }
        _ => Err(AppError::AiCoach(
            "AI Coach is currently set to Off in Settings.".to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_ollama_endpoint_is_loopback() {
        assert!(validate_ollama_endpoint("http://127.0.0.1:11434").is_ok());
        assert!(validate_ollama_endpoint("http://[::1]:11434").is_ok());
        assert!(validate_ollama_endpoint("http://localhost:11434").is_err());
        assert!(validate_ollama_endpoint("https://evil.example.com:11434").is_err());
    }
}
