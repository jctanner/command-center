//! Explicit sends with durable metadata receipts and no automatic delivery retry.
use crate::{ApiError, AppState};
use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Write, path::PathBuf, sync::Arc};
use tokio::sync::{Mutex, Semaphore};

#[derive(Clone, Serialize, Deserialize)]
struct Receipt {
    id: String,
    scope: String,
    channel: String,
    thread_ts: Option<String>,
    digest: String,
    status: String,
    ts: Option<String>,
    error: Option<String>,
}
pub(crate) struct Sends {
    receipts: Mutex<BTreeMap<String, Receipt>>,
    path: Option<PathBuf>,
    slot: Semaphore,
    cooldown: Mutex<Option<std::time::Instant>>,
}
impl Sends {
    pub fn new(path: Option<PathBuf>) -> anyhow::Result<Self> {
        let receipts = match path.as_ref().filter(|p| p.exists()) {
            Some(p) => serde_json::from_slice(&std::fs::read(p)?)?,
            None => BTreeMap::new(),
        };
        Ok(Self {
            receipts: Mutex::new(receipts),
            path,
            slot: Semaphore::new(1),
            cooldown: Mutex::new(None),
        })
    }
}
fn bad(message: &str) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}
fn scope(revision: &str, host: &crate::config::Host) -> String {
    format!("{revision}/{}", crate::attention::scope(host, "", "", "").0)
}
async fn persist(
    path: Option<PathBuf>,
    receipts: &BTreeMap<String, Receipt>,
) -> Result<(), ApiError> {
    let Some(path) = path else {
        return Ok(());
    };
    let bytes = serde_json::to_vec(receipts).unwrap();
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(std::path::Path::new("."));
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        file.write_all(&bytes)?;
        file.as_file().sync_all()?;
        file.persist(&path).map_err(|e| e.error)?;
        std::fs::File::open(parent)?.sync_all()?;
        Ok(())
    })
    .await
    .map_err(|_| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Cannot save Slack delivery receipt; no retry was attempted".into(),
        )
    })?
    .map_err(|_| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Cannot save Slack delivery receipt; no retry was attempted".into(),
        )
    })
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Send {
    revision: String,
    connection_revision: String,
    id: String,
    channel: String,
    thread_ts: Option<String>,
    text: String,
}
fn validate(body: &Send) -> Result<(), ApiError> {
    if uuid::Uuid::parse_str(&body.id)
        .ok()
        .is_none_or(|id| id.to_string() != body.id)
        || !(6..=32).contains(&body.channel.len())
        || !body.channel.starts_with(['C', 'G'])
        || !body
            .channel
            .bytes()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        || body
            .thread_ts
            .as_ref()
            .is_some_and(|ts| crate::slack_state::stamp(ts).is_none())
        || body.text.trim().is_empty()
        || body.text.chars().count() > 4000
        || body.text.contains('\0')
    {
        return Err(bad(
            "Use a selected channel/thread and a message of 1–4000 characters",
        ));
    }
    Ok(())
}
pub(crate) async fn send(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Send>,
) -> Result<Json<Value>, ApiError> {
    validate(&body)?;
    if state.slack.sends.path.is_none() {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "A persistent CC configuration is required before sending Slack messages".into(),
        ));
    }
    let source = state
        .slack
        .settings
        .lock()
        .await
        .source
        .clone()
        .ok_or_else(|| bad("Configure a Slack source first"))?;
    let machine = state.registry.get(&source.host).await?;
    // Shared endpoint mutation lock prevents an SSH-route edit during dispatch.
    let _endpoint = machine.file_writes.lock().await;
    let settings = state.slack.settings.lock().await;
    if settings.revision != body.revision
        || state.registry.get(&source.host).await?.connection_revision != body.connection_revision
    {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Slack destination changed; review before sending".into(),
        ));
    }
    let scope = scope(&body.revision, &machine.config);
    let digest = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(&body.channel, &body.thread_ts, &body.text)).unwrap())
    );
    {
        let receipts = state.slack.sends.receipts.lock().await;
        if let Some(receipt) = receipts.get(&body.id) {
            if receipt.scope != scope || receipt.digest != digest {
                return Err(ApiError(
                    StatusCode::CONFLICT,
                    "Send ID already belongs to another message".into(),
                ));
            }
            return Ok(Json(serde_json::to_value(receipt).unwrap()));
        }
    }
    let _slot = state.slack.sends.slot.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Another Slack message is sending. This message was not sent.".into(),
        )
    })?;
    if state
        .slack
        .sends
        .cooldown
        .lock()
        .await
        .is_some_and(|until| until > std::time::Instant::now())
    {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Slack is cooling down after a rate limit. This message was not sent.".into(),
        ));
    }
    // Record uncertainty before transport IO. A lost response/restart must never cause replay.
    let mut receipt = Receipt {
        id: body.id.clone(),
        scope,
        channel: body.channel.clone(),
        thread_ts: body.thread_ts.clone(),
        digest,
        status: "uncertain".into(),
        ts: None,
        error: None,
    };
    {
        let mut receipts = state.slack.sends.receipts.lock().await;
        if receipts.len() >= 2048 {
            return Err(ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "Slack receipt storage is full. This message was not sent.".into(),
            ));
        }
        let mut next = receipts.clone();
        next.insert(body.id.clone(), receipt.clone());
        persist(state.slack.sends.path.clone(), &next).await?;
        *receipts = next;
    }
    let response = machine.transport.slack_request(&source.project,json!({"operation":"send","channel":body.channel,"thread_ts":body.thread_ts,"text":body.text,"id":body.id})).await;
    if let Ok(value) = response {
        if value["status"] == 429 {
            let seconds = value["retry_after"].as_u64().unwrap_or(30).clamp(1, 3600);
            *state.slack.sends.cooldown.lock().await =
                Some(std::time::Instant::now() + std::time::Duration::from_secs(seconds));
        }
        if value["ok"]["delivery"] == "sent"
            && value["ok"]["channel"] == body.channel
            && let Some(ts) = value["ok"]["ts"]
                .as_str()
                .filter(|s| crate::slack_state::stamp(s).is_some())
        {
            receipt.status = "sent".into();
            receipt.ts = Some(ts.into());
        } else if value["delivery"] == "not_sent" {
            receipt.status = "failed".into();
            receipt.error = Some(match value["error"].as_str().unwrap_or("") {
                "slack_writes_disabled_in_source_project" => "Sending is disabled in the source project's Slack permissions.",
                "slack_rate_limited" => "Slack rate limited this message. It was not sent; wait before trying again.",
                "not_in_channel" | "channel_not_found" | "missing_scope" => "Slack rejected this destination or its posting permissions.",
                _ => "Slack rejected this send. Check source authentication and permissions before trying again.",
            }.into());
        }
    }
    {
        let mut receipts = state.slack.sends.receipts.lock().await;
        let mut next = receipts.clone();
        next.insert(body.id.clone(), receipt.clone());
        if persist(state.slack.sends.path.clone(), &next).await.is_ok() {
            *receipts = next;
        } else {
            receipt.status = "uncertain".into();
            receipt.ts = None;
            receipt.error = None;
        }
    }
    drop(settings);
    // All clients must refresh rather than reuse a pre-send history page.
    state.slack.clear_cache().await;
    Ok(Json(serde_json::to_value(receipt).unwrap()))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Status {
    revision: String,
    connection_revision: String,
    id: String,
}
pub(crate) async fn status(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Status>,
) -> Result<Json<Value>, ApiError> {
    if uuid::Uuid::parse_str(&body.id).is_err() {
        return Err(bad("Invalid send ID"));
    }
    let settings = state.slack.settings.lock().await;
    let source = settings
        .source
        .as_ref()
        .ok_or_else(|| bad("Configure a Slack source first"))?;
    let machine = state.registry.get(&source.host).await?;
    if settings.revision != body.revision || machine.connection_revision != body.connection_revision
    {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Slack source changed; refresh before checking delivery".into(),
        ));
    }
    let receipts = state.slack.sends.receipts.lock().await;
    if let Some(receipt) = receipts.get(&body.id) {
        if receipt.scope != scope(&body.revision, &machine.config) {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "This receipt belongs to another Slack source".into(),
            ));
        }
        Ok(Json(serde_json::to_value(receipt).unwrap()))
    } else {
        Ok(Json(json!({"id":body.id,"status":"uncertain"})))
    }
}
