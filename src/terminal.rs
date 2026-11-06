use crate::{tmux, transport::Transport};
use anyhow::{Context, Result, bail};
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{PtySize, native_pty_system};
use serde::Deserialize;
use serde_json::json;
use std::{
    io::{Read, Write},
    sync::Arc,
    time::Duration,
};
use tokio::sync::mpsc;

const OUTPUT_LIMIT: usize = 256 * 1024;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Control {
    Resize {
        cols: u16,
        rows: u16,
    },
    SelectWindow {
        window: String,
    },
    Focus {
        window: String,
        pane: String,
    },
    Zoom {
        window: String,
        pane: String,
        zoom: bool,
    },
    Ack {
        bytes: usize,
    },
}

enum PtyInput {
    Bytes(Vec<u8>),
    Resize(u16, u16),
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(2, 300),
        cols: cols.clamp(10, 500),
        pixel_width: 0,
        pixel_height: 0,
    }
}

// portable-pty's Unix take_writer() sends newline + VEOF from Drop. For a
// multiplexer that is live user input, not merely a transport close. Duplicate
// the master descriptor directly so every exit path closes without injecting
// keystrokes, including unwinding and failed attachment.
fn input_writer(master: &dyn portable_pty::MasterPty) -> Result<Box<dyn Write + Send>> {
    #[cfg(unix)]
    {
        use std::os::fd::FromRawFd;
        let fd = master.as_raw_fd().context("PTY has no master descriptor")?;
        // SAFETY: master owns this valid descriptor for the duration of fcntl.
        // F_DUPFD_CLOEXEC creates a new independently owned descriptor.
        let duplicate = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
        if duplicate < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        // SAFETY: duplicate is a successful, uniquely owned fcntl result.
        Ok(Box::new(unsafe { std::fs::File::from_raw_fd(duplicate) }))
    }
    #[cfg(not(unix))]
    {
        master.take_writer()
    }
}

async fn send(
    socket: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    message: Message,
) -> Result<()> {
    tokio::time::timeout(Duration::from_secs(5), socket.send(message))
        .await
        .context("slow terminal client")??;
    Ok(())
}

pub async fn serve(
    mut socket: WebSocket,
    transport: Arc<Transport>,
    session: String,
    window: String,
    cols: u16,
    rows: u16,
    shutdown: tokio::sync::watch::Receiver<bool>,
) {
    let viewer = match tmux::create_viewer(&transport, &session, &window, cols, rows).await {
        Ok(viewer) => viewer,
        Err(e) => {
            let _ = socket
                .send(Message::Text(
                    json!({"type":"error", "scope":"connection", "message":e.to_string()})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };
    if let Err(e) = stream(socket, transport.clone(), &viewer.id, cols, rows, shutdown).await {
        tracing::debug!(host = %transport.host.id, error = %e, "terminal disconnected");
    }
    tmux::cleanup(&transport, &viewer).await;
}

async fn stream(
    socket: WebSocket,
    transport: Arc<Transport>,
    viewer: &str,
    cols: u16,
    rows: u16,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<()> {
    if *shutdown.borrow() {
        return Ok(());
    }
    let command = transport.terminal_command(viewer)?;
    let (master, mut child, mut reader, mut writer) =
        tokio::task::spawn_blocking(move || -> Result<_> {
            let pair = native_pty_system().openpty(size(cols, rows))?;
            let child = pair.slave.spawn_command(command)?;
            drop(pair.slave);
            let reader = pair.master.try_clone_reader()?;
            let writer = input_writer(pair.master.as_ref())?;
            Ok((pair.master, child, reader, writer))
        })
        .await??;
    let mut killer = child.clone_killer();
    let (input_tx, mut input_rx) = mpsc::channel::<PtyInput>(32);
    let (output_tx, mut output_rx) = mpsc::channel::<Vec<u8>>(32);
    std::thread::spawn(move || {
        let mut buf = [0; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if output_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    std::thread::spawn(move || {
        while let Some(input) = input_rx.blocking_recv() {
            let result = match input {
                PtyInput::Bytes(bytes) => writer.write_all(&bytes),
                PtyInput::Resize(cols, rows) => master
                    .resize(size(cols, rows))
                    .map_err(std::io::Error::other),
            };
            if result.is_err() {
                break;
            }
        }
    });
    let (control_tx, mut control_rx) = mpsc::channel::<Control>(16);
    let (event_tx, mut event_rx) = mpsc::channel::<Message>(8);
    let worker_transport = transport.clone();
    let worker_viewer = viewer.to_owned();
    let worker = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(100));
        let mut attached = false;
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut previous = String::new();
        loop {
            let result = tokio::select! {
                control = control_rx.recv() => match control {
                    Some(Control::SelectWindow { window }) => tmux::select_window(&worker_transport, &worker_viewer, &window).await,
                    Some(Control::Focus { window, pane }) => tmux::pane_action(&worker_transport, &worker_viewer, &window, &pane, None).await,
                    Some(Control::Zoom { window, pane, zoom }) => tmux::pane_action(&worker_transport, &worker_viewer, &window, &pane, Some(zoom)).await,
                    None => break,
                    _ => Ok(()),
                },
                _ = interval.tick() => Ok(()),
            };
            if let Err(error) = result
                && event_tx
                    .send(Message::Text(
                        json!({"type":"error","message":error.to_string()})
                            .to_string()
                            .into(),
                    ))
                    .await
                    .is_err()
            {
                break;
            }
            match tmux::view(&worker_transport, &worker_viewer).await {
                Ok(state) => {
                    if state.attached && !attached {
                        attached = true;
                        interval = tokio::time::interval(Duration::from_secs(1));
                        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                        interval.reset();
                    }
                    let next = json!({"type":"state", "session":state}).to_string();
                    if next != previous {
                        if event_tx
                            .send(Message::Text(next.clone().into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                        previous = next;
                    }
                }
                Err(error) => {
                    let _ = event_tx
                        .send(Message::Text(
                            json!({"type":"error","scope":"connection","message":error.to_string()})
                                .to_string()
                                .into(),
                        ))
                        .await;
                    break;
                }
            }
        }
    });
    let (mut sink, mut source) = socket.split();
    let mut inflight = 0usize;
    let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
    let mut last_received = tokio::time::Instant::now();
    let result: Result<()> = async {
        loop {
            tokio::select! {
                _ = shutdown.changed() => break,
                data = output_rx.recv(), if inflight < OUTPUT_LIMIT => {
                    let Some(data) = data else { break; };
                    inflight += data.len();
                    send(&mut sink, Message::Binary(data.into())).await?;
                }
                event = event_rx.recv() => {
                    let Some(event) = event else { break; };
                    send(&mut sink, event).await?;
                }
                incoming = source.next() => {
                    let Some(incoming) = incoming else { break; };
                    last_received = tokio::time::Instant::now();
                    match incoming? {
                        Message::Binary(data) => input_tx.try_send(PtyInput::Bytes(data.to_vec())).context("terminal input queue full")?,
                        Message::Text(text) => match serde_json::from_str::<Control>(&text)? {
                            Control::Resize { cols, rows } => input_tx.try_send(PtyInput::Resize(cols, rows)).context("terminal input queue full")?,
                            Control::Ack { bytes } => {
                                if bytes > inflight { bail!("invalid terminal acknowledgement"); }
                                inflight -= bytes;
                            }
                            control => control_tx.try_send(control).context("too many terminal commands")?,
                        },
                        Message::Close(_) => break,
                        Message::Ping(data) => send(&mut sink, Message::Pong(data)).await?,
                        Message::Pong(_) => {},
                    }
                }
                _ = heartbeat.tick() => {
                    if last_received.elapsed() > Duration::from_secs(45) { bail!("terminal client timed out"); }
                    send(&mut sink, Message::Ping(Vec::new().into())).await?;
                }
            }
        }
        Ok(())
    }.await;
    worker.abort();
    drop(output_rx);
    // Detach the owned tmux client cleanly before closing an SSH PTY. Force
    // termination remains a fallback for a broken transport, never a pane kill.
    let _ = transport.run(&["detach-client", "-s", viewer]).await;
    let _ = killer.kill();
    drop(input_tx);
    tokio::task::spawn_blocking(move || {
        let _ = child.wait();
    });
    let _ = tokio::time::timeout(Duration::from_secs(1), sink.close()).await;
    result
}
