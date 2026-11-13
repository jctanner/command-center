//! Explicit one-use pane restarts. Status reads never repeat terminal actions.
use crate::{ApiError, AppState, agents};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Target {
    connection_revision: String,
    session: String,
    window: String,
    pane: String,
    instance: String,
}
impl Target {
    fn request(&self, action: &str) -> Value {
        json!({"action":action,"session":self.session,"window":self.window,"pane":self.pane,"identity":self.instance})
    }
}
#[derive(Clone, Deserialize, Serialize)]
struct Receipt {
    id: String,
    host: String,
    target: Target,
    scope: String,
    endpoint: String,
    plan: Value,
    state: String,
    created: u64,
    note: String,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn conflict(message: &str) -> ApiError {
    ApiError(StatusCode::CONFLICT, message.into())
}
fn storage(_: impl std::fmt::Display) -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Restart receipt storage unavailable; check agents before taking another action".into(),
    )
}
fn read(c: &rusqlite::Connection, id: &str) -> Result<Receipt, ApiError> {
    let data: Option<String> = c
        .query_row("SELECT data FROM agent_restarts WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .optional()
        .map_err(storage)?;
    serde_json::from_str(
        &data.ok_or_else(|| conflict("Restart receipt not found; check the agent"))?,
    )
    .map_err(storage)
}
fn write(c: &rusqlite::Connection, r: &Receipt) -> Result<(), ApiError> {
    c.execute("INSERT INTO agent_restarts(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![r.id,serde_json::to_string(r).map_err(storage)?]).map_err(storage)?;
    Ok(())
}
fn public(r: &Receipt) -> Value {
    json!({"id":r.id,"state":r.state,"note":r.note,"provider":r.plan["provider"],"session":r.plan["session"],"project":r.plan["project"],"command":r.plan["command"],"python_venv":r.plan["python_venv"]})
}
pub(crate) async fn prepare(
    State(s): State<Arc<AppState>>,
    Path(host): Path<String>,
    Query(target): Query<Target>,
) -> Result<Json<Value>, ApiError> {
    let _slot = s
        .file_slots
        .try_acquire()
        .map_err(|_| conflict("Agent operations busy"))?;
    let m = s.registry.get(&host).await?;
    if m.connection_revision != target.connection_revision {
        return Err(conflict("Machine changed; refresh agents"));
    }
    let plan = agents::result(
        m.transport
            .agent_request(target.request("restart_prepare"))
            .await?,
    )?;
    if plan["identity"].as_str() != Some(&target.instance)
        || s.registry.get(&host).await?.connection_revision != target.connection_revision
    {
        return Err(conflict("Agent or machine changed during preparation"));
    }
    let r = Receipt {
        id: uuid::Uuid::new_v4().to_string(),
        host,
        target: target.clone(),
        scope: crate::attention::scope(&m.config, &target.session, &target.window, &target.pane).1,
        endpoint: crate::attention::scope(&m.config, "", "", "").0,
        plan,
        state: "prepared".into(),
        created: now(),
        note: String::new(),
    };
    let saved = r.clone();
    s.board.with(move |c| {
        c.execute("DELETE FROM agent_restarts WHERE json_extract(data,'$.state')='prepared' AND json_extract(data,'$.created')<?1",[now().saturating_sub(120)]).map_err(storage)?;
        let count:u64=c.query_row("SELECT count(*) FROM agent_restarts",[],|r|r.get(0)).map_err(storage)?;
        if count>=4096 { return Err(conflict("Restart receipt limit reached")); }
        write(c,&saved)
    }).await?;
    Ok(Json(public(&r)))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Operation {
    id: String,
}
pub(crate) async fn start(
    State(s): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(body): Json<Operation>,
) -> Result<Json<Value>, ApiError> {
    let _slot = s
        .file_slots
        .try_acquire()
        .map_err(|_| conflict("Agent operations busy; no restart attempted"))?;
    let id = body.id.clone();
    let r = s.board.with(move |c| read(c, &id)).await?;
    if r.host != host {
        return Err(conflict("Restart belongs to another machine"));
    }
    let m = s.registry.get(&host).await?;
    let _endpoint = m.file_writes.lock().await;
    if s.registry.get(&host).await?.connection_revision != r.target.connection_revision {
        return Err(conflict("Machine changed; no restart attempted"));
    }
    let id = body.id;
    let mut r = s
        .board
        .with(move |c| {
            let tx = c.transaction().map_err(storage)?;
            let mut r = read(&tx, &id)?;
            if r.state != "prepared" || now().saturating_sub(r.created) > 120 {
                return Err(conflict(
                    "Restart was already attempted or expired. Check status; do not retry it.",
                ));
            }
            r.state = "checking".into();
            r.note =
                "Restart attempt recorded. Uncertain terminal actions are never repeated.".into();
            write(&tx, &r)?;
            tx.commit().map_err(storage)?;
            Ok(r)
        })
        .await?;
    let mut request = r.target.request("restart_agent");
    request["plan"] = r.plan.clone();
    request["restart_id"] = json!(r.id);
    if let Err(error) = m
        .transport
        .agent_request(request)
        .await
        .and_then(|v| agents::result(v).map_err(|e| anyhow::anyhow!(e.1)))
    {
        // This may be a lost response after respawn. Retain the claimed receipt;
        // a status read can verify the new process, but can never re-execute it.
        let _ = error;
        r.note="Restart result is uncertain. Check restart status or inspect the tmux pane; no retry was made.".into();
        let saved = r.clone();
        s.board.with(move |c| write(c, &saved)).await?;
    }
    s.queue.invalidate();
    Ok(Json(public(&r)))
}
pub(crate) async fn status(
    State(s): State<Arc<AppState>>,
    Path(host): Path<String>,
    Query(query): Query<Operation>,
) -> Result<Json<Value>, ApiError> {
    let id = query.id;
    let mut r = s.board.with(move |c| read(c, &id)).await?;
    if r.host != host {
        return Err(conflict("Restart belongs to another machine"));
    }
    if r.state == "prepared" || r.state == "complete" {
        return Ok(Json(public(&r)));
    }
    let _slot = s
        .file_slots
        .try_acquire()
        .map_err(|_| conflict("Agent operations busy; check status shortly"))?;
    let m = s.registry.get(&host).await?;
    let _endpoint = m.file_writes.lock().await;
    if crate::attention::scope(&m.config, "", "", "").0 != r.endpoint
        || s.registry.get(&host).await?.connection_revision != m.connection_revision
    {
        return Err(conflict(
            "Machine endpoint changed; restart status cannot be verified",
        ));
    }
    let mut request = r.target.request("restart_status");
    request["restart_id"] = json!(r.id);
    request["plan"] = r.plan.clone();
    let result = agents::result(m.transport.agent_request(request).await?)?;
    if result["state"] == "complete" {
        let instance = result["instance"]
            .as_str()
            .ok_or_else(|| conflict("No verified replacement process"))?
            .to_owned();
        r.state = "complete".into();
        r.note="Exact conversation resumed. Card settings retained; old drafts and message receipts remain for review.".into();
        let saved = r.clone();
        s.board
            .with(move |c| {
                let tx = c.transaction().map_err(storage)?;
                crate::agent_cards::transfer_restart(
                    &tx,
                    &saved.scope,
                    &saved.target.instance,
                    &instance,
                )?;
                write(&tx, &saved)?;
                tx.commit().map_err(storage)?;
                Ok(())
            })
            .await?;
        s.queue.invalidate();
    } else {
        r.note = result["note"]
            .as_str()
            .unwrap_or("Waiting for resumed CLI")
            .into();
    }
    Ok(Json(public(&r)))
}
