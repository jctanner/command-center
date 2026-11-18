//! Opt-in ACP launch/control. Native launch and observation routes are unchanged.
use crate::{ApiError, AppState};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{
        Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    convert::Infallible,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    sync::{Mutex, Semaphore},
};

pub(crate) struct Acp {
    grants: Mutex<HashMap<String, Grant>>,
    streams: Arc<Semaphore>,
    observed: Mutex<HashMap<String, String>>,
}
impl Default for Acp {
    fn default() -> Self {
        Self {
            grants: Mutex::default(),
            streams: Arc::new(Semaphore::new(16)),
            observed: Mutex::default(),
        }
    }
}
struct Grant {
    host: String,
    revision: String,
    prepared: Value,
    broker: String,
    at: Instant,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Scope {
    connection_revision: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Prepare {
    connection_revision: String,
    path: String,
    provider: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Start {
    token: String,
    initial_prompt: Option<String>,
}
#[derive(Deserialize)]
pub(crate) struct Command {
    connection_revision: String,
    instance: String,
    id: String,
    #[serde(flatten)]
    action: Action,
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum CommandExecution {
    CcBroker,
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum NativeShellExecution {
    CodexNativeFullAccess,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Action {
    Prompt {
        text: String,
    },
    LocalCommand {
        text: String,
        execution: CommandExecution,
    },
    HarnessCommand {
        text: String,
        execution: NativeShellExecution,
    },
    CancelCommand {
        command: String,
    },
    Permission {
        permission: String,
        revision: String,
        option: String,
    },
    Cancel,
    CancelQueued {
        prompt: String,
    },
    Close,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Watch {
    connection_revision: String,
    instance: String,
}
fn uuid(value: &str) -> Result<(), ApiError> {
    if uuid::Uuid::parse_str(value).is_err() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Invalid UUID".into()));
    }
    Ok(())
}
fn result(value: Value) -> Result<Value, ApiError> {
    crate::agents::result(value)
}
async fn machine(
    state: &AppState,
    host: &str,
    revision: &str,
) -> Result<Arc<crate::machines::Machine>, ApiError> {
    let machine = state.registry.get(host).await?;
    if machine.connection_revision != revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine connection changed".into(),
        ));
    }
    Ok(machine)
}
pub(crate) fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v1/hosts/{host}/acp", get(list))
        .route("/api/v1/hosts/{host}/acp/prepare", post(prepare))
        .route("/api/v1/hosts/{host}/acp/start", post(start))
        .route(
            "/api/v1/hosts/{host}/acp/{broker}",
            get(snapshot).post(command),
        )
        .route("/api/v1/hosts/{host}/acp/{broker}/events", get(events))
        .route("/api/v1/hosts/{host}/acp/{broker}/receipts", get(receipts))
}
async fn list(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Query(scope): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    let _slot = state
        .file_slots
        .try_acquire()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "Host operations busy".into()))?;
    let m = machine(&state, &host, &scope.connection_revision).await?;
    let value = result(m.transport.acp_request(json!({"action":"list"})).await?)?;
    machine(&state, &host, &scope.connection_revision).await?;
    Ok(Json(
        json!({"host":host,"connection_revision":scope.connection_revision,"agents":value,"endpoint":crate::attention::scope(&m.config,"","","").0}),
    ))
}
async fn prepare(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(request): Json<Prepare>,
) -> Result<Json<Value>, ApiError> {
    let _slot = state
        .file_slots
        .try_acquire()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "Host operations busy".into()))?;
    let m = machine(&state, &host, &request.connection_revision).await?;
    let provider = request.provider.as_deref().unwrap_or("claude");
    if !matches!(provider, "claude" | "codex") {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Unsupported ACP provider".into(),
        ));
    }
    let prepared = result(
        m.transport
            .acp_request(json!({"action":"prepare","path":request.path,"provider":provider}))
            .await?,
    )?;
    machine(&state, &host, &request.connection_revision).await?;
    let token = uuid::Uuid::new_v4().to_string();
    let broker = uuid::Uuid::new_v4().to_string();
    let mut grants = state.acp.grants.lock().await;
    grants.retain(|_, g| g.at.elapsed() < Duration::from_secs(120));
    if grants.len() >= 128 {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many preparations".into(),
        ));
    }
    grants.insert(
        token.clone(),
        Grant {
            host,
            revision: request.connection_revision,
            prepared: prepared.clone(),
            broker: broker.clone(),
            at: Instant::now(),
        },
    );
    Ok(Json(
        json!({"token":token,"broker":broker,"protocol":"acp","provider":provider,"path":prepared["path"],"executable":prepared["executable"],"endpoint":crate::attention::scope(&m.config,"","","").0,"notice":"Experimental ACP broker in a dedicated tmux session. No native TUI, resume, model override, pre-trust or automatic permissions. Native mode remains default."}),
    ))
}
async fn start(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(request): Json<Start>,
) -> Result<Json<Value>, ApiError> {
    if request.initial_prompt.as_ref().is_some_and(|p| {
        p.len() > 12000 || p.chars().any(|c| c.is_control() && c != '\n' && c != '\t')
    }) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Invalid ACP initial prompt".into(),
        ));
    }
    let initial_prompt = request.initial_prompt.filter(|p| !p.trim().is_empty());
    let grant=state.acp.grants.lock().await.remove(&request.token).ok_or_else(||ApiError(StatusCode::GONE,"Preparation expired or consumed; check the original broker UUID before another launch".into()))?;
    if grant.host != host || grant.at.elapsed() >= Duration::from_secs(120) {
        return Err(ApiError(StatusCode::GONE, "Preparation invalid".into()));
    }
    let m = machine(&state, &host, &grant.revision).await?;
    let _guard = m.file_writes.lock().await;
    machine(&state, &host, &grant.revision).await?;
    let value = result(
        m.transport
            .acp_request(json!({"action":"launch","broker":grant.broker,"prepared":grant.prepared,"initial_prompt":initial_prompt}))
            .await?,
    )?;
    machine(&state, &host, &grant.revision).await?;
    state.queue.invalidate();
    Ok(Json(value))
}
async fn snapshot(
    State(state): State<Arc<AppState>>,
    Path((host, broker)): Path<(String, String)>,
    Query(scope): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    uuid(&broker)?;
    let m = machine(&state, &host, &scope.connection_revision).await?;
    let _slot = state
        .file_slots
        .try_acquire()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "Host operations busy".into()))?;
    let value = result(
        m.transport
            .acp_request(json!({"action":"call","broker":broker}))
            .await?,
    )?;
    machine(&state, &host, &scope.connection_revision).await?;
    Ok(Json(enrich(&state, &m.config, &value).await?))
}
async fn command(
    State(state): State<Arc<AppState>>,
    Path((host, broker)): Path<(String, String)>,
    Json(request): Json<Command>,
) -> Result<Json<Value>, ApiError> {
    uuid(&broker)?;
    uuid(&request.id)?;
    uuid(&request.instance)?;
    let mut action = json!({"id":request.id,"instance":request.instance});
    let local_command = matches!(
        &request.action,
        Action::LocalCommand {
            execution: CommandExecution::CcBroker,
            ..
        }
    );
    let harness_command = matches!(
        &request.action,
        Action::HarnessCommand {
            execution: NativeShellExecution::CodexNativeFullAccess,
            ..
        }
    );
    match request.action {
        Action::Prompt { text }
        | Action::LocalCommand { text, .. }
        | Action::HarnessCommand { text, .. } => {
            if text.trim().is_empty()
                || text.len() > 12000
                || text
                    .chars()
                    .any(|c| c.is_control() && c != '\n' && c != '\t')
            {
                return Err(ApiError(StatusCode::BAD_REQUEST, "Invalid prompt".into()));
            }
            action["action"] = json!(if harness_command {
                "harness_command"
            } else if local_command {
                "local_command"
            } else {
                "prompt"
            });
            if harness_command {
                action["execution"] = json!("codex_native_full_access");
            }
            if local_command {
                action["execution"] = json!("cc_broker");
            }
            action["text"] = json!(text);
        }
        Action::CancelCommand { command } => {
            uuid(&command)?;
            action["action"] = json!("cancel_command");
            action["command"] = json!(command);
        }
        Action::Permission {
            permission,
            revision,
            option,
        } => {
            uuid(&permission)?;
            uuid(&revision)?;
            if option.is_empty() || option.len() > 500 {
                return Err(ApiError(
                    StatusCode::BAD_REQUEST,
                    "Invalid permission option".into(),
                ));
            }
            action["action"] = json!("permission");
            action["permission"] = json!(permission);
            action["revision"] = json!(revision);
            action["option"] = json!(option);
        }
        Action::Cancel => action["action"] = json!("cancel"),
        Action::CancelQueued { prompt } => {
            uuid(&prompt)?;
            action["action"] = json!("cancel_queued");
            action["prompt"] = json!(prompt);
        }
        Action::Close => action["action"] = json!("close"),
    }
    let m = machine(&state, &host, &request.connection_revision).await?;
    let _guard = m.file_writes.lock().await;
    machine(&state, &host, &request.connection_revision).await?;
    let value = result(
        m.transport
            .acp_request(json!({"action":"call","broker":broker,"command":action}))
            .await?,
    )?;
    machine(&state, &host, &request.connection_revision).await?;
    state.queue.invalidate();
    Ok(Json(value))
}
async fn events(
    State(state): State<Arc<AppState>>,
    Path((host, broker)): Path<(String, String)>,
    Query(scope): Query<Watch>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    uuid(&broker)?;
    uuid(&scope.instance)?;
    let slot = state
        .acp
        .streams
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "Too many ACP viewers".into()))?;
    let m = machine(&state, &host, &scope.connection_revision).await?;
    let mut child=m.transport.acp_stream(json!({"action":"call","broker":broker,"command":{"action":"watch","instance":scope.instance}})).await?;
    let lines = BufReader::new(child.stdout.take().unwrap());
    let stream = futures_util::stream::unfold(
        (lines, child, slot, state, host, scope, false),
        |(mut lines, child, slot, state, host, scope, ended)| async move {
            if ended {
                return None;
            }
            let valid = machine(&state, &host, &scope.connection_revision)
                .await
                .is_ok();
            let mut raw = Vec::new();
            let next = if valid {
                tokio::time::timeout(
                    Duration::from_secs(25),
                    (&mut lines)
                        .take(1024 * 1024 + 1)
                        .read_until(b'\n', &mut raw),
                )
                .await
                .ok()
                .and_then(Result::ok)
                .filter(|n| *n > 0 && *n <= 1024 * 1024)
                .map(|_| raw)
            } else {
                None
            };
            let next = if machine(&state, &host, &scope.connection_revision)
                .await
                .is_ok()
            {
                next
            } else {
                None
            };
            let (event, done) = match next
                .filter(|line| line.len() <= 1024 * 1024)
                .and_then(|line| serde_json::from_slice::<Value>(&line).ok())
            {
                Some(value) if value["ok"]["instance"] == scope.instance => {
                    let enriched = match state.registry.get(&host).await {
                        Ok(m) if m.connection_revision == scope.connection_revision => {
                            enrich(&state, &m.config, &value["ok"]).await.ok()
                        }
                        _ => None,
                    };
                    match enriched {
                        Some(v) => (
                            Event::default().event("snapshot").data(v.to_string()),
                            false,
                        ),
                        None => (
                            Event::default()
                                .event("unavailable")
                                .data("Observation unavailable"),
                            true,
                        ),
                    }
                }
                _ => (
                    Event::default()
                        .event("unavailable")
                        .data("Connection unavailable; no input was retried"),
                    true,
                ),
            };
            Some((Ok(event), (lines, child, slot, state, host, scope, done)))
        },
    );
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(10))))
}

pub(crate) fn instance(broker: &str, raw: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(format!("acp/{broker}/{raw}")))
}
fn usage_metrics(value: &Value, broker: &str, identity: &str, now: u64) -> Value {
    let usage = &value["usage"];
    let Some(at) = usage["observed_at"]
        .as_u64()
        .filter(|at| *at <= now.saturating_add(30))
    else {
        return Value::Null;
    };
    let number = |key: &str, positive: bool| {
        usage[key]
            .as_u64()
            .filter(|v| *v <= 9_007_199_254_740_991 && (!positive || *v > 0))
    };
    let used = number("used", false);
    let window = number("size", true);
    if used.is_none() && window.is_none() {
        return Value::Null;
    }
    let Some(session) = value["session_id"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 512)
    else {
        return Value::Null;
    };
    let provider = value["provider"].as_str().unwrap_or("");
    if !matches!(provider, "claude" | "codex") {
        return Value::Null;
    }
    let model = usage["model"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control));
    let reported = usage["reported_at"]
        .as_str()
        .filter(|s| s.len() <= 40 && s.contains('T') && !s.chars().any(char::is_control));
    json!({"source":"acp_usage_update","provider":provider,"conversation":format!("acp:{broker}:{session}"),"instance":identity,"association":"process","stale":matches!(value["state"].as_str(),Some("unavailable"|"failed"|"exited")),"complete":false,"limited":false,"session":{"input":null,"output":null,"cached_input":null,"cache_write":null,"reasoning_output":null,"total":null},"input_includes_cache":false,"context":{"used":used,"window":window,"reported_at":reported},"model":model,"observed_at":at,"note":"ACP reported context occupancy/capacity; cumulative session token totals are not reported. Context is the last usage_update, not a live estimate."})
}
pub(crate) async fn enrich(
    state: &AppState,
    config: &crate::config::Host,
    value: &Value,
) -> Result<Value, ApiError> {
    let broker = value["broker"]
        .as_str()
        .ok_or_else(|| ApiError(StatusCode::BAD_GATEWAY, "Missing broker identity".into()))?;
    let raw = value["instance"]
        .as_str()
        .ok_or_else(|| ApiError(StatusCode::BAD_GATEWAY, "Missing broker instance".into()))?;
    uuid(broker)?;
    uuid(raw)?;
    let target = &value["target"];
    let (session, window, pane) = (
        target["session"].as_str().unwrap_or(""),
        target["window"].as_str().unwrap_or(""),
        target["pane"].as_str().unwrap_or(""),
    );
    if ![(session, '$'), (window, '@'), (pane, '%')]
        .iter()
        .all(|(id, p)| {
            id.starts_with(*p) && id.len() > 1 && id[1..].bytes().all(|c| c.is_ascii_digit())
        })
    {
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "Invalid broker tmux target".into(),
        ));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let phase = match value["state"].as_str() {
        Some("ready") => "ready",
        Some("working") => "working",
        Some("approval") => "approval",
        Some("unavailable") => "disconnected",
        _ => "unknown",
    };
    let activity = crate::queue::Activity::from_value(
        &json!({"state":phase,"source":"acp_broker","reason":format!("ACP broker: {}",value["state"].as_str().unwrap_or("unknown")),"observed_at":now,"evidence_at":now,"transition":if phase=="approval"{value["approval_cursor"].clone()}else{value["reply_cursor"].clone()}}),
        "",
    );
    let (endpoint, key) = crate::attention::scope(config, session, window, pane);
    let identity = instance(broker, raw);
    let conversation = value["session_id"]
        .as_str()
        .map(|id| format!("acp:{broker}:{id}"));
    let reply=conversation.as_ref().and_then(|id|serde_json::from_value::<crate::attention::Reply>(json!({"conversation":id,"version":format!("acp-v1:{raw}"),"cursor":value["reply_cursor"],"position":value["reply_position"].as_u64().unwrap_or(0)})).ok());
    let read = state
        .attention
        .observe(
            (&key, &endpoint),
            Some(&identity),
            &activity,
            reply,
            true,
            conversation.as_deref(),
        )
        .await?;
    {
        let mut observed = state.acp.observed.lock().await;
        let fingerprint = format!(
            "{phase}/{}/{}/{}/{}",
            value["reply_cursor"],
            value["approval_cursor"],
            value["usage"],
            value["command_running"]
        );
        let scope = format!("{key}/{identity}");
        if observed.get(&scope) != Some(&fingerprint) {
            if observed.len() >= 4096 {
                observed.clear();
            }
            observed.insert(scope, fingerprint);
            state.queue.invalidate();
        }
    }
    let card = crate::agent_cards::views(state, vec![(key, identity.clone())])
        .await?
        .into_iter()
        .next()
        .unwrap_or_default();
    let mut result = value.clone();
    result["activity"] = serde_json::to_value(activity).unwrap();
    result["read_state"] = serde_json::to_value(read).unwrap();
    result["card"] = serde_json::to_value(card).unwrap();
    result["token_metrics"] = usage_metrics(value, broker, &identity, now);
    result["card_instance"] = json!(identity);
    Ok(result)
}
async fn receipts(
    State(state): State<Arc<AppState>>,
    Path((host, broker)): Path<(String, String)>,
    Query(scope): Query<Watch>,
) -> Result<Json<Value>, ApiError> {
    uuid(&broker)?;
    uuid(&scope.instance)?;
    let m = machine(&state, &host, &scope.connection_revision).await?;
    let value = result(
        m.transport
            .acp_request(json!({"action":"receipts","broker":broker,"instance":scope.instance}))
            .await?,
    )?;
    machine(&state, &host, &scope.connection_revision).await?;
    Ok(Json(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn usage_context_is_process_bound_and_does_not_fabricate_totals() {
        let mut value = json!({"provider":"claude","session_id":"thread","state":"ready","usage":{"used":142000,"size":400000,"observed_at":90,"reported_at":"2026-11-17T14:00:00+00:00"}});
        let metrics = usage_metrics(&value, "broker", "instance", 100);
        assert_eq!(metrics["context"]["used"], 142000);
        assert_eq!(metrics["context"]["window"], 400000);
        assert!(metrics["session"]["total"].is_null());
        assert_eq!(metrics["instance"], "instance");
        assert_eq!(metrics["conversation"], "acp:broker:thread");
        assert_eq!(metrics["observed_at"], 90);
        value["usage"]["used"] = json!(0);
        assert_eq!(
            usage_metrics(&value, "broker", "instance", 100)["context"]["used"],
            0
        );
        value["usage"]["size"] = json!(0);
        assert!(usage_metrics(&value, "broker", "instance", 100)["context"]["window"].is_null());
        value["usage"]["observed_at"] = json!(200);
        assert!(usage_metrics(&value, "broker", "instance", 100).is_null());
        value["usage"] = Value::Null;
        assert!(usage_metrics(&value, "broker", "instance", 100).is_null());
    }
    #[test]
    fn usage_invalid_numbers_and_disconnection_remain_honest() {
        let value = json!({"provider":"codex","session_id":"thread","state":"unavailable","usage":{"used":-1,"size":400000,"observed_at":90,"model":"bad\nmodel"}});
        let metrics = usage_metrics(&value, "broker", "instance", 100);
        assert!(metrics["context"]["used"].is_null());
        assert_eq!(metrics["context"]["window"], 400000);
        assert_eq!(metrics["stale"], true);
        assert!(metrics["model"].is_null());
    }
    #[test]
    fn harness_commands_require_exact_native_execution_scope() {
        let input = json!({"connection_revision":"r","instance":uuid::Uuid::new_v4().to_string(),"id":uuid::Uuid::new_v4().to_string(),"action":"harness_command","text":"!pwd","execution":"codex_native_full_access"});
        assert!(serde_json::from_value::<Command>(input.clone()).is_ok());
        for scope in [json!("cc_broker"), json!("sandboxed"), Value::Null] {
            let mut wrong = input.clone();
            wrong["execution"] = scope;
            assert!(serde_json::from_value::<Command>(wrong).is_err());
        }
        for field in ["method", "cwd", "shell", "timeoutMs", "environment"] {
            let mut wrong = input.clone();
            wrong[field] = json!("override");
            assert!(serde_json::from_value::<Command>(wrong).is_err());
        }
    }
    #[test]
    fn local_commands_have_no_client_shell_directory_or_environment_overrides() {
        let input = json!({"connection_revision":"r","instance":uuid::Uuid::new_v4().to_string(),"id":uuid::Uuid::new_v4().to_string(),"action":"local_command","text":"!pwd","execution":"cc_broker"});
        assert!(serde_json::from_value::<Command>(input.clone()).is_ok());
        let mut missing = input.clone();
        missing.as_object_mut().unwrap().remove("execution");
        assert!(serde_json::from_value::<Command>(missing).is_err());
        let mut wrong = input.clone();
        wrong["execution"] = json!("harness");
        assert!(serde_json::from_value::<Command>(wrong).is_err());
        for key in ["cwd", "shell", "env", "pid", "flags"] {
            let mut invalid = input.clone();
            invalid[key] = json!("untrusted override");
            assert!(serde_json::from_value::<Command>(invalid).is_err());
        }
        let cancel = json!({"connection_revision":"r","instance":uuid::Uuid::new_v4().to_string(),"id":uuid::Uuid::new_v4().to_string(),"action":"cancel_command","command":uuid::Uuid::new_v4().to_string()});
        assert!(serde_json::from_value::<Command>(cancel).is_ok());
    }
    #[test]
    fn commands_are_typed_and_do_not_accept_cli_flags() {
        let input = json!({"connection_revision":"r","instance":uuid::Uuid::new_v4().to_string(),"id":uuid::Uuid::new_v4().to_string(),"action":"prompt","text":"hello"});
        assert!(serde_json::from_value::<Command>(input.clone()).is_ok());
        let mut invalid = input;
        invalid["flags"] = json!("--dangerously-skip-permissions");
        assert!(serde_json::from_value::<Command>(invalid).is_err());
        assert!(serde_json::from_value::<Prepare>(json!({"connection_revision":"r","path":"/tmp","protocol":"native","executable":"sh"})).is_err());
    }
}
