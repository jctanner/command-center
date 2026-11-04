//! Slack workspace, using the configured machine's existing SSH bus.
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
    collections::{HashMap, VecDeque},
    io::Write,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, Semaphore};
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Source {
    pub(crate) host: String,
    pub(crate) project: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Settings {
    pub(crate) revision: String,
    pub(crate) source: Option<Source>,
}
struct Cache {
    at: Instant,
    key: String,
    value: Value,
    bytes: usize,
}
pub(crate) struct Slack {
    pub(crate) settings: Mutex<Settings>,
    pub(crate) local: Mutex<crate::slack_state::LocalState>,
    pub(crate) local_path: Option<PathBuf>,
    path: Option<PathBuf>,
    cache: Mutex<VecDeque<Cache>>,
    cooldown: Mutex<HashMap<String, Instant>>,
    slots: Semaphore,
    pub(crate) sends: crate::slack_send::Sends,
}
impl Slack {
    pub(crate) async fn cached_names(
        &self,
        revision: &str,
        connection: &str,
    ) -> HashMap<String, String> {
        let cache = self.cache.lock().await;
        let mut names = HashMap::new();
        for entry in cache.iter().rev().filter(|e| {
            e.value["revision"] == revision && e.value["connection_revision"] == connection
        }) {
            if let Some(values) = entry.value["channels"].as_array() {
                for value in values {
                    if let (Some(id), Some(name)) = (value["id"].as_str(), value["name"].as_str()) {
                        names.entry(id.into()).or_insert_with(|| name.into());
                    }
                }
            }
        }
        names
    }

    pub(crate) async fn clear_cache(&self) {
        self.cache.lock().await.clear();
    }
    pub fn new(path: Option<PathBuf>) -> anyhow::Result<Self> {
        let settings = match path.as_ref().filter(|p| p.exists()) {
            Some(p) => serde_json::from_slice(&std::fs::read(p)?)?,
            None => Settings {
                revision: uuid::Uuid::new_v4().to_string(),
                source: None,
            },
        };
        let local_path = path.as_ref().map(|p| p.with_extension("state.json"));
        let local = match local_path.as_ref().filter(|p| p.exists()) {
            Some(p) => serde_json::from_slice(&std::fs::read(p)?)?,
            None => crate::slack_state::LocalState::default(),
        };
        let sends =
            crate::slack_send::Sends::new(path.as_ref().map(|p| p.with_extension("sends.json")))?;
        Ok(Self {
            sends,
            local: Mutex::new(local),
            local_path,
            settings: Mutex::new(settings),
            path,
            cache: Mutex::new(VecDeque::new()),
            cooldown: Mutex::new(HashMap::new()),
            slots: Semaphore::new(2),
        })
    }
}
fn error(status: StatusCode, message: &str) -> ApiError {
    ApiError(status, message.into())
}
async fn no_store(request: axum::extract::Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "private, no-store".parse().unwrap());
    response
}
pub(crate) fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v1/slack/settings", get(settings).put(save))
        .route("/api/v1/slack/read", post(read))
        .route("/api/v1/slack/inbox", post(crate::slack_inbox::snapshot))
        .route("/api/v1/slack/send", post(crate::slack_send::send))
        .route("/api/v1/slack/send/status", post(crate::slack_send::status))
        .route("/api/v1/slack/state", post(crate::slack_state::change))
        .layer(axum::extract::DefaultBodyLimit::max(32768))
        .layer(middleware::from_fn(no_store))
}
async fn settings(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let settings = state.slack.settings.lock().await.clone();
    let machine = if let Some(source) = &settings.source {
        state.registry.get(&source.host).await.ok()
    } else {
        None
    };
    let connection = machine.as_ref().map(|m| m.connection_revision.clone());
    let scope = machine.as_ref().map(|m| {
        format!(
            "{}/{}",
            settings.revision,
            crate::attention::scope(&m.config, "", "", "").0
        )
    });
    Ok(Json(
        json!({"revision":settings.revision,"source":settings.source,"connection_revision":connection,"scope":scope}),
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
    Json(body): Json<Change>,
) -> Result<Json<Value>, ApiError> {
    if !body.project.starts_with('/')
        || body.project.len() > 4096
        || body.project.chars().any(char::is_control)
    {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Use an absolute source project directory",
        ));
    }
    let machine = state.registry.get(&body.host).await?;
    if machine.connection_revision != body.connection_revision {
        return Err(error(
            StatusCode::CONFLICT,
            "Source machine changed; reload settings",
        ));
    }
    let mut settings = state.slack.settings.lock().await;
    if settings.revision != body.revision {
        return Err(error(
            StatusCode::CONFLICT,
            "Slack settings changed; reload before saving",
        ));
    }
    let updated = Settings {
        revision: uuid::Uuid::new_v4().to_string(),
        source: Some(Source {
            host: body.host,
            project: body.project,
        }),
    };
    if let Some(path) = state.slack.path.clone() {
        let bytes = serde_json::to_vec_pretty(&updated).unwrap();
        tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            let parent = path
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(std::path::Path::new("."));
            let mut file = tempfile::NamedTempFile::new_in(parent)?;
            file.write_all(&bytes)?;
            file.as_file().sync_all()?;
            file.persist(path).map_err(|e| e.error)?;
            Ok(())
        })
        .await
        .map_err(|_| {
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Slack settings could not be saved",
            )
        })?
        .map_err(|_| {
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Slack settings could not be saved",
            )
        })?;
    }
    *settings = updated.clone();
    state.slack.cache.lock().await.clear();
    Ok(Json(
        json!({"revision":updated.revision,"source":updated.source,"connection_revision":machine.connection_revision,"scope":format!("{}/{}",updated.revision,crate::attention::scope(&machine.config,"","", "").0)}),
    ))
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Query {
    revision: String,
    connection_revision: String,
    operation: String,
    channel: Option<String>,
    ts: Option<String>,
    cursor: Option<String>,
    query: Option<String>,
    page: Option<u32>,
    #[serde(default)]
    refresh: bool,
}
async fn read(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Query>,
) -> Result<Json<Value>, ApiError> {
    if !["status", "channels", "history", "thread", "search", "dms"]
        .contains(&body.operation.as_str())
        || body
            .query
            .as_ref()
            .is_some_and(|q| q.len() > 4000 || q.chars().any(char::is_control))
        || body
            .cursor
            .as_ref()
            .is_some_and(|q| q.len() > 2048 || q.chars().any(char::is_control))
        || body.channel.as_ref().is_some_and(|s| s.len() > 40)
        || body.ts.as_ref().is_some_and(|s| s.len() > 32)
        || body.page.is_some_and(|p| p == 0 || p > 100)
    {
        return Err(error(StatusCode::BAD_REQUEST, "Invalid Slack read request"));
    }
    let settings = state.slack.settings.lock().await.clone();
    if settings.revision != body.revision {
        return Err(error(
            StatusCode::CONFLICT,
            "Slack source changed; reload settings",
        ));
    }
    let source = settings
        .source
        .ok_or_else(|| error(StatusCode::BAD_REQUEST, "Configure a Slack source first"))?;
    let machine = state.registry.get(&source.host).await?;
    if machine.connection_revision != body.connection_revision {
        return Err(error(
            StatusCode::CONFLICT,
            "Source connection changed; reload settings",
        ));
    }
    let scope = format!(
        "{}/{}/{}",
        body.revision, source.host, body.connection_revision
    );
    let mut key_body = serde_json::to_value(&body).unwrap();
    key_body.as_object_mut().unwrap().remove("refresh");
    let key = format!("{scope}/{}", key_body);
    {
        let cache = state.slack.cache.lock().await;
        if !body.refresh
            && let Some(entry) = cache.iter().find(|e| {
                e.key == key
                    && e.at.elapsed()
                        < Duration::from_secs(
                            if matches!(body.operation.as_str(), "channels" | "dms") {
                                60
                            } else {
                                15
                            },
                        )
            })
        {
            let mut value = entry.value.clone();
            drop(cache);
            value["cc"] = crate::slack_state::update(
                &state,
                &body.revision,
                &body.connection_revision,
                Some(&value),
                None,
            )
            .await?;
            return Ok(Json(value));
        }
    }
    {
        let mut cooldown = state.slack.cooldown.lock().await;
        cooldown.retain(|_, until| *until > Instant::now());
        if cooldown.contains_key(&scope) {
            return Err(error(
                StatusCode::TOO_MANY_REQUESTS,
                "Slack rate limited this source. Wait before refreshing.",
            ));
        }
    }
    let _slot = tokio::time::timeout(Duration::from_secs(3), state.slack.slots.acquire())
        .await
        .map_err(|_| {
            error(
                StatusCode::TOO_MANY_REQUESTS,
                "Slack reads are busy; try again shortly",
            )
        })?
        .map_err(|_| {
            error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Slack reads are unavailable",
            )
        })?;
    let response=machine.transport.slack_request(&source.project,json!({"operation":body.operation,"channel":body.channel,"ts":body.ts,"cursor":body.cursor,"query":body.query,"page":body.page})).await.map_err(|_|error(StatusCode::BAD_GATEWAY,"Slack source unavailable. Check the source machine SSH connection and project environment."))?;
    if state.slack.settings.lock().await.revision != body.revision
        || state.registry.get(&source.host).await?.connection_revision != body.connection_revision
    {
        return Err(error(
            StatusCode::CONFLICT,
            "Slack source changed during the request; result discarded",
        ));
    }
    if let Some(code) = response.get("error").and_then(Value::as_str) {
        let status = StatusCode::from_u16(response["status"].as_u64().unwrap_or(502) as u16)
            .unwrap_or(StatusCode::BAD_GATEWAY);
        if status == StatusCode::TOO_MANY_REQUESTS {
            let seconds = response["retry_after"]
                .as_u64()
                .unwrap_or(30)
                .clamp(1, 3600);
            let mut cooldown = state.slack.cooldown.lock().await;
            cooldown.clear();
            cooldown.insert(scope, Instant::now() + Duration::from_secs(seconds));
        }
        let safe = if code.len() <= 100
            && code
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        {
            code
        } else {
            "slack_source_unavailable"
        };
        let message = match safe {
            "invalid_auth"
            | "token_revoked"
            | "not_authed"
            | "account_inactive"
            | "slack_authentication_failed" => {
                "Slack authentication expired or failed. Update the existing credentials on the source machine."
            }
            "slack_credentials_not_configured_on_source" => {
                "Slack credentials are not configured in the source project."
            }
            "source_project_venv_missing" => {
                "The source project needs its existing .venv/bin/python environment."
            }
            "slack_disabled_in_source_project" => {
                "Slack is disabled in the source project's configuration."
            }
            "not_in_channel" | "channel_not_found" | "missing_scope" => {
                "Slack does not grant this source access to that conversation."
            }
            "slack_rate_limited" => "Slack rate limited this source. Wait before refreshing.",
            "slack_source_timed_out" => "The Slack source read timed out. Try refreshing later.",
            _ => {
                "The Slack source could not complete this read. Check its connection and project environment."
            }
        };
        return Err(ApiError(status, message.into()));
    }
    let mut value = response
        .get("ok")
        .cloned()
        .filter(Value::is_object)
        .ok_or_else(|| error(StatusCode::BAD_GATEWAY, "Invalid Slack source response"))?;
    if body.operation == "thread" {
        value["thread_channel"] = json!(body.channel);
        value["thread_ts"] = json!(body.ts);
    }
    value["source_host"] = json!(source.host);
    value["revision"] = json!(body.revision);
    value["connection_revision"] = json!(body.connection_revision);
    let bytes = serde_json::to_vec(&value).unwrap().len();
    if bytes > 1024 * 1024 {
        return Err(error(
            StatusCode::BAD_GATEWAY,
            "Slack response exceeded its display limit",
        ));
    }
    let mut cache = state.slack.cache.lock().await;
    cache.retain(|e| e.key != key);
    while cache.len() >= 32
        || cache.iter().map(|e| e.bytes).sum::<usize>() + bytes > 8 * 1024 * 1024
    {
        if cache.pop_front().is_none() {
            break;
        }
    }
    cache.push_back(Cache {
        at: Instant::now(),
        key,
        value: value.clone(),
        bytes,
    });
    drop(cache);
    value["cc"] = crate::slack_state::update(
        &state,
        &body.revision,
        &body.connection_revision,
        Some(&value),
        None,
    )
    .await?;
    Ok(Json(value))
}
