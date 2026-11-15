//! Explicit folder trust decisions for a verified CC launch, never ordinary chat.
use crate::{ApiError, AppState, agents};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;
#[derive(Default)]
pub(crate) struct Trust {
    grants: Mutex<HashMap<String, Grant>>,
}
struct Grant {
    host: String,
    target: agents::Target,
    instance: String,
    prompt: Value,
    claim: String,
    at: Instant,
}
#[derive(Clone, Serialize, Deserialize)]
struct Receipt {
    id: String,
    host: String,
    endpoint: String,
    target: agents::Target,
    instance: String,
    launch_id: String,
    question: String,
    folder: String,
    trust_root: String,
    choice: String,
    status: String,
    note: String,
    created_at: u64,
    updated_at: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Answer {
    id: String,
    token: String,
    choice: String,
    launch_id: String,
    trust_id: String,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn error(s: &str) -> ApiError {
    ApiError(StatusCode::CONFLICT, s.into())
}
fn db(_: impl std::fmt::Display) -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Folder trust receipt unavailable; check terminal, never retry uncertain input".into(),
    )
}
fn hash(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
pub(crate) fn init(c: &Connection) -> anyhow::Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS agent_trust_receipts(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS agent_trust_claims(claim TEXT PRIMARY KEY,receipt TEXT NOT NULL); UPDATE agent_trust_receipts SET data=json_set(data,'$.status','uncertain','$.note','Backend restarted during trust decision; inspect terminal. No retry.') WHERE json_extract(data,'$.status')='submitting';")?;
    Ok(())
}
fn read(c: &Connection, id: &str) -> Result<Option<Receipt>, ApiError> {
    c.query_row(
        "SELECT data FROM agent_trust_receipts WHERE id=?1",
        [id],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .map_err(db)?
    .map(|s| serde_json::from_str(&s).map_err(db))
    .transpose()
}
fn claimed(c: &Connection, key: &str) -> Result<Option<Receipt>, ApiError> {
    let id: Option<String> = c
        .query_row(
            "SELECT receipt FROM agent_trust_claims WHERE claim=?1",
            [key],
            |r| r.get(0),
        )
        .optional()
        .map_err(db)?;
    id.map(|id| read(c, &id)).transpose().map(Option::flatten)
}
fn public(r: &Receipt) -> Value {
    json!({"id":r.id,"host":r.host,"session":r.target.session,"window":r.target.window,"pane":r.target.pane,"instance":r.instance,"conversation":"","launch_id":r.launch_id,"question":r.question,"folder":r.folder,"trust_root":r.trust_root,"choice":r.choice,"status":r.status,"note":r.note,"actor":"explicit human decision (trusted client)","created_at":r.created_at,"updated_at":r.updated_at})
}
pub(crate) fn prompt_view(value: &Value) -> Value {
    if !value.is_object() {
        return Value::Null;
    }
    let mut v = value.clone();
    for key in [
        "screen",
        "selected",
        "directory_identity",
        "trust_root_identity",
    ] {
        v.as_object_mut().unwrap().remove(key);
    }
    v
}
pub(crate) async fn enrich(
    s: &AppState,
    host: &str,
    target: &agents::Target,
    scope: &str,
    value: &mut Value,
) -> Result<(), ApiError> {
    let prompt = value["folder_trust"].clone();
    if !prompt.is_object() {
        return Ok(());
    }
    let instance = value["instance"].as_str().unwrap_or("");
    let key = hash(&format!("trust/{scope}/{instance}/{}", prompt["launch_id"]));
    let lookup = key.clone();
    let receipt = s.board.with(move |c| claimed(c, &lookup)).await?;
    let blocked = receipt
        .as_ref()
        .is_some_and(|r| !matches!(r.status.as_str(), "declined" | "rejected"));
    let mut view = prompt_view(&prompt);
    view["submitted"] = json!(blocked);
    view["choices"] = json!([{"id":"trust","label":"Trust this folder","description":format!("Native choice: {}. Confirms the displayed trust scope; the harness may save this decision.",prompt["labels"][0].as_str().unwrap_or("Trust and continue"))},{"id":"decline","label":"Decline — leave blocked","description":"Records your refusal without sending any keys. The native prompt remains blocked."}]);
    if let Some(r) = receipt {
        view["receipt"] = public(&r);
    }
    if !blocked && target.before.is_none() && !instance.is_empty() {
        let mut grants = s.folder_trust.grants.lock().await;
        grants.retain(|_, g| g.at.elapsed() < Duration::from_secs(120));
        if grants.len() < 512 {
            let token = uuid::Uuid::new_v4().to_string();
            grants.insert(
                token.clone(),
                Grant {
                    host: host.into(),
                    target: target.clone(),
                    instance: instance.into(),
                    prompt,
                    claim: key,
                    at: Instant::now(),
                },
            );
            view["token"] = json!(token);
        }
    }
    value["folder_trust"] = view;
    Ok(())
}
fn insert(c: &mut Connection, key: &str, r: &Receipt) -> Result<(), ApiError> {
    let tx = c.transaction().map_err(db)?;
    if let Some(old) = claimed(&tx, key)? {
        if !matches!(old.status.as_str(), "declined" | "rejected") {
            return Err(error(
                "This trust prompt is already claimed; inspect the receipt",
            ));
        }
        tx.execute("DELETE FROM agent_trust_claims WHERE claim=?1", [key])
            .map_err(db)?;
    }
    let count: u64 = tx
        .query_row("SELECT count(*) FROM agent_trust_receipts", [], |r| {
            r.get(0)
        })
        .map_err(db)?;
    if count >= 4096 {
        return Err(error("Trust receipt limit reached; use terminal"));
    }
    tx.execute(
        "INSERT INTO agent_trust_receipts(id,data) VALUES(?1,?2)",
        params![r.id, serde_json::to_string(r).map_err(db)?],
    )
    .map_err(db)?;
    tx.execute(
        "INSERT INTO agent_trust_claims(claim,receipt) VALUES(?1,?2)",
        params![key, r.id],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(())
}
fn duplicate(r: &Receipt, host: &str, b: &Answer) -> Result<(), ApiError> {
    if r.host != host
        || r.choice != b.choice
        || r.launch_id != b.launch_id
        || r.question != b.trust_id
    {
        return Err(error("Trust UUID belongs to another decision"));
    }
    Ok(())
}
pub(crate) async fn answer(
    State(s): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(b): Json<Answer>,
) -> Result<Json<Value>, ApiError> {
    if !uuid::Uuid::parse_str(&b.id).is_ok_and(|id| id.to_string() == b.id)
        || !matches!(b.choice.as_str(), "trust" | "decline")
    {
        return Err(error(
            "Use a decision UUID and explicit trust or decline choice",
        ));
    }
    let id = b.id.clone();
    if let Some(r) = s.board.with(move |c| read(c, &id)).await? {
        duplicate(&r, &host, &b)?;
        return Ok(Json(json!({"receipt":public(&r)})));
    }
    let grant = {
        let mut grants = s.folder_trust.grants.lock().await;
        let g = grants
            .get(&b.token)
            .ok_or_else(|| error("Trust capability expired or consumed; refresh and review"))?;
        if g.host != host
            || g.at.elapsed() >= Duration::from_secs(120)
            || g.prompt["launch_id"] != b.launch_id
            || g.prompt["id"] != b.trust_id
        {
            return Err(error("Trust target changed; refresh and review"));
        }
        grants.remove(&b.token).unwrap()
    };
    let machine = s.registry.get(&host).await?;
    let slot = s
        .file_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| error("Agent operations busy; nothing sent"))?;
    let lock = machine.file_writes.clone().lock_owned().await;
    if grant.at.elapsed() >= Duration::from_secs(120)
        || machine.connection_revision != grant.target.connection_revision
        || s.registry.get(&host).await?.connection_revision != grant.target.connection_revision
    {
        return Err(error("Machine changed; no trust input sent"));
    }
    let id = b.id.clone();
    if let Some(r) = s.board.with(move |c| read(c, &id)).await? {
        duplicate(&r, &host, &b)?;
        return Ok(Json(json!({"receipt":public(&r)})));
    }
    let r = Receipt {
        id: b.id,
        host,
        endpoint: crate::attention::scope(&machine.config, "", "", "").0,
        target: grant.target.clone(),
        instance: grant.instance.clone(),
        launch_id: b.launch_id,
        question: b.trust_id,
        folder: grant.prompt["folder"].as_str().unwrap_or("").into(),
        trust_root: grant.prompt["trust_root"].as_str().unwrap_or("").into(),
        choice: b.choice,
        status: "submitting".into(),
        note: "Explicit trust decision claimed before native input; no automatic retry.".into(),
        created_at: now(),
        updated_at: now(),
    };
    let state = s.clone();
    let job = tokio::spawn(async move {
        let _slot = slot;
        let _lock = lock;
        let intent = r.clone();
        let claim = grant.claim.clone();
        state
            .board
            .with(move |c| insert(c, &claim, &intent))
            .await?;
        let mut r = r;
        let mut request = grant.target.request();
        request["action"] = json!("folder_trust_answer");
        request["identity"] = json!(grant.instance);
        request["trust_id"] = json!(r.question);
        request["launch_id"] = json!(r.launch_id);
        request["screen"] = grant.prompt["screen"].clone();
        request["choice"] = json!(r.choice);
        let result = if grant.at.elapsed() >= Duration::from_secs(120) {
            Ok(json!({"ok":{"not_sent":true,"submitted":false}}))
        } else {
            machine.transport.agent_request(request).await
        };
        let status = match result {
            Ok(v) if v["ok"]["declined"] == true => "declined",
            Ok(v) if v["ok"]["submitted"] == true => "submitted",
            Ok(v) if v["ok"]["not_sent"] == true => "rejected",
            _ => "uncertain",
        };
        r.status = status.into();
        r.note = match status {
            "declined" => "Declined. No keys sent; native folder trust remains blocked.",
            "submitted" => {
                "Trust confirmation submitted once. Provider acceptance is not yet verified."
            }
            "rejected" => {
                "Prompt/process/launch changed before input; nothing sent. Refresh and review."
            }
            _ => "Trust decision delivery uncertain; inspect terminal. Never retry automatically.",
        }
        .into();
        r.updated_at = now();
        let view = public(&r);
        state
            .board
            .with(move |c| {
                c.execute(
                    "UPDATE agent_trust_receipts SET data=?1 WHERE id=?2",
                    params![serde_json::to_string(&r).map_err(db)?, r.id],
                )
                .map_err(db)?;
                Ok(())
            })
            .await?;
        state.queue.invalidate();
        Ok::<Value, ApiError>(view)
    });
    let value = job.await.map_err(db)??;
    Ok(Json(json!({"receipt":value})))
}
pub(crate) async fn get(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let r = s
        .board
        .with(move |c| read(c, &id))
        .await?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Trust receipt not found".into()))?;
    Ok(Json(json!({"receipt":public(&r)})))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Receipt {
        Receipt {
            id: uuid::Uuid::new_v4().to_string(),
            host: "fixture".into(),
            endpoint: "endpoint".into(),
            target: serde_json::from_value(
                json!({"connection_revision":"revision","session":"$1","window":"@2","pane":"%3"}),
            )
            .unwrap(),
            instance: "pid-start-boot".into(),
            launch_id: uuid::Uuid::new_v4().to_string(),
            question: "trust-prompt".into(),
            folder: "/project".into(),
            trust_root: "/project".into(),
            choice: "trust".into(),
            status: "submitting".into(),
            note: "explicit request".into(),
            created_at: now(),
            updated_at: now(),
        }
    }
    #[test]
    fn durable_claim_prevents_two_clients_and_restart_never_replays() {
        let mut c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        let r = fixture();
        insert(&mut c, "claim", &r).unwrap();
        assert!(insert(&mut c, "claim", &fixture()).is_err());
        init(&c).unwrap();
        assert_eq!(read(&c, &r.id).unwrap().unwrap().status, "uncertain");
        assert!(insert(&mut c, "claim", &fixture()).is_err());
    }
    #[test]
    fn declined_and_proven_not_sent_decisions_allow_fresh_review_but_keep_audit() {
        let mut c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        let mut r = fixture();
        r.status = "declined".into();
        r.choice = "decline".into();
        insert(&mut c, "claim", &r).unwrap();
        let next = fixture();
        insert(&mut c, "claim", &next).unwrap();
        assert_eq!(read(&c, &r.id).unwrap().unwrap().status, "declined");
        assert_eq!(claimed(&c, "claim").unwrap().unwrap().id, next.id);
        let body = Answer {
            id: next.id.clone(),
            token: "unused".into(),
            choice: next.choice.clone(),
            launch_id: next.launch_id.clone(),
            trust_id: next.question.clone(),
        };
        assert!(duplicate(&next, "another host", &body).is_err());
        assert!(duplicate(&next, &next.host, &body).is_ok());
    }
    #[test]
    fn public_prompt_and_receipt_do_not_expose_native_navigation_or_grants() {
        let p = prompt_view(
            &json!({"id":"prompt","folder":"/project","screen":"secret","selected":1,"directory_identity":"inode"}),
        );
        assert!(p.get("screen").is_none());
        assert!(p.get("selected").is_none());
        assert!(p.get("directory_identity").is_none());
        let r = public(&fixture());
        assert!(r.get("target").is_none());
        assert!(r.get("token").is_none());
        assert_eq!(r["folder"], "/project");
    }
    #[tokio::test]
    async fn expired_or_different_endpoint_grants_never_create_an_input_receipt() {
        let state = AppState::new(
            crate::config::Config {
                hosts: vec![crate::config::Host {
                    id: "fixture".into(),
                    name: "Fixture".into(),
                    ssh: None,
                    socket: None,
                    ssh_config: None,
                    ssh_jump: None,
                    projects: vec![],
                }],
            },
            8080,
        )
        .unwrap();
        for expired in [true, false] {
            let r = fixture();
            let token = uuid::Uuid::new_v4().to_string();
            let prompt = json!({"id":r.question,"launch_id":r.launch_id,"folder":"/project","trust_root":"/project","screen":"screen"});
            let grant = Grant {
                host: r.host.clone(),
                target: r.target.clone(),
                instance: r.instance.clone(),
                prompt,
                claim: "claim".into(),
                at: if expired {
                    Instant::now() - Duration::from_secs(121)
                } else {
                    Instant::now()
                },
            };
            state
                .folder_trust
                .grants
                .lock()
                .await
                .insert(token.clone(), grant);
            let body = Answer {
                id: r.id.clone(),
                token,
                choice: "trust".into(),
                launch_id: r.launch_id,
                trust_id: r.question,
            };
            let error = answer(State(state.clone()), Path("fixture".into()), Json(body))
                .await
                .unwrap_err();
            assert_eq!(error.0, StatusCode::CONFLICT);
            assert!(
                state
                    .board
                    .with(move |c| read(c, &r.id))
                    .await
                    .unwrap()
                    .is_none()
            );
        }
    }
}
