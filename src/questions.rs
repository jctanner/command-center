//! Explicit native clarification answers, separate from chat/tool permissions.
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
pub(crate) struct Questions {
    grants: Mutex<HashMap<String, Grant>>,
}
#[derive(Clone)]
struct Grant {
    host: String,
    target: agents::Target,
    instance: String,
    screen: String,
    question: String,
    menu: String,
    request: String,
    claim: String,
    choices: Vec<String>,
    text_limit: usize,
    at: Instant,
}
#[derive(Clone, Serialize, Deserialize)]
struct Receipt {
    id: String,
    host: String,
    endpoint: String,
    target: agents::Target,
    instance: String,
    question: String,
    digest: String,
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
    text: Option<String>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn error(text: &str) -> ApiError {
    ApiError(StatusCode::CONFLICT, text.into())
}
fn db(_: impl std::fmt::Display) -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Question receipt storage unavailable; no automatic retry was made".into(),
    )
}
pub(crate) fn init(c: &Connection) -> anyhow::Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS agent_question_receipts(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS agent_question_claims(claim TEXT PRIMARY KEY,receipt TEXT NOT NULL); UPDATE agent_question_receipts SET data=json_set(data,'$.status','uncertain','$.note','Backend restarted during response; check the terminal. No retry was made.') WHERE json_extract(data,'$.status')='submitting';")?;
    Ok(())
}
fn receipt(c: &Connection, id: &str) -> Result<Option<Receipt>, ApiError> {
    c.query_row(
        "SELECT data FROM agent_question_receipts WHERE id=?1",
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
            "SELECT receipt FROM agent_question_claims WHERE claim=?1",
            [key],
            |r| r.get(0),
        )
        .optional()
        .map_err(db)?;
    id.map(|id| receipt(c, &id))
        .transpose()
        .map(Option::flatten)
}
fn public(r: &Receipt) -> Value {
    json!({"id":r.id,"host":r.host,"session":r.target.session,"window":r.target.window,"pane":r.target.pane,"instance":r.instance,"conversation":r.target.conversation,"question":r.question,"status":r.status,"note":r.note,"created_at":r.created_at,"updated_at":r.updated_at})
}
fn validate(answer: &Answer, grant: &Grant) -> Result<(), ApiError> {
    if !uuid::Uuid::parse_str(&answer.id).is_ok_and(|id| id.to_string() == answer.id) {
        return Err(error("Use a question-response UUID"));
    }
    if answer.choice == "other" {
        let text = answer
            .text
            .as_deref()
            .ok_or_else(|| error("Supply the literal Other answer"))?;
        if grant.text_limit == 0
            || text.is_empty()
            || text.trim() != text
            || text.len() > grant.text_limit
            || text.chars().any(char::is_control)
        {
            return Err(error(
                "Other answer must fit the displayed byte limit, on one line without control characters or edge whitespace",
            ));
        }
    } else if answer.text.is_some() || !grant.choices.contains(&answer.choice) {
        return Err(error("Unsupported question answer"));
    }
    Ok(())
}
pub(crate) async fn enrich(
    s: &AppState,
    host: &str,
    target: &agents::Target,
    scope: &str,
    value: &mut Value,
) -> Result<(), ApiError> {
    if !value["input_request"].is_object() {
        return Ok(());
    }
    let mut q = value["input_request"].take();
    let supported = q["supported"] == true
        && ["menu_id", "request_id"].iter().all(|field| {
            q[field]
                .as_str()
                .is_some_and(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
        });
    let linked = value["association"] == "process" && value["selected"].is_string();
    let id = q["id"].as_str().unwrap_or("").to_string();
    let instance = value["instance"].as_str().unwrap_or("").to_string();
    let conversation = value["selected"].as_str().unwrap_or("");
    let claim = hash(format!("question/{scope}/{instance}/{conversation}/{id}").as_bytes());
    let key = claim.clone();
    let existing = s.board.with(move |c| claimed(c, &key)).await?;
    q["submitted"] = json!(existing.is_some());
    if let Some(r) = existing {
        q["receipt"] = public(&r);
    }
    if supported && linked && target.before.is_none() && q["submitted"] != true {
        let mut grants = s.questions.grants.lock().await;
        grants.retain(|_, g| g.at.elapsed() < Duration::from_secs(120));
        if grants.len() < 512 {
            let mut target = target.clone();
            target.conversation = Some(conversation.into());
            target.known_version = None;
            target.known_branch = None;
            let token = uuid::Uuid::new_v4().to_string();
            let grant = Grant {
                host: host.into(),
                target,
                instance,
                screen: value["screen"].as_str().unwrap_or("").into(),
                question: id,
                menu: q["menu_id"].as_str().unwrap_or("").into(),
                request: q["request_id"].as_str().unwrap_or("").into(),
                claim,
                choices: q["choices"]
                    .as_array()
                    .map(|c| {
                        c.iter()
                            .filter_map(|v| v["id"].as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default(),
                text_limit: q["text_max_bytes"].as_u64().unwrap_or(0).min(512) as usize,
                at: Instant::now(),
            };
            grants.insert(token.clone(), grant);
            q["token"] = json!(token);
        }
    }
    q["text_available"] = json!(supported && q["text_max_bytes"].as_u64().unwrap_or(0) > 0);
    if !supported && !q["reason"].is_string() {
        q["reason"] = json!(
            "This native layout remains terminal-only; question responses support one single-choice question at a time."
        );
    } else if !linked {
        q["reason"] =
            json!("A unique process-linked conversation is required before answering here.");
    }
    for field in ["supported", "selected", "other", "menu_id", "request_id"] {
        q.as_object_mut().unwrap().remove(field);
    }
    value["input_request"] = q;
    Ok(())
}
fn insert(c: &mut Connection, claim: &str, r: &Receipt) -> Result<(), ApiError> {
    let tx = c.transaction().map_err(db)?;
    let count: u64 = tx
        .query_row("SELECT count(*) FROM agent_question_receipts", [], |r| {
            r.get(0)
        })
        .map_err(db)?;
    if count >= 4096 {
        return Err(error(
            "Question receipt capacity reached; respond in the terminal",
        ));
    }
    if claimed(&tx, claim)?.is_some() {
        return Err(error(
            "This question already has a submitted or uncertain response. Check the terminal; it cannot be replayed.",
        ));
    }
    tx.execute(
        "INSERT INTO agent_question_receipts(id,data) VALUES(?1,?2)",
        params![r.id, serde_json::to_string(r).map_err(db)?],
    )
    .map_err(db)?;
    tx.execute(
        "INSERT INTO agent_question_claims(claim,receipt) VALUES(?1,?2)",
        params![claim, r.id],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(())
}
pub(crate) async fn answer(
    State(s): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(body): Json<Answer>,
) -> Result<Json<Value>, ApiError> {
    let digest = hash(&serde_json::to_vec(&(&body.choice, &body.text)).map_err(db)?);
    let id = body.id.clone();
    if let Some(existing) = s.board.with(move |c| receipt(c, &id)).await? {
        if existing.host != host || existing.digest != digest {
            return Err(error(
                "Response UUID belongs to a different question answer",
            ));
        }
        return Ok(Json(json!({"receipt":public(&existing)})));
    }
    let grant = {
        let mut grants = s.questions.grants.lock().await;
        let g = grants.get(&body.token).ok_or_else(|| {
            error("Question authorization expired or was consumed; refresh and review")
        })?;
        if g.host != host || g.at.elapsed() >= Duration::from_secs(120) {
            return Err(error("Question authorization expired or target changed"));
        }
        validate(&body, g)?;
        grants.remove(&body.token).unwrap()
    };
    let machine = s.registry.get(&host).await?;
    let slot = s.file_slots.clone().try_acquire_owned().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Agent operations busy; no question response was attempted".into(),
        )
    })?;
    let endpoint = machine.file_writes.clone().lock_owned().await;
    if grant.at.elapsed() >= Duration::from_secs(120)
        || machine.connection_revision != grant.target.connection_revision
        || s.registry.get(&host).await?.connection_revision != grant.target.connection_revision
    {
        return Err(error("Machine changed; question was not answered"));
    }
    let duplicate_id = body.id.clone();
    if let Some(existing) = s.board.with(move |c| receipt(c, &duplicate_id)).await? {
        if existing.host != host || existing.digest != digest {
            return Err(error(
                "Response UUID belongs to a different question answer",
            ));
        }
        return Ok(Json(json!({"receipt":public(&existing)})));
    }
    let r = Receipt {
        id: body.id,
        host,
        endpoint: crate::attention::scope(&machine.config, "", "", "").0,
        target: grant.target.clone(),
        instance: grant.instance.clone(),
        question: grant.question.clone(),
        digest,
        status: "submitting".into(),
        note: "Submitting the explicit answer once; acceptance is not confirmed.".into(),
        created_at: now(),
        updated_at: now(),
    };
    let claim = grant.claim.clone();
    let intent = r.clone();
    // From the durable claim onward, HTTP disconnect cannot drop receipt handling.
    let state = s.clone();
    let job = tokio::spawn(async move {
        let _slot = slot;
        let _endpoint = endpoint;
        state
            .board
            .with(move |c| insert(c, &claim, &intent))
            .await?;
        let mut r = r;
        let mut request = grant.target.request();
        request["action"] = json!("question_answer");
        request["identity"] = json!(grant.instance);
        request["screen"] = json!(grant.screen);
        request["question_id"] = json!(grant.question);
        request["menu_id"] = json!(grant.menu);
        request["request_id"] = json!(grant.request);
        request["choice"] = json!(body.choice);
        request["text"] = json!(body.text);
        // Endpoint edits must remain serialized through the entire helper operation.
        // This spawned task owns the machine guard below, acquired before enqueueing.
        let response = machine.transport.agent_request(request).await;
        let rejected =
            matches!(&response,Ok(v)if v["ok"]["not_sent"]==true&&v["ok"]["submitted"]==false);
        let submitted = matches!(&response,Ok(v)if v["ok"]["submitted"]==true);
        r.status = if rejected {
            "rejected"
        } else if submitted {
            "submitted"
        } else {
            "uncertain"
        }
        .into();
        r.note=if rejected{"No question input was sent. Refresh and review before a new explicit attempt."}else if submitted{"Answer submitted to the original native CLI. This is not proof of provider acceptance."}else{"Question response delivery is uncertain. Check the terminal; never retry automatically."}.into();
        r.updated_at = now();
        let view = public(&r);
        state
            .board
            .with(move |c| {
                let tx = c.transaction().map_err(db)?;
                tx.execute(
                    "UPDATE agent_question_receipts SET data=?1 WHERE id=?2",
                    params![serde_json::to_string(&r).map_err(db)?, r.id],
                )
                .map_err(db)?;
                if rejected {
                    tx.execute(
                        "DELETE FROM agent_question_claims WHERE claim=?1 AND receipt=?2",
                        params![grant.claim, r.id],
                    )
                    .map_err(db)?;
                }
                tx.commit().map_err(db)?;
                Ok(())
            })
            .await?;
        Ok::<_, ApiError>(view)
    });
    let view = job.await.map_err(db)??;
    Ok(Json(json!({"receipt":view})))
}
pub(crate) async fn get(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let r = s
        .board
        .with(move |c| receipt(c, &id))
        .await?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Question receipt not found".into()))?;
    Ok(Json(json!({"receipt":public(&r)})))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Grant, Receipt) {
        let target:agents::Target=serde_json::from_value(json!({"session":"$1","window":"@2","pane":"%3","connection_revision":"runtime","conversation":"native-conversation"})).unwrap();
        let g = Grant {
            host: "fixture".into(),
            target: target.clone(),
            instance: "pid-start-boot".into(),
            screen: "screen".into(),
            question: "question".into(),
            menu: "menu".into(),
            request: "native-request".into(),
            claim: "claim".into(),
            choices: vec!["1".into(), "2".into()],
            text_limit: 64,
            at: Instant::now(),
        };
        let r = Receipt {
            id: uuid::Uuid::new_v4().to_string(),
            host: g.host.clone(),
            endpoint: "endpoint".into(),
            target,
            instance: g.instance.clone(),
            question: g.question.clone(),
            digest: "digest".into(),
            status: "submitting".into(),
            note: "Submitting".into(),
            created_at: now(),
            updated_at: now(),
        };
        (g, r)
    }
    #[test]
    fn one_prompt_claim_is_durable_and_different_response_ids_cannot_replay() {
        let mut c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        let (g, r) = fixture();
        insert(&mut c, &g.claim, &r).unwrap();
        let mut other = r.clone();
        other.id = uuid::Uuid::new_v4().to_string();
        assert!(insert(&mut c, &g.claim, &other).is_err());
        assert_eq!(claimed(&c, &g.claim).unwrap().unwrap().id, r.id);
        init(&c).unwrap();
        let saved = receipt(&c, &r.id).unwrap().unwrap();
        assert_eq!(saved.status, "uncertain");
        assert!(insert(&mut c, &g.claim, &other).is_err());
    }
    #[test]
    fn storage_failure_rolls_back_receipt_and_claim_together() {
        let mut c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        let (g, r) = fixture();
        c.execute_batch("CREATE TRIGGER deny_claim BEFORE INSERT ON agent_question_claims BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        assert!(insert(&mut c, &g.claim, &r).is_err());
        assert!(receipt(&c, &r.id).unwrap().is_none());
        assert!(claimed(&c, &g.claim).unwrap().is_none());
    }
    #[test]
    fn answers_are_literal_supported_and_bounded_before_grant_consumption() {
        let (g, r) = fixture();
        let mut answer = Answer {
            id: r.id,
            token: "token".into(),
            choice: "2".into(),
            text: None,
        };
        assert!(validate(&answer, &g).is_ok());
        answer.choice = "9".into();
        assert!(validate(&answer, &g).is_err());
        answer.choice = "other".into();
        for text in ["", "edge ", "two\nlines", "escape\u{1b}", &"x".repeat(65)] {
            answer.text = Some(text.into());
            assert!(validate(&answer, &g).is_err());
        }
        answer.text = Some("Literal & <answer>".into());
        assert!(validate(&answer, &g).is_ok());
        answer.choice = "1".into();
        assert!(validate(&answer, &g).is_err());
    }
    #[tokio::test]
    async fn expired_grant_cannot_reach_machine_or_transport() {
        let s = AppState::new(serde_json::from_value(json!({"hosts":[]})).unwrap(), 8080).unwrap();
        let (mut g, r) = fixture();
        g.at = Instant::now() - Duration::from_secs(121);
        s.questions.grants.lock().await.insert("expired".into(), g);
        let answer = Answer {
            id: r.id,
            token: "expired".into(),
            choice: "1".into(),
            text: None,
        };
        let result = super::answer(State(s), Path("fixture".into()), Json(answer)).await;
        assert!(matches!(result, Err(ApiError(StatusCode::CONFLICT, _))));
    }
    #[tokio::test]
    async fn only_process_linked_questions_receive_answer_grants_and_internals_stay_private() {
        let s = AppState::new(serde_json::from_value(json!({"hosts":[]})).unwrap(), 8080).unwrap();
        let (g, _) = fixture();
        let base = json!({"instance":"process","screen":"screen","association":"project","selected":"conversation","input_request":{"id":"q","title":"Question?","context":"menu","choices":[{"id":"1","label":"One","description":"detail"}],"supported":true,"menu_id":"a".repeat(64),"request_id":"b".repeat(64),"selected":"1","other":"3","text_max_bytes":64}});
        let mut value = base.clone();
        enrich(&s, "fixture", &g.target, "scope", &mut value)
            .await
            .unwrap();
        assert!(value["input_request"]["token"].is_null());
        value = base;
        value["association"] = json!("process");
        enrich(&s, "fixture", &g.target, "scope", &mut value)
            .await
            .unwrap();
        assert!(value["input_request"]["token"].is_string());
        for field in ["selected", "other", "supported"] {
            assert!(value["input_request"].get(field).is_none());
        }
    }
}
