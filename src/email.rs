//! Independent, read-only email workspace over the existing machine transport.
use crate::{ApiError, AppState};
use axum::{
    Json, Router,
    extract::State,
    http::{StatusCode, header},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    io::Write,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, Semaphore};
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Source {
    host: String,
    project: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Settings {
    revision: String,
    source: Option<Source>,
}
struct Cached {
    key: String,
    value: Value,
    at: Instant,
    bytes: usize,
}
pub(crate) struct Email {
    settings: Mutex<Settings>,
    path: Option<PathBuf>,
    cache: Mutex<VecDeque<Cached>>,
    slot: Semaphore,
    cooldown: Mutex<Option<(String, Instant)>>,
}
impl Email {
    pub fn new(path: Option<PathBuf>) -> anyhow::Result<Self> {
        let settings = match path.as_ref().filter(|p| p.exists()) {
            Some(p) => serde_json::from_slice(&std::fs::read(p)?)?,
            None => Settings {
                revision: uuid::Uuid::new_v4().to_string(),
                source: None,
            },
        };
        Ok(Self {
            settings: Mutex::new(settings),
            path,
            cache: Mutex::new(VecDeque::new()),
            slot: Semaphore::new(2),
            cooldown: Mutex::new(None),
        })
    }
}
fn error(status: StatusCode, text: &str) -> ApiError {
    ApiError(status, text.into())
}
async fn no_store(request: axum::extract::Request, next: Next) -> Response {
    let mut r = next.run(request).await;
    r.headers_mut()
        .insert(header::CACHE_CONTROL, "private, no-store".parse().unwrap());
    r
}
pub(crate) fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v1/email/settings", get(settings).put(save))
        .route("/api/v1/email/read", post(read))
        .layer(axum::extract::DefaultBodyLimit::max(16384))
        .layer(middleware::from_fn(no_store))
}
async fn settings(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let s = state.email.settings.lock().await.clone();
    let machine = if let Some(source) = &s.source {
        state.registry.get(&source.host).await.ok()
    } else {
        None
    };
    Ok(Json(
        json!({"revision":s.revision,"source":s.source,"connection_revision":machine.map(|m|m.connection_revision.clone())}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Change {
    revision: String,
    host: String,
    connection_revision: String,
    project: String,
}
async fn save(
    State(state): State<Arc<AppState>>,
    Json(b): Json<Change>,
) -> Result<Json<Value>, ApiError> {
    if !b.project.starts_with('/')
        || b.project.len() > 4096
        || b.project.chars().any(char::is_control)
    {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Use an absolute source project directory",
        ));
    }
    let machine = state.registry.get(&b.host).await?;
    let _guard = machine.file_writes.lock().await;
    if machine.connection_revision != b.connection_revision
        || state.registry.get(&b.host).await?.connection_revision != b.connection_revision
    {
        return Err(error(
            StatusCode::CONFLICT,
            "Email source machine changed; reload settings",
        ));
    }
    let mut s = state.email.settings.lock().await;
    if s.revision != b.revision {
        return Err(error(
            StatusCode::CONFLICT,
            "Email settings changed; reload settings",
        ));
    }
    let updated = Settings {
        revision: uuid::Uuid::new_v4().to_string(),
        source: Some(Source {
            host: b.host,
            project: b.project,
        }),
    };
    if let Some(path) = state.email.path.clone() {
        let bytes = serde_json::to_vec_pretty(&updated).unwrap();
        tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            let parent = path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(std::path::Path::new("."));
            let mut f = tempfile::NamedTempFile::new_in(parent)?;
            f.write_all(&bytes)?;
            f.as_file().sync_all()?;
            f.persist(path).map_err(|e| e.error)?;
            Ok(())
        })
        .await
        .map_err(|_| {
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not save Email settings",
            )
        })?
        .map_err(|_| {
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not save Email settings",
            )
        })?;
    }
    *s = updated;
    state.email.cache.lock().await.clear();
    *state.email.cooldown.lock().await = None;
    drop(s);
    settings(State(state)).await
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Query {
    revision: String,
    connection_revision: String,
    operation: String,
    id: Option<String>,
    label: Option<String>,
    query: Option<String>,
    cursor: Option<String>,
    #[serde(default)]
    refresh: bool,
}
fn valid(q: &Query) -> bool {
    ["labels", "messages", "thread"].contains(&q.operation.as_str())
        && (q.operation != "thread"
            || q.id.as_ref().is_some_and(|v| {
                !v.is_empty() && v.len() <= 64 && v.bytes().all(|c| c.is_ascii_hexdigit())
            }))
        && q.label.as_ref().is_none_or(|v| {
            v.len() <= 128
                && v.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
        })
        && [(q.query.as_deref(), 1000), (q.cursor.as_deref(), 2048)]
            .iter()
            .all(|(v, n)| v.is_none_or(|v| v.len() <= *n && !v.chars().any(char::is_control)))
}
async fn read(
    State(state): State<Arc<AppState>>,
    Json(b): Json<Query>,
) -> Result<Json<Value>, ApiError> {
    if !valid(&b) {
        return Err(error(StatusCode::BAD_REQUEST, "Invalid Email read request"));
    }
    let s = state.email.settings.lock().await.clone();
    if s.revision != b.revision {
        return Err(error(
            StatusCode::CONFLICT,
            "Email source changed; reload settings",
        ));
    }
    let source = s
        .source
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, "Configure an Email source first"))?;
    let machine = state.registry.get(&source.host).await?;
    if machine.connection_revision != b.connection_revision {
        return Err(error(
            StatusCode::CONFLICT,
            "Email connection changed; reload settings",
        ));
    }
    let scope = format!("{}/{}", b.revision, b.connection_revision);
    let mut key = serde_json::to_value(&b).unwrap();
    key.as_object_mut().unwrap().remove("refresh");
    let key = key.to_string();
    if !b.refresh {
        let cached = {
            let cache = state.email.cache.lock().await;
            cache
                .iter()
                .find(|v| v.key == key && v.at.elapsed() < Duration::from_secs(30))
                .map(|v| v.value.clone())
        };
        if let Some(value) = cached {
            if state.email.settings.lock().await.revision != b.revision
                || state.registry.get(&source.host).await?.connection_revision
                    != b.connection_revision
            {
                return Err(error(
                    StatusCode::CONFLICT,
                    "Email source changed; reload settings",
                ));
            }
            return Ok(Json(value));
        }
    }
    if state
        .email
        .cooldown
        .lock()
        .await
        .as_ref()
        .is_some_and(|(s, t)| s == &scope && *t > Instant::now())
    {
        return Err(error(
            StatusCode::TOO_MANY_REQUESTS,
            "Email rate limited; wait before refreshing",
        ));
    }
    let _slot = tokio::time::timeout(Duration::from_secs(2), state.email.slot.acquire())
        .await
        .map_err(|_| {
            error(
                StatusCode::TOO_MANY_REQUESTS,
                "Email reads busy; try again shortly",
            )
        })?
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "Email unavailable"))?;
    let response=machine.transport.email_request(&source.project,json!({"operation":b.operation,"id":b.id,"label":b.label,"query":b.query,"cursor":b.cursor})).await.map_err(|_|error(StatusCode::BAD_GATEWAY,"Email source unavailable; check the source machine connection"))?;
    if state.email.settings.lock().await.revision != b.revision
        || state.registry.get(&source.host).await?.connection_revision != b.connection_revision
    {
        return Err(error(
            StatusCode::CONFLICT,
            "Email source changed during this read; result discarded",
        ));
    }
    if response.get("error").is_some() {
        let code = response["error"].as_str().unwrap_or("");
        let (status, text) = match code {
            "email_authentication_required" => (
                StatusCode::UNAUTHORIZED,
                "Email authentication needs attention in the source project's existing Google setup",
            ),
            "email_access_denied" | "email_disabled_in_source" => (
                StatusCode::FORBIDDEN,
                "Email is disabled or the source's Google credentials lack Gmail access",
            ),
            "email_not_found" => (
                StatusCode::NOT_FOUND,
                "This email thread is no longer available",
            ),
            "email_rate_limited" => {
                *state.email.cooldown.lock().await =
                    Some((scope, Instant::now() + Duration::from_secs(60)));
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    "Email rate limited; wait a minute before refreshing",
                )
            }
            "source_project_venv_missing" => (
                StatusCode::SERVICE_UNAVAILABLE,
                "The source project needs its existing .venv/bin/python environment",
            ),
            "email_source_timed_out" => (
                StatusCode::GATEWAY_TIMEOUT,
                "Email source timed out; try refreshing later",
            ),
            _ => (
                StatusCode::BAD_GATEWAY,
                "Email read failed; check the source project and existing Google authentication",
            ),
        };
        return Err(error(status, text));
    }
    let mut value = response
        .get("ok")
        .filter(|v| v.is_object())
        .cloned()
        .ok_or_else(|| error(StatusCode::BAD_GATEWAY, "Invalid Email response"))?;
    value["revision"] = json!(b.revision);
    value["connection_revision"] = json!(b.connection_revision);
    let bytes = serde_json::to_vec(&value).unwrap().len();
    if bytes > 1024 * 1024 {
        return Err(error(
            StatusCode::BAD_GATEWAY,
            "Email response exceeded display limit",
        ));
    }
    let mut cache = state.email.cache.lock().await;
    cache.retain(|v| v.key != key);
    while cache.len() >= 16
        || cache.iter().map(|v| v.bytes).sum::<usize>() + bytes > 4 * 1024 * 1024
    {
        if cache.pop_front().is_none() {
            break;
        }
    }
    cache.push_back(Cached {
        key,
        value: value.clone(),
        at: Instant::now(),
        bytes,
    });
    Ok(Json(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_reject_writes_invalid_ids_and_unbounded_input() {
        let mut q = Query {
            revision: "r".into(),
            connection_revision: "c".into(),
            operation: "messages".into(),
            id: None,
            label: Some("INBOX".into()),
            query: None,
            cursor: None,
            refresh: false,
        };
        assert!(valid(&q));
        q.operation = "send".into();
        assert!(!valid(&q));
        q.operation = "thread".into();
        assert!(!valid(&q));
        q.id = Some("abc123".into());
        assert!(valid(&q));
        q.id = Some("../../secret".into());
        assert!(!valid(&q));
        q.operation = "messages".into();
        q.query = Some("x".repeat(1001));
        assert!(!valid(&q));
        q.query = None;
        q.cursor = Some("bad\n".into());
        assert!(!valid(&q));
    }
}
