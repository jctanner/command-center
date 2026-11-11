//! Shared, revisioned semantic drawing scenes. No agent messaging or remote IO.
use crate::{ApiError, AppState};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{StatusCode, header},
    routing::{get, post},
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
fn error(code: StatusCode, text: impl Into<String>) -> ApiError {
    ApiError(code, text.into())
}
fn db(_: impl std::fmt::Display) -> ApiError {
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Whiteboard storage unavailable; inspect the same operation before retrying",
    )
}
fn bad(text: &str) -> ApiError {
    error(StatusCode::BAD_REQUEST, text)
}
fn conflict(text: &str) -> ApiError {
    error(StatusCode::CONFLICT, text)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn uuid(s: &str) -> bool {
    s.len() == 36 && uuid::Uuid::parse_str(s).is_ok()
}
fn rev() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub(crate) fn init(c: &Connection) -> anyhow::Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS whiteboards(id TEXT PRIMARY KEY,data TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS whiteboard_operations(board TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(board,id)); CREATE TABLE IF NOT EXISTS whiteboard_element_ids(board TEXT NOT NULL,id TEXT NOT NULL,revision TEXT NOT NULL,creator TEXT NOT NULL,PRIMARY KEY(board,id)); CREATE TABLE IF NOT EXISTS whiteboard_history(board TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(board,revision));")?;
    Ok(())
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Point {
    pub(crate) x: f64,
    pub(crate) y: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Drawing {
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub text: String,
    #[serde(default = "ink")]
    pub color: String,
    #[serde(default)]
    pub clean: bool,
    #[serde(default = "one")]
    pub seed: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<Point>>,
}
fn ink() -> String {
    "ink".into()
}
fn one() -> u32 {
    1
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Element {
    pub id: String,
    pub revision: String,
    #[serde(flatten)]
    pub drawing: Drawing,
    pub author: String,
    pub created_by: String,
    pub updated_at: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Scene {
    pub id: String,
    pub name: String,
    pub revision: u64,
    pub metadata_revision: String,
    pub ticket: Option<String>,
    pub elements: Vec<Element>,
    pub updated_at: u64,
}
pub(crate) fn load(c: &Connection, id: &str) -> Result<Scene, ApiError> {
    let data: Option<String> = c
        .query_row(
            "SELECT data FROM whiteboards WHERE id=?1 AND deleted=0",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(db)?;
    serde_json::from_str(&data.ok_or_else(|| error(StatusCode::NOT_FOUND, "Whiteboard not found"))?)
        .map_err(db)
}
fn write(c: &Connection, s: &Scene) -> Result<(), ApiError> {
    c.execute(
        "UPDATE whiteboards SET data=?2 WHERE id=?1",
        params![s.id, serde_json::to_string(s).map_err(db)?],
    )
    .map_err(db)?;
    Ok(())
}
fn actor(s: &str) -> bool {
    !s.trim().is_empty() && s.len() <= 80 && !s.chars().any(char::is_control)
}
pub(crate) fn valid(d: &Drawing) -> bool {
    [d.x, d.y, d.w, d.h]
        .iter()
        .all(|n| n.is_finite() && n.abs() <= 100_000.)
        && [
            "rectangle",
            "ellipse",
            "diamond",
            "sticky",
            "text",
            "arrow",
            "freehand",
        ]
        .contains(&d.kind.as_str())
        && ["ink", "accent", "blue", "magenta", "yellow"].contains(&d.color.as_str())
        && d.text.len() <= 4800
        && !d.text.contains('\0')
        && d.seed <= 100_000
        && d.from.as_ref().is_none_or(|s| uuid(s))
        && d.to.as_ref().is_none_or(|s| uuid(s))
        && (d.kind == "arrow" || (d.from.is_none() && d.to.is_none()))
        && (matches!(d.kind.as_str(), "arrow" | "freehand") || (d.w >= 1. && d.h >= 1.))
        && d.points.as_ref().is_none_or(|ps| {
            d.kind == "freehand"
                && ps.len() <= 1500
                && ps.iter().all(|p| {
                    p.x.is_finite()
                        && p.y.is_finite()
                        && p.x.abs() <= 100_000.
                        && p.y.abs() <= 100_000.
                })
        })
}
fn dependencies(s: &Scene, ids: &HashSet<String>) -> HashSet<String> {
    let mut affected = ids.clone();
    for e in &s.elements {
        if ids.contains(&e.id)
            || e.drawing.from.as_ref().is_some_and(|id| ids.contains(id))
            || e.drawing.to.as_ref().is_some_and(|id| ids.contains(id))
        {
            affected.insert(e.id.clone());
            if let Some(id) = &e.drawing.from {
                affected.insert(id.clone());
            }
            if let Some(id) = &e.drawing.to {
                affected.insert(id.clone());
            }
        }
    }
    affected
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Upsert {
    id: String,
    expected_revision: Option<String>,
    element: Drawing,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Removal {
    id: String,
    revision: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Operations {
    #[serde(skip)]
    request_digest: Option<String>,
    operation_id: String,
    actor: String,
    #[serde(default)]
    upserts: Vec<Upsert>,
    #[serde(default)]
    deletes: Vec<Removal>,
    #[serde(default)]
    dependencies: BTreeMap<String, String>,
}
fn apply(c: &mut Connection, id: &str, b: Operations) -> Result<Scene, ApiError> {
    if !uuid(&b.operation_id)
        || !actor(&b.actor)
        || b.upserts.len() + b.deletes.len() > 300
        || b.upserts.is_empty() && b.deletes.is_empty()
    {
        return Err(bad("Invalid or empty drawing operation"));
    }
    let hash = b.request_digest.clone().unwrap_or(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&b).map_err(db)?)
    ));
    let tx = c.transaction().map_err(db)?;
    let mut s = load(&tx, id)?;
    let existing: Option<(String, String)> = tx
        .query_row(
            "SELECT digest,result FROM whiteboard_operations WHERE board=?1 AND id=?2",
            params![id, b.operation_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    if let Some((digest, _result)) = existing {
        if digest != hash {
            return Err(conflict(
                "Operation UUID belongs to different drawing changes",
            ));
        }
        return Ok(s);
    }
    let mut ids = HashSet::new();
    let mut expected = b.dependencies.clone();
    for up in &b.upserts {
        if !uuid(&up.id) || !ids.insert(up.id.clone()) || !valid(&up.element) {
            return Err(bad("Invalid drawing element or duplicate ID"));
        }
        match s.elements.iter().find(|e| e.id == up.id) {
            Some(e) if Some(&e.revision) != up.expected_revision.as_ref() => {
                return Err(conflict(&format!(
                    "Element {} changed; keep your draft and read the scene",
                    up.id
                )));
            }
            None if up.expected_revision.is_some() => {
                let retained: Option<String> = tx
                    .query_row(
                        "SELECT revision FROM whiteboard_element_ids WHERE board=?1 AND id=?2",
                        params![id, up.id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(db)?;
                if retained.as_ref() != up.expected_revision.as_ref() {
                    return Err(conflict(
                        "An edited element was deleted or its retained revision changed",
                    ));
                }
            }
            _ => (),
        };
        if let Some(revision) = &up.expected_revision
            && s.elements.iter().any(|e| e.id == up.id)
        {
            expected.insert(up.id.clone(), revision.clone());
        }
    }
    for removed in &b.deletes {
        if !uuid(&removed.id) || !ids.insert(removed.id.clone()) {
            return Err(bad("Invalid or repeated deletion ID"));
        }
        expected.insert(removed.id.clone(), removed.revision.clone());
    }
    let mut required = dependencies(&s, &ids);
    for up in &b.upserts {
        for target in [&up.element.from, &up.element.to].into_iter().flatten() {
            required.insert(target.clone());
        }
    }
    for target in required {
        if let Some(e) = s.elements.iter().find(|e| e.id == target)
            && expected.get(&target) != Some(&e.revision)
        {
            return Err(conflict(&format!(
                "Element dependency {target} changed or lacks its expected revision"
            )));
        }
    }
    for (target, revision) in &expected {
        if !s
            .elements
            .iter()
            .any(|e| e.id == *target && e.revision == *revision)
        {
            return Err(conflict(&format!(
                "Element {target} changed or was deleted"
            )));
        }
    }
    let deleted: HashSet<_> = b.deletes.iter().map(|d| d.id.as_str()).collect();
    s.elements.retain(|e| !deleted.contains(e.id.as_str()));
    for up in b.upserts {
        let previous = s.elements.iter().position(|e| e.id == up.id);
        if previous.is_none() {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM whiteboard_element_ids WHERE board=?1 AND id=?2)",
                    params![id, up.id],
                    |r| r.get(0),
                )
                .map_err(db)?;
            if exists && up.expected_revision.is_none() {
                return Err(conflict(
                    "Element UUID was deleted; use a new UUID or explicitly restore its retained revision",
                ));
            }
            let count: i64 = tx
                .query_row("SELECT count(*) FROM whiteboard_element_ids", [], |r| {
                    r.get(0)
                })
                .map_err(db)?;
            if !exists && count >= 100000 {
                return Err(conflict("Retained element identity capacity reached"));
            }
        }
        let retained_creator: Option<String> = tx
            .query_row(
                "SELECT creator FROM whiteboard_element_ids WHERE board=?1 AND id=?2",
                params![id, up.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db)?;
        let e = Element {
            id: up.id,
            revision: rev(),
            drawing: up.element,
            created_by: previous.map_or_else(
                || retained_creator.unwrap_or_else(|| b.actor.clone()),
                |i| s.elements[i].created_by.clone(),
            ),
            author: b.actor.clone(),
            updated_at: now(),
        };
        tx.execute("INSERT INTO whiteboard_element_ids(board,id,revision,creator) VALUES(?1,?2,?3,?4) ON CONFLICT(board,id) DO UPDATE SET revision=excluded.revision",params![id,e.id,e.revision,e.created_by]).map_err(db)?;
        if let Some(i) = previous {
            s.elements[i] = e;
        } else {
            s.elements.push(e);
        }
    }
    if s.elements.len() > 300 {
        return Err(bad("Whiteboard limit is 300 elements"));
    }
    for e in &s.elements {
        for target in [&e.drawing.from, &e.drawing.to].into_iter().flatten() {
            if target == &e.id
                || !s.elements.iter().any(|other| {
                    other.id == *target
                        && matches!(
                            other.drawing.kind.as_str(),
                            "rectangle" | "ellipse" | "diamond" | "sticky"
                        )
                })
            {
                return Err(conflict(
                    "Arrow bindings must reference existing shapes; detach arrows before deleting their shapes",
                ));
            }
        }
    }
    s.revision += 1;
    s.updated_at = now();
    let result = serde_json::to_string(&s).map_err(db)?;
    if result.len() > 1024 * 1024 {
        return Err(bad("Whiteboard exceeds 1 MiB scene limit"));
    }
    let count: i64 = tx
        .query_row("SELECT count(*) FROM whiteboard_operations", [], |r| {
            r.get(0)
        })
        .map_err(db)?;
    if count >= 100000 {
        return Err(conflict(
            "Whiteboard operation capacity reached; review retained state",
        ));
    }
    let total: i64 = tx
        .query_row(
            "SELECT coalesce(sum(length(data)),0) FROM whiteboards WHERE id<>?1",
            [id],
            |r| r.get(0),
        )
        .map_err(db)?;
    if total + result.len() as i64 > 16 * 1024 * 1024 {
        return Err(conflict("Whiteboard scene capacity reached"));
    }
    write(&tx, &s)?;
    tx.execute(
        "INSERT INTO whiteboard_operations VALUES(?1,?2,?3,?4)",
        params![
            id,
            b.operation_id,
            hash,
            serde_json::to_string(&json!({"operation_id":b.operation_id,"revision":s.revision}))
                .map_err(db)?
        ],
    )
    .map_err(db)?;
    tx.execute(
        "INSERT INTO whiteboard_history VALUES(?1,?2,?3)",
        params![id, s.revision, result],
    )
    .map_err(db)?;
    tx.execute(
        "DELETE FROM whiteboard_history WHERE board=?1 AND revision < ?2",
        params![id, s.revision.saturating_sub(100)],
    )
    .map_err(db)?;
    loop {
        let bytes: i64 = tx
            .query_row(
                "SELECT coalesce(sum(length(data)),0) FROM whiteboard_history",
                [],
                |r| r.get(0),
            )
            .map_err(db)?;
        if bytes <= 32 * 1024 * 1024 {
            break;
        }
        tx.execute("DELETE FROM whiteboard_history WHERE rowid=(SELECT rowid FROM whiteboard_history ORDER BY rowid LIMIT 1)",[]).map_err(db)?;
    }
    tx.commit().map_err(db)?;
    Ok(s)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Create {
    id: String,
    name: String,
    #[serde(default)]
    ticket: Option<String>,
}
fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.len() <= 120 && !name.chars().any(char::is_control)
}
fn valid_ticket(c: &Connection, ticket: &Option<String>) -> Result<(), ApiError> {
    if let Some(t) = ticket {
        if !uuid(t) {
            return Err(bad("Ticket must be a ticket UUID"));
        }
        let exists:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM tickets WHERE id=?1 AND NOT EXISTS (SELECT 1 FROM ticket_deletions WHERE id=?1))",[t],|r|r.get(0)).map_err(db)?;
        if !exists {
            return Err(conflict("Linked ticket is unavailable"));
        }
    }
    Ok(())
}
async fn create(
    State(s): State<Arc<AppState>>,
    Json(b): Json<Create>,
) -> Result<Json<Scene>, ApiError> {
    if !uuid(&b.id) || !valid_name(&b.name) {
        return Err(bad("Use a UUID and a nonblank name up to 120 bytes"));
    }
    s.board
        .with(move |c| {
            valid_ticket(c, &b.ticket)?;
            let count: i64 = c
                .query_row(
                    "SELECT count(*) FROM whiteboards WHERE deleted=0",
                    [],
                    |r| r.get(0),
                )
                .map_err(db)?;
            if count >= 100 {
                return Err(conflict("Whiteboard capacity reached"));
            }
            let exists: bool = c
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM whiteboards WHERE id=?1)",
                    [&b.id],
                    |r| r.get(0),
                )
                .map_err(db)?;
            if exists {
                return Err(conflict(
                    "Whiteboard UUID already exists; inspect it before proceeding",
                ));
            }
            let scene = Scene {
                id: b.id,
                name: b.name,
                revision: 1,
                metadata_revision: rev(),
                ticket: b.ticket,
                elements: vec![],
                updated_at: now(),
            };
            c.execute(
                "INSERT INTO whiteboards(id,data) VALUES(?1,?2)",
                params![scene.id, serde_json::to_string(&scene).map_err(db)?],
            )
            .map_err(db)?;
            Ok(Json(scene))
        })
        .await
}
async fn list(State(s): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    s.board.with(|c|{let mut q=c.prepare("SELECT data FROM whiteboards WHERE deleted=0 ORDER BY rowid DESC LIMIT 100").map_err(db)?;let rows=q.query_map([],|r|r.get::<_,String>(0)).map_err(db)?;let mut out=vec![];for row in rows{let scene:Scene=serde_json::from_str(&row.map_err(db)?).map_err(db)?;out.push(json!({"id":scene.id,"name":scene.name,"revision":scene.revision,"metadata_revision":scene.metadata_revision,"ticket":scene.ticket,"updated_at":scene.updated_at,"elements":scene.elements.len()}));}Ok(Json(json!({"whiteboards":out})))}).await
}
async fn detail(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Scene>, ApiError> {
    s.board.with(move |c| Ok(Json(load(c, &id)?))).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Metadata {
    revision: String,
    name: String,
    #[serde(default)]
    ticket: Option<String>,
}
async fn metadata(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(b): Json<Metadata>,
) -> Result<Json<Scene>, ApiError> {
    if !valid_name(&b.name) {
        return Err(bad("Invalid whiteboard name"));
    }
    s.board
        .with(move |c| {
            let tx = c.transaction().map_err(db)?;
            let mut scene = load(&tx, &id)?;
            if scene.metadata_revision != b.revision {
                return Err(conflict("Board details changed; refresh before editing"));
            }
            valid_ticket(&tx, &b.ticket)?;
            scene.name = b.name;
            scene.ticket = b.ticket;
            scene.metadata_revision = rev();
            scene.revision += 1;
            scene.updated_at = now();
            write(&tx, &scene)?;
            tx.commit().map_err(db)?;
            Ok(Json(scene))
        })
        .await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeleteBoard {
    revision: u64,
}
async fn delete_board(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(b): Json<DeleteBoard>,
) -> Result<StatusCode, ApiError> {
    s.board
        .with(move |c| {
            let tx = c.transaction().map_err(db)?;
            let scene = load(&tx, &id)?;
            if scene.revision != b.revision {
                return Err(conflict("Board changed; refresh before deleting"));
            }
            tx.execute("UPDATE whiteboards SET deleted=1 WHERE id=?1", [id])
                .map_err(db)?;
            tx.commit().map_err(db)?;
            Ok(StatusCode::NO_CONTENT)
        })
        .await
}
async fn operations(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(b): Json<Operations>,
) -> Result<Json<Scene>, ApiError> {
    s.board.with(move |c| Ok(Json(apply(c, &id, b)?))).await
}
async fn add_elements(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(b): Json<Operations>,
) -> Result<Json<Scene>, ApiError> {
    if !b.deletes.is_empty() || b.upserts.iter().any(|e| e.expected_revision.is_some()) {
        return Err(bad("Create accepts only new elements"));
    }
    s.board.with(move |c| Ok(Json(apply(c, &id, b)?))).await
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Edit {
    operation_id: String,
    actor: String,
    revision: String,
    changes: serde_json::Map<String, Value>,
    #[serde(default)]
    dependencies: BTreeMap<String, String>,
}
async fn edit(
    State(s): State<Arc<AppState>>,
    Path((id, element)): Path<(String, String)>,
    Json(b): Json<Edit>,
) -> Result<Json<Scene>, ApiError> {
    let request_digest = format!("{:x}", Sha256::digest(serde_json::to_vec(&b).map_err(db)?));
    s.board
        .with(move |c| {
            let prior: Option<String> = c
                .query_row(
                    "SELECT digest FROM whiteboard_operations WHERE board=?1 AND id=?2",
                    params![id, b.operation_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(db)?;
            if let Some(prior) = prior {
                if prior != request_digest {
                    return Err(conflict(
                        "Operation UUID belongs to different drawing changes",
                    ));
                }
                return Ok(Json(load(c, &id)?));
            }
            let scene = load(c, &id)?;
            let old = scene
                .elements
                .iter()
                .find(|e| e.id == element)
                .ok_or_else(|| conflict("Element was deleted"))?;
            let mut value = serde_json::to_value(&old.drawing).map_err(db)?;
            for (k, v) in b.changes {
                if ![
                    "kind", "x", "y", "w", "h", "text", "color", "clean", "seed", "from", "to",
                    "points",
                ]
                .contains(&k.as_str())
                {
                    return Err(bad("Unknown drawing property"));
                }
                value[&k] = v;
            }
            let drawing =
                serde_json::from_value(value).map_err(|_| bad("Invalid drawing fields"))?;
            Ok(Json(apply(
                c,
                &id,
                Operations {
                    request_digest: Some(request_digest),
                    operation_id: b.operation_id,
                    actor: b.actor,
                    upserts: vec![Upsert {
                        id: element,
                        expected_revision: Some(b.revision),
                        element: drawing,
                    }],
                    deletes: vec![],
                    dependencies: b.dependencies,
                },
            )?))
        })
        .await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeleteElement {
    operation_id: String,
    actor: String,
    revision: String,
    #[serde(default)]
    dependencies: BTreeMap<String, String>,
}
async fn delete_element(
    State(s): State<Arc<AppState>>,
    Path((id, element)): Path<(String, String)>,
    Json(b): Json<DeleteElement>,
) -> Result<Json<Scene>, ApiError> {
    s.board
        .with(move |c| {
            Ok(Json(apply(
                c,
                &id,
                Operations {
                    request_digest: None,
                    operation_id: b.operation_id,
                    actor: b.actor,
                    upserts: vec![],
                    deletes: vec![Removal {
                        id: element,
                        revision: b.revision,
                    }],
                    dependencies: b.dependencies,
                },
            )?))
        })
        .await
}
async fn operation(
    State(s): State<Arc<AppState>>,
    Path((id, op)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    s.board
        .with(move |c| {
            load(c, &id)?;
            let result: Option<String> = c
                .query_row(
                    "SELECT result FROM whiteboard_operations WHERE board=?1 AND id=?2",
                    params![id, op],
                    |r| r.get(0),
                )
                .optional()
                .map_err(db)?;
            Ok(Json(
                serde_json::from_str(&result.ok_or_else(|| {
                    error(
                        StatusCode::NOT_FOUND,
                        "Operation not committed; do not replay uncertain input automatically",
                    )
                })?)
                .map_err(db)?,
            ))
        })
        .await
}
pub(crate) fn description(s: &Scene) -> String {
    let mut text = format!("{} · revision {}\n", s.name, s.revision);
    for e in &s.elements {
        text.push_str(&format!("{} {} {:?} at ({:.0},{:.0}) size {:.0}×{:.0}; revision {}; created by {}; last edit {}",e.id,e.drawing.kind,e.drawing.text,e.drawing.x,e.drawing.y,e.drawing.w,e.drawing.h,e.revision,e.created_by,e.author));
        if e.drawing.kind == "arrow" {
            text.push_str(&format!(
                "; {} → {}",
                e.drawing.from.as_deref().unwrap_or("free"),
                e.drawing.to.as_deref().unwrap_or("free")
            ));
        }
        text.push('\n');
    }
    text
}
async fn readback(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    s.board
        .with(move |c| {
            let scene = load(c, &id)?;
            Ok(Json(
                json!({"id":scene.id,"revision":scene.revision,"description":description(&scene)}),
            ))
        })
        .await
}
async fn history(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    s.board.with(move|c|{load(c,&id)?;let mut q=c.prepare("SELECT revision,data FROM whiteboard_history WHERE board=?1 ORDER BY revision DESC LIMIT 100").map_err(db)?;let rows=q.query_map([id],|r|Ok((r.get::<_,u64>(0)?,r.get::<_,String>(1)?))).map_err(db)?;let mut out=vec![];for row in rows{let(revision,data)=row.map_err(db)?;let scene:Scene=serde_json::from_str(&data).map_err(db)?;out.push(json!({"revision":revision,"updated_at":scene.updated_at,"elements":scene.elements.len()}));}Ok(Json(json!({"history":out})))}).await
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct GraphNode {
    id: String,
    label: String,
    #[serde(default = "rectangle")]
    kind: String,
}
fn rectangle() -> String {
    "rectangle".into()
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Edge {
    id: String,
    from: String,
    to: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Graph {
    operation_id: String,
    actor: String,
    nodes: Vec<GraphNode>,
    #[serde(default)]
    edges: Vec<Edge>,
    #[serde(default = "right")]
    direction: String,
}
fn right() -> String {
    "right".into()
}
async fn graph(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(b): Json<Graph>,
) -> Result<Json<Scene>, ApiError> {
    let request_digest = format!("{:x}", Sha256::digest(serde_json::to_vec(&b).map_err(db)?));
    if b.nodes.is_empty()
        || b.nodes.len() > 40
        || b.edges.len() > 80
        || !["right", "down"].contains(&b.direction.as_str())
    {
        return Err(bad(
            "Use 1–40 nodes, at most 80 edges, and right/down layout",
        ));
    }
    s.board
        .with(move |c| {
            let scene = load(c, &id)?;
            let origin = scene
                .elements
                .iter()
                .map(|e| e.drawing.y + e.drawing.h.abs())
                .fold(0., f64::max)
                + 100.;
            let mut upserts = vec![];
            let positions: BTreeMap<_, _> = b
                .nodes
                .iter()
                .enumerate()
                .map(|(i, n)| {
                    (
                        n.id.clone(),
                        if b.direction == "right" {
                            (80. + i as f64 * 270., origin)
                        } else {
                            (80., origin + i as f64 * 180.)
                        },
                    )
                })
                .collect();
            if positions.len() != b.nodes.len() {
                return Err(bad("Repeated graph node IDs"));
            }
            for n in b.nodes {
                if !["rectangle", "ellipse", "diamond", "sticky"].contains(&n.kind.as_str()) {
                    return Err(bad("Graph nodes must be shapes"));
                }
                let (x, y) = positions[&n.id];
                upserts.push(Upsert {
                    id: n.id,
                    expected_revision: None,
                    element: Drawing {
                        kind: n.kind,
                        x,
                        y,
                        w: 200.,
                        h: 100.,
                        text: n.label,
                        color: "magenta".into(),
                        clean: false,
                        seed: 1,
                        from: None,
                        to: None,
                        points: None,
                    },
                });
            }
            for e in b.edges {
                let Some(&(x, y)) = positions.get(&e.from) else {
                    return Err(bad("Unknown graph source"));
                };
                let Some(&(to_x, to_y)) = positions.get(&e.to) else {
                    return Err(bad("Unknown graph destination"));
                };
                upserts.push(Upsert {
                    id: e.id,
                    expected_revision: None,
                    element: Drawing {
                        kind: "arrow".into(),
                        x: x + 100.,
                        y: y + 50.,
                        w: to_x - x,
                        h: to_y - y,
                        text: String::new(),
                        color: "magenta".into(),
                        clean: false,
                        seed: 1,
                        from: Some(e.from),
                        to: Some(e.to),
                        points: None,
                    },
                });
            }
            let operations = Operations {
                request_digest: Some(request_digest),
                operation_id: b.operation_id,
                actor: b.actor,
                upserts,
                deletes: vec![],
                dependencies: BTreeMap::new(),
            };
            Ok(Json(apply(c, &id, operations)?))
        })
        .await
}
// Snapshot exports deliberately do not render images or send them anywhere.
async fn export_json(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<impl axum::response::IntoResponse, ApiError> {
    s.board.with(move|c|{let scene=load(c,&id)?;Ok(([(header::CONTENT_DISPOSITION,"attachment; filename=whiteboard.json"),(header::CACHE_CONTROL,"no-store")],Json(json!({"type":"cc-whiteboard","version":1,"scene":scene,"description":description(&scene)}))))}).await
}
pub(crate) fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v1/whiteboards", get(list).post(create))
        .route(
            "/api/v1/whiteboards/{id}",
            get(detail).patch(metadata).delete(delete_board),
        )
        .route("/api/v1/whiteboards/{id}/operations", post(operations))
        .route(
            "/api/v1/whiteboards/{id}/operations/{operation}",
            get(operation),
        )
        .route("/api/v1/whiteboards/{id}/elements", post(add_elements))
        .route(
            "/api/v1/whiteboards/{id}/elements/{element}",
            axum::routing::patch(edit).delete(delete_element),
        )
        .route("/api/v1/whiteboards/{id}/graph", post(graph))
        .route("/api/v1/whiteboards/{id}/description", get(readback))
        .route("/api/v1/whiteboards/{id}/history", get(history))
        .route("/api/v1/whiteboards/{id}/export", get(export_json))
        .layer(axum::extract::DefaultBodyLimit::max(2 * 1024 * 1024))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(c: &Connection) -> Scene {
        init(c).unwrap();
        let scene = Scene {
            id: rev(),
            name: "Synthetic whiteboard".into(),
            revision: 1,
            metadata_revision: rev(),
            ticket: None,
            elements: vec![],
            updated_at: now(),
        };
        c.execute(
            "INSERT INTO whiteboards(id,data) VALUES(?1,?2)",
            params![scene.id, serde_json::to_string(&scene).unwrap()],
        )
        .unwrap();
        scene
    }
    fn drawing(text: &str) -> Drawing {
        Drawing {
            kind: "rectangle".into(),
            x: 0.,
            y: 0.,
            w: 200.,
            h: 100.,
            text: text.into(),
            color: "ink".into(),
            clean: false,
            seed: 7,
            from: None,
            to: None,
            points: None,
        }
    }
    fn batch(upserts: Vec<Upsert>) -> Operations {
        Operations {
            request_digest: None,
            operation_id: rev(),
            actor: "Coordinator fixture".into(),
            upserts,
            deletes: vec![],
            dependencies: BTreeMap::new(),
        }
    }
    fn add(text: &str) -> Upsert {
        Upsert {
            id: rev(),
            expected_revision: None,
            element: drawing(text),
        }
    }
    #[test]
    fn independent_element_edits_merge_and_stale_writes_preserve_current() {
        let mut c = Connection::open_in_memory().unwrap();
        let s = fixture(&c);
        let a = add("A");
        let b = add("B");
        let first = apply(&mut c, &s.id, batch(vec![a, b])).unwrap();
        let a = &first.elements[0];
        let b = &first.elements[1];
        let mut changed = a.drawing.clone();
        changed.text = "Human A".into();
        let next = apply(
            &mut c,
            &s.id,
            batch(vec![Upsert {
                id: a.id.clone(),
                expected_revision: Some(a.revision.clone()),
                element: changed.clone(),
            }]),
        )
        .unwrap();
        let mut second = b.drawing.clone();
        second.text = "Agent B".into();
        let merged = apply(
            &mut c,
            &s.id,
            batch(vec![Upsert {
                id: b.id.clone(),
                expected_revision: Some(b.revision.clone()),
                element: second,
            }]),
        )
        .unwrap();
        assert_eq!(merged.elements[0].drawing.text, "Human A");
        assert_eq!(merged.elements[1].drawing.text, "Agent B");
        assert_eq!(merged.elements[0].created_by, "Coordinator fixture");
        assert_eq!(
            apply(
                &mut c,
                &s.id,
                batch(vec![Upsert {
                    id: a.id.clone(),
                    expected_revision: Some(a.revision.clone()),
                    element: changed
                }])
            )
            .unwrap_err()
            .0,
            StatusCode::CONFLICT
        );
        assert_eq!(load(&c, &s.id).unwrap().revision, next.revision + 1);
    }
    #[test]
    fn operation_uuid_is_idempotent_and_cannot_change_payload() {
        let mut c = Connection::open_in_memory().unwrap();
        let s = fixture(&c);
        let operation = batch(vec![add("A")]);
        let saved = apply(&mut c, &s.id, operation.clone()).unwrap();
        assert_eq!(
            apply(&mut c, &s.id, operation.clone()).unwrap().revision,
            saved.revision
        );
        let mut changed = operation.clone();
        changed.actor = "Other actor".into();
        assert_eq!(
            apply(&mut c, &s.id, changed).unwrap_err().0,
            StatusCode::CONFLICT
        );
        let after = apply(&mut c, &s.id, batch(vec![add("B")])).unwrap();
        assert_eq!(
            apply(&mut c, &s.id, operation).unwrap().revision,
            after.revision
        );
        assert_eq!(load(&c, &s.id).unwrap().elements.len(), 2);
    }
    #[test]
    fn bindings_require_checked_dependencies_and_deletions_are_atomic() {
        let mut c = Connection::open_in_memory().unwrap();
        let s = fixture(&c);
        let a = add("A");
        let b = add("B");
        let mut arrow = add("");
        arrow.element.kind = "arrow".into();
        arrow.element.from = Some(a.id.clone());
        arrow.element.to = Some(b.id.clone());
        let scene = apply(&mut c, &s.id, batch(vec![a, b, arrow])).unwrap();
        let a = &scene.elements[0];
        let mut changed = a.drawing.clone();
        changed.x = 90.;
        let op = batch(vec![Upsert {
            id: a.id.clone(),
            expected_revision: Some(a.revision.clone()),
            element: changed,
        }]);
        assert_eq!(
            apply(&mut c, &s.id, op.clone()).unwrap_err().0,
            StatusCode::CONFLICT
        );
        let mut checked = op;
        checked.dependencies = scene
            .elements
            .iter()
            .map(|e| (e.id.clone(), e.revision.clone()))
            .collect();
        let moved = apply(&mut c, &s.id, checked).unwrap();
        assert_eq!(moved.elements[0].drawing.x, 90.);
        let mut delete = batch(vec![]);
        delete.deletes = vec![Removal {
            id: a.id.clone(),
            revision: moved.elements[0].revision.clone(),
        }];
        delete.dependencies = moved
            .elements
            .iter()
            .map(|e| (e.id.clone(), e.revision.clone()))
            .collect();
        assert_eq!(
            apply(&mut c, &s.id, delete.clone()).unwrap_err().0,
            StatusCode::CONFLICT
        );
        assert_eq!(load(&c, &s.id).unwrap().elements.len(), 3);
        let edge = &moved.elements[2];
        let mut unbound = edge.drawing.clone();
        unbound.from = None;
        delete.upserts.push(Upsert {
            id: edge.id.clone(),
            expected_revision: Some(edge.revision.clone()),
            element: unbound,
        });
        assert_eq!(apply(&mut c, &s.id, delete).unwrap().elements.len(), 2);
    }
    #[test]
    fn invalid_geometry_and_partial_batches_never_write() {
        let mut c = Connection::open_in_memory().unwrap();
        let s = fixture(&c);
        for mutate in 0..4 {
            let mut bad = add("bad");
            match mutate {
                0 => bad.element.w = -1.,
                1 => bad.element.x = f64::INFINITY,
                2 => bad.element.from = Some(rev()),
                _ => bad.element.text = "x".repeat(4801),
            }
            let op = batch(vec![add("valid"), bad]);
            assert!(apply(&mut c, &s.id, op).is_err());
            assert!(load(&c, &s.id).unwrap().elements.is_empty());
        }
    }
    #[test]
    fn scene_and_compact_operation_receipts_survive_reopening() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("whiteboard.sqlite3");
        let mut c = Connection::open(&path).unwrap();
        let s = fixture(&c);
        let op = batch(vec![add("Durable")]);
        let saved = apply(&mut c, &s.id, op.clone()).unwrap();
        drop(c);
        let mut reopened = Connection::open(path).unwrap();
        init(&reopened).unwrap();
        assert_eq!(
            load(&reopened, &s.id).unwrap().elements[0].drawing.text,
            "Durable"
        );
        assert_eq!(
            apply(&mut reopened, &s.id, op).unwrap().revision,
            saved.revision
        );
        let receipt: String = reopened
            .query_row("SELECT result FROM whiteboard_operations", [], |r| r.get(0))
            .unwrap();
        assert!(receipt.len() < 200);
        assert!(!receipt.contains("Durable"));
    }
    #[test]
    fn deletion_retains_identity_and_checked_undo_restores_creator() {
        let mut c = Connection::open_in_memory().unwrap();
        let s = fixture(&c);
        let first = apply(&mut c, &s.id, batch(vec![add("A")])).unwrap();
        let element = &first.elements[0];
        let mut remove = batch(vec![]);
        remove.deletes.push(Removal {
            id: element.id.clone(),
            revision: element.revision.clone(),
        });
        apply(&mut c, &s.id, remove).unwrap();
        let mut recreate = batch(vec![Upsert {
            id: element.id.clone(),
            expected_revision: None,
            element: element.drawing.clone(),
        }]);
        assert_eq!(
            apply(&mut c, &s.id, recreate.clone()).unwrap_err().0,
            StatusCode::CONFLICT
        );
        recreate.upserts[0].expected_revision = Some(element.revision.clone());
        recreate.actor = "Human undo".into();
        let restored = apply(&mut c, &s.id, recreate).unwrap();
        assert_eq!(restored.elements[0].created_by, "Coordinator fixture");
        assert_eq!(restored.elements[0].author, "Human undo");
        assert_ne!(restored.elements[0].revision, element.revision);
    }
}
