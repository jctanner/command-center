//! Durable tickets. Agent launches use the existing one-use launcher and endpoint guards.
use crate::{ApiError, AppState, launch};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
fn err(status: StatusCode, text: &str) -> ApiError {
    ApiError(status, text.into())
}
fn db_error(_: impl std::fmt::Display) -> ApiError {
    err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Ticket storage unavailable; no launch was authorized",
    )
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn revision() -> String {
    uuid::Uuid::new_v4().to_string()
}
const STATUSES: [&str; 6] = [
    "backlog",
    "ready",
    "in_progress",
    "review",
    "blocked",
    "done",
];
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct Context {
    pub host: String,
    pub endpoint: Option<String>,
    pub session: String,
    pub session_name: String,
    pub window: String,
    pub window_number: Option<u32>,
    pub window_name: String,
    pub pane: String,
    pub path: String,
    pub provider: String,
    pub model: String,
    pub conversation: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Check {
    id: String,
    text: String,
    done: bool,
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Run {
    #[serde(default)]
    pub python_venv: Option<String>,
    pub id: String,
    pub host: String,
    pub endpoint: String,
    pub project: String,
    pub provider: String,
    pub model: Option<String>,
    #[serde(default)]
    pub approval_policy: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub target_session: Option<String>,
    #[serde(default)]
    pub window_name: Option<String>,
    #[serde(default)]
    pub card_name: Option<String>,
    #[serde(default)]
    pub card_initialized: bool,
    pub created_at: u64,
    pub checked_at: Option<u64>,
    pub result: Option<Value>,
    pub released: bool,
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Ticket {
    pub id: String,
    pub number: i64,
    pub revision: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    pub context: Context,
    checklist: Vec<Check>,
    pub runs: Vec<Run>,
    pub created_at: u64,
    pub updated_at: u64,
}
pub(crate) struct Board {
    db: Arc<Mutex<Connection>>,
    pub(crate) whiteboard_events: tokio::sync::watch::Sender<u64>,
    pub(crate) whiteboard_epoch: String,
    pub(crate) whiteboard_event_slots: Arc<tokio::sync::Semaphore>,
}
impl Board {
    pub fn new(path: Option<PathBuf>) -> anyhow::Result<Self> {
        let db = match &path {
            Some(p) => Connection::open(p)?,
            None => Connection::open_in_memory()?,
        };
        #[cfg(unix)]
        if let Some(p) = path {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600))?;
        }
        db.busy_timeout(std::time::Duration::from_secs(3))?;
        let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
        anyhow::ensure!(
            version <= 2,
            "Board database schema is newer than this backend"
        );
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS tickets(id TEXT NOT NULL UNIQUE, version TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS ticket_deletions(id TEXT PRIMARY KEY, revision TEXT NOT NULL, deleted_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS agent_cards(scope TEXT PRIMARY KEY, revision INTEGER NOT NULL, name TEXT NOT NULL, notes TEXT NOT NULL); CREATE TABLE IF NOT EXISTS agent_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, scope TEXT NOT NULL, phase TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS agent_outbox_scope ON agent_outbox(scope,seq); CREATE TABLE IF NOT EXISTS agent_restarts(id TEXT PRIMARY KEY,data TEXT NOT NULL); UPDATE agent_outbox SET phase='uncertain', revision=revision+1, data=json_set(data,'$.status','uncertain','$.revision',revision+1,'$.note','Backend restarted during submission; delivery is uncertain. No retry was made.') WHERE phase='submitting';")?;
        if version < 2 {
            db.execute_batch("BEGIN IMMEDIATE; ALTER TABLE agent_cards ADD COLUMN color TEXT NOT NULL DEFAULT ''; ALTER TABLE agent_cards ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)); PRAGMA user_version=2; COMMIT;")?;
        }
        crate::questions::init(&db)?;
        crate::whiteboard::init(&db)?;
        crate::whiteboard_exports::init(&db)?;
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            whiteboard_events: tokio::sync::watch::channel(0).0,
            whiteboard_epoch: uuid::Uuid::new_v4().to_string(),
            whiteboard_event_slots: Arc::new(tokio::sync::Semaphore::new(32)),
        })
    }
    /// Notify inside the owned DB job, after successful committed work. HTTP
    /// disconnect cannot lose the invalidation between commit and publication.
    /// Read-only and idempotent duplicate calls do not change total_changes.
    pub(crate) async fn whiteboard_write<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<T, ApiError> + Send + 'static,
    ) -> Result<T, ApiError> {
        let events = self.whiteboard_events.clone();
        self.with(move |c| {
            let before = c.total_changes();
            let result = f(c);
            if result.is_ok() && c.total_changes() != before {
                events.send_modify(|revision| *revision = revision.wrapping_add(1));
            }
            result
        })
        .await
    }
    pub(crate) async fn with<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<T, ApiError> + Send + 'static,
    ) -> Result<T, ApiError> {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || {
            let mut c = db.lock().map_err(db_error)?;
            f(&mut c)
        })
        .await
        .map_err(db_error)?
    }
    pub(crate) async fn ticket(&self, id: String) -> Result<Ticket, ApiError> {
        self.with(move |c| load(c, &id)).await
    }
    async fn delete(&self, id: String, expected: String) -> Result<(), ApiError> {
        self.with(move |c| {
            let tx = c.transaction().map_err(db_error)?;
            let t = load(&tx, &id)?;
            check_revision(&t, &expected)?;
            if t.runs.iter().any(|r| !r.released) {
                return Err(err(
                    StatusCode::CONFLICT,
                    "Check and release the existing launch before deleting this ticket",
                ));
            }
            // Keep the row: its number, UUID and launch receipts must never be recycled.
            tx.execute(
                "INSERT INTO ticket_deletions(id,revision,deleted_at) VALUES(?1,?2,?3)",
                params![id, expected, now()],
            )
            .map_err(db_error)?;
            tx.commit().map_err(db_error)?;
            Ok(())
        })
        .await
    }
    pub(crate) async fn claim(
        &self,
        id: String,
        expected: String,
        run: Run,
    ) -> Result<Ticket, ApiError> {
        self.with(move |c| {
            let tx = c.transaction().map_err(db_error)?;
            let mut t = load(&tx, &id)?;
            check_revision(&t, &expected)?;
            if t.runs.iter().any(|r| !r.released) {
                return Err(err(
                    StatusCode::CONFLICT,
                    "This ticket already has a launch. Check it before allowing another agent",
                ));
            }
            if t.runs.len() >= 10 {
                return Err(err(
                    StatusCode::CONFLICT,
                    "This ticket has reached its ten-launch history limit",
                ));
            }
            t.runs.push(run);
            write(&tx, &mut t)?;
            tx.commit().map_err(db_error)?;
            Ok(t)
        })
        .await
    }
    pub(crate) async fn record(
        &self,
        id: String,
        run_id: String,
        result: Value,
    ) -> Result<Ticket, ApiError> {
        self.with(move |c| {
            let tx = c.transaction().map_err(db_error)?;
            let mut t = load(&tx, &id)?;
            let r = t
                .runs
                .iter_mut()
                .find(|r| r.id == run_id)
                .ok_or_else(|| err(StatusCode::CONFLICT, "Ticket launch no longer matches"))?;
            let first = r.result.as_ref().is_none_or(|v| v["found"] != true);
            r.checked_at = Some(now());
            let mut result = safe_result(&result);
            if let Some(previous) = &r.result {
                if previous["identity"].is_string() {
                    if result["identity"].is_string() && previous["identity"] != result["identity"]
                    {
                        result["replacement"] = json!(true);
                    }
                    result["identity"] = previous["identity"].clone();
                }
                if previous["replacement"] == true {
                    result["replacement"] = json!(true);
                }
                if (result["conversation"].is_null() || result["replacement"] == true)
                    && previous["conversation"].is_string()
                {
                    result["conversation"] = previous["conversation"].clone();
                }
            }
            if !r.card_initialized
                && result["replacement"] != true
                && let (Some(name), Some(instance), Some(session), Some(window), Some(pane)) = (
                    r.card_name.as_deref(),
                    result["identity"].as_str(),
                    result["session"].as_str(),
                    result["window"].as_str(),
                    result["pane"].as_str(),
                )
                && instance.len() == 64
                && instance.bytes().all(|b| b.is_ascii_hexdigit())
            {
                let scope = crate::attention::agent_scope(&r.endpoint, session, window, pane);
                crate::agent_cards::initialize(&tx, &scope, instance, name)?;
                r.card_initialized = true;
            }
            r.result = Some(result.clone());
            if first && result["found"] == true && ["backlog", "ready"].contains(&t.status.as_str())
            {
                t.status = "in_progress".into();
            }
            write(&tx, &mut t)?;
            tx.commit().map_err(db_error)?;
            Ok(t)
        })
        .await
    }
}
fn load(c: &Connection, id: &str) -> Result<Ticket, ApiError> {
    let data: Option<String> = c
        .query_row("SELECT data FROM tickets WHERE id=?1 AND NOT EXISTS (SELECT 1 FROM ticket_deletions d WHERE d.id=tickets.id)", [id], |r| r.get(0))
        .optional()
        .map_err(db_error)?;
    serde_json::from_str(&data.ok_or_else(|| err(StatusCode::NOT_FOUND, "Ticket not found"))?)
        .map_err(db_error)
}
fn check_revision(t: &Ticket, r: &str) -> Result<(), ApiError> {
    if t.revision != r {
        Err(err(
            StatusCode::CONFLICT,
            "Ticket changed in another client. Reload before saving; your draft has been kept",
        ))
    } else {
        Ok(())
    }
}
fn write(c: &Connection, t: &mut Ticket) -> Result<(), ApiError> {
    t.revision = revision();
    t.updated_at = now();
    c.execute(
        "UPDATE tickets SET version=?1,data=?2 WHERE id=?3",
        params![
            t.revision,
            serde_json::to_string(t).map_err(db_error)?,
            t.id
        ],
    )
    .map_err(db_error)?;
    Ok(())
}
fn safe_result(v: &Value) -> Value {
    let mut result = json!({});
    for key in [
        "found",
        "running",
        "exited",
        "launch_id",
        "session",
        "window",
        "pane",
        "session_name",
        "project",
        "provider",
        "model",
        "identity",
        "conversation",
        "replacement",
        "destination",
    ] {
        if let Some(v) = v.get(key) {
            result[key] = v.clone();
        }
    }
    result
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Change {
    id: String,
    revision: Option<String>,
    title: String,
    description: String,
    status: String,
    priority: String,
    context: Context,
    checklist: Vec<Check>,
    host_revision: Option<String>,
}
fn valid(b: &Change) -> bool {
    uuid::Uuid::parse_str(&b.id).is_ok()
        && !b.title.trim().is_empty()
        && b.title.len() <= 240
        && !b.title.chars().any(char::is_control)
        && b.description.len() <= 24000
        && STATUSES.contains(&b.status.as_str())
        && ["low", "normal", "high", "urgent"].contains(&b.priority.as_str())
        && b.checklist.len() <= 100
        && b.checklist
            .iter()
            .all(|v| v.id.len() <= 64 && !v.id.is_empty() && v.text.len() <= 500)
        && [
            &b.context.host,
            &b.context.session,
            &b.context.session_name,
            &b.context.window,
            &b.context.window_name,
            &b.context.pane,
            &b.context.provider,
            &b.context.model,
            &b.context.conversation,
        ]
        .iter()
        .all(|s| s.len() <= 240 && !s.chars().any(char::is_control))
        && b.context.path.len() <= 4096
        && !b.context.path.chars().any(char::is_control)
        && !b.description.contains('\0')
}
pub(crate) fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v1/board/activity", get(activity))
        .route("/api/v1/board/tickets", get(list).post(save))
        .route(
            "/api/v1/board/tickets/{id}",
            get(detail).delete(delete_ticket),
        )
        .route("/api/v1/board/tickets/{id}/move", post(move_ticket))
        .route("/api/v1/board/tickets/{id}/prepare", post(prepare))
        .route("/api/v1/board/tickets/{id}/launch", post(start))
        .route("/api/v1/board/tickets/{id}/check", post(check))
        .route("/api/v1/board/tickets/{id}/release", post(release))
        .route("/api/v1/board/tickets/{id}/target", get(target))
        .layer(axum::extract::DefaultBodyLimit::max(131072))
}
async fn list(State(s): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    s.board.with(|c|{let mut q=c.prepare("SELECT data FROM tickets WHERE NOT EXISTS (SELECT 1 FROM ticket_deletions d WHERE d.id=tickets.id) ORDER BY rowid DESC LIMIT 1000").map_err(db_error)?;let rows=q.query_map([],|r|r.get::<_,String>(0)).map_err(db_error)?;let mut out=Vec::new();for r in rows{let t:Ticket=serde_json::from_str(&r.map_err(db_error)?).map_err(db_error)?;out.push(json!({"id":t.id,"number":t.number,"revision":t.revision,"title":t.title,"status":t.status,"priority":t.priority,"context":t.context,"updated_at":t.updated_at,"checks":t.checklist.len(),"checked":t.checklist.iter().filter(|c|c.done).count(),"run":t.runs.last().map(|r|json!({"id":r.id,"released":r.released,"checked_at":r.checked_at,"result":r.result}))}));}Ok(Json(json!({"tickets":out})))}).await
}
async fn detail(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Ticket>, ApiError> {
    Ok(Json(s.board.ticket(id).await?))
}
async fn save(
    State(s): State<Arc<AppState>>,
    Json(mut b): Json<Change>,
) -> Result<Json<Ticket>, ApiError> {
    if !valid(&b) {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "Invalid ticket fields or display limits exceeded",
        ));
    }
    let retain_scope = if b.revision.is_some() {
        s.board.ticket(b.id.clone()).await.ok().is_some_and(|t| {
            t.context.host == b.context.host
                && t.context.endpoint.is_some()
                && t.context.endpoint == b.context.endpoint
        })
    } else {
        false
    };
    if !b.context.host.is_empty() && !retain_scope {
        let machine = s.registry.get(&b.context.host).await?;
        if b.host_revision.as_deref() != Some(&machine.connection_revision) {
            return Err(err(
                StatusCode::CONFLICT,
                "Machine changed; refresh its context before saving",
            ));
        }
        let endpoint = crate::attention::scope(&machine.config, "", "", "").0;
        if b.context.endpoint.as_ref().is_some_and(|v| v != &endpoint) {
            return Err(err(
                StatusCode::CONFLICT,
                "Ticket references a different machine endpoint. Choose its machine again to rebind explicitly",
            ));
        }
        b.context.endpoint = Some(endpoint);
    } else if b.context.host.is_empty() {
        b.context.endpoint = None;
    }
    let t = s
        .board
        .with(move |c| {
            let tx = c.transaction().map_err(db_error)?;
            let old = load(&tx, &b.id);
            let mut t = if let Some(expected) = &b.revision {
                let old = old?;
                check_revision(&old, expected)?;
                old
            } else {
                if tx.query_row("SELECT EXISTS(SELECT 1 FROM tickets WHERE id=?1)", [&b.id], |r| r.get::<_, bool>(0)).map_err(db_error)? {
                    return Err(err(
                        StatusCode::CONFLICT,
                        "Ticket already exists; reload before creating another",
                    ));
                }
                let count: i64 = tx
                    .query_row("SELECT count(*) FROM tickets WHERE NOT EXISTS (SELECT 1 FROM ticket_deletions d WHERE d.id=tickets.id)", [], |r| r.get(0))
                    .map_err(db_error)?;
                if count >= 1000 {
                    return Err(err(StatusCode::CONFLICT, "Board ticket limit reached"));
                }
                let mut t = Ticket {
                    id: b.id.clone(),
                    number: 0,
                    revision: revision(),
                    title: String::new(),
                    description: String::new(),
                    status: String::new(),
                    priority: String::new(),
                    context: Context::default(),
                    checklist: Vec::new(),
                    runs: Vec::new(),
                    created_at: now(),
                    updated_at: now(),
                };
                tx.execute(
                    "INSERT INTO tickets(id,version,data) VALUES(?1,?2,'{}')",
                    params![t.id, t.revision],
                )
                .map_err(db_error)?;
                t.number = tx.last_insert_rowid();
                t
            };
            t.title = b.title.trim().into();
            t.description = b.description;
            t.status = b.status;
            t.priority = b.priority;
            t.context = b.context;
            t.checklist = b.checklist;
            write(&tx, &mut t)?;
            tx.commit().map_err(db_error)?;
            Ok(t)
        })
        .await?;
    Ok(Json(t))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Move {
    revision: String,
    status: String,
}
async fn move_ticket(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(b): Json<Move>,
) -> Result<Json<Ticket>, ApiError> {
    if !STATUSES.contains(&b.status.as_str()) {
        return Err(err(StatusCode::BAD_REQUEST, "Invalid ticket status"));
    }
    Ok(Json(
        s.board
            .with(move |c| {
                let tx = c.transaction().map_err(db_error)?;
                let mut t = load(&tx, &id)?;
                check_revision(&t, &b.revision)?;
                t.status = b.status;
                write(&tx, &mut t)?;
                tx.commit().map_err(db_error)?;
                Ok(t)
            })
            .await?,
    ))
}
#[derive(Clone)]
pub(crate) struct Binding {
    pub ticket: String,
    pub revision: String,
    pub prompt: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Prepare {
    python_venv: Option<String>,
    revision: String,
    host: String,
    connection_revision: String,
    path: String,
    provider: String,
    model: Option<String>,
    approval_policy: Option<String>,
    prompt: String,
    target_session: Option<String>,
    window_name: Option<String>,
    card_name: Option<String>,
}
async fn prepare(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(b): Json<Prepare>,
) -> Result<Json<Value>, ApiError> {
    let t = s.board.ticket(id.clone()).await?;
    check_revision(&t, &b.revision)?;
    if b.prompt.trim().is_empty() || b.prompt.len() > 24000 || b.prompt.contains('\0') {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "Use a nonempty ticket prompt of up to 24,000 bytes",
        ));
    }
    if t.runs.iter().any(|r| !r.released) {
        return Err(err(
            StatusCode::CONFLICT,
            "Check the existing launch before starting another agent",
        ));
    }
    let machine = s.registry.get(&b.host).await?;
    if t.context.host == b.host
        && t.context
            .endpoint
            .as_ref()
            .is_some_and(|v| v != &crate::attention::scope(&machine.config, "", "", "").0)
    {
        return Err(err(
            StatusCode::CONFLICT,
            "Ticket machine endpoint changed; rebind it before launching",
        ));
    }
    let Json(mut value) = launch::prepare(
        State(s.clone()),
        Path(b.host),
        Query(launch::Prepare {
            python_venv: b.python_venv,
            connection_revision: b.connection_revision,
            path: b.path,
            provider: b.provider,
            model: b.model,
            approval_policy: b.approval_policy,
            target_session: b.target_session,
            window_name: b.window_name,
            card_name: b.card_name,
        }),
    )
    .await?;
    let token = value["token"]
        .as_str()
        .ok_or_else(|| err(StatusCode::BAD_GATEWAY, "Launch preparation unavailable"))?;
    launch::bind(
        &s,
        token,
        Binding {
            ticket: id,
            revision: b.revision,
            prompt: b.prompt,
        },
    )
    .await?;
    value["ticket"] = json!(t.id);
    Ok(Json(value))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Start {
    token: String,
}
async fn start(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(b): Json<Start>,
) -> Result<Json<Value>, ApiError> {
    launch::board_start(s, id, b.token).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Expected {
    revision: String,
}
async fn delete_ticket(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(b): Json<Expected>,
) -> Result<StatusCode, ApiError> {
    s.board.delete(id, b.revision).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn check(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(b): Json<Expected>,
) -> Result<Json<Value>, ApiError> {
    let t = s.board.ticket(id.clone()).await?;
    check_revision(&t, &b.revision)?;
    let r = t
        .runs
        .iter()
        .rev()
        .find(|r| !r.released)
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "No active launch to check"))?;
    let Json(mut result) = launch::status(
        State(s.clone()),
        Path(r.host.clone()),
        Query(launch::Recovery {
            connection_revision: None,
            endpoint: Some(r.endpoint.clone()),
            launch_id: r.id.clone(),
        }),
    )
    .await?;
    s.board.record(id, r.id.clone(), result.clone()).await?;
    result.as_object_mut().unwrap().remove("context");
    Ok(Json(result))
}
async fn release(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(b): Json<Expected>,
) -> Result<Json<Ticket>, ApiError> {
    Ok(Json(
        s.board
            .with(move |c| {
                let tx = c.transaction().map_err(db_error)?;
                let mut t = load(&tx, &id)?;
                check_revision(&t, &b.revision)?;
                let r = t
                    .runs
                    .iter_mut()
                    .rev()
                    .find(|r| !r.released)
                    .ok_or_else(|| err(StatusCode::BAD_REQUEST, "No launch to release"))?;
                if r.checked_at.is_none()
                    || r.result.as_ref().is_none_or(|v| {
                        v["running"] == true || v["found"] == true && v["exited"] != true
                    })
                {
                    return Err(err(
                        StatusCode::CONFLICT,
                        "Check the launch first; a running or starting agent cannot be released",
                    ));
                }
                r.released = true;
                write(&tx, &mut t)?;
                tx.commit().map_err(db_error)?;
                Ok(t)
            })
            .await?,
    ))
}
async fn target(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let t = s.board.ticket(id).await?;
    let run = t.runs.iter().rev().find(|r| !r.released);
    let (host, endpoint, session, window, pane, path) = if let Some(r) = run {
        let v = r.result.as_ref().ok_or_else(|| {
            err(
                StatusCode::CONFLICT,
                "Check this launch before opening its target",
            )
        })?;
        (
            r.host.as_str(),
            Some(r.endpoint.as_str()),
            v["session"].as_str().unwrap_or(""),
            v["window"].as_str().unwrap_or(""),
            v["pane"].as_str().unwrap_or(""),
            r.project.as_str(),
        )
    } else {
        (
            t.context.host.as_str(),
            t.context.endpoint.as_deref(),
            t.context.session.as_str(),
            t.context.window.as_str(),
            t.context.pane.as_str(),
            t.context.path.as_str(),
        )
    };
    let m = s.registry.get(host).await?;
    if endpoint != Some(crate::attention::scope(&m.config, "", "", "").0.as_str()) {
        return Err(err(
            StatusCode::CONFLICT,
            "Ticket machine endpoint changed; saved context is retained",
        ));
    }
    let inventory = crate::tmux::inventory(&m.transport).await?;
    let w = inventory
        .sessions
        .iter()
        .find(|s| s.id == session)
        .and_then(|s| s.windows.iter().find(|w| w.id == window));
    let terminal=w.filter(|w|pane.is_empty()||w.panes.iter().any(|p|p.id==pane)).map(|w|json!({"host":host,"connection":m.connection_revision,"session":session,"window":w.id,"instance":run.and_then(|r|r.result.as_ref()).and_then(|v|v["identity"].as_str()),"pane":if pane.is_empty(){w.panes.iter().find(|p|p.active).map(|p|p.id.as_str()).unwrap_or("")}else{pane}}));
    if s.registry.get(host).await?.connection_revision != m.connection_revision {
        return Err(err(
            StatusCode::CONFLICT,
            "Machine changed during target check",
        ));
    }
    Ok(Json(
        json!({"host":host,"connection_revision":m.connection_revision,"path":path,"terminal":terminal,"agent_current":run.is_none_or(|r|r.result.as_ref().is_some_and(|v|v["identity"].is_string()&&v["replacement"]!=true))}),
    ))
}

async fn activity(State(s): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let runs = s
        .board
        .with(|c| {
            let mut q = c
                .prepare("SELECT data FROM tickets WHERE NOT EXISTS (SELECT 1 FROM ticket_deletions d WHERE d.id=tickets.id) ORDER BY rowid DESC LIMIT 1000")
                .map_err(db_error)?;
            let values = q
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(db_error)?;
            let mut out = Vec::new();
            for data in values {
                let t: Ticket = serde_json::from_str(&data.map_err(db_error)?).map_err(db_error)?;
                if let Some(run) = t.runs.into_iter().rev().find(|r| !r.released) {
                    out.push((t.id, run));
                }
            }
            Ok(out)
        })
        .await?;
    if runs.is_empty() {
        return Ok(Json(json!({"items":{}})));
    }
    let Json(snapshot) = crate::queue::snapshot(State(s.clone())).await;
    let snapshot = serde_json::to_value(snapshot).map_err(db_error)?;
    let mut items = serde_json::Map::new();
    for (id, run) in runs {
        let machine = s.registry.get(&run.host).await;
        let Ok(machine) = machine else { continue };
        if crate::attention::scope(&machine.config, "", "", "").0 != run.endpoint {
            continue;
        }
        let result = run.result.unwrap_or(Value::Null);
        let host = snapshot["hosts"].as_array().and_then(|h| {
            h.iter().find(|h| {
                h["id"] == run.host && h["connection_revision"] == machine.connection_revision
            })
        });
        let item = host.and_then(|h| h["items"].as_array()).and_then(|v| {
            v.iter().find(|i| {
                i["session"] == result["session"]
                    && i["window"] == result["window"]
                    && i["pane"] == result["pane"]
            })
        });
        if let Some(item) = item.filter(|item| {
            result["identity"].is_string()
                && item["attention"]["instance"] == result["identity"]
                && result["replacement"] != true
        }) {
            items.insert(id,json!({"state":item["activity"]["state"],"reason":item["activity"]["reason"],"needs_attention":item["attention"]["needs_attention"]}));
        }
    }
    Ok(Json(json!({"items":items})))
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn fixture(b: &Board) -> Ticket {
        b.with(|c| {
            let t = Ticket {
                id: revision(),
                number: 1,
                revision: revision(),
                title: "Task".into(),
                description: "Markdown".into(),
                status: "ready".into(),
                priority: "normal".into(),
                context: Context::default(),
                checklist: vec![],
                runs: vec![],
                created_at: now(),
                updated_at: now(),
            };
            c.execute(
                "INSERT INTO tickets(id,version,data) VALUES(?1,?2,?3)",
                params![t.id, t.revision, serde_json::to_string(&t).unwrap()],
            )
            .unwrap();
            Ok(t)
        })
        .await
        .unwrap()
    }
    fn run() -> Run {
        Run {
            python_venv: None,
            id: revision(),
            host: "local".into(),
            endpoint: "endpoint".into(),
            project: "/tmp".into(),
            provider: "pi".into(),
            model: None,
            approval_policy: None,
            prompt: "Reviewed prompt".into(),
            target_session: None,
            window_name: None,
            card_name: None,
            card_initialized: false,
            created_at: now(),
            checked_at: None,
            result: None,
            released: false,
        }
    }
    #[tokio::test]
    async fn card_preferences_migrate_legacy_rows_and_survive_reopening() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.sqlite3");
        let legacy = Connection::open(&path).unwrap();
        legacy.execute_batch("CREATE TABLE agent_cards(scope TEXT PRIMARY KEY,revision INTEGER NOT NULL,name TEXT NOT NULL,notes TEXT NOT NULL); INSERT INTO agent_cards VALUES('legacy',7,'Existing card','Existing notes'); PRAGMA user_version=1;").unwrap();
        drop(legacy);
        let board = Board::new(Some(path.clone())).unwrap();
        board.with(|c| {
            let row:(u64,String,String,String,bool)=c.query_row("SELECT revision,name,notes,color,pinned FROM agent_cards WHERE scope='legacy'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(db_error)?;
            assert_eq!(row,(7,"Existing card".into(),"Existing notes".into(),String::new(),false));
            c.execute("UPDATE agent_cards SET color='#b34fff',pinned=1 WHERE scope='legacy'",[]).map_err(db_error)?;
            assert_eq!(c.pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).map_err(db_error)?,2);
            Ok(())
        }).await.unwrap();
        drop(board);
        let reopened = Board::new(Some(path)).unwrap();
        reopened
            .with(|c| {
                let value: (String, bool) = c
                    .query_row(
                        "SELECT color,pinned FROM agent_cards WHERE scope='legacy'",
                        [],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .map_err(db_error)?;
                assert_eq!(value, ("#b34fff".into(), true));
                Ok(())
            })
            .await
            .unwrap();
    }
    #[tokio::test]
    async fn claims_are_durable_and_one_per_revision() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("board.sqlite3");
        let b = Board::new(Some(path.clone())).unwrap();
        let t = fixture(&b).await;
        let r = run();
        let saved = b
            .claim(t.id.clone(), t.revision.clone(), r.clone())
            .await
            .unwrap();
        assert_ne!(saved.revision, t.revision);
        assert!(b.claim(t.id.clone(), t.revision, run()).await.is_err());
        drop(b);
        let b = Board::new(Some(path)).unwrap();
        let saved = b.ticket(t.id.clone()).await.unwrap();
        assert_eq!(saved.runs[0].prompt, "Reviewed prompt");
        assert!(saved.runs[0].result.is_none());
        let final_ticket=b.record(t.id,r.id,json!({"found":true,"running":true,"pane":"%1","context":"DO NOT PERSIST TERMINAL"})).await.unwrap();
        assert_eq!(final_ticket.status, "in_progress");
        assert!(
            final_ticket.runs[0]
                .result
                .as_ref()
                .unwrap()
                .get("context")
                .is_none()
        );
    }
    #[tokio::test]
    async fn a_replacement_process_cannot_inherit_a_ticket_association() {
        let b = Board::new(None).unwrap();
        let t = fixture(&b).await;
        let r = run();
        b.claim(t.id.clone(), t.revision, r.clone()).await.unwrap();
        b.record(t.id.clone(),r.id.clone(),json!({"found":true,"running":true,"identity":"original","conversation":"known-session"})).await.unwrap();
        let updated = b
            .record(
                t.id,
                r.id,
                json!({"found":true,"running":true,"identity":"replacement"}),
            )
            .await
            .unwrap();
        let result = updated.runs[0].result.as_ref().unwrap();
        assert_eq!(result["identity"], "original");
        assert_eq!(result["conversation"], "known-session");
        assert_eq!(result["replacement"], true);
    }
    #[tokio::test]
    async fn deletion_is_revision_checked_durable_and_retains_receipts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("delete.sqlite3");
        let b = Board::new(Some(path.clone())).unwrap();
        let t = fixture(&b).await;
        assert_eq!(
            b.delete(t.id.clone(), "stale".into()).await.unwrap_err().0,
            StatusCode::CONFLICT
        );
        assert!(b.ticket(t.id.clone()).await.is_ok());
        let mut r = run();
        r.released = true;
        b.with({
            let id = t.id.clone();
            move |c| {
                let mut t = load(c, &id)?;
                t.runs.push(r);
                write(c, &mut t)?;
                Ok(())
            }
        })
        .await
        .unwrap();
        let saved = b.ticket(t.id.clone()).await.unwrap();
        b.delete(t.id.clone(), saved.revision).await.unwrap();
        drop(b);
        let b = Board::new(Some(path)).unwrap();
        assert_eq!(
            b.ticket(t.id.clone()).await.err().unwrap().0,
            StatusCode::NOT_FOUND
        );
        assert!(
            b.claim(t.id.clone(), t.revision.clone(), run())
                .await
                .is_err()
        );
        b.with(move |c| {
            let raw: String = c
                .query_row("SELECT data FROM tickets WHERE id=?1", [t.id], |r| r.get(0))
                .map_err(db_error)?;
            let retained: Ticket = serde_json::from_str(&raw).map_err(db_error)?;
            assert_eq!(retained.number, t.number);
            assert_eq!(retained.runs.len(), 1);
            Ok(())
        })
        .await
        .unwrap();
    }
    #[tokio::test]
    async fn deletion_rejects_unreleased_or_uncertain_launches() {
        let b = Board::new(None).unwrap();
        let t = fixture(&b).await;
        let saved = b.claim(t.id.clone(), t.revision, run()).await.unwrap();
        assert_eq!(
            b.delete(t.id.clone(), saved.revision).await.unwrap_err().0,
            StatusCode::CONFLICT
        );
        assert_eq!(b.ticket(t.id).await.unwrap().runs.len(), 1);
    }
    #[tokio::test]
    async fn failed_claims_do_not_insert_a_run() {
        let b = Board::new(None).unwrap();
        let t = fixture(&b).await;
        assert!(b.claim(t.id.clone(), "stale".into(), run()).await.is_err());
        assert!(b.ticket(t.id).await.unwrap().runs.is_empty());
    }
}
