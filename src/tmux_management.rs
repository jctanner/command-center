//! Small, explicit tmux mutations through the existing local/SSH transport.
use crate::{ApiError, AppState, tmux};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
fn invalid(message: &str) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Create {
    connection_revision: String,
    name: String,
    directory: Option<String>,
}
pub(crate) async fn create(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(body): Json<Create>,
) -> Result<Json<Value>, ApiError> {
    if body.name.is_empty()
        || body.name.len() > 80
        || !body
            .name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || body.name.starts_with('-')
        || body.name.starts_with(tmux::VIEWER_PREFIX)
    {
        return Err(invalid(
            "Session names must use 1–80 letters, numbers, underscores or dashes, and cannot start with a dash or cc-view-",
        ));
    }
    let directory = match body.directory.as_deref().filter(|s| !s.is_empty()) {
        None => "#{HOME}".to_owned(),
        Some(path) => {
            if !path.starts_with('/') || path.len() > 4096 || path.chars().any(char::is_control) {
                return Err(invalid(
                    "Use an absolute directory, or leave it blank for the machine's home directory",
                ));
            }
            path.replace('#', "##")
        }
    };
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Machine operations busy".into(),
        )
    })?;
    let machine = state.registry.get(&host).await?;
    let _guard = machine.file_writes.lock().await;
    if state.registry.get(&host).await?.connection_revision != body.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed; reopen the session dialog".into(),
        ));
    }
    let mut cache = machine.inventory.lock().await;
    let inventory = tmux::inventory(&machine.transport).await?;
    if inventory.sessions.iter().any(|s| s.name == body.name) {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "A session with that name already exists; choose it or use another name".into(),
        ));
    }
    // A unique name and no -A/-s replacement prevents accidental attachment or
    // destructive reuse. A failed/uncertain creation is never retried here.
    *cache = None;
    let output = machine
        .transport
        .run(&[
            "new-session",
            "-d",
            "-P",
            "-F",
            "#{session_id}\t#{window_id}\t#{pane_id}",
            "-s",
            &body.name,
            "-c",
            &directory,
            "-x",
            "120",
            "-y",
            "36",
        ])
        .await?;
    let ids: Vec<_> = output.trim().split('\t').collect();
    if ids.len() != 3
        || !tmux::valid_id(ids[0], '$')
        || !tmux::valid_id(ids[1], '@')
        || !tmux::valid_id(ids[2], '%')
    {
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "Session creation may have completed; check sessions before trying again".into(),
        ));
    }
    state.queue.invalidate();
    Ok(Json(
        json!({"session":ids[0],"window":ids[1],"pane":ids[2],"name":body.name}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Rename {
    connection_revision: String,
    session: String,
    window: String,
    expected_name: String,
    name: String,
}
pub(crate) async fn rename(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(body): Json<Rename>,
) -> Result<Json<Value>, ApiError> {
    if !tmux::valid_id(&body.session, '$') || !tmux::valid_id(&body.window, '@') {
        return Err(invalid("Invalid tmux session/window identity"));
    }
    if body.name.trim().is_empty()
        || body.name.chars().count() > 120
        || body.name.chars().any(char::is_control)
        || body.name == ";"
    {
        return Err(invalid(
            "Window names must be 1–120 characters without control characters",
        ));
    }
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Machine operations busy".into(),
        )
    })?;
    let machine = state.registry.get(&host).await?;
    let _guard = machine.file_writes.lock().await;
    if state.registry.get(&host).await?.connection_revision != body.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed; reopen the rename dialog".into(),
        ));
    }
    let mut cache = machine.inventory.lock().await;
    let inventory = tmux::inventory(&machine.transport).await?;
    let window = inventory
        .sessions
        .iter()
        .find(|s| s.id == body.session)
        .and_then(|s| s.windows.iter().find(|w| w.id == body.window))
        .ok_or_else(|| {
            ApiError(
                StatusCode::CONFLICT,
                "Window no longer belongs to this session; refresh before renaming".into(),
            )
        })?;
    if window.name != body.expected_name {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Window name changed; refresh and review before renaming".into(),
        ));
    }
    *cache = None;
    machine
        .transport
        .run(&[
            "rename-window",
            "-t",
            &format!("{}:{}", body.session, body.window),
            "--",
            &body.name.replace('#', "##"),
        ])
        .await?;
    state.queue.invalidate();
    Ok(Json(
        json!({"session":body.session,"window":body.window,"name":body.name}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Renumber {
    connection_revision: String,
    session: String,
    window: String,
    expected_windows: Vec<(String, u32)>,
    index: u32,
}
pub(crate) async fn renumber(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(body): Json<Renumber>,
) -> Result<Json<Value>, ApiError> {
    if !tmux::valid_id(&body.session, '$')
        || !tmux::valid_id(&body.window, '@')
        || body.index > 9999
        || body.expected_windows.len() > 1000
    {
        return Err(invalid("Choose a window index from 0 to 9999"));
    }
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Machine operations busy".into(),
        )
    })?;
    let machine = state.registry.get(&host).await?;
    let _guard = machine.file_writes.lock().await;
    if state.registry.get(&host).await?.connection_revision != body.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed; reopen the renumber dialog".into(),
        ));
    }
    let mut cache = machine.inventory.lock().await;
    let inventory = tmux::inventory(&machine.transport).await?;
    let session = inventory
        .sessions
        .iter()
        .find(|s| s.id == body.session)
        .ok_or_else(|| {
            ApiError(
                StatusCode::CONFLICT,
                "Session changed; refresh before renumbering".into(),
            )
        })?;
    let mut actual: Vec<_> = session
        .windows
        .iter()
        .map(|w| (w.id.clone(), w.index))
        .collect();
    let mut expected = body.expected_windows;
    actual.sort();
    expected.sort();
    if actual != expected {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Window numbering changed; refresh and review before renumbering".into(),
        ));
    }
    let source = session
        .windows
        .iter()
        .find(|w| w.id == body.window)
        .ok_or_else(|| {
            ApiError(
                StatusCode::CONFLICT,
                "Window no longer belongs to this session".into(),
            )
        })?;
    if source.index != body.index {
        let temporary = session
            .windows
            .iter()
            .map(|w| w.index)
            .max()
            .unwrap_or(0)
            .max(body.index)
            .checked_add(1)
            .filter(|i| *i <= i32::MAX as u32)
            .ok_or_else(|| invalid("No temporary window index is available"))?;
        let mut shifted: Vec<_> = session
            .windows
            .iter()
            .filter(|w| {
                if body.index < source.index {
                    w.index >= body.index && w.index < source.index
                } else {
                    w.index > source.index && w.index <= body.index
                }
            })
            .collect();
        shifted.sort_by_key(|w| w.index);
        if body.index < source.index {
            shifted.reverse();
        }
        // Move only links in the selected session. Never replace a window (-k),
        // recreate panes, or retry an uncertain multi-command operation.
        let mut args = Vec::<String>::new();
        let mut move_to = |id: &str, index: u32| {
            if !args.is_empty() {
                args.push(";".into());
            }
            args.extend([
                "move-window".into(),
                "-d".into(),
                "-s".into(),
                format!("{}:{}", body.session, id),
                "-t".into(),
                format!("{}:{}", body.session, index),
            ]);
        };
        move_to(&body.window, temporary);
        for window in shifted {
            move_to(
                &window.id,
                if body.index < source.index {
                    window.index + 1
                } else {
                    window.index - 1
                },
            );
        }
        move_to(&body.window, body.index);
        if let Some(active) = session.windows.iter().find(|w| w.active) {
            args.extend([
                ";".into(),
                "select-window".into(),
                "-t".into(),
                format!("{}:{}", body.session, active.id),
            ]);
        }
        *cache = None;
        machine
            .transport
            .run(&args.iter().map(String::as_str).collect::<Vec<_>>())
            .await?;
        state.queue.invalidate();
    }
    Ok(Json(
        json!({"session":body.session,"window":body.window,"index":body.index}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ClipboardQuery {
    connection_revision: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ClipboardChange {
    connection_revision: String,
    expected_mode: String,
    mode: String,
}
fn valid_clipboard_mode(mode: &str) -> bool {
    matches!(mode, "on" | "external" | "off")
}
pub(crate) async fn clipboard_status(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Query(query): Query<ClipboardQuery>,
) -> Result<Json<Value>, ApiError> {
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Machine operations busy".into(),
        )
    })?;
    let machine = state.registry.get(&host).await?;
    let _guard = machine.file_writes.lock().await;
    if state.registry.get(&host).await?.connection_revision != query.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed; reopen clipboard settings".into(),
        ));
    }
    let mode = machine
        .transport
        .run(&["show-options", "-s", "-v", "set-clipboard"])
        .await?
        .trim()
        .to_owned();
    if !valid_clipboard_mode(&mode) {
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "Unsupported tmux clipboard setting".into(),
        ));
    }
    Ok(Json(json!({"mode":mode})))
}
pub(crate) async fn clipboard_set(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(body): Json<ClipboardChange>,
) -> Result<Json<Value>, ApiError> {
    if !valid_clipboard_mode(&body.mode) || !valid_clipboard_mode(&body.expected_mode) {
        return Err(invalid("Choose on, external or off"));
    }
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Machine operations busy".into(),
        )
    })?;
    let machine = state.registry.get(&host).await?;
    let _guard = machine.file_writes.lock().await;
    if state.registry.get(&host).await?.connection_revision != body.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed; reopen clipboard settings".into(),
        ));
    }
    let current = machine
        .transport
        .run(&["show-options", "-s", "-v", "set-clipboard"])
        .await?;
    if current.trim() != body.expected_mode {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "tmux clipboard setting changed; refresh status before applying".into(),
        ));
    }
    machine
        .transport
        .run(&["set-option", "-s", "set-clipboard", &body.mode])
        .await?;
    Ok(Json(json!({"mode":body.mode})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Spawn {
    connection_revision: String,
    session: String,
    window: String,
    pane: String,
    expected_directory: String,
    directory: Option<String>,
    name: Option<String>,
    direction: Option<String>,
}
pub(crate) async fn new_window(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(body): Json<Spawn>,
) -> Result<Json<Value>, ApiError> {
    spawn(state, host, body, false).await
}
pub(crate) async fn split_pane(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(body): Json<Spawn>,
) -> Result<Json<Value>, ApiError> {
    spawn(state, host, body, true).await
}
async fn spawn(
    state: Arc<AppState>,
    host: String,
    body: Spawn,
    split: bool,
) -> Result<Json<Value>, ApiError> {
    if !tmux::valid_id(&body.session, '$')
        || !tmux::valid_id(&body.window, '@')
        || !tmux::valid_id(&body.pane, '%')
    {
        return Err(invalid("Invalid source session/window/pane identity"));
    }
    let name = body.name.as_deref().filter(|s| !s.is_empty());
    if split && (name.is_some() || !matches!(body.direction.as_deref(), Some("right" | "below")))
        || !split && body.direction.is_some()
    {
        return Err(invalid(
            "Choose split right or below, or create a named window",
        ));
    }
    if name.is_some_and(|s| {
        s.trim().is_empty()
            || s.chars().count() > 120
            || s.chars().any(char::is_control)
            || s == ";"
    }) {
        return Err(invalid(
            "Window names must be 1–120 characters without control characters",
        ));
    }
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Machine operations busy".into(),
        )
    })?;
    let machine = state.registry.get(&host).await?;
    let _guard = machine.file_writes.lock().await;
    if state.registry.get(&host).await?.connection_revision != body.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed; reopen the creation dialog".into(),
        ));
    }
    let mut cache = machine.inventory.lock().await;
    let inventory = tmux::inventory(&machine.transport).await?;
    let source = inventory
        .sessions
        .iter()
        .find(|s| s.id == body.session)
        .and_then(|s| s.windows.iter().find(|w| w.id == body.window))
        .and_then(|w| w.panes.iter().find(|p| p.id == body.pane))
        .ok_or_else(|| {
            ApiError(
                StatusCode::CONFLICT,
                "Source pane no longer belongs to this session/window; refresh before creating"
                    .into(),
            )
        })?;
    if source.cwd != body.expected_directory {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Source directory changed; reopen the dialog and review".into(),
        ));
    }
    let directory = body
        .directory
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(&source.cwd);
    if !directory.starts_with('/')
        || directory.len() > 4096
        || directory.chars().any(char::is_control)
    {
        return Err(invalid("Choose an absolute working directory"));
    }
    if !machine.transport.directory_accessible(directory).await? {
        return Err(invalid(
            "Working directory does not exist or cannot be entered",
        ));
    }
    let mut args = vec![
        if split {
            "split-window".to_owned()
        } else {
            "new-window".to_owned()
        },
        "-d".into(),
        "-P".into(),
        "-F".into(),
        "#{session_id}\t#{window_id}\t#{pane_id}".into(),
        "-t".into(),
        if split {
            format!("{}:{}.{}", body.session, body.window, body.pane)
        } else {
            format!("{}:", body.session)
        },
        "-c".into(),
        directory.replace('#', "##"),
    ];
    if split {
        args.push(if body.direction.as_deref() == Some("right") {
            "-h".into()
        } else {
            "-v".into()
        });
    }
    if let Some(name) = name {
        args.extend(["-n".into(), name.replace('#', "##")]);
    }
    // Detached creation preserves other clients' selection and all existing
    // processes. The requesting browser explicitly focuses the returned IDs.
    // A split intentionally restores the full layout rather than keeping zoom.
    *cache = None;
    let output = machine
        .transport
        .run(&args.iter().map(String::as_str).collect::<Vec<_>>())
        .await?;
    let ids: Vec<_> = output.trim().split('\t').collect();
    if ids.len() != 3
        || ids[0] != body.session
        || !tmux::valid_id(ids[1], '@')
        || !tmux::valid_id(ids[2], '%')
        || split && ids[1] != body.window
    {
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "Creation may have completed; check windows and panes before trying again".into(),
        ));
    }
    state.queue.invalidate();
    Ok(Json(
        json!({"session":ids[0],"window":ids[1],"pane":ids[2]}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ClosePreview {
    connection_revision: String,
    session: String,
    window: String,
    agent_pane: Option<String>,
    agent_instance: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CloseWindow {
    connection_revision: String,
    session: String,
    window: String,
    agent_pane: Option<String>,
    agent_instance: Option<String>,
    expected: String,
}
async fn close_snapshot(
    transport: &crate::transport::Transport,
    session: &str,
    window: &str,
) -> Result<Value, ApiError> {
    use sha2::{Digest, Sha256};
    if !tmux::valid_id(session, '$') || !tmux::valid_id(window, '@') {
        return Err(invalid("Invalid tmux session/window identity"));
    }
    let inventory = tmux::inventory(transport).await?;
    let selected = inventory
        .sessions
        .iter()
        .find(|s| s.id == session)
        .and_then(|s| s.windows.iter().find(|w| w.id == window))
        .ok_or_else(|| {
            ApiError(
                StatusCode::CONFLICT,
                "Window no longer belongs to this session; refresh the window tabs".into(),
            )
        })?;
    let panes = transport
        .run(&[
            "list-panes",
            "-t",
            &format!("{session}:{window}"),
            "-F",
            "#{pane_id}\t#{pane_pid}",
        ])
        .await?;
    let server = transport
        .run(&[
            "display-message",
            "-p",
            "-t",
            &format!("{session}:{window}"),
            "#{pid}\t#{start_time}",
        ])
        .await?;
    let mut links = inventory
        .sessions
        .iter()
        .filter(|s| s.windows.iter().any(|w| w.id == window))
        .map(|s| (s.id.clone(), s.name.clone(), s.windows.len()))
        .collect::<Vec<_>>();
    links.sort();
    let expected = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(
                session,
                window,
                &selected.name,
                selected.index,
                &panes,
                &server,
                &links
            ))
            .unwrap()
        )
    );
    Ok(
        json!({"session":session,"window":window,"name":selected.name,"index":selected.index,"panes":selected.panes.len(),"affected_sessions":links.into_iter().map(|(id,name,count)|json!({"id":id,"name":name,"last_window":count==1})).collect::<Vec<_>>(),"expected":expected}),
    )
}
async fn bind_close_agent(
    transport: &crate::transport::Transport,
    session: &str,
    window: &str,
    pane: &Option<String>,
    instance: &Option<String>,
    snapshot: &mut Value,
) -> Result<(), ApiError> {
    match (pane, instance) {
        (None, None) => Ok(()),
        (Some(pane), Some(instance))
            if tmux::valid_id(pane, '%')
                && instance.len() == 64
                && instance.bytes().all(|b| b.is_ascii_hexdigit()) =>
        {
            let status = crate::agents::result(
                transport
                    .agent_request(
                        json!({"action":"status","session":session,"window":window,"pane":pane}),
                    )
                    .await?,
            )?;
            if status["instance"].as_str() != Some(instance.as_str()) {
                return Err(ApiError(
                    StatusCode::CONFLICT,
                    "Agent process changed; reopen Close agent and review the intended agent"
                        .into(),
                ));
            }
            use sha2::{Digest, Sha256};
            snapshot["expected"] = json!(format!(
                "{:x}",
                Sha256::digest(
                    serde_json::to_vec(&(&snapshot["expected"], pane, instance)).unwrap()
                )
            ));
            Ok(())
        }
        _ => Err(invalid(
            "Close agent requires an exact pane and process identity",
        )),
    }
}
pub(crate) async fn close_preview(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Query(q): Query<ClosePreview>,
) -> Result<Json<Value>, ApiError> {
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Machine operations busy".into(),
        )
    })?;
    let machine = state.registry.get(&host).await?;
    let _guard = machine.file_writes.lock().await;
    if state.registry.get(&host).await?.connection_revision != q.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed; reopen the window menu".into(),
        ));
    }
    let mut snapshot = close_snapshot(&machine.transport, &q.session, &q.window).await?;
    bind_close_agent(
        &machine.transport,
        &q.session,
        &q.window,
        &q.agent_pane,
        &q.agent_instance,
        &mut snapshot,
    )
    .await?;
    Ok(Json(snapshot))
}
pub(crate) async fn close_window(
    State(state): State<Arc<AppState>>,
    Path(host): Path<String>,
    Json(b): Json<CloseWindow>,
) -> Result<Json<Value>, ApiError> {
    let _slot = state.file_slots.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Machine operations busy".into(),
        )
    })?;
    let machine = state.registry.get(&host).await?;
    let _guard = machine.file_writes.lock().await;
    if state.registry.get(&host).await?.connection_revision != b.connection_revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Machine changed; reopen the window menu".into(),
        ));
    }
    let mut cache = machine.inventory.lock().await;
    let mut current = close_snapshot(&machine.transport, &b.session, &b.window).await?;
    bind_close_agent(
        &machine.transport,
        &b.session,
        &b.window,
        &b.agent_pane,
        &b.agent_instance,
        &mut current,
    )
    .await?;
    if current["expected"].as_str() != Some(b.expected.as_str()) {
        return Err(ApiError(StatusCode::CONFLICT,"Window, pane processes, or session links changed. Reopen Close window and review again".into()));
    }
    *cache = None;
    state.queue.invalidate();
    if let (Some(pane), Some(instance)) = (b.agent_pane, b.agent_instance) {
        crate::agents::result(machine.transport.agent_request(json!({"action":"close_agent","session":b.session,"window":b.window,"pane":pane,"identity":instance})).await?)?;
    } else {
        machine.transport.run(&["kill-window","-t",&format!("{}:{}",b.session,b.window)]).await.map_err(|_|ApiError(StatusCode::BAD_GATEWAY,"Close outcome is uncertain. Check the windows before taking another action; the close will not be retried".into()))?;
    }
    state.queue.invalidate();
    Ok(Json(
        json!({"closed":true,"session":b.session,"window":b.window}),
    ))
}
