//! Independent, read-only jira workspace over the existing machine transport.
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
pub(crate) struct Jira {
    settings: Mutex<Settings>,
    path: Option<PathBuf>,
    cache: Mutex<VecDeque<Cached>>,
    slot: Semaphore,
    cooldown: Mutex<Option<(String, Instant)>>,
}
impl Jira {
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
        .route("/api/v1/jira/settings", get(settings).put(save))
        .route("/api/v1/jira/read", post(read))
        .layer(axum::extract::DefaultBodyLimit::max(16384))
        .layer(middleware::from_fn(no_store))
}
async fn settings(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let s = state.jira.settings.lock().await.clone();
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
            "Jira source machine changed; reload settings",
        ));
    }
    let mut s = state.jira.settings.lock().await;
    if s.revision != b.revision {
        return Err(error(
            StatusCode::CONFLICT,
            "Jira settings changed; reload settings",
        ));
    }
    let updated = Settings {
        revision: uuid::Uuid::new_v4().to_string(),
        source: Some(Source {
            host: b.host,
            project: b.project,
        }),
    };
    if let Some(path) = state.jira.path.clone() {
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
                "Could not save Jira settings",
            )
        })?
        .map_err(|_| {
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not save Jira settings",
            )
        })?;
    }
    *s = updated;
    state.jira.cache.lock().await.clear();
    *state.jira.cooldown.lock().await = None;
    drop(s);
    settings(State(state)).await
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Query {
    revision: String,
    connection_revision: String,
    operation: String,
    key: Option<String>,
    query: Option<String>,
    cursor: Option<String>,
    #[serde(default)]
    refresh: bool,
}
fn issue_key(value: &str) -> bool {
    let Some((project, number)) = value.split_once('-') else {
        return false;
    };
    !project.is_empty()
        && project.len() <= 64
        && project.as_bytes()[0].is_ascii_uppercase()
        && project
            .bytes()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
        && !number.is_empty()
        && number.len() <= 16
        && number.bytes().all(|c| c.is_ascii_digit())
}
fn valid(q: &Query) -> bool {
    (match q.operation.as_str() {
        "search" => q.key.is_none() && q.query.as_ref().is_some_and(|v| !v.trim().is_empty()),
        "issue" | "comments" => q.key.as_deref().is_some_and(issue_key) && q.query.is_none(),
        _ => false,
    }) && q.query.as_ref().is_none_or(|v| {
        v.len() <= 4000 && !v.chars().any(|c| c.is_control() && c != '\n' && c != '\t')
    }) && q
        .cursor
        .as_ref()
        .is_none_or(|v| v.len() <= 2048 && !v.chars().any(char::is_control))
}
async fn read(
    State(state): State<Arc<AppState>>,
    Json(b): Json<Query>,
) -> Result<Json<Value>, ApiError> {
    if !valid(&b) {
        return Err(error(StatusCode::BAD_REQUEST, "Invalid Jira read request"));
    }
    let s = state.jira.settings.lock().await.clone();
    if s.revision != b.revision {
        return Err(error(
            StatusCode::CONFLICT,
            "Jira source changed; reload settings",
        ));
    }
    let source = s
        .source
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, "Configure a Jira source first"))?;
    let machine = state.registry.get(&source.host).await?;
    if machine.connection_revision != b.connection_revision {
        return Err(error(
            StatusCode::CONFLICT,
            "Jira connection changed; reload settings",
        ));
    }
    let scope = format!("{}/{}", b.revision, b.connection_revision);
    let mut key = serde_json::to_value(&b).unwrap();
    key.as_object_mut().unwrap().remove("refresh");
    let key = key.to_string();
    if !b.refresh {
        let cached = {
            let cache = state.jira.cache.lock().await;
            cache
                .iter()
                .find(|v| v.key == key && v.at.elapsed() < Duration::from_secs(30))
                .map(|v| v.value.clone())
        };
        if let Some(value) = cached {
            if state.jira.settings.lock().await.revision != b.revision
                || state.registry.get(&source.host).await?.connection_revision
                    != b.connection_revision
            {
                return Err(error(
                    StatusCode::CONFLICT,
                    "Jira source changed; reload settings",
                ));
            }
            return Ok(Json(value));
        }
    }
    if state
        .jira
        .cooldown
        .lock()
        .await
        .as_ref()
        .is_some_and(|(s, t)| s == &scope && *t > Instant::now())
    {
        return Err(error(
            StatusCode::TOO_MANY_REQUESTS,
            "Jira rate limited; wait before refreshing",
        ));
    }
    let _slot = tokio::time::timeout(Duration::from_secs(2), state.jira.slot.acquire())
        .await
        .map_err(|_| {
            error(
                StatusCode::TOO_MANY_REQUESTS,
                "Jira reads busy; try again shortly",
            )
        })?
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "Jira unavailable"))?;
    let response = machine
        .transport
        .jira_request(
            &source.project,
            json!({"operation":b.operation,"key":b.key,"query":b.query,"cursor":b.cursor}),
        )
        .await
        .map_err(|_| {
            error(
                StatusCode::BAD_GATEWAY,
                "Jira source unavailable; check the source machine connection",
            )
        })?;
    if state.jira.settings.lock().await.revision != b.revision
        || state.registry.get(&source.host).await?.connection_revision != b.connection_revision
    {
        return Err(error(
            StatusCode::CONFLICT,
            "Jira source changed during this read; result discarded",
        ));
    }
    if response.get("error").is_some() {
        let code = response["error"].as_str().unwrap_or("");
        let (status, text) = match code {
            "jira_authentication_required" => (
                StatusCode::UNAUTHORIZED,
                "Jira authentication failed. Update the existing credentials on the source machine.",
            ),
            "jira_access_denied" | "jira_disabled_in_source" => (
                StatusCode::FORBIDDEN,
                "Jira is disabled or this source lacks access to the requested issues.",
            ),
            "jira_not_found" => (
                StatusCode::NOT_FOUND,
                "This Jira issue is unavailable or inaccessible.",
            ),
            "jira_invalid_query" => (
                StatusCode::BAD_REQUEST,
                "Jira rejected the JQL query. Check field names, values and syntax.",
            ),
            "jira_rate_limited" => {
                *state.jira.cooldown.lock().await =
                    Some((scope, Instant::now() + Duration::from_secs(60)));
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    "Jira rate limited this source. Wait a minute before refreshing.",
                )
            }
            "source_project_venv_missing" => (
                StatusCode::SERVICE_UNAVAILABLE,
                "The source project needs its existing .venv/bin/python environment.",
            ),
            "jira_source_timed_out" => (
                StatusCode::GATEWAY_TIMEOUT,
                "Jira source timed out. Try refreshing later.",
            ),
            "jira_credentials_missing" => (
                StatusCode::SERVICE_UNAVAILABLE,
                "Configure Jira credentials in the existing source project.",
            ),
            _ => (
                StatusCode::BAD_GATEWAY,
                "Jira read failed. Check the source machine and its existing Jira setup.",
            ),
        };
        return Err(error(status, text));
    }
    let mut value = response
        .get("ok")
        .filter(|v| v.is_object())
        .cloned()
        .ok_or_else(|| error(StatusCode::BAD_GATEWAY, "Invalid Jira response"))?;
    value["revision"] = json!(b.revision);
    value["connection_revision"] = json!(b.connection_revision);
    let bytes = serde_json::to_vec(&value).unwrap().len();
    if bytes > 1024 * 1024 {
        return Err(error(
            StatusCode::BAD_GATEWAY,
            "Jira response exceeded display limit",
        ));
    }
    let mut cache = state.jira.cache.lock().await;
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
    fn read_contract_rejects_mutations_bad_keys_and_unbounded_jql() {
        let mut q = Query {
            revision: "r".into(),
            connection_revision: "c".into(),
            operation: "search".into(),
            key: None,
            query: Some("assignee = currentUser()".into()),
            cursor: None,
            refresh: false,
        };
        assert!(valid(&q));
        q.operation = "update".into();
        assert!(!valid(&q));
        q.operation = "search".into();
        q.query = Some("x".repeat(4001));
        assert!(!valid(&q));
        q.query = Some("bad\0".into());
        assert!(!valid(&q));
        q.query = None;
        q.operation = "issue".into();
        q.key = Some("WORK-123".into());
        assert!(valid(&q));
        q.key = Some("../../secret".into());
        assert!(!valid(&q));
        q.key = Some("WORK-123".into());
        q.cursor = Some("bad\n".into());
        assert!(!valid(&q));
    }
}
