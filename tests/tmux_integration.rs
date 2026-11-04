use command_center::{
    AppState,
    config::{Config, Host},
    router, tmux,
    transport::Transport,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{process::Command, time::Duration};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};

struct Fixture {
    _dir: tempfile::TempDir,
    transport: Transport,
}
impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let transport = Transport {
            host: Host {
                id: "test".into(),
                name: "Test".into(),
                ssh: None,
                ssh_config: None,
                ssh_jump: None,
                projects: vec![],
                socket: Some(dir.path().join("tmux.sock").to_string_lossy().into()),
            },
            control_path: dir.path().join("ssh"),
        };
        let f = Self {
            _dir: dir,
            transport,
        };
        f.command(&[
            "-f",
            "/dev/null",
            "new-session",
            "-d",
            "-s",
            "source",
            "-x",
            "100",
            "-y",
            "30",
        ]);
        f
    }
    fn command(&self, args: &[&str]) -> String {
        let output = Command::new("tmux")
            .args(["-S", self.transport.host.socket.as_ref().unwrap()])
            .args(args)
            .env_remove("TMUX")
            .output()
            .expect("tmux must be installed");
        assert!(
            output.status.success(),
            "tmux failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = Command::new("tmux")
            .args([
                "-S",
                self.transport.host.socket.as_ref().unwrap(),
                "kill-server",
            ])
            .output();
    }
}

#[tokio::test]
async fn viewer_zoom_and_cleanup_preserve_source_and_linked_windows() {
    let f = Fixture::new();
    f.command(&["split-window", "-h", "-t", "source"]);
    f.command(&["new-window", "-d", "-t", "source", "-n", "other"]);
    f.command(&["rename-window", "-t", "source:0", "odd ' name; $(literal)"]);
    let source = tmux::inventory(&f.transport)
        .await
        .unwrap()
        .sessions
        .remove(0);
    assert_eq!(source.windows.len(), 2);
    assert_eq!(source.windows[0].name, "odd ' name; $(literal)");
    let window = &source.windows[0];
    let viewer = tmux::create_viewer(&f.transport, &source.id, &window.id, 100, 30)
        .await
        .unwrap();
    assert_eq!(
        tmux::inventory(&f.transport).await.unwrap().sessions.len(),
        1
    );
    tmux::select_window(&f.transport, &viewer.id, &source.windows[1].id)
        .await
        .unwrap();
    assert_eq!(
        f.command(&["display-message", "-p", "-t", &source.id, "#{window_id}"]),
        window.id
    );
    tmux::select_window(&f.transport, &viewer.id, &window.id)
        .await
        .unwrap();
    let pane = &window.panes[0];
    tmux::pane_action(&f.transport, &viewer.id, &window.id, &pane.id, Some(true))
        .await
        .unwrap();
    tmux::pane_action(&f.transport, &viewer.id, &window.id, &pane.id, Some(true))
        .await
        .unwrap();
    assert_eq!(
        f.command(&[
            "display-message",
            "-p",
            "-t",
            &window.id,
            "#{window_zoomed_flag}"
        ]),
        "1"
    );
    tmux::pane_action(&f.transport, &viewer.id, &window.id, &pane.id, Some(false))
        .await
        .unwrap();
    assert_eq!(
        f.command(&[
            "display-message",
            "-p",
            "-t",
            &window.id,
            "#{window_zoomed_flag}"
        ]),
        "0"
    );
    assert!(
        tmux::pane_action(&f.transport, &viewer.id, &window.id, "%99999", None)
            .await
            .is_err()
    );
    // Even a mistaken cleanup ID cannot kill a normal session.
    tmux::cleanup(
        &f.transport,
        &tmux::Viewer {
            id: source.id.clone(),
            name: viewer.name.clone(),
        },
    )
    .await;
    tmux::cleanup(&f.transport, &viewer).await;
    let after = tmux::inventory(&f.transport).await.unwrap();
    assert_eq!(after.sessions.len(), 1);
    assert_eq!(after.sessions[0].windows.len(), 2);
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
async fn wait_state(socket: &mut Socket, window: &str) -> Value {
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            match socket.next().await.unwrap().unwrap() {
                Message::Binary(data) => socket
                    .send(Message::Text(
                        json!({"type":"ack", "bytes":data.len()}).to_string().into(),
                    ))
                    .await
                    .unwrap(),
                Message::Text(text) => {
                    let event: Value = serde_json::from_str(&text).unwrap();
                    assert_ne!(event["type"], "error", "{event}");
                    if event["type"] == "state"
                        && event["session"]["attached"] == true
                        && event["session"]["windows"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|w| w["id"] == window && w["active"] == true)
                    {
                        return event;
                    }
                }
                Message::Ping(data) => socket.send(Message::Pong(data)).await.unwrap(),
                other => panic!("unexpected websocket event {other:?}"),
            }
        }
    })
    .await
    .expect("terminal state timed out")
}

#[tokio::test(flavor = "multi_thread")]
async fn websocket_routes_input_switches_windows_resizes_and_survives_disconnect() {
    let f = Fixture::new();
    f.command(&["new-window", "-d", "-t", "source", "-n", "second"]);
    let source = tmux::inventory(&f.transport)
        .await
        .unwrap()
        .sessions
        .remove(0);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let mut state = AppState::new(
        Config {
            hosts: vec![f.transport.host.clone()],
        },
        port,
    )
    .unwrap();
    std::sync::Arc::get_mut(&mut state).unwrap().tailnet_address =
        Some("100.64.0.10:8080".parse().unwrap());
    let shutdown = state.shutdown.clone();
    let app = router(state, "web/dist".into());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let url = format!(
        "ws://127.0.0.1:{port}/api/v1/hosts/test/terminal?session={}&window={}&cols=100&rows=30",
        source.id, source.windows[0].id
    );
    let mut wrong_origin = url.clone().into_client_request().unwrap();
    wrong_origin
        .headers_mut()
        .insert("Origin", "http://evil.example".parse().unwrap());
    assert!(connect_async(wrong_origin).await.is_err());
    let mut tailnet_request = url.clone().into_client_request().unwrap();
    tailnet_request
        .headers_mut()
        .insert("Host", "100.64.0.10:8080".parse().unwrap());
    tailnet_request
        .headers_mut()
        .insert("Origin", "http://evil.example".parse().unwrap());
    assert!(connect_async(tailnet_request.clone()).await.is_err());
    tailnet_request
        .headers_mut()
        .insert("Origin", "http://100.64.0.10:8080".parse().unwrap());
    let (mut tailnet_socket, _) = connect_async(tailnet_request).await.unwrap();
    wait_state(&mut tailnet_socket, &source.windows[0].id).await;
    tailnet_socket.close(None).await.unwrap();
    wait_detached(&f).await;
    let mut request = url.into_client_request().unwrap();
    request.headers_mut().insert(
        "Origin",
        format!("http://127.0.0.1:{port}").parse().unwrap(),
    );
    let (mut socket, _) = connect_async(request.clone()).await.unwrap();
    wait_state(&mut socket, &source.windows[0].id).await;
    socket
        .send(Message::Binary(
            b"printf 'CC_FIRST_%s\\n' 123\r".to_vec().into(),
        ))
        .await
        .unwrap();
    socket
        .send(Message::Text(
            json!({"type":"select_window", "window":source.windows[1].id})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    wait_state(&mut socket, &source.windows[1].id).await;
    socket
        .send(Message::Binary(
            "printf 'CC_SECOND_é_%s\\n' 456\r"
                .as_bytes()
                .to_vec()
                .into(),
        ))
        .await
        .unwrap();
    socket
        .send(Message::Text(
            json!({"type":"resize", "cols":90, "rows":26})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let first = f.command(&["capture-pane", "-p", "-t", &source.windows[0].panes[0].id]);
            let second = f.command(&["capture-pane", "-p", "-t", &source.windows[1].panes[0].id]);
            if first.contains("CC_FIRST_123") && second.contains("CC_SECOND_é_456") {
                assert!(!first.contains("CC_SECOND_é_456"));
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        f.command(&["display-message", "-p", "-t", &source.id, "#{window_id}"]),
        source.windows[0].id
    );
    tokio::time::timeout(Duration::from_secs(5), async {
        while f.command(&["list-clients", "-F", "#{client_width}x#{client_height}"]) != "90x26" {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();
    socket.close(None).await.unwrap();
    drop(socket);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let sessions = f.command(&["list-sessions", "-F", "#{session_name}"]);
            if !sessions.contains(tmux::VIEWER_PREFIX) {
                assert_eq!(sessions, "source");
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("viewer not cleaned up");
    assert_eq!(
        tmux::inventory(&f.transport).await.unwrap().sessions[0]
            .windows
            .len(),
        2
    );
    // An unfinished line must remain unfinished: dropping portable-pty's
    // default Unix writer used to inject newline/EOF and exit a source shell.
    for _ in 0..5 {
        let (mut socket, _) = connect_async(request.clone()).await.unwrap();
        wait_state(&mut socket, &source.windows[0].id).await;
        socket
            .send(Message::Binary(
                b"\x15printf 'CC_DROP_%s\\n' BAD".to_vec().into(),
            ))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while !f
                .command(&["capture-pane", "-p", "-t", &source.windows[0].panes[0].id])
                .contains("CC_DROP_%s")
            {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        socket.close(None).await.unwrap();
        drop(socket);
        wait_detached(&f).await;
        let after = tmux::inventory(&f.transport).await.unwrap();
        assert_eq!(after.sessions[0].windows.len(), 2);
        assert!(
            !f.command(&["capture-pane", "-p", "-t", &source.windows[0].panes[0].id])
                .contains("CC_DROP_BAD")
        );
    }
    let (mut socket, _) = connect_async(request).await.unwrap();
    wait_state(&mut socket, &source.windows[0].id).await;
    let _ = shutdown.send(true);
    tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(Ok(message)) = socket.next().await {
            if matches!(message, Message::Close(_)) {
                break;
            }
        }
    })
    .await
    .expect("backend shutdown did not close terminal");
    wait_detached(&f).await;
    assert_eq!(
        tmux::inventory(&f.transport).await.unwrap().sessions[0]
            .windows
            .len(),
        2
    );
    server.abort();
}

async fn wait_detached(f: &Fixture) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while f
            .command(&["list-sessions", "-F", "#{session_name}"])
            .contains(tmux::VIEWER_PREFIX)
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("viewer was not cleaned up");
}
