//! Explicit one-use native/ACP handoffs. Status reads never repeat terminal actions.
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
    mode: String,
    broker: Option<String>,
    broker_instance: Option<String>,
}
impl Target {
    fn request(&self, action: &str) -> Value {
        json!({"action":action,"session":self.session,"window":self.window,"pane":self.pane,"identity":self.instance,"mode":self.mode,"broker":self.broker,"broker_instance":self.broker_instance})
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
        "Mode switch receipt storage unavailable; check agents before taking another action".into(),
    )
}
fn read(c: &rusqlite::Connection, id: &str) -> Result<Receipt, ApiError> {
    let data: Option<String> = c
        .query_row(
            "SELECT data FROM agent_mode_switches WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(storage)?;
    serde_json::from_str(
        &data.ok_or_else(|| conflict("Mode switch receipt not found; check the agent"))?,
    )
    .map_err(storage)
}
fn write(c: &rusqlite::Connection, r: &Receipt) -> Result<(), ApiError> {
    c.execute("INSERT INTO agent_mode_switches(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![r.id,serde_json::to_string(r).map_err(storage)?]).map_err(storage)?;
    Ok(())
}
fn pending(
    c: &rusqlite::Connection,
    host: &str,
    target: &Target,
    endpoint: &str,
) -> Result<(), ApiError> {
    for (table, status) in [
        (
            "agent_outbox",
            "phase IN ('queued','submitting','submitted','uncertain','blocked')",
        ),
        (
            "agent_question_receipts",
            "json_extract(data,'$.status')='submitting'",
        ),
        (
            "agent_trust_receipts",
            "json_extract(data,'$.status')='submitting'",
        ),
    ] {
        let exists: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [table],
                |r| r.get(0),
            )
            .map_err(storage)?;
        if !exists {
            continue;
        }
        let count:u64=c.query_row(&format!("SELECT count(*) FROM {table} WHERE {status} AND json_extract(data,'$.host')=?1 AND json_extract(data,'$.target.pane')=?2 AND json_extract(data,'$.endpoint')=?3"),params![host,target.pane,endpoint],|r|r.get(0)).map_err(storage)?;
        if count > 0 {
            return Err(conflict(
                "Resolve pending messages or answers in this pane before switching",
            ));
        }
    }
    let count:u64=c.query_row("SELECT count(*) FROM agent_mode_switches WHERE json_extract(data,'$.host')=?1 AND json_extract(data,'$.target.pane')=?2 AND json_extract(data,'$.endpoint')=?3 AND json_extract(data,'$.state') IN ('checking','installing','install_uncertain')",params![host,target.pane,endpoint],|r|r.get(0)).map_err(storage)?;
    if count > 0 {
        return Err(conflict(
            "An earlier switch is unresolved; check its receipt before another handoff",
        ));
    }
    Ok(())
}
fn public(r: &Receipt) -> Value {
    json!({"id":r.id,"state":r.state,"note":r.note,"provider":r.plan["provider"],"session":r.plan["session"],"project":r.plan["project"],"installation":if r.plan["installation"].is_object(){json!({"package":r.plan["installation"]["package"],"version":r.plan["installation"]["version"],"prefix":r.plan["installation"]["prefix"],"scripts":false,"registry":r.plan["installation"]["registry"],"timeout_seconds":r.plan["installation"]["timeout_seconds"]})}else{Value::Null},"command":if r.plan["installation"].is_object() {json!(["CC isolated install",format!("{}@{}",r.plan["installation"]["package"].as_str().unwrap_or(""),r.plan["installation"]["version"].as_str().unwrap_or("")),r.plan["installation"]["prefix"]])} else if matches!(r.target.mode.as_str(),"acp"|"acp_restart") {json!([r.plan["adapter"]["executable"],"ACP session/load",r.plan["session"]])} else {r.plan["command"].clone()},"python_venv":r.plan["python_venv"],"mode":r.target.mode})
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
    if !matches!(target.mode.as_str(), "native" | "acp" | "acp_restart")
        || target.instance.len() != 64
        || !target.instance.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err(conflict("Invalid switch target"));
    }
    if target.mode == "acp_restart" && target.broker.is_none() {
        return Err(conflict("Broker restart requires a verified ACP target"));
    }
    if let Some(broker) = &target.broker {
        let raw = target
            .broker_instance
            .as_deref()
            .ok_or_else(|| conflict("Missing broker process instance"))?;
        if uuid::Uuid::parse_str(broker).is_err()
            || uuid::Uuid::parse_str(raw).is_err()
            || crate::acp::instance(broker, raw) != target.instance
        {
            return Err(conflict("ACP process identity changed"));
        }
    } else if target.broker_instance.is_some() {
        return Err(conflict("Invalid broker target"));
    }
    let plan = agents::result(m.transport.mode_request(target.request("prepare")).await?)?;
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
        plan: plan.clone(),
        state: if plan["installation"].is_object() {
            "install_required"
        } else {
            "prepared"
        }
        .into(),
        created: now(),
        note: String::new(),
    };
    let saved = r.clone();
    s.board.with(move |c| {
        c.execute("DELETE FROM agent_mode_switches WHERE json_extract(data,'$.state') IN ('prepared','install_required') AND json_extract(data,'$.created')<?1",[now().saturating_sub(120)]).map_err(storage)?;
        let count:u64=c.query_row("SELECT count(*) FROM agent_mode_switches",[],|r|r.get(0)).map_err(storage)?;
        if count>=4096 { return Err(conflict("Mode switch receipt limit reached")); }
        pending(c,&saved.host,&saved.target,&saved.endpoint)?;
        write(c,&saved)
    }).await?;
    Ok(Json(public(&r)))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Operation {
    id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Recovery {
    id: String,
    target: Target,
}
pub(crate) async fn recoverable(
    State(s): State<Arc<AppState>>,
    Path(host): Path<String>,
    Query(target): Query<Target>,
) -> Result<Json<Value>, ApiError> {
    let _slot = s
        .file_slots
        .try_acquire()
        .map_err(|_| conflict("Agent operations busy"))?;
    let m = s.registry.get(&host).await?;
    let _endpoint = m.file_writes.lock().await;
    if target.connection_revision != m.connection_revision
        || target.mode != "acp"
        || target.broker.is_some()
        || target.broker_instance.is_some()
    {
        return Err(conflict(
            "Refresh the recovered native agent before inspecting its earlier switch",
        ));
    }
    let endpoint = crate::attention::scope(&m.config, "", "", "").0;
    let h = host.clone();
    let t = target.clone();
    let r=s.board.with(move|c|{
        let mut statement=c.prepare("SELECT id FROM agent_mode_switches WHERE json_extract(data,'$.host')=?1 AND json_extract(data,'$.endpoint')=?2 AND json_extract(data,'$.target.session')=?3 AND json_extract(data,'$.target.window')=?4 AND json_extract(data,'$.target.pane')=?5 AND json_extract(data,'$.target.mode')='acp' AND json_extract(data,'$.state')='checking' LIMIT 2").map_err(storage)?;
        let ids=statement.query_map(params![h,endpoint,t.session,t.window,t.pane],|row|row.get::<_,String>(0)).map_err(storage)?.collect::<Result<Vec<_>,_>>().map_err(storage)?;
        if ids.len()!=1{return Err(conflict("No unique earlier switch matches this recovered pane"));}
        read(c,&ids[0])
    }).await?;
    let mut request = target.request("recover");
    request["id"] = json!(r.id);
    request["plan"] = r.plan.clone();
    let proof = agents::result(m.transport.mode_request(request).await?)?;
    if proof["state"] != "recovered"
        || proof["instance"] != target.instance
        || s.registry.get(&host).await?.connection_revision != m.connection_revision
    {
        return Err(conflict("Native recovery could not be verified"));
    }
    let mut value = public(&r);
    value["connection_revision"] = json!(m.connection_revision);
    Ok(Json(value))
}
pub(crate) async fn recover(
    State(s): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(body): Json<Recovery>,
) -> Result<Json<Value>, ApiError> {
    let _slot = s
        .file_slots
        .try_acquire()
        .map_err(|_| conflict("Agent operations busy"))?;
    let m = s.registry.get(&host).await?;
    let _endpoint = m.file_writes.lock().await;
    if m.connection_revision != body.target.connection_revision {
        return Err(conflict("Machine changed; refresh agents"));
    }
    let id = body.id.clone();
    let mut r = s.board.with(move |c| read(c, &id)).await?;
    if r.host != host
        || r.endpoint != crate::attention::scope(&m.config, "", "", "").0
        || r.target.mode != "acp"
        || body.target.mode != "acp"
        || r.target.session != body.target.session
        || r.target.window != body.target.window
        || r.target.pane != body.target.pane
        || body.target.broker.is_some()
        || body.target.broker_instance.is_some()
        || body.target.instance.len() != 64
        || !body.target.instance.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err(conflict(
            "Recovery target does not match the original switch",
        ));
    }
    if r.state == "recovered" && r.plan["recovery"]["instance"] == body.target.instance {
        let mut value = public(&r);
        value["connection_revision"] = json!(m.connection_revision);
        return Ok(Json(value));
    }
    if r.state != "checking" {
        return Err(conflict(
            "Only an unresolved switch can be resolved after recovery",
        ));
    }
    let mut request = body.target.request("recover");
    request["id"] = json!(r.id);
    request["plan"] = r.plan.clone();
    let proof = agents::result(m.transport.mode_request(request).await?)?;
    if proof["state"] != "recovered"
        || proof["instance"] != body.target.instance
        || s.registry.get(&host).await?.connection_revision != m.connection_revision
    {
        return Err(conflict("Native recovery could not be verified"));
    }
    r.state = "recovered".into();
    r.note="Earlier switch resolved after verified native recovery. Original receipt retained; no input sent or switch retried. Prepare and confirm a fresh switch separately.".into();
    r.plan["recovery"] = json!({"instance":proof["instance"],"session":proof["session"],"conversation":proof["conversation"],"at":now()});
    let saved = r.clone();
    s.board.with(move |c| write(c, &saved)).await?;
    s.queue.invalidate();
    let mut value = public(&r);
    value["connection_revision"] = json!(m.connection_revision);
    Ok(Json(value))
}
pub(crate) async fn start(
    State(s): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(body): Json<Operation>,
) -> Result<Json<Value>, ApiError> {
    let _slot = s
        .file_slots
        .try_acquire()
        .map_err(|_| conflict("Agent operations busy; no switch attempted"))?;
    let id = body.id.clone();
    let r = s.board.with(move |c| read(c, &id)).await?;
    if r.host != host {
        return Err(conflict("Mode switch belongs to another machine"));
    }
    let m = s.registry.get(&host).await?;
    let _endpoint = m.file_writes.lock().await;
    if s.registry.get(&host).await?.connection_revision != r.target.connection_revision {
        return Err(conflict("Machine changed; no switch attempted"));
    }
    let id = body.id;
    let mut r = s
        .board
        .with(move |c| {
            let tx = c.transaction().map_err(storage)?;
            let mut r = read(&tx, &id)?;
            if r.state != "prepared" || now().saturating_sub(r.created) > 120 {
                return Err(conflict(
                    "Mode switch was already attempted or expired. Check status; do not retry it.",
                ));
            }
            pending(&tx, &r.host, &r.target, &r.endpoint)?;
            r.state = "checking".into();
            r.note = "Mode switch attempt recorded. Uncertain terminal actions are never repeated."
                .into();
            write(&tx, &r)?;
            tx.commit().map_err(storage)?;
            Ok(r)
        })
        .await?;
    let mut request = r.target.request("start");
    request["plan"] = r.plan.clone();
    request["id"] = json!(r.id);
    let outcome = m.transport.mode_request(request).await;
    if let Ok(value) = &outcome
        && value["ok"]["state"] == "not_sent"
    {
        r.state = "not_sent".into();
        r.note = value["ok"]["note"]
            .as_str()
            .unwrap_or("Verified not sent; original process retained")
            .into();
        let saved = r.clone();
        s.board.with(move |c| write(c, &saved)).await?;
        s.queue.invalidate();
        return Ok(Json(public(&r)));
    }
    let helper_note = outcome
        .as_ref()
        .ok()
        .and_then(|v| v["error"].as_str())
        .map(|v| v.chars().take(300).collect::<String>());
    if let Err(error) = outcome.and_then(|v| agents::result(v).map_err(|e| anyhow::anyhow!(e.1))) {
        // This may be a lost response after respawn. Retain the claimed receipt;
        // a status read can verify the new process, but can never re-execute it.
        let _ = error;
        r.note = format!(
            "Mode switch result is uncertain. {} Check switch status or inspect the tmux pane; no retry was made.",
            helper_note.unwrap_or_default()
        );
        let saved = r.clone();
        s.board.with(move |c| write(c, &saved)).await?;
    }
    s.queue.invalidate();
    Ok(Json(public(&r)))
}
pub(crate) async fn install(
    State(s): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(body): Json<Operation>,
) -> Result<Json<Value>, ApiError> {
    let _slot = s
        .file_slots
        .try_acquire()
        .map_err(|_| conflict("Host operations busy; installation not started"))?;
    let id = body.id;
    let r = s
        .board
        .with({
            let id = id.clone();
            move |c| read(c, &id)
        })
        .await?;
    if r.host != host {
        return Err(conflict("Installation belongs to another machine"));
    }
    let m = s.registry.get(&host).await?;
    let _endpoint = m.file_writes.lock().await;
    if m.connection_revision != r.target.connection_revision
        || s.registry.get(&host).await?.connection_revision != m.connection_revision
    {
        return Err(conflict("Machine changed; installation not started"));
    }
    let mut r = s
        .board
        .with(move |c| {
            let tx = c.transaction().map_err(storage)?;
            let mut r = read(&tx, &id)?;
            if r.state != "install_required" || now().saturating_sub(r.created) > 120 {
                return Err(conflict(
                    "Installation expired or already attempted; check its original receipt",
                ));
            }
            pending(&tx, &r.host, &r.target, &r.endpoint)?;
            r.state = "installing".into();
            r.note =
                "Pinned adapter installation requested explicitly; agent remains unchanged.".into();
            write(&tx, &r)?;
            tx.commit().map_err(storage)?;
            Ok(r)
        })
        .await?;
    let mut request = r.target.request("install_start");
    request["id"] = json!(r.id);
    request["plan"] = r.plan.clone();
    if let Ok(value) = m
        .transport
        .mode_request(request)
        .await
        .and_then(|v| agents::result(v).map_err(|e| anyhow::anyhow!(e.1)))
    {
        if value["state"] == "install_failed" {
            r.state = "install_failed".into();
            r.note = value["note"]
                .as_str()
                .unwrap_or("Installation did not start; agent unchanged")
                .into();
        }
    } else {
        r.note="Installation response unavailable. Check its original receipt; no retry or agent switch was made.".into();
    }
    let saved = r.clone();
    s.board.with(move |c| write(c, &saved)).await?;
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
        return Err(conflict("Mode switch belongs to another machine"));
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
            "Machine endpoint changed; switch status cannot be verified",
        ));
    }
    if matches!(
        r.state.as_str(),
        "prepared"
            | "complete"
            | "recovered"
            | "not_sent"
            | "install_required"
            | "installed"
            | "install_failed"
    ) {
        let mut value = public(&r);
        value["connection_revision"] = json!(m.connection_revision);
        return Ok(Json(value));
    }
    if matches!(r.state.as_str(), "installing" | "install_uncertain") {
        let mut request = r.target.request("install_status");
        request["id"] = json!(r.id);
        let result = agents::result(m.transport.mode_request(request).await?)?;
        let phase = result["state"]
            .as_str()
            .filter(|v| {
                matches!(
                    *v,
                    "installing" | "installed" | "install_failed" | "install_uncertain"
                )
            })
            .ok_or_else(|| conflict("Invalid installation receipt"))?;
        r.state = phase.into();
        r.note = result["note"]
            .as_str()
            .unwrap_or("Check original installation; agent unchanged")
            .into();
        let saved = r.clone();
        s.board.with(move |c| write(c, &saved)).await?;
        let mut value = public(&r);
        value["connection_revision"] = json!(m.connection_revision);
        return Ok(Json(value));
    }
    let mut request = r.target.request("status");
    request["id"] = json!(r.id);
    request["plan"] = r.plan.clone();
    let result = agents::result(m.transport.mode_request(request).await?)?;
    if result["state"] == "not_sent" {
        r.state = "not_sent".into();
        r.note = result["note"]
            .as_str()
            .unwrap_or("Verified not sent")
            .into();
        let saved = r.clone();
        s.board.with(move |c| write(c, &saved)).await?;
    } else if result["state"] == "complete" {
        let instance = result["instance"]
            .as_str()
            .ok_or_else(|| conflict("No verified replacement process"))?
            .to_owned();
        r.state = "complete".into();
        r.note=if r.target.mode == "acp_restart" { "Broker restarted and updated; exact conversation resumed. Card settings retained; old drafts and message receipts remain for review." } else { "Connection mode switched; exact conversation resumed. Card settings retained; old drafts and message receipts remain for review." }.into();
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unresolved_pane_messages_and_attempts_block_switch_without_consuming_other_scopes() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE agent_mode_switches(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE agent_outbox(phase TEXT,data TEXT);").unwrap();
        let target = Target {
            connection_revision: "r".into(),
            session: "$1".into(),
            window: "@2".into(),
            pane: "%3".into(),
            instance: "a".repeat(64),
            mode: "acp".into(),
            broker: None,
            broker_instance: None,
        };
        for phase in ["queued", "submitting", "submitted", "uncertain", "blocked"] {
            c.execute(
                "INSERT INTO agent_outbox VALUES(?1,?2)",
                params![
                    phase,
                    json!({"host":"one","endpoint":"endpoint","target":{"pane":"%3"}}).to_string()
                ],
            )
            .unwrap();
            assert!(pending(&c, "one", &target, "endpoint").is_err());
            assert!(pending(&c, "other", &target, "endpoint").is_ok());
            assert!(pending(&c, "one", &target, "different-endpoint").is_ok());
            c.execute("DELETE FROM agent_outbox", []).unwrap();
        }
        c.execute(
            "INSERT INTO agent_outbox VALUES('seen',?1)",
            [json!({"host":"one","endpoint":"endpoint","target":{"pane":"%3"}}).to_string()],
        )
        .unwrap();
        assert!(pending(&c, "one", &target, "endpoint").is_ok());
        c.execute(
            "INSERT INTO agent_mode_switches VALUES('id',?1)",
            [json!({"host":"one","endpoint":"endpoint","target":{"pane":"%3"},"state":"checking"}).to_string()],
        )
        .unwrap();
        assert!(pending(&c, "one", &target, "endpoint").is_err());
    }
}
