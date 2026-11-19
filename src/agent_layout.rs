//! Shared presentation metadata only; no agent/process control.
use crate::{ApiError, AppState};
use axum::{Json, extract::State, http::StatusCode};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::Arc};
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PinnedSort {
    #[default]
    Manual,
    Activity,
}
#[derive(Clone, Default, Deserialize, Serialize)]
pub(crate) struct Layout {
    pub revision: u64,
    pub pinned_sort: PinnedSort,
    pub order: Vec<String>,
}
fn storage(_: impl std::fmt::Display) -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Agent layout storage unavailable".into(),
    )
}
pub(crate) fn init(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS agent_layout(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);")
}
pub(crate) fn read(c: &Connection) -> Result<Layout, ApiError> {
    let raw: Option<String> = c
        .query_row("SELECT data FROM agent_layout WHERE id=1", [], |r| r.get(0))
        .optional()
        .map_err(storage)?;
    let mut layout: Layout = raw
        .map(|v| serde_json::from_str(&v).map_err(storage))
        .transpose()?
        .unwrap_or_default();
    let mut statement = c
        .prepare("SELECT scope FROM agent_cards WHERE pinned=1 ORDER BY rowid")
        .map_err(storage)?;
    let keys = statement
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(storage)?;
    let mut seen: HashSet<String> = layout.order.iter().cloned().collect();
    for key in keys {
        let key = key.map_err(storage)?;
        if seen.insert(key.clone()) {
            layout.order.push(key);
        }
    }
    Ok(layout)
}
fn write(c: &Connection, layout: &Layout) -> Result<(), ApiError> {
    c.execute(
        "INSERT INTO agent_layout VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        [serde_json::to_string(layout).map_err(storage)?],
    )
    .map_err(storage)?;
    Ok(())
}
pub(crate) fn pin(c: &Connection, key: &str) -> Result<(), ApiError> {
    let mut layout = read(c)?;
    layout.order.retain(|k| k != key);
    layout.order.push(key.into());
    layout.revision += 1;
    write(c, &layout)
}
pub(crate) fn transfer(c: &Connection, old: &str, new: &str) -> Result<(), ApiError> {
    let mut layout = read(c)?;
    if layout.order.iter().any(|k| k == old) {
        layout.order.retain(|k| k != new);
        if let Some(index) = layout.order.iter().position(|k| k == old) {
            layout.order[index] = new.into();
        }
        layout.revision += 1;
        write(c, &layout)?;
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Change {
    revision: u64,
    pinned_sort: Option<PinnedSort>,
    order: Option<Vec<String>>,
}
fn change(c: &mut Connection, b: Change) -> Result<Layout, ApiError> {
    let tx = c.transaction().map_err(storage)?;
    let mut layout = read(&tx)?;
    if layout.revision != b.revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Agent layout changed elsewhere. Reload before trying again.".into(),
        ));
    }
    if let Some(order) = b.order {
        let unique: HashSet<_> = order.iter().collect();
        if order.len() > 4096
            || unique.len() != order.len()
            || unique != layout.order.iter().collect()
        {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Pinned cards changed. Reload the agent list before reordering.".into(),
            ));
        }
        layout.order = order;
    }
    if let Some(mode) = b.pinned_sort {
        layout.pinned_sort = mode;
    }
    layout.revision += 1;
    write(&tx, &layout)?;
    tx.commit().map_err(storage)?;
    Ok(layout)
}
pub(crate) async fn view(State(s): State<Arc<AppState>>) -> Result<Json<Layout>, ApiError> {
    Ok(Json(s.board.with(|c| read(c)).await?))
}
pub(crate) async fn save(
    State(s): State<Arc<AppState>>,
    Json(b): Json<Change>,
) -> Result<Json<Layout>, ApiError> {
    Ok(Json(s.board.with(move |c| change(c, b)).await?))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE agent_cards(scope TEXT PRIMARY KEY,pinned INTEGER);INSERT INTO agent_cards VALUES('a',1),('b',1),('hidden',1);").unwrap();
        init(&c).unwrap();
        c
    }
    #[test]
    fn default_manual_conflicts_and_hidden_order() {
        let mut c = db();
        let l = read(&c).unwrap();
        assert_eq!(l.pinned_sort, PinnedSort::Manual);
        assert_eq!(l.order, vec!["a", "b", "hidden"]);
        let next = change(
            &mut c,
            Change {
                revision: 0,
                pinned_sort: None,
                order: Some(vec!["b".into(), "a".into(), "hidden".into()]),
            },
        )
        .unwrap();
        assert_eq!(read(&c).unwrap().order, next.order);
        assert!(
            change(
                &mut c,
                Change {
                    revision: 0,
                    pinned_sort: Some(PinnedSort::Activity),
                    order: None
                }
            )
            .is_err()
        );
        assert!(
            change(
                &mut c,
                Change {
                    revision: 1,
                    pinned_sort: None,
                    order: Some(vec!["a".into(), "b".into()])
                }
            )
            .is_err()
        );
        let l = change(
            &mut c,
            Change {
                revision: 1,
                pinned_sort: Some(PinnedSort::Activity),
                order: None,
            },
        )
        .unwrap();
        assert_eq!(l.pinned_sort, PinnedSort::Activity);
        assert_eq!(l.order, next.order);
    }
    #[test]
    fn pinning_existing_metadata_appends_and_keeps_unknown_ids_out() {
        let mut c = db();
        c.execute("INSERT INTO agent_cards VALUES('earlier',0)", [])
            .unwrap();
        pin(&c, "earlier").unwrap();
        c.execute("UPDATE agent_cards SET pinned=1 WHERE scope='earlier'", [])
            .unwrap();
        assert_eq!(read(&c).unwrap().order, vec!["a", "b", "hidden", "earlier"]);
        assert!(
            change(
                &mut c,
                Change {
                    revision: 1,
                    pinned_sort: None,
                    order: Some(vec![
                        "a".into(),
                        "b".into(),
                        "hidden".into(),
                        "unknown".into()
                    ])
                }
            )
            .is_err()
        );
    }
    #[test]
    fn restart_keeps_position_new_pins_append() {
        let c = db();
        transfer(&c, "a", "new").unwrap();
        assert_eq!(read(&c).unwrap().order, vec!["new", "b", "hidden", "a"]);
        c.execute("INSERT INTO agent_cards VALUES('last',1)", [])
            .unwrap();
        assert_eq!(read(&c).unwrap().order.last().unwrap(), "last");
    }
}
