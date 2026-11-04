use crate::transport::Transport;
use anyhow::{Result, bail, ensure};
use serde::Serialize;

pub const VIEWER_PREFIX: &str = "cc-view-";
// Strip control characters from labels so a user-controlled name cannot inject
// rows/fields into the inventory protocol. Names are never used as targets.
const FORMAT: &str = "#{session_id}\t#{s/[\u{1}-\u{1f}\u{7f}]/?/:session_name}\t#{window_id}\t#{window_index}\t#{s/[\u{1}-\u{1f}\u{7f}]/?/:window_name}\t#{window_width}\t#{window_height}\t#{window_zoomed_flag}\t#{window_active}\t#{pane_id}\t#{pane_index}\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}\t#{pane_active}\t#{s/[\u{1}-\u{1f}\u{7f}]/?/:pane_current_command}\t#{session_attached}\t#{n:pane_current_path}\t#{pane_current_path}";

#[derive(Clone, Debug, Serialize)]
pub struct Pane {
    pub id: String,
    pub index: u32,
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
    pub active: bool,
    pub command: String,
    pub cwd: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Window {
    pub id: String,
    pub index: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub zoomed: bool,
    pub active: bool,
    pub panes: Vec<Pane>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Session {
    pub attached: bool,
    pub id: String,
    pub name: String,
    pub windows: Vec<Window>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Inventory {
    pub sessions: Vec<Session>,
}

pub fn valid_id(value: &str, prefix: char) -> bool {
    value.starts_with(prefix) && value.len() > 1 && value[1..].bytes().all(|c| c.is_ascii_digit())
}

pub fn parse_inventory(text: &str, include_viewers: bool) -> Result<Inventory> {
    let mut sessions: Vec<Session> = Vec::new();
    let mut remaining = text;
    while !remaining.is_empty() {
        let mut f = Vec::with_capacity(19);
        for _ in 0..19 {
            let (field, rest) = remaining
                .split_once('\t')
                .ok_or_else(|| anyhow::anyhow!("invalid tmux inventory record"))?;
            f.push(field);
            remaining = rest;
        }
        let length: usize = f[18].parse()?;
        ensure!(length <= 32768, "invalid working directory length");
        let cwd = remaining
            .get(..length)
            .ok_or_else(|| anyhow::anyhow!("invalid working directory encoding"))?;
        remaining = remaining
            .get(length..)
            .and_then(|s| s.strip_prefix('\n'))
            .ok_or_else(|| anyhow::anyhow!("invalid tmux record terminator"))?;
        ensure!(
            valid_id(f[0], '$') && valid_id(f[2], '@') && valid_id(f[9], '%'),
            "invalid tmux identity"
        );
        if !include_viewers && f[1].starts_with(VIEWER_PREFIX) {
            continue;
        }
        let si = match sessions.iter().position(|s| s.id == f[0]) {
            Some(i) => i,
            None => {
                sessions.push(Session {
                    id: f[0].into(),
                    name: f[1].into(),
                    attached: f[17] != "0",
                    windows: vec![],
                });
                sessions.len() - 1
            }
        };
        let session = &mut sessions[si];
        let wi = match session.windows.iter().position(|w| w.id == f[2]) {
            Some(i) => i,
            None => {
                session.windows.push(Window {
                    id: f[2].into(),
                    index: f[3].parse()?,
                    name: f[4].into(),
                    width: f[5].parse()?,
                    height: f[6].parse()?,
                    zoomed: f[7] == "1",
                    active: f[8] == "1",
                    panes: vec![],
                });
                session.windows.len() - 1
            }
        };
        session.windows[wi].panes.push(Pane {
            id: f[9].into(),
            index: f[10].parse()?,
            left: f[11].parse()?,
            top: f[12].parse()?,
            width: f[13].parse()?,
            height: f[14].parse()?,
            active: f[15] == "1",
            command: f[16].into(),
            cwd: cwd.into(),
        });
    }
    for s in &mut sessions {
        s.windows.sort_by_key(|w| w.index);
        for w in &mut s.windows {
            w.panes.sort_by_key(|p| p.index);
        }
    }
    Ok(Inventory { sessions })
}

pub async fn inventory(transport: &Transport) -> Result<Inventory> {
    match transport.run(&["list-panes", "-a", "-F", FORMAT]).await {
        Ok(text) => parse_inventory(&text, false),
        Err(e)
            if e.to_string().contains("no server running")
                || e.to_string().contains("No such file or directory")
                    && e.to_string().contains("connecting to") =>
        {
            Ok(Inventory { sessions: vec![] })
        }
        Err(e) => Err(e),
    }
}

pub async fn view(transport: &Transport, viewer: &str) -> Result<Session> {
    let text = transport
        .run(&["list-panes", "-s", "-t", viewer, "-F", FORMAT])
        .await?;
    parse_inventory(&text, true)?
        .sessions
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("viewer session closed"))
}

#[derive(Debug)]
pub struct Viewer {
    pub id: String,
    pub name: String,
}

pub async fn create_viewer(
    transport: &Transport,
    session: &str,
    window: &str,
    cols: u16,
    rows: u16,
) -> Result<Viewer> {
    ensure!(
        valid_id(session, '$') && valid_id(window, '@'),
        "invalid session or window id"
    );
    let source = inventory(transport).await?;
    ensure!(
        source
            .sessions
            .iter()
            .any(|s| s.id == session && s.windows.iter().any(|w| w.id == window)),
        "session/window no longer exists"
    );
    let name = format!("{VIEWER_PREFIX}{}", uuid::Uuid::new_v4().simple());
    let viewer = transport
        .run(&[
            "new-session",
            "-d",
            "-t",
            session,
            "-s",
            &name,
            "-x",
            &cols.to_string(),
            "-y",
            &rows.to_string(),
            "-P",
            "-F",
            "#{session_id}",
        ])
        .await?
        .trim()
        .to_owned();
    ensure!(valid_id(&viewer, '$'), "invalid viewer session id");
    let setup = transport
        .run(&[
            "set-option",
            "-t",
            &viewer,
            "status",
            "off",
            ";",
            "set-option",
            "-t",
            &viewer,
            "mouse",
            "on",
            ";",
            "select-window",
            "-t",
            &format!("{viewer}:{window}"),
        ])
        .await;
    let viewer = Viewer { id: viewer, name };
    if let Err(e) = setup {
        cleanup(transport, &viewer).await;
        return Err(e);
    }
    Ok(viewer)
}

pub async fn cleanup(transport: &Transport, viewer: &Viewer) {
    // The only caller-supplied target here is an ID returned by create_viewer.
    // Verify ownership again so cleanup can never kill an ordinary user session.
    if let Ok(name) = transport
        .run(&["display-message", "-p", "-t", &viewer.id, "#{session_name}"])
        .await
        && name.trim() == viewer.name
    {
        let _ = transport.run(&["kill-session", "-t", &viewer.id]).await;
    }
}

pub async fn select_window(transport: &Transport, viewer: &str, window: &str) -> Result<()> {
    ensure!(valid_id(window, '@'), "invalid window id");
    let state = view(transport, viewer).await?;
    ensure!(
        state.windows.iter().any(|w| w.id == window),
        "window is not in this session"
    );
    transport
        .run(&["select-window", "-t", &format!("{viewer}:{window}")])
        .await?;
    Ok(())
}

pub async fn pane_action(
    transport: &Transport,
    viewer: &str,
    window: &str,
    pane: &str,
    zoom: Option<bool>,
) -> Result<()> {
    ensure!(
        valid_id(window, '@') && valid_id(pane, '%'),
        "invalid window or pane id"
    );
    let state = view(transport, viewer).await?;
    let Some(w) = state.windows.iter().find(|w| w.id == window && w.active) else {
        bail!("window changed; try again");
    };
    ensure!(
        w.panes.iter().any(|p| p.id == pane),
        "pane is not in this window"
    );
    let target = format!("{viewer}:{window}.{pane}");
    match zoom {
        None => {
            transport.run(&["select-pane", "-t", &target]).await?;
        }
        Some(zoom) => {
            // Evaluate and toggle inside tmux's command queue, making repeated
            // zoom=true requests idempotent even across multiple web clients.
            let condition = format!("#{{!=:#{{window_zoomed_flag}},{}}}", u8::from(zoom));
            let command = format!("resize-pane -Z -t {target}");
            transport
                .run(&["if-shell", "-F", "-t", &target, &condition, &command])
                .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_session_membership_for_linked_windows() {
        let text = "$1\twork\t@3\t0\tshell\t80\t24\t0\t1\t%9\t0\t0\t0\t80\t24\t1\tbash\t0\t4\t/tmp\n$2\tother\t@3\t4\tshell\t80\t24\t0\t1\t%9\t0\t0\t0\t80\t24\t1\tbash\t0\t4\t/tmp\n$3\tcc-view-test\t@3\t0\tshell\t80\t24\t0\t1\t%9\t0\t0\t0\t80\t24\t1\tbash\t0\t4\t/tmp\n";
        let inv = parse_inventory(text, false).unwrap();
        assert_eq!(inv.sessions.len(), 2);
        assert_eq!(inv.sessions[0].windows[0].id, inv.sessions[1].windows[0].id);
        assert_eq!(inv.sessions[1].windows[0].index, 4);
    }
    #[test]
    fn rejects_targets_that_could_be_commands() {
        assert!(!valid_id("@1; kill-server", '@'));
        assert!(!valid_id("@", '@'));
        assert!(!valid_id("%1", '@'));
        assert!(valid_id("@123", '@'));
    }
    #[test]
    fn malformed_inventory_is_an_error_not_an_empty_success() {
        assert!(parse_inventory("broken", false).is_err());
    }
}

#[cfg(test)]
mod cwd_tests {
    use super::*;
    #[test]
    fn inventory_framing_preserves_unicode_and_embedded_record_separators() {
        let cwd = "/tmp/café ' tab\tline\nnext"
            .replace("\\t", "\t")
            .replace("\\n", "\n");
        let row = format!(
            "$1\twork\t@3\t0\tshell\t80\t24\t0\t1\t%9\t0\t0\t0\t80\t24\t1\tbash\t0\t{}\t{}\n",
            cwd.len(),
            cwd
        );
        let inv = parse_inventory(&row.repeat(2), false).unwrap();
        assert_eq!(inv.sessions[0].windows[0].panes[0].cwd, cwd);
    }
}
