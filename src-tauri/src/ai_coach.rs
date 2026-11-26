use reqwest::Client;
use serde_json::{json, Value};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::storage::AiCoachConfig;

pub fn validate_ollama_endpoint(endpoint: &str) -> AppResult<Url> {
    let parsed = Url::parse(endpoint.trim())
        .map_err(|e| AppError::SecurityPolicy(format!("Invalid Ollama endpoint URL: {e}")))?;
    let host = parsed.host_str().unwrap_or("");
    if host != "127.0.0.1" && host != "localhost" {
        return Err(AppError::SecurityPolicy(
            "Local Ollama endpoint must target 127.0.0.1 or localhost".to_string(),
        ));
    }
    Ok(parsed)
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
            let model = if config.model.trim().is_empty() {
                "gemini-2.5-flash"
            } else {
                config.model.trim()
            };
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
                .map_err(|e| AppError::RiotApi(format!("Gemini request failed: {e}")))?;

            if !res.status().is_success() {
                return Err(AppError::RiotApi(format!(
                    "Gemini API returned HTTP {}",
                    res.status()
                )));
            }
            let body: Value = res
                .json()
                .await
                .map_err(|e| AppError::RiotApi(e.to_string()))?;
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
            let model = if config.model.trim().is_empty() {
                "gpt-4o-mini"
            } else {
                config.model.trim()
            };
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
                .map_err(|e| AppError::RiotApi(format!("OpenAI request failed: {e}")))?;

            if !res.status().is_success() {
                return Err(AppError::RiotApi(format!(
                    "OpenAI API returned HTTP {}",
                    res.status()
                )));
            }
            let body: Value = res
                .json()
                .await
                .map_err(|e| AppError::RiotApi(e.to_string()))?;
            let text = body["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("No coaching response generated.")
                .to_string();
            Ok(text)
        }
        "ollama" => {
            let base = validate_ollama_endpoint(&config.endpoint)?;
            let url = base
                .join("/api/generate")
                .map_err(|e| AppError::RiotApi(e.to_string()))?;
            let model = if config.model.trim().is_empty() {
                "llama3.1"
            } else {
                config.model.trim()
            };
            let res = client
                .post(url)
                .json(&json!({
                    "model": model,
                    "prompt": format!("{system_prompt}\n\n{context}"),
                    "stream": false
                }))
                .send()
                .await
                .map_err(|e| AppError::RiotApi(format!("Ollama request failed: {e}")))?;

            if !res.status().is_success() {
                return Err(AppError::RiotApi(format!(
                    "Ollama returned HTTP {}",
                    res.status()
                )));
            }
            let body: Value = res
                .json()
                .await
                .map_err(|e| AppError::RiotApi(e.to_string()))?;
            let text = body["response"]
                .as_str()
                .unwrap_or("No coaching response generated.")
                .to_string();
            Ok(text)
        }
        _ => Err(AppError::RiotApi(
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
        assert!(validate_ollama_endpoint("http://localhost:11434").is_ok());
        assert!(validate_ollama_endpoint("https://evil.example.com:11434").is_err());
    }
}
