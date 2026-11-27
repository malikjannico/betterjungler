use std::collections::HashSet;
use std::time::Duration;

use reqwest::Client;
use serde_json::{json, Value};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::storage::AiCoachConfig;

fn normalize_comma_thousands(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\u{2212}' {
            out.push('-');
            i += 1;
            continue;
        }
        if chars[i] == ','
            && i > 0
            && chars[i - 1].is_ascii_digit()
            && i + 3 < chars.len()
            && chars[i + 1].is_ascii_digit()
            && chars[i + 2].is_ascii_digit()
            && chars[i + 3].is_ascii_digit()
            && (i + 4 == chars.len() || !chars[i + 4].is_ascii_digit())
        {
            i += 1;
            continue;
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

#[derive(Default)]
struct GroundedFacts {
    structured_json: bool,
    exact_tokens: HashSet<String>,
    all_floats: Vec<f64>,
    gold_floats: Vec<f64>,
    percent_floats: Vec<f64>,
    cs_floats: Vec<f64>,
    combat_floats: Vec<f64>,
    ward_floats: Vec<f64>,
    time_sec: HashSet<i64>,
    time_min: HashSet<i64>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum UnitKind {
    None,
    Percent,
    Thousand,
    Gold,
    Minutes,
    Seconds,
    Cs,
    CombatCount,
    Ward,
}

fn is_gold_key(key_lower: &str) -> bool {
    key_lower.contains("gold") || key_lower.contains("bounty")
}

fn is_percent_key(key_lower: &str) -> bool {
    key_lower.contains("pct")
        || key_lower.contains("percent")
        || key_lower.contains("share")
        || key_lower.contains("winrate")
}

fn is_cs_key(key_lower: &str) -> bool {
    !is_percent_key(key_lower) && (key_lower.contains("cs") || key_lower.contains("creep"))
}

fn is_combat_key(key_lower: &str) -> bool {
    !is_percent_key(key_lower)
        && (key_lower.contains("kill")
            || key_lower.contains("death")
            || key_lower.contains("assist")
            || key_lower.contains("kda"))
}

fn is_ward_key(key_lower: &str) -> bool {
    !is_percent_key(key_lower) && (key_lower.contains("ward") || key_lower.contains("vision"))
}

fn is_time_sec_key(key_lower: &str) -> bool {
    key_lower.contains("sec") || key_lower.contains("duration") || key_lower.contains("spawn")
}

fn extract_key_minutes(key_lower: &str, facts: &mut GroundedFacts) {
    let bytes = key_lower.as_bytes();
    let mut i = 0;
    while i + 2 < bytes.len() {
        if bytes[i] == b'a' && bytes[i + 1] == b't' && bytes[i + 2].is_ascii_digit() {
            let start = i + 2;
            let mut end = start;
            while end < bytes.len() && bytes[end].is_ascii_digit() && end - start < 2 {
                end += 1;
            }
            if end == bytes.len() || !bytes[end].is_ascii_digit() {
                if let Ok(m) = key_lower[start..end].parse::<i64>() {
                    facts.time_min.insert(m);
                }
            }
            i = end;
        } else {
            i += 1;
        }
    }
}

fn parse_hms_seconds(token: &str) -> Option<i64> {
    let parts: Vec<&str> = token.split(':').collect();
    match parts.as_slice() {
        [m_str, s_str] => {
            let m = m_str.parse::<i64>().ok()?;
            let s = s_str.parse::<i64>().ok()?;
            if m < 0 || !(0..=59).contains(&s) {
                return None;
            }
            m.checked_mul(60)?.checked_add(s)
        }
        [h_str, m_str, s_str] => {
            let h = h_str.parse::<i64>().ok()?;
            let m = m_str.parse::<i64>().ok()?;
            let s = s_str.parse::<i64>().ok()?;
            if h < 0 || !(0..=59).contains(&m) || !(0..=59).contains(&s) {
                return None;
            }
            h.checked_mul(3600)?
                .checked_add(m.checked_mul(60)?)?
                .checked_add(s)
        }
        _ => None,
    }
}

fn classify_unit_word(lower: &str, allow_single_letter: bool) -> UnitKind {
    if allow_single_letter {
        match lower {
            "k" => return UnitKind::Thousand,
            "g" => return UnitKind::Gold,
            "m" => return UnitKind::Minutes,
            "s" => return UnitKind::Seconds,
            _ => {}
        }
    }
    match lower {
        "gold" => UnitKind::Gold,
        "min" | "mins" | "minute" | "minutes" => UnitKind::Minutes,
        "sec" | "secs" | "second" | "seconds" => UnitKind::Seconds,
        "cs" => UnitKind::Cs,
        "kill" | "kills" | "death" | "deaths" | "assist" | "assists" => UnitKind::CombatCount,
        "ward" | "wards" => UnitKind::Ward,
        _ => UnitKind::None,
    }
}

fn classify_unit_at(bytes: &[u8], after_num: usize) -> (UnitKind, String) {
    if after_num < bytes.len() && bytes[after_num] == b'%' {
        return (UnitKind::Percent, "%".to_string());
    }
    let mut w1_end = after_num;
    while w1_end < bytes.len() && bytes[w1_end].is_ascii_alphabetic() {
        w1_end += 1;
    }
    if w1_end > after_num {
        let w1 = std::str::from_utf8(&bytes[after_num..w1_end]).unwrap_or("");
        let kind = classify_unit_word(&w1.to_ascii_lowercase(), true);
        let label = if kind == UnitKind::None {
            String::new()
        } else {
            w1.to_string()
        };
        return (kind, label);
    }

    let mut sp = after_num;
    while sp < bytes.len() && bytes[sp] == b' ' {
        sp += 1;
    }
    if sp > after_num && sp < bytes.len() {
        let mut w2_end = sp;
        while w2_end < bytes.len() && bytes[w2_end].is_ascii_alphabetic() {
            w2_end += 1;
        }
        if w2_end > sp {
            let w2 = std::str::from_utf8(&bytes[sp..w2_end]).unwrap_or("");
            let kind = classify_unit_word(&w2.to_ascii_lowercase(), false);
            if kind != UnitKind::None {
                return (kind, format!(" {w2}"));
            }
        }
    }
    (UnitKind::None, String::new())
}

fn collect_numbers_from_str(text: &str, key_lower: &str, facts: &mut GroundedFacts) {
    let normalized = normalize_comma_thousands(text);
    let bytes = normalized.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        let prev_non_numeric_boundary = i == 0
            || (!bytes[i - 1].is_ascii_alphanumeric()
                && !matches!(bytes[i - 1], b'.' | b':' | b'_'));
        let is_signed_digit =
            matches!(b, b'+' | b'-') && i + 1 < bytes.len() && bytes[i + 1].is_ascii_digit();
        if prev_non_numeric_boundary && (b.is_ascii_digit() || is_signed_digit) {
            let start = i;
            if is_signed_digit {
                i += 1;
            }
            while i < bytes.len()
                && (bytes[i].is_ascii_digit() || bytes[i] == b'.' || bytes[i] == b':')
            {
                i += 1;
            }
            let raw = &normalized[start..i];
            let cleaned = raw.trim_end_matches(['.', ':']);
            let unit_offset = start + cleaned.len();
            let (unit_kind, _) = classify_unit_at(bytes, unit_offset);

            if cleaned.contains(':') {
                if let Some(total) = parse_hms_seconds(cleaned) {
                    facts.exact_tokens.insert(cleaned.to_string());
                    facts.exact_tokens.insert(total.to_string());
                    facts.all_floats.push(total as f64);
                    facts.time_sec.insert(total);
                    facts.time_min.insert(total / 60);
                    facts.time_min.insert((total as f64 / 60.0).round() as i64);
                }
            } else {
                let unsigned = cleaned.trim_start_matches('+');
                facts.exact_tokens.insert(unsigned.to_string());
                if let Ok(val) = unsigned.parse::<f64>() {
                    facts.all_floats.push(val);
                    facts.exact_tokens.insert(format!("{:.1}", val));
                    facts.exact_tokens.insert(format!("{:.2}", val));
                    if is_gold_key(key_lower) || unit_kind == UnitKind::Gold {
                        facts.gold_floats.push(val);
                    } else if unit_kind == UnitKind::Thousand {
                        facts.gold_floats.push(val * 1000.0);
                    }
                    if is_percent_key(key_lower) || unit_kind == UnitKind::Percent {
                        facts.percent_floats.push(val);
                    }
                    if is_cs_key(key_lower) || unit_kind == UnitKind::Cs {
                        facts.cs_floats.push(val);
                    }
                    if is_combat_key(key_lower) || unit_kind == UnitKind::CombatCount {
                        facts.combat_floats.push(val);
                    }
                    if is_ward_key(key_lower) || unit_kind == UnitKind::Ward {
                        facts.ward_floats.push(val);
                    }
                    if unit_kind == UnitKind::Minutes {
                        facts.time_min.insert(val.round() as i64);
                    }
                    if unit_kind == UnitKind::Seconds {
                        let sec = val.round() as i64;
                        facts.time_sec.insert(sec);
                        facts.time_min.insert(sec / 60);
                    }
                }
            }
        } else {
            i += 1;
        }
    }
}

fn collect_json_grounded_tokens(val: &Value, key_lower: &str, facts: &mut GroundedFacts) {
    match val {
        Value::Number(num) => {
            if let Some(i) = num.as_i64() {
                facts.exact_tokens.insert(i.to_string());
                facts.all_floats.push(i as f64);
                if is_gold_key(key_lower) {
                    facts.gold_floats.push(i as f64);
                }
                if is_percent_key(key_lower) {
                    facts.percent_floats.push(i as f64);
                }
                if is_cs_key(key_lower) {
                    facts.cs_floats.push(i as f64);
                }
                if is_combat_key(key_lower) {
                    facts.combat_floats.push(i as f64);
                }
                if is_ward_key(key_lower) {
                    facts.ward_floats.push(i as f64);
                }
                if is_time_sec_key(key_lower) {
                    facts.time_sec.insert(i);
                    facts.time_min.insert(i / 60);
                    facts.time_min.insert((i as f64 / 60.0).round() as i64);
                    if i >= 60 {
                        facts
                            .exact_tokens
                            .insert(format!("{}:{:02}", i / 60, i % 60));
                    }
                } else if i >= 60 {
                    facts
                        .exact_tokens
                        .insert(format!("{}:{:02}", i / 60, i % 60));
                }
            } else if let Some(f) = num.as_f64() {
                facts.all_floats.push(f);
                facts.exact_tokens.insert(format!("{f}"));
                facts.exact_tokens.insert(format!("{:.1}", f));
                facts.exact_tokens.insert(format!("{:.2}", f));
                if is_gold_key(key_lower) {
                    facts.gold_floats.push(f);
                }
                if is_percent_key(key_lower) {
                    facts.percent_floats.push(f);
                }
                if is_cs_key(key_lower) {
                    facts.cs_floats.push(f);
                }
                if is_combat_key(key_lower) {
                    facts.combat_floats.push(f);
                }
                if is_ward_key(key_lower) {
                    facts.ward_floats.push(f);
                }
            }
        }
        Value::String(s) => {
            collect_numbers_from_str(s, key_lower, facts);
        }
        Value::Array(arr) => {
            for item in arr {
                collect_json_grounded_tokens(item, key_lower, facts);
            }
        }
        Value::Object(map) => {
            for (k, v) in map {
                let child_lower = k.to_ascii_lowercase();
                extract_key_minutes(&child_lower, facts);
                collect_numbers_from_str(k, &child_lower, facts);
                let combined_hint = if is_gold_key(&child_lower)
                    || is_percent_key(&child_lower)
                    || is_cs_key(&child_lower)
                    || is_combat_key(&child_lower)
                    || is_ward_key(&child_lower)
                    || is_time_sec_key(&child_lower)
                    || key_lower.is_empty()
                {
                    child_lower
                } else {
                    format!("{key_lower} {child_lower}")
                };
                collect_json_grounded_tokens(v, &combined_hint, facts);
            }
        }
        _ => {}
    }
}

fn same_sign_or_zero(a: f64, b: f64) -> bool {
    a == 0.0 || b == 0.0 || a.is_sign_positive() == b.is_sign_positive()
}

fn matches_value(g: f64, f: f64, explicit_sign: bool, tol: f64) -> bool {
    if (g - f).abs() <= tol && same_sign_or_zero(g, f) {
        return true;
    }
    !explicit_sign && g < 0.0 && (g.abs() - f).abs() <= tol
}

fn strip_list_prefix(line: &str) -> &str {
    let trimmed = line.trim_start();
    let bytes = trimmed.as_bytes();
    let mut i = 0;
    while i < bytes.len() && matches!(bytes[i], b'*' | b'_' | b'`') {
        i += 1;
    }
    let digit_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() && i - digit_start < 2 {
        i += 1;
    }
    if i == digit_start || i >= bytes.len() || !matches!(bytes[i], b'.' | b')') {
        return trimmed;
    }
    i += 1;
    while i < bytes.len() && matches!(bytes[i], b'*' | b'_' | b'`') {
        i += 1;
    }
    if i == bytes.len() || bytes[i].is_ascii_whitespace() {
        trimmed[i..].trim_start()
    } else {
        trimmed
    }
}

/// Validates that an LLM response does not hallucinate metrics, timestamps,
/// percentages, or gold deltas absent from the grounded JSON telemetry context.
pub fn validate_grounded_ai_response(context: &str, response: &str) -> Result<(), Vec<String>> {
    let mut facts = GroundedFacts::default();
    if let Ok(parsed) = serde_json::from_str::<Value>(context) {
        facts.structured_json = true;
        collect_json_grounded_tokens(&parsed, "", &mut facts);
    } else {
        collect_numbers_from_str(context, "", &mut facts);
    }

    let mut ungrounded = Vec::new();
    for line in response.lines() {
        let stripped = strip_list_prefix(line);
        let normalized_line = normalize_comma_thousands(stripped);
        let bytes = normalized_line.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            let b = bytes[i];
            let prev_non_numeric_boundary = i == 0
                || (!bytes[i - 1].is_ascii_alphanumeric()
                    && !matches!(bytes[i - 1], b'.' | b':' | b'_'));
            let is_signed_digit =
                matches!(b, b'+' | b'-') && i + 1 < bytes.len() && bytes[i + 1].is_ascii_digit();
            if prev_non_numeric_boundary && (b.is_ascii_digit() || is_signed_digit) {
                let start = i;
                if is_signed_digit {
                    i += 1;
                }
                while i < bytes.len()
                    && (bytes[i].is_ascii_digit() || bytes[i] == b'.' || bytes[i] == b':')
                {
                    i += 1;
                }
                let raw = &normalized_line[start..i];
                let token = raw.trim_end_matches(['.', ':']);
                if token.is_empty() {
                    continue;
                }
                let (unit_kind, unit_label) = classify_unit_at(bytes, start + token.len());
                if !token.contains(':')
                    && !token.contains('.')
                    && !token.starts_with('+')
                    && !token.starts_with('-')
                    && unit_kind == UnitKind::None
                {
                    if let Ok(n) = token.parse::<i64>() {
                        if (1..=3).contains(&n) {
                            continue;
                        }
                    }
                }

                let explicit_sign = token.starts_with('+') || token.starts_with('-');
                let lookup = token.trim_start_matches('+');
                let is_grounded = if lookup.contains(':') {
                    if let Some(sec) = parse_hms_seconds(lookup) {
                        facts.exact_tokens.contains(lookup)
                            || facts.time_sec.contains(&sec)
                            || sec
                                .checked_sub(1)
                                .is_some_and(|v| facts.time_sec.contains(&v))
                            || sec
                                .checked_add(1)
                                .is_some_and(|v| facts.time_sec.contains(&v))
                            || (!facts.structured_json
                                && (facts.exact_tokens.contains(&sec.to_string())
                                    || sec.checked_sub(1).is_some_and(|v| {
                                        facts.exact_tokens.contains(&v.to_string())
                                    })
                                    || sec.checked_add(1).is_some_and(|v| {
                                        facts.exact_tokens.contains(&v.to_string())
                                    })))
                    } else {
                        false
                    }
                } else if let Ok(f) = lookup.parse::<f64>() {
                    match unit_kind {
                        UnitKind::Thousand => {
                            let pool = if facts.structured_json {
                                &facts.gold_floats
                            } else {
                                &facts.all_floats
                            };
                            let scaled = f * 1000.0;
                            if token.contains('.') {
                                pool.iter()
                                    .any(|&g| matches_value(g, scaled, explicit_sign, 55.0))
                            } else {
                                pool.iter().any(|&g| {
                                    g.abs() >= 500.0
                                        && (g.abs() / 1000.0).round() == f.abs()
                                        && (if explicit_sign {
                                            same_sign_or_zero(g, scaled)
                                        } else {
                                            g <= 0.0 || same_sign_or_zero(g, scaled)
                                        })
                                })
                            }
                        }
                        UnitKind::Gold => {
                            let pool = if facts.structured_json {
                                &facts.gold_floats
                            } else {
                                &facts.all_floats
                            };
                            pool.iter()
                                .any(|&g| matches_value(g, f, explicit_sign, 0.05))
                        }
                        UnitKind::Percent => {
                            let pool = if facts.structured_json {
                                &facts.percent_floats
                            } else {
                                &facts.all_floats
                            };
                            if token.contains('.') {
                                pool.iter()
                                    .any(|&g| matches_value(g, f, explicit_sign, 0.05))
                            } else {
                                pool.iter().any(|&g| {
                                    (g.round() == f
                                        || (!explicit_sign && g < 0.0 && g.abs().round() == f))
                                        && if explicit_sign {
                                            same_sign_or_zero(g, f)
                                        } else {
                                            same_sign_or_zero(g, f) || g < 0.0
                                        }
                                })
                            }
                        }
                        UnitKind::Minutes => {
                            if !explicit_sign
                                && (f - f.round()).abs() <= 0.05
                                && facts.time_min.contains(&(f.round() as i64))
                            {
                                true
                            } else if !facts.structured_json {
                                facts
                                    .all_floats
                                    .iter()
                                    .any(|&g| matches_value(g, f, explicit_sign, 0.05))
                            } else {
                                false
                            }
                        }
                        UnitKind::Seconds => {
                            let sec = f.round() as i64;
                            if !explicit_sign
                                && (f - f.round()).abs() <= 0.05
                                && (facts.time_sec.contains(&sec)
                                    || sec
                                        .checked_sub(1)
                                        .is_some_and(|v| facts.time_sec.contains(&v))
                                    || sec
                                        .checked_add(1)
                                        .is_some_and(|v| facts.time_sec.contains(&v)))
                            {
                                true
                            } else if !facts.structured_json {
                                facts
                                    .all_floats
                                    .iter()
                                    .any(|&g| matches_value(g, f, explicit_sign, 0.05))
                            } else {
                                false
                            }
                        }
                        UnitKind::Cs => {
                            let pool = if facts.structured_json {
                                &facts.cs_floats
                            } else {
                                &facts.all_floats
                            };
                            pool.iter()
                                .any(|&g| matches_value(g, f, explicit_sign, 0.05))
                        }
                        UnitKind::CombatCount => {
                            let pool = if facts.structured_json {
                                &facts.combat_floats
                            } else {
                                &facts.all_floats
                            };
                            pool.iter()
                                .any(|&g| matches_value(g, f, explicit_sign, 0.05))
                        }
                        UnitKind::Ward => {
                            let pool = if facts.structured_json {
                                &facts.ward_floats
                            } else {
                                &facts.all_floats
                            };
                            pool.iter()
                                .any(|&g| matches_value(g, f, explicit_sign, 0.05))
                        }
                        UnitKind::None => {
                            if !explicit_sign
                                && !token.contains('.')
                                && facts.exact_tokens.contains(lookup)
                            {
                                true
                            } else {
                                facts
                                    .all_floats
                                    .iter()
                                    .any(|&g| matches_value(g, f, explicit_sign, 0.05))
                            }
                        }
                    }
                } else {
                    false
                };

                if !is_grounded {
                    ungrounded.push(format!("{token}{unit_label}"));
                }
            } else {
                i += 1;
            }
        }
    }

    if ungrounded.is_empty() {
        Ok(())
    } else {
        Err(ungrounded)
    }
}

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

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProviderErrorDiagnostic {
    message: String,
    retryable: bool,
    retry_after_ms: Option<u64>,
}

fn sanitize_provider_error_detail(body_text: &str) -> String {
    let extracted = serde_json::from_str::<Value>(body_text)
        .ok()
        .and_then(|v| {
            v["error"]["message"]
                .as_str()
                .or_else(|| v["error"].as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| body_text.to_string());
    let cleaned: String = extracted
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    cleaned.chars().take(220).collect()
}

fn parse_retry_after_ms(header: Option<&str>) -> Option<u64> {
    header
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(|secs| secs.saturating_mul(1000).clamp(250, 5_000))
}

fn parse_body_retry_delay_ms(body_text: &str) -> Option<u64> {
    let lower = body_text.to_ascii_lowercase();
    for needle in ["\"retrydelay\"", "retry in "] {
        if let Some(idx) = lower.find(needle) {
            let rest = &lower[idx + needle.len()..];
            let trimmed = rest.trim_start_matches([':', '"', ' ']);
            let num_str: String = trimmed
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if let Ok(secs) = num_str.parse::<f64>() {
                if secs.is_finite() && secs >= 0.0 {
                    return Some(((secs * 1000.0).round() as u64).clamp(250, 5_000));
                }
            }
        }
    }
    None
}

fn classify_provider_http_error(
    provider: &str,
    model: &str,
    status: reqwest::StatusCode,
    retry_after_header: Option<&str>,
    body_text: &str,
) -> ProviderErrorDiagnostic {
    let code = status.as_u16();
    let detail = sanitize_provider_error_detail(body_text);
    let lower_all = format!("{body_text} {detail}").to_ascii_lowercase();
    let suffix = if detail.is_empty() {
        String::new()
    } else {
        format!(" ({detail})")
    };

    if code == 402
        || ((code == 429 || code == 403)
            && (lower_all.contains("prepayment")
                || lower_all.contains("prepaid")
                || lower_all.contains("insufficient balance")
                || lower_all.contains("credit balance")
                || lower_all.contains("billing balance")
                || lower_all.contains("balance greater than")))
    {
        let msg = if provider == "gemini" {
            format!(
                "Google AI Studio requires a positive prepaid balance (>$0, e.g. small minimum top-up) to activate Paid-Tier & GCP/Developer credits, or switch to a Free-Tier model (gemini-4-hydrogen, gemini-3.8-flash, gemini-3.5-flash-lite) in Settings.{suffix}"
            )
        } else if provider == "openai" {
            format!(
                "OpenAI API requires active billing credits (HTTP {code}). Check your OpenAI Platform balance or switch to Google Gemini Free Tier / Local Ollama.{suffix}"
            )
        } else {
            format!("{provider} API returned HTTP {status}.{suffix}")
        };
        return ProviderErrorDiagnostic {
            message: msg,
            retryable: false,
            retry_after_ms: None,
        };
    }

    if code == 429 {
        if lower_all.contains("limit: 0")
            || lower_all.contains("limit:0")
            || lower_all.contains("insufficient_quota")
            || lower_all.contains("prepayment")
            || lower_all.contains("prepaid")
            || lower_all.contains("billing account")
            || lower_all.contains("enable billing")
        {
            let msg = if provider == "gemini" {
                format!(
                    "Gemini model '{model}' has 0 free-tier quota or requires active AI Studio billing (>$0 prepay balance). Switch to a Free-Tier model (gemini-4-hydrogen, gemini-3.8-flash, gemini-3.5-flash-lite) or link/top up billing in AI Studio.{suffix}"
                )
            } else {
                format!(
                    "{provider} API quota or billing credits exhausted (HTTP 429). Check billing and usage limits for your account.{suffix}"
                )
            };
            return ProviderErrorDiagnostic {
                message: msg,
                retryable: false,
                retry_after_ms: None,
            };
        }

        let retry_ms = parse_retry_after_ms(retry_after_header)
            .or_else(|| parse_body_retry_delay_ms(body_text))
            .unwrap_or(1_500);
        return ProviderErrorDiagnostic {
            message: format!(
                "{provider} rate limit reached for '{model}' (HTTP 429 Too Many Requests). Wait briefly or switch to gemini-3.5-flash-lite for higher free-tier headroom.{suffix}"
            ),
            retryable: true,
            retry_after_ms: Some(retry_ms),
        };
    }

    if code == 401 || code == 403 {
        return ProviderErrorDiagnostic {
            message: format!(
                "API key rejected (HTTP {code}). Verify your saved {provider} key in Settings.{suffix}"
            ),
            retryable: false,
            retry_after_ms: None,
        };
    }

    if code == 404 {
        return ProviderErrorDiagnostic {
            message: format!(
                "Model '{model}' was not found on {provider} (HTTP 404). Select a curated preset in Settings -> AI Coach.{suffix}"
            ),
            retryable: false,
            retry_after_ms: None,
        };
    }

    ProviderErrorDiagnostic {
        message: format!("{provider} API returned HTTP {status}.{suffix}"),
        retryable: false,
        retry_after_ms: None,
    }
}

async fn read_capped_error_body(res: reqwest::Response) -> String {
    let bytes = res.bytes().await.unwrap_or_default();
    let capped = &bytes[..bytes.len().min(8_192)];
    String::from_utf8_lossy(capped).to_string()
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

async fn call_ai_provider(
    client: &Client,
    config: &AiCoachConfig,
    api_key: Option<String>,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: Option<u32>,
) -> AppResult<(String, String)> {
    match config.provider.as_str() {
        "gemini" => {
            let key = api_key.ok_or_else(|| {
                AppError::Credential("Save your Gemini API key in Settings first.".to_string())
            })?;
            let model = validate_model_name(&config.model, "gemini-3.8-flash")?;
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            );
            let mut payload = json!({
                "systemInstruction": { "parts": [{ "text": system_prompt }] },
                "contents": [{ "parts": [{ "text": user_prompt }] }]
            });
            if let Some(tokens) = max_tokens {
                payload["generationConfig"] = json!({ "maxOutputTokens": tokens });
            }

            for attempt in 1u64..=3 {
                let res = client
                    .post(&url)
                    .header("x-goog-api-key", &key)
                    .json(&payload)
                    .send()
                    .await
                    .map_err(|e| AppError::AiCoach(format!("Gemini request failed: {e}")))?;

                if res.status().is_success() {
                    let body: Value = res
                        .json()
                        .await
                        .map_err(|e| AppError::AiCoach(e.to_string()))?;
                    let text = body["candidates"][0]["content"]["parts"][0]["text"]
                        .as_str()
                        .unwrap_or("No coaching response generated.")
                        .to_string();
                    return Ok((model, text));
                }

                let status = res.status();
                let retry_after = res
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                let body_text = read_capped_error_body(res).await;
                let diag = classify_provider_http_error(
                    "gemini",
                    &model,
                    status,
                    retry_after.as_deref(),
                    &body_text,
                );
                if diag.retryable && attempt < 3 {
                    let delay_ms = diag
                        .retry_after_ms
                        .unwrap_or_else(|| 1_000 * attempt)
                        .min(5_000);
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    continue;
                }
                return Err(AppError::AiCoach(diag.message));
            }
            Err(AppError::AiCoach(
                "Gemini rate limit exceeded after retries.".to_string(),
            ))
        }
        "openai" => {
            let key = api_key.ok_or_else(|| {
                AppError::Credential("Save your OpenAI API key in Settings first.".to_string())
            })?;
            let model = validate_model_name(&config.model, "gpt-6-luna")?;
            let mut payload = json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": user_prompt }
                ]
            });
            if let Some(tokens) = max_tokens {
                payload["max_completion_tokens"] = json!(tokens);
            }

            for attempt in 1u64..=3 {
                let res = client
                    .post("https://api.openai.com/v1/chat/completions")
                    .bearer_auth(&key)
                    .json(&payload)
                    .send()
                    .await
                    .map_err(|e| AppError::AiCoach(format!("OpenAI request failed: {e}")))?;

                if res.status().is_success() {
                    let body: Value = res
                        .json()
                        .await
                        .map_err(|e| AppError::AiCoach(e.to_string()))?;
                    let text = body["choices"][0]["message"]["content"]
                        .as_str()
                        .unwrap_or("No coaching response generated.")
                        .to_string();
                    return Ok((model, text));
                }

                let status = res.status();
                let retry_after = res
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                let body_text = read_capped_error_body(res).await;
                let diag = classify_provider_http_error(
                    "openai",
                    &model,
                    status,
                    retry_after.as_deref(),
                    &body_text,
                );
                if diag.retryable && attempt < 3 {
                    let delay_ms = diag
                        .retry_after_ms
                        .unwrap_or_else(|| 1_000 * attempt)
                        .min(5_000);
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                    continue;
                }
                return Err(AppError::AiCoach(diag.message));
            }
            Err(AppError::AiCoach(
                "OpenAI rate limit exceeded after retries.".to_string(),
            ))
        }
        "ollama" => {
            let base = validate_ollama_endpoint(&config.endpoint)?;
            let url = base
                .join("api/generate")
                .map_err(|e| AppError::AiCoach(e.to_string()))?;
            let model = validate_model_name(&config.model, "llama3.1:8b")?;
            let mut payload = json!({
                "model": model,
                "prompt": format!("{system_prompt}\n\n{user_prompt}"),
                "stream": false
            });
            if let Some(tokens) = max_tokens {
                payload["options"] = json!({ "num_predict": tokens });
            }
            let res = client
                .post(url)
                .json(&payload)
                .send()
                .await
                .map_err(|e| AppError::AiCoach(format!("Ollama request failed: {e}")))?;

            if !res.status().is_success() {
                let status = res.status();
                let body_text = read_capped_error_body(res).await;
                let diag = classify_provider_http_error("ollama", &model, status, None, &body_text);
                return Err(AppError::AiCoach(diag.message));
            }
            let body: Value = res
                .json()
                .await
                .map_err(|e| AppError::AiCoach(e.to_string()))?;
            let text = body["response"]
                .as_str()
                .unwrap_or("No coaching response generated.")
                .to_string();
            Ok((model, text))
        }
        _ => Err(AppError::AiCoach(
            "AI Coach is currently set to Off in Settings.".to_string(),
        )),
    }
}

pub async fn generate_ai_debrief(
    client: &Client,
    config: &AiCoachConfig,
    api_key: Option<String>,
    context: &str,
) -> AppResult<String> {
    let system_prompt = "You are a concise, constructive League of Legends jungle coach. Give 3-4 actionable bullet points focusing on pathing, objectives, vision, and macro. STRICT FACTUAL GROUNDING: cite ONLY numbers, timestamps, percentages, or gold figures present in the JSON telemetry context. Never invent or estimate unprovided statistics or summoner names.";

    let (_model, raw_text) =
        call_ai_provider(client, config, api_key, system_prompt, context, None).await?;

    if let Err(ungrounded) = validate_grounded_ai_response(context, &raw_text) {
        return Err(AppError::AiCoach(format!(
            "AI Coach response rejected by numeric fact validator — invented or ungrounded figures: {}",
            ungrounded.join(", ")
        )));
    }

    Ok(raw_text)
}

pub async fn test_ai_connection(
    client: &Client,
    config: &AiCoachConfig,
    api_key: Option<String>,
) -> AppResult<String> {
    if config.provider == "off" {
        return Err(AppError::AiCoach(
            "Select an AI provider (Google Gemini, OpenAI, or Local Ollama) first.".to_string(),
        ));
    }
    let provider_label = match config.provider.as_str() {
        "gemini" => "Google Gemini",
        "openai" => "OpenAI",
        "ollama" => "Local Ollama",
        other => other,
    };
    let (resolved_model, _reply) = call_ai_provider(
        client,
        config,
        api_key,
        "Reply with OK.",
        "Connection test.",
        Some(8),
    )
    .await?;
    Ok(format!(
        "Connected to {provider_label} ({resolved_model}) — ready for coaching debriefs."
    ))
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

    #[test]
    fn rejects_hallucinated_numbers_while_accepting_grounded_telemetry_summaries() {
        let context = serde_json::json!({
            "championName": "Viego",
            "durationSeconds": 1825,
            "grade": "B",
            "kpis": {
                "csPerMin": 6.4,
                "goldDiffAt15": -320,
                "objectiveSharePct": 50,
                "preObjectiveDeaths": 1
            }
        })
        .to_string();

        let grounded_reply = "\
**1.** Keep clearing toward bot side: your 6.4 CS/min held steady through 30:25.\n\
**4.** Avoid trading down 320g (-320g) before Dragon setups — keep 1 Control Ward ready so 50% objective share rises.";
        assert!(validate_grounded_ai_response(&context, grounded_reply).is_ok());

        let hallucinated_reply = "\
1. Your **9.8 CS/min** crushed the 78.4% benchmark while gaining +1,450g before **22:15** (~1,000 bonus).";
        let errs = validate_grounded_ai_response(&context, hallucinated_reply)
            .expect_err("must reject invented stats");
        assert!(errs.iter().any(|t| t.contains("9.8")));
        assert!(errs.iter().any(|t| t.contains("78.4")));
        assert!(errs
            .iter()
            .any(|t| t.contains("+1450g") || t.contains("1450")));
        assert!(errs.iter().any(|t| t.contains("22:15")));

        let subtle_hallucination = "Your **+320g** lead came with **5.9** CS/min and 2k gold.";
        let subtle_errs = validate_grounded_ai_response(&context, subtle_hallucination)
            .expect_err("must reject flipped sign, near-rounding decimal, and 2k unit");
        assert!(subtle_errs.iter().any(|t| t.contains("320")));
        assert!(subtle_errs.iter().any(|t| t.contains("5.9")));
        assert!(subtle_errs.iter().any(|t| t.contains("2k")));
    }

    #[test]
    fn closes_decimal_bypass_and_validates_unit_scaling_and_hms_parity() {
        let win_con_context = serde_json::json!({
            "championName": "Viego",
            "durationSeconds": 3735,
            "keyLevels": [4, 6, 11, 16],
            "kpis": {
                "csPerMin": 6.4,
                "goldDiffAt15": 1825,
                "objectiveSharePct": 50,
                "visionNegDelta": -3.22
            },
            "objectiveSpawnsSec": {
                "scuttle": 210,
                "dragon": 300,
                "herald": 840,
                "baron": 1500
            },
            "totalGold": 1234567
        })
        .to_string();

        let valid_text = "\
**10.** At 15m your 1.8k gold lead paired cleanly with Herald at 14m and Baron at 25 minutes.\n\
__4.__ Past S14 / patch16.23, 1:02:15 (total 1,234,567) keeps vision near 3.2.";
        assert!(validate_grounded_ai_response(&win_con_context, valid_text).is_ok());

        assert!(validate_grounded_ai_response(&win_con_context, "9.2 CS/min was strong.").is_err());
        assert!(
            validate_grounded_ai_response(&win_con_context, "**500.2** CS/min was strong.")
                .is_err()
        );
        assert!(validate_grounded_ai_response(&win_con_context, "9.*2 CS/min").is_err());
        assert!(validate_grounded_ai_response(&win_con_context, "Push a 6k gold lead.").is_err());
        assert!(
            validate_grounded_ai_response(&win_con_context, "Save 50g for components.").is_err()
        );
        assert!(validate_grounded_ai_response(
            &serde_json::json!({ "kpis": { "csPerMin": 6.4 } }).to_string(),
            "Hit 6 CS/min."
        )
        .is_err());

        let overflow_ctx = serde_json::json!({ "durationSeconds": 1825 }).to_string();
        assert!(validate_grounded_ai_response(&overflow_ctx, "Ended at 29:85.").is_err());
        assert!(validate_grounded_ai_response(&overflow_ctx, "Ended at 0:1825.").is_err());
        assert!(validate_grounded_ai_response(
            &serde_json::json!({ "durationSeconds": 43230 }).to_string(),
            "Ended at 12::30."
        )
        .is_err());

        assert!(validate_grounded_ai_response(&win_con_context, "Secured 6 kills early.").is_err());
        assert!(validate_grounded_ai_response(&overflow_ctx, "Farmed 1825 CS total.").is_err());

        let signed_ctx = serde_json::json!({
            "kpis": { "goldDiffAt15": -320, "csPerMin": 6.4 }
        })
        .to_string();
        assert!(validate_grounded_ai_response(
            &signed_ctx,
            "*10.* Down \u{2212}320g at 6.4 CS/min."
        )
        .is_ok());
        assert!(validate_grounded_ai_response(
            &serde_json::json!({ "kpis": { "goldDiffAt15": 320 } }).to_string(),
            "Down \u{2212}320g early."
        )
        .is_err());
    }

    #[test]
    fn classifies_provider_http_errors_for_billing_quota_and_retry() {
        let gemini_limit_zero = classify_provider_http_error(
            "gemini",
            "gemini-4-neon",
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            None,
            r#"{"error":{"code":429,"message":"Quota exceeded for quota metric 'Requests', limit: 0 of model gemini-4-neon","status":"RESOURCE_EXHAUSTED"}}"#,
        );
        assert!(!gemini_limit_zero.retryable);
        assert!(gemini_limit_zero.message.contains("gemini-4-neon"));
        assert!(gemini_limit_zero.message.contains("gemini-4-hydrogen"));
        assert!(gemini_limit_zero.message.contains("gemini-3.8-flash"));

        let gemini_prepay = classify_provider_http_error(
            "gemini",
            "gemini-4-neon",
            reqwest::StatusCode::PAYMENT_REQUIRED,
            None,
            r#"{"error":{"message":"402 - Prepayment credits depleted; balance greater than $0 required."}}"#,
        );
        assert!(!gemini_prepay.retryable);
        assert!(gemini_prepay.message.contains(">$0"));

        let openai_prepay = classify_provider_http_error(
            "openai",
            "gpt-6-luna",
            reqwest::StatusCode::PAYMENT_REQUIRED,
            None,
            r#"{"error":{"message":"Insufficient balance on your account."}}"#,
        );
        assert!(!openai_prepay.retryable);
        assert!(openai_prepay.message.contains("OpenAI API"));
        assert!(!openai_prepay.message.contains("Google AI Studio"));

        let gemini_real_transient = classify_provider_http_error(
            "gemini",
            "gemini-3.8-flash",
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            None,
            r#"{"error":{"message":"You exceeded your current quota, please check your plan and billing details. Please retry in 2s.","details":[{"retryDelay":"39s"}]}}"#,
        );
        assert!(gemini_real_transient.retryable);
        assert_eq!(gemini_real_transient.retry_after_ms, Some(5_000));

        let gemini_transient = classify_provider_http_error(
            "gemini",
            "gemini-3.8-flash",
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            Some("2"),
            r#"{"error":{"message":"You exceeded your current quota, please check your plan and billing details."}}"#,
        );
        assert!(gemini_transient.retryable);
        assert_eq!(gemini_transient.retry_after_ms, Some(2_000));

        let gemini_clamped = classify_provider_http_error(
            "gemini",
            "gemini-3.8-flash",
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            Some("60"),
            "Too many requests",
        );
        assert!(gemini_clamped.retryable);
        assert_eq!(gemini_clamped.retry_after_ms, Some(5_000));

        let openai_quota = classify_provider_http_error(
            "openai",
            "gpt-6-luna",
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            None,
            r#"{"error":{"code":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details."}}"#,
        );
        assert!(!openai_quota.retryable);

        let not_found = classify_provider_http_error(
            "gemini",
            "gemini-does-not-exist",
            reqwest::StatusCode::NOT_FOUND,
            None,
            "Model not found",
        );
        assert!(!not_found.retryable);
        assert!(not_found.message.contains("HTTP 404"));
        assert!(not_found.message.contains("preset"));
    }
}
