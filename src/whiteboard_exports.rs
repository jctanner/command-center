//! Frozen CC-managed drawing artifacts. No message delivery or remote file access.
use crate::{
    ApiError, AppState,
    whiteboard::{self, Scene},
    whiteboard_render::{ARTIFACT_LIMIT, Bounds, Job, Rendered},
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    process::Stdio,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
static SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
const TTL: u64 = 24 * 60 * 60 * 1000;
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn uuid(s: &str) -> bool {
    s.len() == 36 && uuid::Uuid::parse_str(s).is_ok()
}
fn err(code: StatusCode, text: &str) -> ApiError {
    ApiError(code, text.into())
}
fn db(_: impl std::fmt::Display) -> ApiError {
    err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Whiteboard artifact storage unavailable; inspect the retained export UUID",
    )
}
fn bad(text: &str) -> ApiError {
    err(StatusCode::BAD_REQUEST, text)
}
fn conflict(text: &str) -> ApiError {
    err(StatusCode::CONFLICT, text)
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(crate) fn init(c: &Connection) -> anyhow::Result<()> {
    crate::attachments::init(c)?;
    c.execute_batch("CREATE TABLE IF NOT EXISTS whiteboard_regions(board TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(board,id)); CREATE TABLE IF NOT EXISTS whiteboard_exports(id TEXT PRIMARY KEY,board TEXT NOT NULL,digest TEXT NOT NULL,metadata TEXT NOT NULL,png BLOB,svg BLOB,native BLOB,description BLOB); UPDATE whiteboard_exports SET png=NULL,svg=NULL,native=NULL,description=NULL,metadata=json_set(metadata,'$.state','failed','$.error','Backend restarted during rendering; no retry was made') WHERE json_extract(metadata,'$.state')='rendering';")?;
    Ok(())
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Scope {
    #[default]
    Board,
    Selection {
        elements: Vec<String>,
    },
    Frame {
        id: String,
        revision: String,
    },
    Group {
        id: String,
        revision: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub id: String,
    pub revision: u64,
    #[serde(default)]
    pub scope: Scope,
    #[serde(default = "one")]
    pub scale: f64,
    #[serde(default = "dark")]
    pub theme: String,
}
fn one() -> f64 {
    1.
}
fn dark() -> String {
    "dark".into()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Region {
    id: String,
    revision: Option<String>,
    scene_revision: u64,
    name: String,
    kind: String,
    elements: Vec<String>,
    #[serde(default)]
    bounds: Option<Bounds>,
}
fn region(c: &Connection, board: &str, id: &str) -> Result<Region, ApiError> {
    let data: Option<String> = c
        .query_row(
            "SELECT data FROM whiteboard_regions WHERE board=?1 AND id=?2",
            params![board, id],
            |r| r.get(0),
        )
        .optional()
        .map_err(db)?;
    serde_json::from_str(
        &data.ok_or_else(|| err(StatusCode::NOT_FOUND, "Region not found on this board"))?,
    )
    .map_err(db)
}
fn member_ids(ids: &[String], scene: &Scene) -> Result<HashSet<String>, ApiError> {
    let set: HashSet<_> = ids.iter().cloned().collect();
    if ids.is_empty()
        || ids.len() > 300
        || set.len() != ids.len()
        || ids
            .iter()
            .any(|id| !uuid(id) || !scene.elements.iter().any(|e| e.id == *id))
    {
        return Err(bad("Scope needs 1–300 distinct existing element UUIDs"));
    }
    Ok(set)
}
fn center(d: &whiteboard::Drawing) -> (f64, f64) {
    (d.x + d.w / 2., d.y + d.h / 2.)
}
fn boundary(d: &whiteboard::Drawing, p: (f64, f64)) -> (f64, f64) {
    let (x, y) = center(d);
    let (dx, dy) = (p.0 - x, p.1 - y);
    if dx == 0. && dy == 0. {
        return (x, y);
    }
    let (a, b) = ((d.w / 2.).max(1.), (d.h / 2.).max(1.));
    let k = match d.kind.as_str() {
        "ellipse" => 1. / (dx * dx / (a * a) + dy * dy / (b * b)).sqrt(),
        "diamond" => 1. / (dx.abs() / a + dy.abs() / b),
        _ => {
            let kx = if dx == 0. {
                f64::INFINITY
            } else {
                a / dx.abs()
            };
            let ky = if dy == 0. {
                f64::INFINITY
            } else {
                b / dy.abs()
            };
            kx.min(ky)
        }
    };
    (x + dx * k, y + dy * k)
}
fn ends(d: &whiteboard::Drawing, s: &Scene) -> ((f64, f64), (f64, f64)) {
    let a = s.elements.iter().find(|e| Some(&e.id) == d.from.as_ref());
    let b = s.elements.iter().find(|e| Some(&e.id) == d.to.as_ref());
    let ca = a.map_or((d.x, d.y), |e| center(&e.drawing));
    let cb = b.map_or((d.x + d.w, d.y + d.h), |e| center(&e.drawing));
    (
        a.map_or(ca, |e| boundary(&e.drawing, cb)),
        b.map_or(cb, |e| boundary(&e.drawing, ca)),
    )
}
fn inside(d: &whiteboard::Drawing, s: &Scene, b: &Bounds) -> bool {
    let points = if d.kind == "arrow" {
        let (a, z) = ends(d, s);
        vec![a, z]
    } else if d.kind == "freehand" {
        d.points.as_ref().map_or(vec![], |ps| {
            ps.iter().map(|p| (d.x + p.x, d.y + p.y)).collect()
        })
    } else {
        vec![(d.x, d.y), (d.x + d.w, d.y + d.h)]
    };
    points
        .iter()
        .all(|(x, y)| *x >= b.x && *y >= b.y && *x <= b.x + b.w && *y <= b.y + b.h)
}
fn freeze(
    c: &Connection,
    scene: &Scene,
    scope: &Scope,
) -> Result<(Scene, Option<Bounds>), ApiError> {
    let (ids, bounds) = match scope {
        Scope::Board => (scene.elements.iter().map(|e| e.id.clone()).collect(), None),
        Scope::Selection { elements } => (member_ids(elements, scene)?, None),
        Scope::Frame { id, revision } | Scope::Group { id, revision } => {
            let r = region(c, &scene.id, id)?;
            let kind = if matches!(scope, Scope::Frame { .. }) {
                "frame"
            } else {
                "group"
            };
            if r.kind != kind || r.revision.as_ref() != Some(revision) {
                return Err(conflict(
                    "Region changed; read its current revision before exporting",
                ));
            }
            let ids = member_ids(&r.elements, scene)?;
            if let Some(b) = &r.bounds
                && r.elements.iter().any(|id| {
                    !inside(
                        &scene.elements.iter().find(|e| e.id == *id).unwrap().drawing,
                        scene,
                        b,
                    )
                })
            {
                return Err(conflict(
                    "A frame member moved outside its bounds; review the frame before exporting",
                ));
            }
            (ids, r.bounds)
        }
    };
    let mut frozen = scene.clone();
    frozen.elements.retain(|e| ids.contains(&e.id));
    for e in &mut frozen.elements {
        if e.drawing.kind == "arrow" {
            let (a, b) = ends(&e.drawing, scene);
            e.drawing.x = a.0;
            e.drawing.y = a.1;
            e.drawing.w = b.0 - a.0;
            e.drawing.h = b.1 - a.1;
            if e.drawing.from.as_ref().is_some_and(|id| !ids.contains(id)) {
                e.drawing.from = None;
            }
            if e.drawing.to.as_ref().is_some_and(|id| !ids.contains(id)) {
                e.drawing.to = None;
            }
        }
    }
    // Ticket references aren't part of a cropped drawing export.
    if !matches!(scope, Scope::Board) {
        frozen.ticket = None;
    }
    Ok((frozen, bounds))
}
async fn save_region(
    State(s): State<Arc<AppState>>,
    Path(board): Path<String>,
    Json(mut b): Json<Region>,
) -> Result<Json<Region>, ApiError> {
    if !uuid(&b.id)
        || b.name.trim().is_empty()
        || b.name.len() > 120
        || b.name.chars().any(char::is_control)
        || !["frame", "group"].contains(&b.kind.as_str())
        || b.bounds.as_ref().is_some_and(|v| !v.valid())
        || b.kind == "frame" && b.bounds.is_none()
        || b.kind == "group" && b.bounds.is_some()
    {
        return Err(bad(
            "Invalid named frame/group; frames need finite positive bounds",
        ));
    }
    s.board.with(move|c|{let tx=c.transaction().map_err(db)?;let scene=whiteboard::load(&tx,&board)?;if scene.revision!=b.scene_revision{return Err(conflict("Scene changed; review region membership before saving"));}member_ids(&b.elements,&scene)?;let old=region(&tx,&board,&b.id);match old{Ok(old)if old.revision!=b.revision=>return Err(conflict("Region changed")),Err(ApiError(StatusCode::NOT_FOUND,_))if b.revision.is_none()=>(),Err(e)=>return Err(e),_=>()};let count:i64=tx.query_row("SELECT count(*) FROM whiteboard_regions WHERE board=?1",[&board],|r|r.get(0)).map_err(db)?;if count>=100&&b.revision.is_none(){return Err(conflict("Board region limit reached"));}b.revision=Some(uuid::Uuid::new_v4().to_string());tx.execute("INSERT INTO whiteboard_regions VALUES(?1,?2,?3) ON CONFLICT(board,id) DO UPDATE SET data=excluded.data",params![board,b.id,serde_json::to_string(&b).map_err(db)?]).map_err(db)?;tx.commit().map_err(db)?;Ok(Json(b))}).await
}
async fn list_regions(
    State(s): State<Arc<AppState>>,
    Path(board): Path<String>,
) -> Result<Json<Value>, ApiError> {
    s.board
        .with(move |c| {
            whiteboard::load(c, &board)?;
            let mut q = c
                .prepare(
                    "SELECT data FROM whiteboard_regions WHERE board=?1 ORDER BY rowid LIMIT 100",
                )
                .map_err(db)?;
            let rows = q
                .query_map([board], |r| r.get::<_, String>(0))
                .map_err(db)?;
            let mut out = vec![];
            for row in rows {
                out.push(serde_json::from_str::<Region>(&row.map_err(db)?).map_err(db)?);
            }
            Ok(Json(json!({"regions":out})))
        })
        .await
}
fn metadata(c: &Connection, id: &str) -> Result<Value, ApiError> {
    let data: Option<String> = c
        .query_row(
            "SELECT metadata FROM whiteboard_exports WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(db)?;
    let mut data: Value =
        serde_json::from_str(&data.ok_or_else(|| err(StatusCode::NOT_FOUND, "Export not found"))?)
            .map_err(db)?;
    if data["expires_at"].as_u64().unwrap_or(0) <= now() {
        data["state"] = json!("expired");
        data["artifacts"] = json!({});
    }
    Ok(data)
}
fn prior(
    c: &Connection,
    board: &str,
    b: &Request,
    digest: &str,
) -> Result<Option<Value>, ApiError> {
    let row: Option<(String, String)> = c
        .query_row(
            "SELECT board,digest FROM whiteboard_exports WHERE id=?1",
            [&b.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    if let Some((stored, hash)) = row {
        if stored != board || hash != digest {
            return Err(conflict("Export UUID belongs to a different request"));
        }
        return Ok(Some(metadata(c, &b.id)?));
    }
    Ok(None)
}
fn expire(c: &Connection) -> Result<(), ApiError> {
    c.execute(
        "DELETE FROM export_attachment_pins WHERE expires IS NOT NULL AND expires<=?1",
        [now()],
    )
    .map_err(db)?;
    c.execute("UPDATE whiteboard_exports SET png=NULL,svg=NULL,native=NULL,description=NULL,metadata=json_set(metadata,'$.state','expired','$.artifacts',json('{}')) WHERE json_extract(metadata,'$.expires_at')<=?1 AND json_extract(metadata,'$.state')<>'expired' AND NOT EXISTS(SELECT 1 FROM export_attachment_pins p WHERE p.export_id=whiteboard_exports.id)",[now()]).map_err(db)?;
    Ok(())
}
async fn worker(job: Job) -> Result<Rendered, ApiError> {
    let exe = std::env::current_exe().map_err(db)?;
    let body = serde_json::to_vec(&job).map_err(db)?;
    if body.len() > 2 * 1024 * 1024 {
        return Err(bad("Render input exceeds 2 MiB"));
    }
    let mut command = tokio::process::Command::new(exe);
    command
        .arg("--whiteboard-render-worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(unix)]
    unsafe {
        command.pre_exec(|| {
            let memory = libc::rlimit {
                rlim_cur: 512 * 1024 * 1024,
                rlim_max: 512 * 1024 * 1024,
            };
            let cpu = libc::rlimit {
                rlim_cur: 8,
                rlim_max: 8,
            };
            if libc::setrlimit(libc::RLIMIT_AS, &memory) != 0
                || libc::setrlimit(libc::RLIMIT_CPU, &cpu) != 0
            {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let task = async {
        let mut child = command.spawn().map_err(db)?;
        let mut input = child.stdin.take().unwrap();
        let mut output = child.stdout.take().unwrap().take(24 * 1024 * 1024 + 1);
        let write = async {
            input.write_all(&body).await.map_err(db)?;
            drop(input);
            Ok::<(), ApiError>(())
        };
        let read = async {
            let mut bytes = vec![];
            output.read_to_end(&mut bytes).await.map_err(db)?;
            if bytes.len() > 24 * 1024 * 1024 {
                return Err(bad("Renderer response exceeded budget"));
            }
            Ok(bytes)
        };
        let wait = async { child.wait().await.map_err(db) };
        let (_, bytes, status) = tokio::try_join!(write, read, wait)?;
        if !status.success() {
            return Err(err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Rendering failed or exceeded size/time/memory limits",
            ));
        }
        serde_json::from_slice::<Rendered>(&bytes).map_err(db)
    };
    tokio::time::timeout(Duration::from_secs(12), task)
        .await
        .map_err(|_| {
            err(
                StatusCode::GATEWAY_TIMEOUT,
                "Render deadline exceeded; worker stopped",
            )
        })?
}
enum Prepared {
    Existing(Value),
    Render(Job),
}
fn prepare(
    c: &mut Connection,
    board: &str,
    request: Request,
    digest: &str,
) -> Result<Prepared, ApiError> {
    let tx = c.transaction().map_err(db)?;
    if let Some(value) = prior(&tx, board, &request, digest)? {
        return Ok(Prepared::Existing(value));
    }
    expire(&tx)?;
    let count: i64 = tx
        .query_row("SELECT count(*) FROM whiteboard_exports", [], |r| r.get(0))
        .map_err(db)?;
    if count >= 10000 {
        return Err(conflict("Retained export limit reached"));
    }
    let scene = whiteboard::load(&tx, board)?;
    if scene.revision != request.revision {
        return Err(conflict("Scene revision changed; read before exporting"));
    }
    let (frozen, bounds) = freeze(&tx, &scene, &request.scope)?;
    let description = whiteboard::description(&frozen);
    let native=serde_json::to_vec(&json!({"type":"cc-whiteboard-export","version":1,"scope":request.scope,"bounds":bounds,"scene":frozen,"description":description})).map_err(db)?;
    let used:i64=tx.query_row("SELECT coalesce(sum(coalesce(length(png),0)+coalesce(length(svg),0)+coalesce(length(native),0)+coalesce(length(description),0)),0) FROM whiteboard_exports",[],|r|r.get(0)).map_err(db)?;
    if used + native.len() as i64 + description.len() as i64 > 64 * 1024 * 1024 {
        return Err(conflict("Artifact storage capacity reached"));
    }
    let meta = json!({"id":request.id,"board":board,"revision":scene.revision,"scope":request.scope,"bounds":bounds,"scale":request.scale,"theme":request.theme,"created_at":now(),"expires_at":now()+TTL,"state":"rendering","element_ids":frozen.elements.iter().map(|e|&e.id).collect::<Vec<_>>(),"artifacts":{}});
    tx.execute("INSERT INTO whiteboard_exports(id,board,digest,metadata,native,description) VALUES(?1,?2,?3,?4,?5,?6)",params![request.id,board,digest,serde_json::to_string(&meta).map_err(db)?,native,description.as_bytes()]).map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(Prepared::Render(Job {
        scene: frozen,
        bounds,
        theme: request.theme,
        scale: request.scale,
    }))
}
fn failed(c: &Connection, id: &str, mut meta: Value, reason: &str) -> Result<Value, ApiError> {
    meta["state"] = json!("failed");
    meta["error"] = json!(reason);
    meta["artifacts"] = json!({});
    c.execute("UPDATE whiteboard_exports SET metadata=?2,png=NULL,svg=NULL,native=NULL,description=NULL WHERE id=?1",params![id,serde_json::to_string(&meta).map_err(db)?]).map_err(db)?;
    Ok(meta)
}
fn finish(
    c: &mut Connection,
    id: &str,
    rendered: Result<Rendered, ApiError>,
) -> Result<Value, ApiError> {
    let tx = c.transaction().map_err(db)?;
    let mut meta = metadata(&tx, id)?;
    let render = match rendered {
        Ok(value) => value,
        Err(error) => {
            let value = failed(&tx, id, meta, &error.1)?;
            tx.commit().map_err(db)?;
            return Ok(value);
        }
    };
    let png = match STANDARD.decode(render.png) {
        Ok(value) => value,
        Err(_) => {
            let value = failed(&tx, id, meta, "Invalid renderer response")?;
            tx.commit().map_err(db)?;
            return Ok(value);
        }
    };
    let svg = render.svg.into_bytes();
    if png.len() > ARTIFACT_LIMIT
        || svg.len() > ARTIFACT_LIMIT
        || !png.starts_with(b"\x89PNG\r\n\x1a\n")
    {
        let value = failed(&tx, id, meta, "Invalid or oversized renderer artifact")?;
        tx.commit().map_err(db)?;
        return Ok(value);
    }
    let (native, text): (Vec<u8>, Vec<u8>) = tx
        .query_row(
            "SELECT native,description FROM whiteboard_exports WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(db)?;
    let used:i64=tx.query_row("SELECT coalesce(sum(coalesce(length(png),0)+coalesce(length(svg),0)+coalesce(length(native),0)+coalesce(length(description),0)),0) FROM whiteboard_exports",[],|r|r.get(0)).map_err(db)?;
    if used + png.len() as i64 + svg.len() as i64 > 64 * 1024 * 1024 {
        let value = failed(&tx, id, meta, "Artifact storage capacity reached")?;
        tx.commit().map_err(db)?;
        return Ok(value);
    }
    let mut info = serde_json::Map::new();
    for (format, mime, bytes) in [
        ("png", "image/png", &png),
        ("svg", "image/svg+xml", &svg),
        ("json", "application/json", &native),
        ("text", "text/plain; charset=utf-8", &text),
    ] {
        info.insert(format.into(),json!({"url":format!("/api/v1/whiteboard-exports/{id}/{format}"),"sha256":hash(bytes),"bytes":bytes.len(),"content_type":mime}));
    }
    meta["artifacts"] = Value::Object(info);
    meta["state"] = json!("ready");
    meta["width"] = json!(render.width);
    meta["height"] = json!(render.height);
    meta["font"] = json!("Liberation Sans");
    tx.execute(
        "UPDATE whiteboard_exports SET metadata=?2,png=?3,svg=?4 WHERE id=?1",
        params![id, serde_json::to_string(&meta).map_err(db)?, png, svg],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(meta)
}
async fn create_export(
    State(s): State<Arc<AppState>>,
    Path(board): Path<String>,
    Json(b): Json<Request>,
) -> Result<Json<Value>, ApiError> {
    if !uuid(&b.id)
        || !b.scale.is_finite()
        || !(0.25..=4.).contains(&b.scale)
        || !["light", "dark"].contains(&b.theme.as_str())
    {
        return Err(bad(
            "Use an export UUID, scale 0.25–4, and light/dark theme",
        ));
    }
    let digest = hash(&serde_json::to_vec(&b).map_err(db)?);
    let id = b.id.clone();
    let check_board = board.clone();
    let check = b.clone();
    let check_digest = digest.clone();
    if let Some(value) = s
        .board
        .with(move |c| prior(c, &check_board, &check, &check_digest))
        .await?
    {
        return Ok(Json(value));
    }
    let permit = SLOTS.try_acquire().map_err(|_| {
        err(
            StatusCode::TOO_MANY_REQUESTS,
            "A render is already running; no export was started",
        )
    })?;
    // Own preparation as well as rendering: disconnects cannot strand a committed job.
    let task = tokio::spawn(async move {
        let _permit = permit;
        let prepared = s
            .board
            .with(move |c| prepare(c, &board, b, &digest))
            .await?;
        match prepared {
            Prepared::Existing(value) => Ok(value),
            Prepared::Render(job) => {
                let rendered = worker(job).await;
                s.board.with(move |c| finish(c, &id, rendered)).await
            }
        }
    });
    Ok(Json(task.await.map_err(db)??))
}

async fn get_export(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    s.board.with(move |c| Ok(Json(metadata(c, &id)?))).await
}
async fn artifact(
    State(s): State<Arc<AppState>>,
    Path((id, format)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let (column, mime, extension) = match format.as_str() {
        "png" => ("png", "image/png", "png"),
        "svg" => ("svg", "image/svg+xml", "svg"),
        "json" => ("native", "application/json", "json"),
        "text" => ("description", "text/plain; charset=utf-8", "txt"),
        _ => return Err(bad("Unknown artifact format")),
    };
    if !uuid(&id) {
        return Err(bad("Invalid export UUID"));
    }
    s.board
        .with(move |c| {
            let m = metadata(c, &id)?;
            if m["state"] == "expired" {
                return Err(err(
                    StatusCode::GONE,
                    "Export expired; make a new export with a new UUID",
                ));
            }
            if m["state"] != "ready" {
                return Err(conflict("Export is not ready"));
            }
            let bytes: Vec<u8> = c
                .query_row(
                    &format!("SELECT {column} FROM whiteboard_exports WHERE id=?1"),
                    [&id],
                    |r| r.get(0),
                )
                .map_err(db)?;
            Ok((
                [
                    (header::CONTENT_TYPE, mime.to_owned()),
                    (
                        header::CONTENT_DISPOSITION,
                        format!("attachment; filename=whiteboard-{id}.{extension}"),
                    ),
                    (header::CACHE_CONTROL, "no-store".into()),
                    (
                        header::CONTENT_SECURITY_POLICY,
                        "default-src 'none'; style-src 'unsafe-inline'; font-src data:; sandbox"
                            .into(),
                    ),
                ],
                bytes,
            )
                .into_response())
        })
        .await
}
pub(crate) fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v1/whiteboards/{id}/export", post(create_export))
        .route(
            "/api/v1/whiteboards/{id}/regions",
            get(list_regions).post(save_region),
        )
        .route("/api/v1/whiteboard-exports/{id}", get(get_export))
        .route("/api/v1/whiteboard-exports/{id}/{format}", get(artifact))
        .layer(axum::extract::DefaultBodyLimit::max(128 * 1024))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Connection, Scene) {
        let c = Connection::open_in_memory().unwrap();
        whiteboard::init(&c).unwrap();
        init(&c).unwrap();
        let a = uuid::Uuid::new_v4().to_string();
        let b = uuid::Uuid::new_v4().to_string();
        let edge = uuid::Uuid::new_v4().to_string();
        let element = |id: &str, kind: &str, text: &str, x: f64| json!({"id":id,"revision":"revision","kind":kind,"x":x,"y":0,"w":100,"h":80,"text":text,"author":"fixture","created_by":"fixture","updated_at":1});
        let mut arrow = element(&edge, "arrow", "", 100.);
        arrow["from"] = json!(a);
        arrow["to"] = json!(b);
        let scene:Scene=serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"name":"Fixture","revision":1,"metadata_revision":"metadata","ticket":"ticket-reference","updated_at":1,"elements":[element(&a,"rectangle","SELECTED",0.),element(&b,"rectangle","DO-NOT-EXPORT",200.),arrow]})).unwrap();
        (c, scene)
    }
    #[test]
    fn selections_strip_external_bindings_and_preserve_the_arrow_geometry() {
        let (c, scene) = fixture();
        let original = ends(&scene.elements[2].drawing, &scene);
        let (frozen, bounds) = freeze(
            &c,
            &scene,
            &Scope::Selection {
                elements: vec![scene.elements[2].id.clone()],
            },
        )
        .unwrap();
        assert!(bounds.is_none());
        assert!(frozen.ticket.is_none());
        assert_eq!(frozen.elements.len(), 1);
        assert!(frozen.elements[0].drawing.from.is_none());
        assert!(frozen.elements[0].drawing.to.is_none());
        assert_eq!(ends(&frozen.elements[0].drawing, &frozen), original);
        let data = serde_json::to_string(&frozen).unwrap();
        assert!(!data.contains("DO-NOT-EXPORT"));
        assert!(!data.contains(&scene.elements[1].id));
    }
    #[test]
    fn duplicate_or_missing_selection_ids_are_rejected() {
        let (c, scene) = fixture();
        let id = scene.elements[0].id.clone();
        assert!(
            freeze(
                &c,
                &scene,
                &Scope::Selection {
                    elements: vec![id.clone(), id]
                }
            )
            .is_err()
        );
        assert!(
            freeze(
                &c,
                &scene,
                &Scope::Selection {
                    elements: vec![uuid::Uuid::new_v4().to_string()]
                }
            )
            .is_err()
        );
    }
    #[test]
    fn stale_named_regions_cannot_change_the_scope_silently() {
        let (c, scene) = fixture();
        let id = uuid::Uuid::new_v4().to_string();
        let r = Region {
            id: id.clone(),
            revision: Some("current".into()),
            scene_revision: 1,
            name: "Group".into(),
            kind: "group".into(),
            elements: vec![scene.elements[0].id.clone()],
            bounds: None,
        };
        c.execute(
            "INSERT INTO whiteboard_regions VALUES(?1,?2,?3)",
            params![scene.id, id, serde_json::to_string(&r).unwrap()],
        )
        .unwrap();
        assert!(
            freeze(
                &c,
                &scene,
                &Scope::Group {
                    id: id.clone(),
                    revision: "stale".into()
                }
            )
            .is_err()
        );
        let (frozen, _) = freeze(
            &c,
            &scene,
            &Scope::Group {
                id,
                revision: "current".into(),
            },
        )
        .unwrap();
        assert_eq!(frozen.elements.len(), 1);
    }
}
