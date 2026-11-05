//! User labels only; edits never rename tmux targets or send agent input.
use crate::{ApiError, AppState};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;
#[derive(Clone, Default, Serialize)]
pub(crate) struct Card {
    pub revision: u64,
    pub name: String,
    pub notes: String,
    pub color: String,
    pub pinned: bool,
}
fn key(scope: &str, instance: &str) -> String {
    format!("{:x}", Sha256::digest(format!("{scope}/{instance}")))
}
fn storage(_: impl std::fmt::Display) -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Agent card storage unavailable".into(),
    )
}
fn read(c: &rusqlite::Connection, key: &str) -> Result<Card, ApiError> {
    Ok(c.query_row(
        "SELECT revision,name,notes,color,pinned FROM agent_cards WHERE scope=?1",
        [key],
        |r| {
            Ok(Card {
                revision: r.get(0)?,
                name: r.get(1)?,
                notes: r.get(2)?,
                color: r.get(3)?,
                pinned: r.get(4)?,
            })
        },
    )
    .optional()
    .map_err(storage)?
    .unwrap_or_default())
}
// Called in the ticket receipt transaction after original-process verification.
// Existing user edits always take precedence, including an intentionally blank name.
pub(crate) fn initialize(
    c: &rusqlite::Connection,
    scope: &str,
    instance: &str,
    name: &str,
) -> Result<(), ApiError> {
    let key = key(scope, instance);
    if read(c, &key)?.revision != 0 {
        return Ok(());
    }
    let count: i64 = c
        .query_row("SELECT count(*) FROM agent_cards", [], |r| r.get(0))
        .map_err(storage)?;
    if count >= 4096 {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Agent card metadata limit reached".into(),
        ));
    }
    c.execute(
        "INSERT OR IGNORE INTO agent_cards(scope,revision,name,notes) VALUES(?1,1,?2,'')",
        params![key, name],
    )
    .map_err(storage)?;
    Ok(())
}
pub(crate) async fn views(
    state: &AppState,
    scopes: Vec<(String, String)>,
) -> Result<Vec<Card>, ApiError> {
    state
        .board
        .with(move |c| {
            scopes
                .into_iter()
                .map(|(scope, instance)| {
                    if instance.is_empty() {
                        Ok(Card::default())
                    } else {
                        read(c, &key(&scope, &instance))
                    }
                })
                .collect()
        })
        .await
}
pub(crate) async fn view(
    state: &AppState,
    scope: String,
    instance: String,
) -> Result<Card, ApiError> {
    Ok(views(state, vec![(scope, instance)])
        .await?
        .pop()
        .unwrap_or_default())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Target {
    session: String,
    window: String,
    pane: String,
    connection_revision: String,
    instance: String,
}
impl Target {
    fn valid(&self) -> bool {
        [
            (&self.session, b'$'),
            (&self.window, b'@'),
            (&self.pane, b'%'),
        ]
        .iter()
        .all(|(s, p)| {
            s.as_bytes().first() == Some(p)
                && s.len() > 1
                && s.len() <= 24
                && s.as_bytes()[1..].iter().all(u8::is_ascii_digit)
        }) && self.instance.len() == 64
            && self.instance.bytes().all(|b| b.is_ascii_hexdigit())
    }
}
async fn verify(state: &AppState, host: &str, t: &Target) -> Result<String, ApiError> {
    if !t.valid() {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Invalid agent card target".into(),
        ));
    }
    let m = state.registry.get(host).await?;
    if m.connection_revision != t.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed; reopen the card editor".into(),
        ));
    }
    let value = m
        .transport
        .agent_request(
            json!({"action":"status","session":t.session,"window":t.window,"pane":t.pane}),
        )
        .await?;
    if value["ok"]["instance"].as_str() != Some(t.instance.as_str())
        || state.registry.get(host).await?.connection_revision != t.connection_revision
    {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Agent changed or is unavailable. Your card draft was kept; reopen the intended agent"
                .into(),
        ));
    }
    Ok(key(
        &crate::attention::scope(&m.config, &t.session, &t.window, &t.pane).1,
        &t.instance,
    ))
}
pub(crate) async fn get(
    State(s): State<Arc<AppState>>,
    Path(host): Path<String>,
    Query(t): Query<Target>,
) -> Result<Json<Card>, ApiError> {
    let _slot = s.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Agent operations busy".into(),
        )
    })?;
    let scope = verify(&s, &host, &t).await?;
    Ok(Json(s.board.with(move |c| read(c, &scope)).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Change {
    target: Target,
    revision: u64,
    name: String,
    notes: String,
    color: Option<String>,
    pinned: Option<bool>,
}
pub(crate) async fn save(
    State(s): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(mut b): Json<Change>,
) -> Result<Json<Card>, ApiError> {
    b.name = b.name.trim().into();
    if let Some(color) = &mut b.color {
        *color = color.to_ascii_lowercase();
        if !color.is_empty()
            && !(color.len() == 7
                && color.starts_with('#')
                && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit))
        {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "Choose a six-digit hex color, or empty for the default".into(),
            ));
        }
    }

    if b.name.len() > 240
        || b.name.chars().any(char::is_control)
        || b.notes.len() > 8000
        || b.notes.contains('\0')
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Use a name up to 240 bytes and notes up to 8,000 bytes".into(),
        ));
    }
    let _slot = s.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Agent operations busy".into(),
        )
    })?;
    let m = s.registry.get(&host).await?;
    let _endpoint = m.file_writes.lock().await;
    let scope = verify(&s, &host, &b.target).await?;
    let card=s.board.with(move|c|{
        let tx=c.transaction().map_err(storage)?;
        let old=read(&tx,&scope)?;
        if old.revision!=b.revision {
            return Err(ApiError(StatusCode::CONFLICT,"This card was edited in another client. Your draft was kept; reload the saved card before retrying".into()));
        }
        if old.revision==0 {
            let count:i64=tx.query_row("SELECT count(*) FROM agent_cards",[],|r|r.get(0)).map_err(storage)?;
            if count>=4096 {return Err(ApiError(StatusCode::CONFLICT,"Agent card metadata limit reached".into()));}
        }
        let card=Card{revision:old.revision+1,name:b.name,notes:b.notes,color:b.color.unwrap_or(old.color),pinned:b.pinned.unwrap_or(old.pinned)};
        tx.execute("INSERT INTO agent_cards(scope,revision,name,notes,color,pinned) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision,name=excluded.name,notes=excluded.notes,color=excluded.color,pinned=excluded.pinned",params![scope,card.revision,card.name,card.notes,card.color,card.pinned]).map_err(storage)?;
        tx.commit().map_err(storage)?;
        Ok(card)
    }).await?;
    Ok(Json(card))
}
