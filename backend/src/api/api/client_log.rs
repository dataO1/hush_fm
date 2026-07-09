//! Client-log beacon endpoint: `POST /api/client-log`.
//!
//! The frontend POSTs a JSON body when something bad happens on a client
//! (terminal error / uncaught exception / pagehide) — NOT a ring buffer, just
//! the error report(s) for that event. This lets the next party post-mortem be
//! driven by data instead of guesswork.
//!
//! Server behaviour (design decisions locked):
//!
//! * **File per entity.** One newline-delimited-JSON (`.jsonl`) file per
//!   device-id under the configured log dir (default `client-logs/`). Each POST
//!   appends one line: the received body plus a server-side `received_at`
//!   timestamp. The server's own tracing log is kept separate (we do NOT merge
//!   client logs into it).
//! * **Rate-limited per device.** A broken client must not spam-write the Pi's
//!   SD card. We cap writes per rolling minute per device-id; requests over the
//!   cap are dropped (still answered 204 so the client never blocks/retries).
//! * **Path-traversal safe.** The device-id is sanitized to a filesystem-safe
//!   slug (alphanumerics / `-` / `_` only, length-capped); everything else
//!   becomes `_`. No `..`, `/`, or absolute paths can escape the log dir.
//! * **Best-effort & non-blocking.** The endpoint returns 204 quickly. The file
//!   append runs on a blocking thread; any IO error is logged server-side and
//!   swallowed (the client is not the place to surface Pi disk problems).
//! * **All local / offline Pi.** PII in the payload is fine (own party).
//!
//! Env overrides (read inline, sane defaults):
//! * `HUSHFM_CLIENT_LOG_DIR`        — log directory (default `client-logs`).
//! * `HUSHFM_CLIENT_LOG_MAX_PER_MIN` — max writes/min per device (default `30`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
use serde::Deserialize;

use crate::lib::domain::Lobby;

/// Default directory (relative to the server working dir) for per-device logs.
const DEFAULT_LOG_DIR: &str = "client-logs";
/// Default per-device write cap per rolling minute.
const DEFAULT_MAX_PER_MIN: u32 = 30;
/// Hard cap on sanitized device-id length (filesystem safety / sanity).
const MAX_DEVICE_ID_LEN: usize = 128;

/// Wire the `POST /api/client-log` route. Nested under `/api` by the caller.
pub fn client_log_router() -> Router<Lobby> {
    Router::new().route("/client-log", post(client_log))
}

/// Client-log request body. All fields optional/loose on purpose — a client
/// that is already failing must still be able to report *something*, and we
/// never want a schema mismatch to drop a post-mortem breadcrumb. The whole
/// body is re-serialized into the JSONL line, so unknown extra fields are kept.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientLogBody {
    /// Stable per-device id (used as the log filename, after sanitizing).
    device_id: Option<String>,
    /// Role of the reporting client: "dj" | "listener".
    role: Option<String>,
    /// Room id the client was in, if any.
    room_id: Option<String>,
    /// User-Agent string.
    ua: Option<String>,
    /// App build / version tag from the frontend.
    app_build: Option<String>,
    /// The error payload(s): message / stack / context lines. Free-form.
    #[serde(default)]
    errors: serde_json::Value,
    /// Catch-all for any additional fields the client attaches.
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

/// Resolved config (dir + cap), computed once from env.
struct ClientLogConfig {
    dir: PathBuf,
    max_per_min: u32,
}

fn config() -> &'static ClientLogConfig {
    static CONFIG: OnceLock<ClientLogConfig> = OnceLock::new();
    CONFIG.get_or_init(|| {
        let dir = std::env::var("HUSHFM_CLIENT_LOG_DIR")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_LOG_DIR));

        let max_per_min = std::env::var("HUSHFM_CLIENT_LOG_MAX_PER_MIN")
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .filter(|&n| n > 0)
            .unwrap_or(DEFAULT_MAX_PER_MIN);

        ClientLogConfig { dir, max_per_min }
    })
}

/// Per-device rolling-window rate limiter state: device slug -> (window start,
/// writes in this window). A plain Mutex<HashMap> is ample: writes are rare
/// (only on client failure) and the endpoint is best-effort.
fn rate_limiter() -> &'static Mutex<HashMap<String, (Instant, u32)>> {
    static LIMITER: OnceLock<Mutex<HashMap<String, (Instant, u32)>>> = OnceLock::new();
    LIMITER.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Returns true if a write is allowed for `slug` right now (and records it).
fn allow_write(slug: &str, max_per_min: u32) -> bool {
    let window = Duration::from_secs(60);
    let now = Instant::now();
    let mut map = match rate_limiter().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(), // never poison-fail a beacon
    };

    let entry = map.entry(slug.to_string()).or_insert((now, 0));
    if now.duration_since(entry.0) >= window {
        // Window elapsed: reset.
        *entry = (now, 0);
    }

    if entry.1 >= max_per_min {
        false
    } else {
        entry.1 += 1;
        true
    }
}

/// Sanitize a device-id into a filesystem-safe slug. Keeps ASCII
/// alphanumerics, `-` and `_`; replaces everything else (including `.`, `/`,
/// `\`, path separators) with `_`. This makes path traversal impossible: the
/// result contains no separators and no `..`. Length-capped; empty/degenerate
/// ids fall back to "unknown".
fn sanitize_device_id(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len().min(MAX_DEVICE_ID_LEN));
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('_');
        }
        if out.len() >= MAX_DEVICE_ID_LEN {
            break;
        }
    }
    let trimmed = out.trim_matches('_');
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Handler: accept the beacon, best-effort persist, return 204 quickly.
///
/// We never return an error to the client — a client that is already failing
/// gains nothing from a non-2xx, and a `sendBeacon`/`keepalive` fetch on
/// pagehide can't act on it anyway.
async fn client_log(
    State(_lobby): State<Lobby>,
    Json(body): Json<ClientLogBody>,
) -> StatusCode {
    let cfg = config();

    let raw_device_id = body.device_id.clone().unwrap_or_default();
    let slug = sanitize_device_id(&raw_device_id);

    // Rate-limit BEFORE touching the filesystem so a spamming client can't
    // hammer the SD card.
    if !allow_write(&slug, cfg.max_per_min) {
        tracing::debug!(
            device = %slug,
            "client-log: dropped over per-device rate limit"
        );
        return StatusCode::NO_CONTENT;
    }

    // Build the JSONL line: original body fields + a server-side timestamp.
    let line = build_log_line(&body, &raw_device_id);

    let dir = cfg.dir.clone();
    let file_name = format!("{slug}.jsonl");

    // Do the blocking file IO off the async runtime; don't await the result on
    // the hot path beyond spawning — the response returns immediately.
    tokio::task::spawn_blocking(move || {
        if let Err(e) = append_line(&dir, &file_name, &line) {
            tracing::warn!(error = %e, file = %file_name, "client-log: failed to persist entry");
        }
    });

    StatusCode::NO_CONTENT
}

/// Serialize the beacon into a single JSON object (one JSONL line).
fn build_log_line(body: &ClientLogBody, raw_device_id: &str) -> String {
    let mut obj = serde_json::Map::new();
    obj.insert(
        "receivedAt".to_string(),
        serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
    );
    obj.insert(
        "deviceId".to_string(),
        serde_json::Value::String(raw_device_id.to_string()),
    );
    if let Some(role) = &body.role {
        obj.insert("role".to_string(), serde_json::Value::String(role.clone()));
    }
    if let Some(room_id) = &body.room_id {
        obj.insert("roomId".to_string(), serde_json::Value::String(room_id.clone()));
    }
    if let Some(ua) = &body.ua {
        obj.insert("ua".to_string(), serde_json::Value::String(ua.clone()));
    }
    if let Some(app_build) = &body.app_build {
        obj.insert("appBuild".to_string(), serde_json::Value::String(app_build.clone()));
    }
    if !body.errors.is_null() {
        obj.insert("errors".to_string(), body.errors.clone());
    }
    for (k, v) in &body.extra {
        obj.entry(k.clone()).or_insert_with(|| v.clone());
    }

    // Should never fail (map of JSON values), but degrade gracefully.
    serde_json::to_string(&serde_json::Value::Object(obj))
        .unwrap_or_else(|_| "{\"receivedAt\":null,\"error\":\"serialize_failed\"}".to_string())
}

/// Append a single line (newline-terminated) to `<dir>/<file_name>`, creating
/// the directory on first use. Blocking; call from `spawn_blocking`.
fn append_line(dir: &PathBuf, file_name: &str, line: &str) -> std::io::Result<()> {
    use std::io::Write;

    std::fs::create_dir_all(dir)?;
    let path = dir.join(file_name);
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    file.write_all(line.as_bytes())?;
    file.write_all(b"\n")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_blocks_path_traversal() {
        assert_eq!(sanitize_device_id("../../etc/passwd"), "etc_passwd");
        assert_eq!(sanitize_device_id("a/b/c"), "a_b_c");
        assert_eq!(sanitize_device_id("..\\..\\x"), "x");
        assert_eq!(sanitize_device_id("/absolute"), "absolute");
    }

    #[test]
    fn sanitize_keeps_safe_chars() {
        assert_eq!(sanitize_device_id("device-123_ABC"), "device-123_ABC");
    }

    #[test]
    fn sanitize_empty_falls_back() {
        assert_eq!(sanitize_device_id(""), "unknown");
        assert_eq!(sanitize_device_id("..."), "unknown");
    }

    #[test]
    fn sanitize_length_capped() {
        let long = "x".repeat(500);
        assert!(sanitize_device_id(&long).len() <= MAX_DEVICE_ID_LEN);
    }

    #[test]
    fn rate_limit_caps_per_device() {
        let slug = "rl-test-device";
        // First `cap` writes allowed, the next dropped.
        let cap = 3;
        for _ in 0..cap {
            assert!(allow_write(slug, cap));
        }
        assert!(!allow_write(slug, cap));
    }
}
