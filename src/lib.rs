mod agent_cards;
mod agent_restart;
mod agents;
mod attention;
mod board;
pub mod config;
mod email;
mod features;
mod filesystem;
mod jira;
mod launch;
mod machines;
mod outbox;
mod queue;
mod slack;
mod slack_inbox;
mod slack_send;
mod slack_state;
mod terminal;
pub mod tmux;
mod tmux_management;
pub mod transport;
mod whiteboard;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State, WebSocketUpgrade},
    http::{HeaderMap, Method, StatusCode, header},
    middleware::{self, Next},
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;
use std::{convert::Infallible, path::PathBuf, sync::Arc};
use tokio::sync::Semaphore;
use tower_http::services::ServeDir;
use transport::Transport;

pub struct AppState {
    registry: machines::Registry,
    pub port: u16,
    pub public_origin: Option<String>,
    pub tailnet_address: Option<std::net::SocketAddr>,
    pub lan_address: Option<std::net::SocketAddr>,
    pub terminal_slots: Arc<Semaphore>,
    connection_tests: Semaphore,
    file_slots: Semaphore,
    queue: queue::Queue,
    features: features::Features,
    slack: slack::Slack,
    email: email::Email,
    jira: jira::Jira,
    board: board::Board,
    agents: agents::Agents,
    outbox: outbox::Outbox,
    launches: launch::Launches,
    attention: attention::Attention,
    pub runtime: tempfile::TempDir,
    pub shutdown: tokio::sync::watch::Sender<bool>,
}

impl AppState {
    pub fn new(config: config::Config, port: u16) -> anyhow::Result<Arc<Self>> {
        Self::with_config(config, port, None)
    }
    pub fn with_config(
        config: config::Config,
        port: u16,
        path: Option<PathBuf>,
    ) -> anyhow::Result<Arc<Self>> {
        let runtime = tempfile::Builder::new().prefix("cc-").tempdir()?;
        let attention =
            attention::Attention::new(path.as_ref().map(|p| p.with_extension("attention.json")))?;
        let agents =
            agents::Agents::new(path.as_ref().map(|p| p.with_extension("approvals.json")))?;
        let slack = slack::Slack::new(path.as_ref().map(|p| p.with_extension("slack.json")))?;
        let email = email::Email::new(path.as_ref().map(|p| p.with_extension("email.json")))?;
        let jira = jira::Jira::new(path.as_ref().map(|p| p.with_extension("jira.json")))?;
        let features = features::Features::new(path.as_deref())?;
        let board = board::Board::new(path.as_ref().map(|p| p.with_extension("board.sqlite3")))?;
        let registry = machines::Registry::new(config, path, runtime.path())?;
        let (shutdown, _) = tokio::sync::watch::channel(false);
        Ok(Arc::new(Self {
            registry,
            features,
            slack,
            email,
            jira,
            board,
            queue: queue::Queue::default(),
            agents,
            outbox: outbox::Outbox::default(),
            launches: launch::Launches::default(),
            attention,
            shutdown,
            port,
            public_origin: None,
            tailnet_address: None,
            lan_address: None,
            terminal_slots: Arc::new(Semaphore::new(16)),
            connection_tests: Semaphore::new(4),
            file_slots: Semaphore::new(8),
            runtime,
        }))
    }
}

#[derive(Debug)]
pub(crate) struct ApiError(pub StatusCode, pub String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self(StatusCode::BAD_GATEWAY, error.to_string())
    }
}

pub fn router(state: Arc<AppState>, web_dir: std::path::PathBuf) -> Router {
    outbox::start(state.clone());
    Router::new()
        .merge(outbox::routes())
        .merge(slack::routes().layer(middleware::from_fn_with_state(
            (state.clone(), features::Feature::Slack),
            features::gate,
        )))
        .merge(email::routes().layer(middleware::from_fn_with_state(
            (state.clone(), features::Feature::Email),
            features::gate,
        )))
        .merge(jira::routes().layer(middleware::from_fn_with_state(
            (state.clone(), features::Feature::Jira),
            features::gate,
        )))
        .merge(board::routes())
        .merge(whiteboard::routes())
        .route(
            "/api/v1/openapi.json",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "application/json")],
                    include_str!("../docs/openapi.json"),
                )
            }),
        )
        .route(
            "/api/v1/settings/features",
            get(features::get).put(features::save),
        )
        .route(
            "/api/v1/health",
            get(|| async { Json(json!({"status":"ok", "version":env!("CARGO_PKG_VERSION")})) }),
        )
        .route("/api/v1/queue", get(queue::snapshot))
        .route("/api/v1/attention/read", post(attention::read))
        .route(
            "/api/v1/hosts/{host}/agents/conversation",
            get(agents::conversation),
        )
        .route("/api/v1/hosts/{host}/agents/message", post(agents::message))
        .route(
            "/api/v1/hosts/{host}/agents/restart",
            get(agent_restart::prepare).post(agent_restart::start),
        )
        .route(
            "/api/v1/hosts/{host}/agents/restart-status",
            get(agent_restart::status),
        )
        .route(
            "/api/v1/hosts/{host}/agents/card",
            get(agent_cards::get).put(agent_cards::save),
        )
        .route(
            "/api/v1/hosts/{host}/agents/launch-options",
            get(launch::prepare),
        )
        .route(
            "/api/v1/hosts/{host}/agents/launch",
            post(launch::start).layer(DefaultBodyLimit::max(160 * 1024)),
        )
        .route(
            "/api/v1/hosts/{host}/agents/launch-status",
            get(launch::status),
        )
        .route(
            "/api/v1/hosts/{host}/agents/approval",
            post(agents::approval),
        )
        .route("/api/v1/hosts", get(hosts).post(add_host))
        .route("/api/v1/events/hosts", get(host_events))
        .route("/api/v1/settings/hosts/test", post(test_host))
        .route("/api/v1/settings/hosts", get(host_settings))
        .route(
            "/api/v1/hosts/{host}",
            axum::routing::put(edit_host).delete(remove_host),
        )
        .route(
            "/api/v1/hosts/{host}/windows/renumber",
            post(tmux_management::renumber),
        )
        .route(
            "/api/v1/hosts/{host}/clipboard",
            get(tmux_management::clipboard_status).post(tmux_management::clipboard_set),
        )
        .route(
            "/api/v1/hosts/{host}/windows",
            post(tmux_management::new_window),
        )
        .route(
            "/api/v1/hosts/{host}/panes",
            post(tmux_management::split_pane),
        )
        .route("/api/v1/hosts/{host}/inventory", get(inventory))
        .route(
            "/api/v1/hosts/{host}/sessions",
            post(tmux_management::create),
        )
        .route(
            "/api/v1/hosts/{host}/windows/close",
            get(tmux_management::close_preview).post(tmux_management::close_window),
        )
        .route(
            "/api/v1/hosts/{host}/windows/rename",
            post(tmux_management::rename),
        )
        .route("/api/v1/hosts/{host}/terminal", get(terminal))
        .route(
            "/api/v1/hosts/{host}/projects",
            get(filesystem::projects).put(filesystem::pin),
        )
        .route("/api/v1/hosts/{host}/fs", get(filesystem::list))
        .route(
            "/api/v1/hosts/{host}/file",
            get(filesystem::get)
                .put(filesystem::put)
                .layer(DefaultBodyLimit::max(8 * 1024 * 1024)),
        )
        .fallback_service(ServeDir::new(web_dir))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), same_host))
        .with_state(state)
}

fn allowed_host(
    host: &str,
    port: u16,
    tailnet: Option<std::net::SocketAddr>,
    lan: Option<std::net::SocketAddr>,
) -> bool {
    host == format!("127.0.0.1:{port}")
        || host == format!("localhost:{port}")
        || tailnet.is_some_and(|address| host == address.to_string())
        || lan.is_some_and(|address| host == address.to_string())
}
async fn same_host(
    State(state): State<Arc<AppState>>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|s| s.to_str().ok())
        .unwrap_or("");
    let public = state
        .public_origin
        .as_deref()
        .filter(|origin| origin.strip_prefix("https://") == Some(host));
    if public.is_none() && !allowed_host(host, state.port, state.tailnet_address, state.lan_address)
    {
        return (StatusCode::FORBIDDEN, "invalid Host header").into_response();
    }
    let expected_origin = public
        .map(str::to_owned)
        .unwrap_or_else(|| format!("http://{host}"));
    if let Some(origin) = request.headers().get(header::ORIGIN)
        && origin.to_str().ok() != Some(expected_origin.as_str())
    {
        return (StatusCode::FORBIDDEN, "cross-origin request rejected").into_response();
    }
    if !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    ) && !request.headers().contains_key(header::ORIGIN)
    {
        return (
            StatusCode::FORBIDDEN,
            "changes require a same-origin request",
        )
            .into_response();
    }
    let api = request.uri().path().starts_with("/api/");
    let embedded_whiteboard = request.uri().path() == "/whiteboard.html";
    let mut response = next.run(request).await;
    if api {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    }
    response
        .headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    response.headers_mut().insert(
        "x-frame-options",
        if embedded_whiteboard {
            "SAMEORIGIN"
        } else {
            "DENY"
        }
        .parse()
        .unwrap(),
    );
    response
}
async fn hosts(State(state): State<Arc<AppState>>) -> Json<Vec<machines::Summary>> {
    Json(state.registry.list().await.hosts)
}
async fn host_settings(State(state): State<Arc<AppState>>) -> Json<machines::Settings> {
    Json(state.registry.settings().await)
}
async fn add_host(
    State(state): State<Arc<AppState>>,
    Json(edit): Json<machines::Edit>,
) -> Result<Json<machines::Settings>, ApiError> {
    let host = edit
        .host
        .host(format!("machine-{}", uuid::Uuid::new_v4().simple()))?;
    Ok(Json(
        state
            .registry
            .apply(&edit.revision, machines::Change::Add(host))
            .await?,
    ))
}
async fn edit_host(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(edit): Json<machines::Edit>,
) -> Result<Json<machines::Settings>, ApiError> {
    let mut host = edit.host.host(id.clone())?;
    host.projects = state.registry.get(&id).await?.config.projects.clone();
    Ok(Json(
        state
            .registry
            .apply(&edit.revision, machines::Change::Update(host))
            .await?,
    ))
}
async fn remove_host(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(edit): Json<machines::Remove>,
) -> Result<Json<machines::Settings>, ApiError> {
    Ok(Json(
        state
            .registry
            .apply(&edit.revision, machines::Change::Remove(id))
            .await?,
    ))
}
async fn test_host(
    State(state): State<Arc<AppState>>,
    Json(draft): Json<machines::Draft>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _slot = state.connection_tests.try_acquire().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "connection tests are busy; try again shortly".into(),
        )
    })?;
    let host = draft.host("connection-test".into())?;
    let transport = Transport {
        host,
        control_path: state
            .runtime
            .path()
            .join(format!("test-{}", uuid::Uuid::new_v4().simple())),
    };
    let result = tokio::time::timeout(std::time::Duration::from_secs(12), async {
        let version = transport.run(&["-V"]).await?;
        let inventory = tmux::inventory(&transport).await?;
        Ok::<_, anyhow::Error>(Json(
            json!({"version":version.trim(), "sessions":inventory.sessions.len()}),
        ))
    })
    .await
    .map_err(|_| {
        ApiError(
            StatusCode::GATEWAY_TIMEOUT,
            "connection test timed out".into(),
        )
    })??;
    Ok(result)
}
async fn host_events(
    State(state): State<Arc<AppState>>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let receiver = state.registry.events.subscribe();
    let stream = futures_util::stream::unfold(
        (receiver, true, state.shutdown.subscribe()),
        |(mut receiver, first, mut shutdown)| async move {
            if !first {
                tokio::select! { result = receiver.changed() => { if result.is_err() { return None; } }, _ = shutdown.changed() => return None }
            }
            let list = receiver.borrow_and_update().clone();
            Some((
                Ok(Event::default()
                    .event("hosts")
                    .json_data(list)
                    .expect("serializable host list")),
                (receiver, false, shutdown),
            ))
        },
    );
    Sse::new(stream).keep_alive(KeepAlive::default())
}
async fn inventory(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<tmux::Inventory>, ApiError> {
    let host = state.registry.get(&id).await?;
    let mut cache = host.inventory.lock().await;
    if let Some((at, inventory)) = &*cache
        && at.elapsed().as_secs_f32() < 1.5
    {
        return Ok(Json(inventory.clone()));
    }
    let inventory = tmux::inventory(&host.transport).await?;
    *cache = Some((std::time::Instant::now(), inventory.clone()));
    Ok(Json(inventory))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TerminalQuery {
    session: String,
    window: String,
    cols: Option<u16>,
    rows: Option<u16>,
}
async fn terminal(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<TerminalQuery>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    // Web browsers always send Origin on WS handshakes. Native clients should
    // send the backend's origin as well. HTTP inventory remains usable by curl.
    if !headers.contains_key(header::ORIGIN) {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "terminal connections require Origin".into(),
        ));
    }
    if !tmux::valid_id(&query.session, '$') || !tmux::valid_id(&query.window, '@') {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "invalid tmux target".into(),
        ));
    }
    let host = state.registry.get(&id).await?.transport.clone();
    let slot = state
        .terminal_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "terminal connection limit reached".into(),
            )
        })?;
    Ok(ws
        .max_message_size(64 * 1024)
        .max_frame_size(64 * 1024)
        .on_upgrade(move |socket| async move {
            let _slot = slot;
            terminal::serve(
                socket,
                host,
                query.session,
                query.window,
                query.cols.unwrap_or(100).clamp(10, 500),
                query.rows.unwrap_or(30).clamp(2, 300),
                state.shutdown.subscribe(),
            )
            .await;
        }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn https_origin_guard_preserves_host_and_csrf_checks() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut state = AppState::new(config::Config { hosts: vec![] }, 8080).unwrap();
        Arc::get_mut(&mut state).unwrap().public_origin = Some("https://cc.example:8443".into());
        let app = Router::new()
            .route("/probe", post(|| async { "ok" }))
            .layer(middleware::from_fn_with_state(state, same_host));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        for (host, origin, expected) in [
            ("cc.example:8443", Some("https://cc.example:8443"), 200),
            ("cc.example:8443", Some("http://cc.example:8443"), 403),
            ("cc.example:8443", Some("https://evil.example"), 403),
            ("cc.example:8443", None, 403),
            ("evil.example", Some("https://cc.example:8443"), 403),
            ("127.0.0.1:8080", Some("http://127.0.0.1:8080"), 200),
            ("127.0.0.1:8080", Some("https://cc.example:8443"), 403),
        ] {
            let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
            let origin = origin
                .map(|v| format!("Origin: {v}\r\n"))
                .unwrap_or_default();
            let request = format!(
                "POST /probe HTTP/1.1\r\nHost: {host}\r\n{origin}X-Forwarded-Host: cc.example:8443\r\nX-Forwarded-Proto: https\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(request.as_bytes()).await.unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).await.unwrap();
            assert!(
                response.starts_with(&format!("HTTP/1.1 {expected}")),
                "{host} {origin}: {response}"
            );
        }
        server.abort();
    }
    #[test]
    fn loopback_host_check_rejects_dns_rebinding() {
        assert!(allowed_host("localhost:8080", 8080, None, None));
        assert!(allowed_host("127.0.0.1:8080", 8080, None, None));
        assert!(!allowed_host("evil.example:8080", 8080, None, None));
        assert!(!allowed_host("localhost:9999", 8080, None, None));
        let tailnet = Some("100.64.0.10:8080".parse().unwrap());
        assert!(allowed_host("100.64.0.10:8080", 8080, tailnet, None));
        assert!(!allowed_host("100.64.0.10:8080", 8080, None, None));
        assert!(!allowed_host("100.64.0.10:8081", 8080, tailnet, None));
        assert!(!allowed_host("evil.example:8080", 8080, tailnet, None));
        let lan = Some("10.0.0.10:8080".parse().unwrap());
        assert!(allowed_host("10.0.0.10:8080", 8080, tailnet, lan));
        assert!(!allowed_host("10.0.0.11:8080", 8080, tailnet, lan));
        assert!(!allowed_host("10.0.0.10:8081", 8080, tailnet, lan));
        assert!(!allowed_host("10.0.0.10:8080", 8080, tailnet, None));
    }
}
