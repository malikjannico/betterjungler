use std::collections::HashMap;
use std::time::Duration;

use reqwest::header::HeaderMap;
use tokio::sync::Mutex;
use tokio::time::Instant;

#[derive(Debug, Default)]
struct BucketState {
    blocked_until: Option<Instant>,
    last_request_at: Option<Instant>,
}

/// Shared rate-limit coordinator for official Riot Web API routes.
/// Honors HTTP 429 `Retry-After` headers and enforces conservative global/bucket pacing.
#[derive(Debug, Default)]
pub struct RiotRateLimiter {
    buckets: Mutex<HashMap<String, BucketState>>,
    min_spacing: Duration,
}

impl RiotRateLimiter {
    pub fn new(min_spacing: Duration) -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
            min_spacing,
        }
    }

    pub fn with_default_pacing() -> Self {
        Self::new(Duration::from_millis(65))
    }

    /// Waits for any active cooldown or minimum spacing window on global and bucket limits.
    pub async fn acquire(&self, bucket: &str) {
        loop {
            let wait_duration = {
                let mut map = self.buckets.lock().await;
                let now = Instant::now();
                let global_state = map.get("global");
                let global_wait = global_state
                    .and_then(|s| s.blocked_until)
                    .and_then(|until| until.checked_duration_since(now));
                let global_spacing = global_state
                    .and_then(|s| s.last_request_at)
                    .map(|last| last + self.min_spacing)
                    .and_then(|until| until.checked_duration_since(now));

                let entry = map.entry(bucket.to_string()).or_default();
                let bucket_wait = entry
                    .blocked_until
                    .and_then(|until| until.checked_duration_since(now));
                let spacing_wait = entry
                    .last_request_at
                    .map(|last| last + self.min_spacing)
                    .and_then(|until| until.checked_duration_since(now));

                let next_wait = [global_wait, global_spacing, bucket_wait, spacing_wait]
                    .into_iter()
                    .flatten()
                    .max();

                if next_wait.is_none() {
                    entry.last_request_at = Some(now);
                    let global_mut = map.entry("global".to_string()).or_default();
                    global_mut.last_request_at = Some(now);
                    None
                } else {
                    next_wait
                }
            };

            match wait_duration {
                Some(dur) if !dur.is_zero() => tokio::time::sleep(dur).await,
                _ => return,
            }
        }
    }

    /// Records a 429 backoff window for both the endpoint bucket and optional global limit.
    pub async fn record_rate_limit(&self, bucket: &str, retry_after_secs: u64, is_app_limit: bool) {
        let clamped = retry_after_secs.clamp(1, 120);
        let until = Instant::now() + Duration::from_secs(clamped);
        let mut map = self.buckets.lock().await;
        let entry = map.entry(bucket.to_string()).or_default();
        entry.blocked_until = Some(until);
        if is_app_limit {
            let global = map.entry("global".to_string()).or_default();
            global.blocked_until = Some(until);
        }
    }

    /// Reads Riot `X-App-Rate-Limit` / `X-App-Rate-Limit-Count` headers to proactively pace near caps.
    pub async fn observe_headers(&self, bucket: &str, headers: &HeaderMap) {
        if near_rate_cap(headers, "x-app-rate-limit", "x-app-rate-limit-count") {
            let until = Instant::now() + Duration::from_millis(900);
            let mut map = self.buckets.lock().await;
            let global = map.entry("global".to_string()).or_default();
            global.blocked_until = Some(until);
        } else if near_rate_cap(headers, "x-method-rate-limit", "x-method-rate-limit-count") {
            let until = Instant::now() + Duration::from_millis(600);
            let mut map = self.buckets.lock().await;
            let entry = map.entry(bucket.to_string()).or_default();
            entry.blocked_until = Some(until);
        }
    }
}

fn near_rate_cap(headers: &HeaderMap, limit_hdr: &str, count_hdr: &str) -> bool {
    let Some(limits_raw) = headers.get(limit_hdr).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let Some(counts_raw) = headers.get(count_hdr).and_then(|v| v.to_str().ok()) else {
        return false;
    };

    for (lim_pair, cnt_pair) in limits_raw.split(',').zip(counts_raw.split(',')) {
        let lim = lim_pair
            .split(':')
            .next()
            .and_then(|s| s.trim().parse::<u64>().ok());
        let cnt = cnt_pair
            .split(':')
            .next()
            .and_then(|s| s.trim().parse::<u64>().ok());
        if let (Some(l), Some(c)) = (lim, cnt) {
            if l > 2 && c >= l.saturating_sub(1) {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    #[test]
    fn detects_near_rate_limit_header_thresholds() {
        let mut headers = HeaderMap::new();
        headers.insert("x-app-rate-limit", HeaderValue::from_static("20:1,100:120"));
        headers.insert("x-app-rate-limit-count", HeaderValue::from_static("19:1,42:120"));
        assert!(near_rate_cap(&headers, "x-app-rate-limit", "x-app-rate-limit-count"));

        headers.insert("x-app-rate-limit-count", HeaderValue::from_static("5:1,42:120"));
        assert!(!near_rate_cap(&headers, "x-app-rate-limit", "x-app-rate-limit-count"));
    }

    #[tokio::test]
    async fn rate_limiter_enforces_cooldown_window() {
        let limiter = RiotRateLimiter::new(Duration::from_millis(5));
        limiter.record_rate_limit("match-v5", 1, false).await;
        let start = Instant::now();
        limiter.acquire("match-v5").await;
        assert!(start.elapsed() >= Duration::from_millis(900));
    }
}
