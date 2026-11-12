//! Coalesced, bounded metadata invalidations; REST scenes remain authoritative.
use crate::{ApiError, AppState};
use axum::{
    Router,
    extract::State,
    http::StatusCode,
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::get,
};
use serde_json::json;
use std::{convert::Infallible, sync::Arc};
async fn events(State(state): State<Arc<AppState>>) -> Result<Response, ApiError> {
    let permit = state
        .board
        .whiteboard_event_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "Whiteboard live connection limit reached; reconnect later".into(),
            )
        })?;
    let receiver = state.board.whiteboard_events.subscribe();
    let epoch = state.board.whiteboard_epoch.clone();
    let stream = futures_util::stream::unfold(
        (receiver, true, state.shutdown.subscribe(), permit, epoch),
        |(mut receiver, first, mut shutdown, permit, epoch)| async move {
            if !first {
                tokio::select! {result=receiver.changed()=>{if result.is_err(){return None;}},_=shutdown.changed()=>return None}
            }
            let sequence = *receiver.borrow_and_update();
            Some((
                Ok::<_, Infallible>(
                    Event::default()
                        .event("whiteboards")
                        .id(format!("{epoch}:{sequence}"))
                        .json_data(json!({"epoch":epoch,"sequence":sequence}))
                        .expect("serializable invalidation"),
                ),
                (receiver, false, shutdown, permit, epoch),
            ))
        },
    );
    let mut response = Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response();
    response
        .headers_mut()
        .insert("x-accel-buffering", "no".parse().unwrap());
    Ok(response)
}
pub(crate) fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/v1/whiteboards/events", get(events))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn committed_changes_notify_after_commit_but_reads_replays_and_rollback_do_not() {
        let board = crate::board::Board::new(None).unwrap();
        let mut events = board.whiteboard_events.subscribe();
        board
            .whiteboard_write(|c| {
                let tx = c.transaction().unwrap();
                tx.execute("CREATE TABLE fixture(value INTEGER)", [])
                    .unwrap();
                tx.execute("INSERT INTO fixture VALUES(1)", []).unwrap();
                tx.commit().unwrap();
                Ok(())
            })
            .await
            .unwrap();
        assert!(events.has_changed().unwrap());
        assert_eq!(*events.borrow_and_update(), 1);
        board
            .whiteboard_write(|c| {
                Ok(
                    c.query_row("SELECT value FROM fixture", [], |r| r.get::<_, u64>(0))
                        .unwrap(),
                )
            })
            .await
            .unwrap();
        assert!(!events.has_changed().unwrap());
        let result: Result<(), ApiError> = board
            .whiteboard_write(|c| {
                let tx = c.transaction().unwrap();
                tx.execute("UPDATE fixture SET value=2", []).unwrap();
                Err(ApiError(StatusCode::CONFLICT, "fixture rollback".into()))
            })
            .await;
        assert!(result.is_err());
        assert!(!events.has_changed().unwrap());
        board
            .whiteboard_write(|c| {
                assert_eq!(
                    c.query_row("SELECT value FROM fixture", [], |r| r.get::<_, u64>(0))
                        .unwrap(),
                    1
                );
                Ok(())
            })
            .await
            .unwrap();
        assert!(!events.has_changed().unwrap());
    }
    #[tokio::test]
    async fn slow_receivers_coalesce_instead_of_accumulating_and_slot_limit_fails_closed() {
        let state = AppState::new(crate::config::Config { hosts: vec![] }, 8080).unwrap();
        let mut receiver = state.board.whiteboard_events.subscribe();
        for _ in 0..1000 {
            state.board.whiteboard_events.send_modify(|n| *n += 1);
        }
        assert_eq!(*receiver.borrow_and_update(), 1000);
        let permit = state
            .board
            .whiteboard_event_slots
            .clone()
            .acquire_many_owned(32)
            .await
            .unwrap();
        let response = events(State(state.clone())).await.unwrap_err();
        assert_eq!(response.0, StatusCode::TOO_MANY_REQUESTS);
        drop(permit);
        assert!(events(State(state)).await.is_ok());
    }
}
