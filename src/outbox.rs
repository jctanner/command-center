//! Explicit durable human messages. Only queued intents may dispatch; terminal
//! submission is not provider acceptance, and uncertain input is never replayed.
use crate::{ApiError, AppState, agents, queue::AgentState};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use futures_util::{StreamExt, stream};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Mutex, Notify};

#[derive(Default)]
pub(crate) struct Outbox {
    started: AtomicBool,
    enqueue: Mutex<()>,
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    wake: Notify,
}
#[derive(Clone, Serialize, Deserialize)]
struct Log {
    conversation: String,
    device: u64,
    inode: u64,
    size: u64,
}
#[derive(Clone, Serialize, Deserialize)]
struct Record {
    id: String,
    host: String,
    endpoint: String,
    scope: String,
    target: agents::Target,
    instance: String,
    conversation: Option<String>,
    text: String,
    digest: String,
    #[serde(default)]
    payload_digest: String,
    status: String,
    note: String,
    revision: u64,
    created_at: u64,
    updated_at: u64,
    baseline: Option<Log>,
    seen_message: Option<u64>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn digest(text: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(text.replace("\r\n", "\n").trim().as_bytes())
    )
}
fn storage(_: impl std::fmt::Display) -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Agent outbox storage unavailable; no automatic retry was made".into(),
    )
}
fn conflict(message: &str) -> ApiError {
    ApiError(StatusCode::CONFLICT, message.into())
}
fn unresolved(r: &Record) -> bool {
    matches!(
        r.status.as_str(),
        "queued" | "submitting" | "submitted" | "uncertain" | "blocked"
    )
}
fn stored(c: &Connection, id: &str) -> Result<Option<Record>, ApiError> {
    c.query_row("SELECT data FROM agent_outbox WHERE id=?1", [id], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .map_err(storage)?
    .map(|v| serde_json::from_str(&v).map_err(storage))
    .transpose()
}
fn records(c: &Connection, scope: Option<&str>) -> Result<Vec<Record>, ApiError> {
    let mut q = c
        .prepare("SELECT data FROM agent_outbox WHERE (?1 IS NULL OR scope=?1) ORDER BY seq")
        .map_err(storage)?;
    q.query_map([scope], |r| r.get::<_, String>(0))
        .map_err(storage)?
        .map(|v| serde_json::from_str(&v.map_err(storage)?).map_err(storage))
        .collect()
}
fn write(c: &Connection, record: &Record, expected: u64) -> Result<bool, ApiError> {
    let data = serde_json::to_string(record).map_err(storage)?;
    Ok(c.execute(
        "UPDATE agent_outbox SET phase=?1,revision=?2,data=?3 WHERE id=?4 AND revision=?5",
        params![record.status, record.revision, data, record.id, expected],
    )
    .map_err(storage)?
        == 1)
}
async fn change(
    s: &AppState,
    mut r: Record,
    status: &str,
    note: &str,
) -> Result<Option<Record>, ApiError> {
    let expected = r.revision;
    r.revision += 1;
    r.updated_at = now();
    r.status = status.into();
    r.note = note.into();
    s.board
        .with(move |c| {
            Ok(if write(c, &r, expected)? {
                Some(r)
            } else {
                None
            })
        })
        .await
}
fn public(r: &Record) -> Value {
    json!({"id":r.id,"host":r.host,"session":r.target.session,"window":r.target.window,"pane":r.target.pane,
        "instance":r.instance,"conversation":r.conversation,"text":r.text,"status":r.status,"note":r.note,
        "revision":r.revision,"created_at":r.created_at,"updated_at":r.updated_at,"seen_message":r.seen_message})
}
pub(crate) fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v1/agents/outbox", get(list))
        .route("/api/v1/agents/outbox/{id}", post(action))
}
async fn list(
    State(s): State<Arc<AppState>>,
) -> Result<impl axum::response::IntoResponse, ApiError> {
    let entries = s.board.with(|c| records(c, None)).await?;
    let recent: HashSet<_> = entries
        .iter()
        .rev()
        .filter(|r| !unresolved(r) && r.status != "archived")
        .take(100)
        .map(|r| r.id.as_str())
        .collect();
    let view: Vec<_> = entries
        .iter()
        .filter(|r| unresolved(r) || recent.contains(r.id.as_str()))
        .map(public)
        .collect();
    Ok((
        [("Cache-Control", "private, no-store")],
        Json(json!({"entries":view})),
    ))
}
async fn lookup(s: &AppState, id: String) -> Result<Option<Record>, ApiError> {
    s.board.with(move |c| stored(c, &id)).await
}
fn duplicate(r: &Record, host: &str, text: &str) -> Result<(), ApiError> {
    let payload = format!("{:x}", Sha256::digest(text.as_bytes()));
    let same_text = if r.payload_digest.is_empty() {
        r.text == text
    } else {
        r.payload_digest == payload
    };
    if r.host != host || !same_text {
        return Err(conflict(
            "Message ID already belongs to a different intent; no input was sent",
        ));
    }
    Ok(())
}
pub(crate) async fn enqueue(
    s: Arc<AppState>,
    host: String,
    id: String,
    token: String,
    text: String,
) -> Result<Json<Value>, ApiError> {
    if uuid::Uuid::parse_str(&id).is_err() || id.len() != 36 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Invalid outbox message ID".into(),
        ));
    }
    let _enqueue = s.outbox.enqueue.lock().await;
    if let Some(existing) = lookup(&s, id.clone()).await? {
        duplicate(&existing, &host, &text)?;
        return Ok(Json(json!({"outbox":public(&existing)})));
    }
    let grant = agents::claim_message(&s, &host, &token).await?;
    let machine = s.registry.get(&host).await?;
    if machine.connection_revision != grant.target.connection_revision {
        return Err(conflict("Machine changed; message was not queued"));
    }
    let (endpoint, scope) = crate::attention::scope(
        &machine.config,
        &grant.target.session,
        &grant.target.window,
        &grant.target.pane,
    );
    let record = Record {
        id,
        host,
        endpoint,
        scope: format!("{scope}/{}", grant.identity),
        conversation: grant.target.conversation.clone(),
        target: grant.target,
        instance: grant.identity,
        digest: digest(&text),
        payload_digest: format!("{:x}", Sha256::digest(text.as_bytes())),
        text,
        status: "queued".into(),
        note: "Queued in CC; waiting for verified Ready status.".into(),
        revision: 1,
        created_at: now(),
        updated_at: now(),
        baseline: None,
        seen_message: None,
    };
    let view = public(&record);
    s.board.with(move|c|{
        let (count,active,bytes):(u64,u64,u64)=c.query_row("SELECT count(*),coalesce(sum(phase IN ('queued','submitting','submitted','uncertain','blocked')),0),coalesce(sum(length(json_extract(data,'$.text'))),0) FROM agent_outbox",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(storage)?;
        if count>=4096||active>=256||bytes+record.text.len() as u64>4*1024*1024 {return Err(conflict("Outbox capacity reached. Review and archive settled messages; your draft was not sent."));}
        c.execute("INSERT INTO agent_outbox(id,scope,phase,revision,data) VALUES (?1,?2,?3,?4,?5)",params![record.id,record.scope,record.status,record.revision,serde_json::to_string(&record).map_err(storage)?]).map_err(storage)?;
        Ok(())
    }).await?;
    s.outbox.wake.notify_one();
    Ok(Json(json!({"outbox":view})))
}
async fn target_lock(s: &AppState, r: &Record) -> tokio::sync::OwnedMutexGuard<()> {
    let key = format!("{}/{}", r.host, r.target.pane);
    let mutex = {
        let mut locks = s.outbox.locks.lock().await;
        locks.retain(|_, v| Arc::strong_count(v) > 1);
        locks.entry(key).or_default().clone()
    };
    mutex.lock_owned().await
}
async fn group(s: &AppState, scope: String) -> Result<Vec<Record>, ApiError> {
    s.board.with(move |c| records(c, Some(&scope))).await
}
async fn annotate(
    s: &AppState,
    entries: &[Record],
    note: &str,
    block: bool,
) -> Result<(), ApiError> {
    for r in entries.iter().filter(|r| unresolved(r)) {
        let phase = if block && r.status == "queued" {
            "blocked"
        } else {
            r.status.as_str()
        };
        if r.note != note || r.status != phase {
            let _ = change(s, r.clone(), phase, note).await?;
        }
    }
    Ok(())
}
fn matching_receipt(r: &Record, observation: &Value, used: &HashSet<(String, u64)>) -> Option<u64> {
    let baseline = r.baseline.as_ref()?;
    let log: Log = serde_json::from_value(observation["log"].clone()).ok()?;
    if log.conversation != baseline.conversation
        || log.device != baseline.device
        || log.inode != baseline.inode
        || log.size < baseline.size
    {
        return None;
    }
    observation["users"].as_array()?.iter().find_map(|u| {
        let position = u["position"].as_u64()?;
        (position >= baseline.size
            && u["digest"].as_str() == Some(r.digest.as_str())
            && !used.contains(&(log.conversation.clone(), position)))
        .then_some(position)
    })
}
async fn confirm_observed(
    s: &AppState,
    entries: &mut [Record],
    observation: &Value,
) -> Result<(), ApiError> {
    let mut used: HashSet<_> = entries
        .iter()
        .filter_map(|r| Some((r.baseline.as_ref()?.conversation.clone(), r.seen_message?)))
        .collect();
    let ambiguous_archived: Vec<_> = entries
        .iter()
        .filter(|r| r.status == "archived" && r.baseline.is_some() && r.seen_message.is_none())
        .cloned()
        .collect();
    for r in entries
        .iter_mut()
        .filter(|r| matches!(r.status.as_str(), "submitted" | "uncertain"))
    {
        if ambiguous_archived.iter().any(|old| {
            old.created_at <= r.created_at
                && old.digest == r.digest
                && old
                    .baseline
                    .as_ref()
                    .map(|l| (&l.conversation, l.device, l.inode))
                    == r.baseline
                        .as_ref()
                        .map(|l| (&l.conversation, l.device, l.inode))
        }) {
            let note = "An earlier identical submission has unconfirmed delivery; transcript matching is ambiguous. No retry was made.";
            if r.note != note
                && let Some(updated) = change(s, r.clone(), &r.status, note).await?
            {
                *r = updated;
            }
            continue;
        }
        if let Some(position) = matching_receipt(r, observation, &used) {
            let mut updated = r.clone();
            updated.seen_message = Some(position);
            if let Some(updated) = change(
                s,
                updated,
                "seen",
                "Seen in the process-linked conversation.",
            )
            .await?
            {
                used.insert((
                    updated.baseline.as_ref().unwrap().conversation.clone(),
                    position,
                ));
                *r = updated;
            }
        }
    }
    Ok(())
}
// Reconcile only the exact process-linked history observation already being
// returned to the client. No SSH request, dispatch or input is performed here.
pub(crate) async fn history_receipts(
    s: &AppState,
    scope: String,
    observation: &Value,
) -> Result<Vec<Value>, ApiError> {
    let entries = group(s, scope.clone()).await?;
    let Some(first) = entries.first() else {
        return Ok(vec![]);
    };
    let _lock = target_lock(s, first).await;
    let mut entries = group(s, scope).await?;
    confirm_observed(s, &mut entries, observation).await?;
    Ok(entries
        .iter()
        .filter(|r| r.status != "archived")
        .map(public)
        .collect())
}
async fn process(s: &AppState, scope: String, dispatch: bool) -> Result<(), ApiError> {
    let initial = group(s, scope.clone()).await?;
    let Some(first) = initial.iter().find(|r| unresolved(r)) else {
        return Ok(());
    };
    let _lock = target_lock(s, first).await;
    let mut entries = group(s, scope).await?;
    for r in entries.iter_mut().filter(|r| r.status == "submitting") {
        if let Some(updated)=change(s,r.clone(),"uncertain","Submission finished without a durable receipt. Delivery is uncertain; no retry was made.").await?{*r=updated;}
    }
    let Some(first) = entries.iter().find(|r| unresolved(r)).cloned() else {
        return Ok(());
    };
    let machine = match s.registry.get(&first.host).await {
        Ok(m) => m,
        Err(_) => {
            return annotate(
                s,
                &entries,
                "Machine unavailable; queued input is retained and was not sent.",
                false,
            )
            .await;
        }
    };
    if crate::attention::scope(&machine.config, "", "", "").0 != first.endpoint {
        return annotate(s,&entries,"Machine endpoint changed. Original messages are retained; no input was sent to the replacement.",true).await;
    }
    let Ok(_slot) = s.file_slots.try_acquire() else {
        return Ok(());
    };
    let _endpoint = machine.file_writes.lock().await;
    if s.registry.get(&first.host).await?.connection_revision != machine.connection_revision {
        return Ok(());
    }
    let mut request = first.target.request();
    request["action"] = json!("outbox_status");
    request["identity"] = json!(first.instance);
    let observation = match machine
        .transport
        .agent_request(request)
        .await
        .and_then(|v| agents::result(v).map_err(|e| anyhow::anyhow!("{}:{}", e.0.as_u16(), e.1)))
    {
        Ok(v) => v,
        Err(e) => {
            let replaced = e.to_string().starts_with("409:");
            return annotate(s,&entries,if replaced{"Original agent or pane is no longer available. Review these messages; no replacement was targeted."}else{"Live status unavailable. Queued messages are retained; submitted messages will not be retried."},replaced).await;
        }
    };
    if observation["instance"].as_str() != Some(first.instance.as_str()) {
        return annotate(
            s,
            &entries,
            "Agent process changed. Original messages were not sent to the replacement.",
            true,
        )
        .await;
    }
    let log: Option<Log> = serde_json::from_value(observation["log"].clone()).ok();
    confirm_observed(s, &mut entries, &observation).await?;
    if !dispatch {
        return Ok(());
    }
    let Some(mut next) = entries.iter().find(|r| unresolved(r)).cloned() else {
        return Ok(());
    };
    if next.status != "queued" {
        return Ok(());
    }
    if let Some(expected) = &next.conversation {
        match &log {
            Some(actual) if &actual.conversation != expected => {
                let _=change(s,next,"blocked","Conversation changed in this agent. Review the original message; it was not sent.").await?;
                return Ok(());
            }
            None => {
                let _ = change(
                    s,
                    next,
                    "queued",
                    "Waiting for the original conversation to be process-linked again.",
                )
                .await?;
                return Ok(());
            }
            _ => {}
        }
    }
    let activity = crate::queue::Activity::from_value(
        &observation["activity"],
        observation["context"].as_str().unwrap_or(""),
    );
    let verified = matches!(
        observation["activity"]["source"].as_str(),
        Some("pi_bridge" | "claude_registry" | "claude_events" | "codex_events")
    );
    if activity.state != AgentState::Ready || !verified || observation["send_available"] != true {
        let note = match activity.state {
            AgentState::Working => "Queued in CC; waiting for the agent's current turn to finish.",
            AgentState::Approval => {
                "Queued in CC; waiting for the approval or dialog to be resolved."
            }
            _ => {
                "Queued in CC; waiting for verified Ready status. Submit now is available after checking the terminal."
            }
        };
        if next.note != note {
            let _ = change(s, next, "queued", note).await?;
        }
        return Ok(());
    }
    if next.conversation.is_none() {
        next.conversation = log.as_ref().map(|l| l.conversation.clone());
    }
    next.baseline = log;
    let Some(claimed) = change(
        s,
        next,
        "submitting",
        "Submitting once to the original terminal; CLI acceptance is not yet confirmed.",
    )
    .await?
    else {
        return Ok(());
    };
    let mut request = claimed.target.request();
    request["action"] = json!("send");
    request["identity"] = json!(claimed.instance);
    request["screen"] = observation["screen"].clone();
    request["text"] = json!(claimed.text);
    request["require_ready"] = json!(true);
    complete(s, claimed, machine.transport.agent_request(request).await).await
}
async fn complete(
    s: &AppState,
    mut r: Record,
    response: anyhow::Result<Value>,
) -> Result<(), ApiError> {
    let (phase, note) = match response {
        Ok(v) if v["ok"]["sent"] == true => (
            "submitted",
            "Submitted to terminal. Waiting for the message to appear in its native conversation.",
        ),
        Ok(v) if matches!(v["status"].as_u64(), Some(400 | 409)) => (
            "blocked",
            "The agent or terminal changed before paste. Message retained for review; no automatic retry.",
        ),
        _ => (
            "uncertain",
            "Terminal delivery is uncertain. Message retained; never retried automatically.",
        ),
    };
    if phase == "blocked" {
        r.baseline = None;
    }
    let _ = change(s, r, phase, note).await?;
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Action {
    action: String,
    revision: u64,
    token: Option<String>,
}
async fn action(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<Action>,
) -> Result<Json<Value>, ApiError> {
    let r = lookup(&s, id.clone())
        .await?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Outbox message not found".into()))?;
    if r.revision != body.revision {
        return Err(conflict(
            "Message status changed. Refresh the outbox before acting.",
        ));
    }
    match body.action.as_str() {
        "cancel" if matches!(r.status.as_str(), "queued" | "blocked") => {
            if change(
                &s,
                r,
                "cancelled",
                "Cancelled in CC before terminal submission.",
            )
            .await?
            .is_none()
            {
                return Err(conflict(
                    "Message changed before cancellation. Check its current status.",
                ));
            }
        }
        "archive" if r.status != "queued" && r.status != "submitting" => {
            let mut cleared = r;
            cleared.text.clear();
            if change(
                &s,
                cleared,
                "archived",
                "Archived by user; this does not undo or retry terminal input.",
            )
            .await?
            .is_none()
            {
                return Err(conflict(
                    "Message status changed; refresh before archiving.",
                ));
            }
            s.outbox.wake.notify_one();
        }
        "check" if matches!(r.status.as_str(), "submitted" | "uncertain") => {
            process(&s, r.scope, false).await?;
        }
        "submit" if matches!(r.status.as_str(), "queued" | "blocked") => {
            manual(&s, r, body.token.as_deref().unwrap_or("")).await?;
        }
        _ => {
            return Err(conflict(
                "That action is unavailable for this message state. Uncertain messages cannot be resubmitted.",
            ));
        }
    }
    let current = lookup(&s, id).await?.unwrap();
    Ok(Json(json!({"outbox":public(&current)})))
}
async fn manual(s: &AppState, r: Record, token: &str) -> Result<(), ApiError> {
    let _lock = target_lock(s, &r).await;
    let current = lookup(s, r.id.clone())
        .await?
        .ok_or_else(|| conflict("Message no longer exists"))?;
    if current.revision != r.revision {
        return Err(conflict("Message status changed; review it again"));
    }
    let grant = agents::claim_message(s, &r.host, token).await?;
    if grant.identity != r.instance
        || grant.target.session != r.target.session
        || grant.target.window != r.target.window
        || grant.target.pane != r.target.pane
    {
        return Err(conflict(
            "Original agent target changed; message was not submitted",
        ));
    }
    let machine = s.registry.get(&r.host).await?;
    let _slot = s.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Agent operations busy; no submission was attempted".into(),
        )
    })?;
    let _endpoint = machine.file_writes.lock().await;
    if machine.connection_revision != grant.target.connection_revision
        || crate::attention::scope(&machine.config, "", "", "").0 != r.endpoint
        || s.registry.get(&r.host).await?.connection_revision != machine.connection_revision
    {
        return Err(conflict(
            "Machine endpoint changed; no message was submitted",
        ));
    }
    let before = group(s, r.scope.clone()).await?;
    if before.iter().take_while(|x| x.id != r.id).any(unresolved) {
        return Err(conflict(
            "An earlier message needs delivery confirmation or review before this one can be submitted",
        ));
    }
    let mut request = r.target.request();
    request["action"] = json!("outbox_status");
    request["identity"] = json!(r.instance);
    let observed = agents::result(machine.transport.agent_request(request).await?)?;
    if observed["screen"].as_str() != Some(grant.screen.as_str())
        || observed["send_available"] != true
    {
        return Err(conflict(
            "Terminal changed or is awaiting a decision. Refresh and check it before submitting.",
        ));
    }
    let log: Option<Log> = serde_json::from_value(observed["log"].clone()).ok();
    if r.conversation.is_some() && log.as_ref().map(|l| &l.conversation) != r.conversation.as_ref()
    {
        return Err(conflict(
            "Conversation changed; the original message was not submitted",
        ));
    }
    let mut intent = r;
    intent.baseline = log;
    if intent.conversation.is_none() {
        intent.conversation = intent.baseline.as_ref().map(|l| l.conversation.clone());
    }
    let Some(claimed) = change(
        s,
        intent,
        "submitting",
        "Submitting once by explicit user request; acceptance is unconfirmed.",
    )
    .await?
    else {
        return Err(conflict("Message changed before submission"));
    };
    let mut request = claimed.target.request();
    request["action"] = json!("send");
    request["identity"] = json!(claimed.instance);
    request["screen"] = json!(grant.screen);
    request["text"] = json!(claimed.text);
    complete(s, claimed, machine.transport.agent_request(request).await).await
}
pub(crate) fn start(s: Arc<AppState>) {
    if s.outbox.started.swap(true, Ordering::SeqCst) {
        return;
    }
    tokio::spawn(async move {
        let mut stop = s.shutdown.subscribe();
        let mut checked: HashMap<String, Instant> = HashMap::new();
        loop {
            if *stop.borrow() {
                break;
            }
            if let Ok(entries) = s.board.with(|c| records(c, None)).await {
                let active: HashSet<_> = entries
                    .iter()
                    .filter(|r| unresolved(r) && r.status != "blocked")
                    .map(|r| r.scope.clone())
                    .collect();
                checked.retain(|scope, _| active.contains(scope));
                let due: Vec<_> = active
                    .into_iter()
                    .filter(|scope| {
                        let quick = entries.iter().any(|r| {
                            &r.scope == scope
                                && (r.status == "queued"
                                    || r.status == "submitting"
                                    || now().saturating_sub(r.created_at) < 120000)
                        });
                        checked.get(scope).is_none_or(|at| {
                            at.elapsed() >= Duration::from_secs(if quick { 4 } else { 30 })
                        })
                    })
                    .collect();
                stream::iter(due.into_iter().map(|scope| {
                    checked.insert(scope.clone(), Instant::now());
                    let s = s.clone();
                    async move {
                        let _ = process(&s, scope, true).await;
                    }
                }))
                .buffer_unordered(4)
                .collect::<Vec<_>>()
                .await;
            }
            tokio::select! {_=tokio::time::sleep(Duration::from_secs(2))=>{},_=s.outbox.wake.notified()=>{},_=stop.changed()=>{break;}}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Record {
        Record {
            id: uuid::Uuid::new_v4().to_string(),
            host: "fixture".into(),
            endpoint: "endpoint".into(),
            scope: "scope".into(),
            target: agents::Target {
                session: "$0".into(),
                window: "@0".into(),
                pane: "%0".into(),
                connection_revision: "runtime".into(),
                conversation: Some("conversation".into()),
                before: None,
                known_version: None,
                known_branch: None,
            },
            instance: "process".into(),
            conversation: Some("conversation".into()),
            text: "message".into(),
            digest: digest("message"),
            payload_digest: format!("{:x}", Sha256::digest(b"message")),
            status: "submitted".into(),
            note: String::new(),
            revision: 1,
            created_at: now(),
            updated_at: now(),
            baseline: Some(Log {
                conversation: "conversation".into(),
                device: 1,
                inode: 2,
                size: 100,
            }),
            seen_message: None,
        }
    }
    #[test]
    fn confirmation_requires_exact_input_after_submission_in_same_log_and_no_reuse() {
        let r = fixture();
        let observation = json!({"log":{"conversation":"conversation","device":1,"inode":2,"size":200},"users":[{"position":110,"digest":digest("message")} ]});
        assert_eq!(
            matching_receipt(&r, &observation, &HashSet::new()),
            Some(110)
        );
        for (field, value) in [
            ("conversation", json!("other")),
            ("device", json!(3)),
            ("inode", json!(4)),
            ("size", json!(90)),
        ] {
            let mut changed = observation.clone();
            changed["log"][field] = value;
            assert_eq!(matching_receipt(&r, &changed, &HashSet::new()), None);
        }
        let mut old = observation.clone();
        old["users"][0]["position"] = json!(99);
        assert_eq!(matching_receipt(&r, &old, &HashSet::new()), None);
        let mut wrong = observation.clone();
        wrong["users"][0]["digest"] = json!(digest("different"));
        assert_eq!(matching_receipt(&r, &wrong, &HashSet::new()), None);
        assert_eq!(
            matching_receipt(
                &r,
                &observation,
                &HashSet::from([("conversation".into(), 110)])
            ),
            None
        );
        assert_eq!(digest("message\r\n"), digest("message\n"));
    }
    #[test]
    fn restart_recovers_inflight_as_uncertain_and_compare_and_swap_rejects_stale_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("board.sqlite3");
        let mut r = fixture();
        r.status = "submitting".into();
        {
            let _board = crate::board::Board::new(Some(path.clone())).unwrap();
            let c = Connection::open(&path).unwrap();
            c.execute(
                "INSERT INTO agent_outbox(id,scope,phase,revision,data) VALUES (?1,?2,?3,?4,?5)",
                params![
                    r.id,
                    r.scope,
                    r.status,
                    r.revision,
                    serde_json::to_string(&r).unwrap()
                ],
            )
            .unwrap();
        }
        let _board = crate::board::Board::new(Some(path.clone())).unwrap();
        let c = Connection::open(path).unwrap();
        let recovered = stored(&c, &r.id).unwrap().unwrap();
        assert_eq!(recovered.status, "uncertain");
        assert_eq!(recovered.text, "message");
        assert_eq!(recovered.revision, 2);
        r.revision = 2;
        r.status = "queued".into();
        assert!(!write(&c, &r, 1).unwrap());
        assert_eq!(stored(&c, &r.id).unwrap().unwrap().status, "uncertain");
        assert!(duplicate(&recovered, "fixture", "message").is_ok());
        assert!(duplicate(&recovered, "other", "message").is_err());
        assert!(duplicate(&recovered, "fixture", "other").is_err());
        assert!(duplicate(&recovered, "fixture", " message ").is_err());
    }
}
