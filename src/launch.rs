//! Explicit human launches. Grants bind the endpoint, directory and installed CLI.
use crate::{ApiError, AppState};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
#[derive(Default)]
pub(crate) struct Launches {
    grants: Mutex<HashMap<String, Grant>>,
}
struct Grant {
    host: String,
    revision: String,
    prepared: Value,
    id: String,
    at: Instant,
    used: bool,
    board: Option<crate::board::Binding>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Prepare {
    pub(crate) connection_revision: String,
    pub(crate) path: String,
    pub(crate) provider: String,
    pub(crate) model: Option<String>,
    pub(crate) approval_policy: Option<String>,
    pub(crate) target_session: Option<String>,
    pub(crate) window_name: Option<String>,
    pub(crate) card_name: Option<String>,
}
fn result(value: Value) -> Result<Value, ApiError> {
    if let Some(error) = value["error"].as_str() {
        return Err(ApiError(
            StatusCode::from_u16(value["status"].as_u64().unwrap_or(502) as u16)
                .unwrap_or(StatusCode::BAD_GATEWAY),
            error.into(),
        ));
    }
    value
        .get("ok")
        .cloned()
        .ok_or_else(|| ApiError(StatusCode::BAD_GATEWAY, "Invalid launch response".into()))
}
pub(crate) async fn prepare(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Query(query): Query<Prepare>,
) -> Result<Json<Value>, ApiError> {
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Agent operations busy".into(),
        )
    })?;
    let machine = state.registry.get(&host).await?;
    if machine.connection_revision != query.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed; refresh projects".into(),
        ));
    }
    let mut prepared = result(
        machine
            .transport
            .agent_request(
                json!({"action":"launch_options", "path":query.path,"provider":query.provider,"model":query.model,"approval_policy":query.approval_policy,"target_session":query.target_session,"window_name":query.window_name,"card_name":query.card_name}),
            )
            .await?,
    )?;
    if state.registry.get(&host).await?.connection_revision != query.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed during preparation".into(),
        ));
    }
    let mut grants = state.launches.grants.lock().await;
    grants.retain(|_, g| g.at.elapsed() < Duration::from_secs(120));
    if grants.len() >= 256 {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many pending launches".into(),
        ));
    }
    let token = uuid::Uuid::new_v4().to_string();
    let id = uuid::Uuid::new_v4().to_string();
    grants.insert(
        token.clone(),
        Grant {
            host,
            revision: query.connection_revision,
            prepared: prepared.clone(),
            id: id.clone(),
            at: Instant::now(),
            used: false,
            board: None,
        },
    );
    prepared
        .as_object_mut()
        .unwrap()
        .remove("directory_identity");
    prepared
        .as_object_mut()
        .unwrap()
        .remove("executable_identity");
    prepared["endpoint"] = json!(crate::attention::scope(&machine.config, "", "", "").0);
    prepared["token"] = json!(token);
    prepared["launch_id"] = json!(id);
    Ok(Json(prepared))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Start {
    token: String,
    conversation: Option<String>,
    initial_prompt: Option<String>,
}
fn validate_initial_prompt(value: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.len() > 24000
        || value
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return Err(ApiError(StatusCode::BAD_REQUEST,"Initial prompt must be at most 24,000 UTF-8 bytes without control characters other than newlines and tabs".into()));
    }
    Ok((!value.trim().is_empty()).then_some(value))
}
pub(crate) async fn start(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(start): Json<Start>,
) -> Result<Json<Value>, ApiError> {
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Agent operations busy".into(),
        )
    })?;
    let initial_prompt = validate_initial_prompt(start.initial_prompt)?;
    if initial_prompt.is_some() && start.conversation.is_some() {
        return Err(ApiError(StatusCode::BAD_REQUEST,"Initial prompts are for new conversations; send follow-ups from the agent chat after resuming".into()));
    }
    let (revision, prepared, id, board) = {
        let mut grants = state.launches.grants.lock().await;
        let g = grants.get_mut(&start.token).ok_or_else(|| {
            ApiError(
                StatusCode::GONE,
                "Launch authorization expired; check any previous launch before preparing another"
                    .into(),
            )
        })?;
        if g.host != host || g.used || g.at.elapsed() >= Duration::from_secs(120) {
            return Err(ApiError(StatusCode::GONE,"Launch authorization expired or already used; check the launch instead of retrying".into()));
        }
        if let Some(conversation) = &start.conversation
            && !g.prepared["conversations"].as_array().is_some_and(|items| {
                items
                    .iter()
                    .any(|c| c["id"].as_str() == Some(conversation) && c["active"] != true)
            })
        {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "Choose an available project conversation".into(),
            ));
        }
        if g.board.is_some() && initial_prompt.is_some() {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "Ticket launches use the prompt reviewed with the ticket".into(),
            ));
        }
        g.used = true;
        (
            g.revision.clone(),
            g.prepared.clone(),
            g.id.clone(),
            g.board.clone(),
        )
    };
    let machine = state.registry.get(&host).await?;
    let _guard = machine.file_writes.lock().await;
    if state.registry.get(&host).await?.connection_revision != revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed; agent was not launched".into(),
        ));
    }
    if let Some(binding) = &board {
        if start.conversation.is_some() {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "Ticket launches start a new conversation".into(),
            ));
        }
        state
            .board
            .claim(
                binding.ticket.clone(),
                binding.revision.clone(),
                crate::board::Run {
                    id: id.clone(),
                    host: host.clone(),
                    endpoint: crate::attention::scope(&machine.config, "", "", "").0,
                    project: prepared["project"].as_str().unwrap_or("").into(),
                    provider: prepared["provider"].as_str().unwrap_or("").into(),
                    model: prepared["model"].as_str().map(str::to_owned),
                    approval_policy: prepared["approval_policy"].as_str().map(str::to_owned),
                    prompt: binding.prompt.clone(),
                    target_session: prepared["target_session"].as_str().map(str::to_owned),
                    window_name: prepared["window_name"].as_str().map(str::to_owned),
                    card_name: prepared["card_name"].as_str().map(str::to_owned),
                    card_initialized: false,
                    created_at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                    checked_at: None,
                    result: None,
                    released: false,
                },
            )
            .await?;
    }
    let mut request = prepared;
    if let Some(binding) = &board {
        request["initial_prompt"] = json!(binding.prompt);
    } else {
        request["initial_prompt"] = json!(initial_prompt);
    }

    request["action"] = json!("launch");
    request["launch_id"] = json!(&id);
    request["conversation"] = json!(start.conversation);
    let mut value = result(machine.transport.agent_request(request).await?)?;
    value["host"] = json!(host);
    value["connection_revision"] = json!(revision);
    if let Some(binding) = board {
        state
            .board
            .record(binding.ticket, id, value.clone())
            .await?;
    }
    state.queue.invalidate();
    Ok(Json(value))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Recovery {
    pub(crate) connection_revision: Option<String>,
    pub(crate) endpoint: Option<String>,
    pub(crate) launch_id: String,
}
pub(crate) async fn status(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Query(query): Query<Recovery>,
) -> Result<Json<Value>, ApiError> {
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Agent operations busy".into(),
        )
    })?;
    let machine = state.registry.get(&host).await?;
    let matches = match &query.endpoint {
        Some(endpoint) => *endpoint == crate::attention::scope(&machine.config, "", "", "").0,
        None => query.connection_revision.as_deref() == Some(&machine.connection_revision),
    };
    if !matches {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed; check the original machine before launching again".into(),
        ));
    }
    let mut value = result(
        machine
            .transport
            .agent_request(json!({"action":"launch_status","launch_id":query.launch_id}))
            .await?,
    )?;
    if state.registry.get(&host).await?.connection_revision != machine.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed during launch check".into(),
        ));
    }
    value["host"] = json!(host);
    value["connection_revision"] = json!(machine.connection_revision);
    Ok(Json(value))
}

pub(crate) async fn bind(
    state: &Arc<AppState>,
    token: &str,
    binding: crate::board::Binding,
) -> Result<(), ApiError> {
    let mut grants = state.launches.grants.lock().await;
    let g = grants
        .get_mut(token)
        .ok_or_else(|| ApiError(StatusCode::GONE, "Launch preparation expired".into()))?;
    g.board = Some(binding);
    Ok(())
}
pub(crate) async fn board_start(
    state: Arc<AppState>,
    ticket: String,
    token: String,
) -> Result<Json<Value>, ApiError> {
    let host = {
        let grants = state.launches.grants.lock().await;
        let g = grants.get(&token).ok_or_else(|| {
            ApiError(
                StatusCode::GONE,
                "Launch preparation expired; check the ticket before preparing another".into(),
            )
        })?;
        if g.board.as_ref().is_none_or(|b| b.ticket != ticket) {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Launch belongs to a different ticket".into(),
            ));
        }
        g.host.clone()
    };
    start(
        State(state),
        Path(host),
        Json(Start {
            token,
            conversation: None,
            initial_prompt: None,
        }),
    )
    .await
}

#[cfg(test)]
mod initial_prompt_tests {
    use super::*;
    #[test]
    fn validates_initial_prompt_without_rewriting_literal_content() {
        let text = "  Write a plan.\n\tKeep $(literal) and `quotes` intact.  ";
        assert_eq!(
            validate_initial_prompt(Some(text.into()))
                .unwrap()
                .as_deref(),
            Some(text)
        );
        assert!(validate_initial_prompt(None).unwrap().is_none());
        assert!(
            validate_initial_prompt(Some(" \n\t".into()))
                .unwrap()
                .is_none()
        );
        assert!(validate_initial_prompt(Some("x".repeat(24000))).is_ok());
        for bad in [
            "x".repeat(24001),
            "😀".repeat(6001),
            "bad\0input".into(),
            "bad\x1binput".into(),
            "bad\rinput".into(),
        ] {
            assert!(validate_initial_prompt(Some(bad)).is_err());
        }
    }
}
