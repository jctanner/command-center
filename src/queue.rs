//! Observed agent state. Provider evidence and inferred terminal prompts stay distinct.
use crate::{AppState, tmux};
use axum::{Json, extract::State};
use futures_util::{StreamExt, stream};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

#[derive(Default)]
pub(crate) struct Queue {
    cache: Mutex<Option<(Instant, u64, Snapshot)>>,
    epoch: AtomicU64,
}
impl Queue {
    pub(crate) fn invalidate(&self) {
        self.epoch.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut cache) = self.cache.try_lock() {
            *cache = None;
        }
    }
}
#[derive(Clone, Serialize)]
pub(crate) struct Snapshot {
    checked_at: u64,
    hosts: Vec<HostResult>,
}
#[derive(Clone, Serialize)]
struct HostResult {
    id: String,
    name: String,
    connection_revision: String,
    error: Option<String>,
    limited: bool,
    items: Vec<Item>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentState {
    Working,
    Ready,
    Approval,
    Unknown,
    Disconnected,
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Activity {
    pub state: AgentState,
    source: String,
    reason: String,
    evidence_at: Option<u64>,
    observed_at: u64,
    #[serde(default)]
    pub transition: Option<String>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
impl Activity {
    fn unknown(reason: &str) -> Self {
        Self {
            state: AgentState::Unknown,
            source: "none".into(),
            reason: reason.into(),
            evidence_at: None,
            observed_at: now(),
            transition: None,
        }
    }
    pub(crate) fn from_value(value: &serde_json::Value, context: &str) -> Self {
        let mut activity: Self = serde_json::from_value(value.clone())
            .unwrap_or_else(|_| Self::unknown("Provider status unavailable"));
        if activity.source != "pi_bridge" && prompt(context).is_some() {
            activity = Self {
                state: AgentState::Approval,
                source: "terminal_prompt".into(),
                reason: "Possible approval prompt detected in terminal output".into(),
                evidence_at: Some(now()),
                observed_at: now(),
                transition: None,
            };
        }
        activity
    }
}
#[derive(Clone, Serialize)]
struct Item {
    id: String,
    session: String,
    session_name: String,
    window: String,
    window_name: String,
    pane: String,
    project: String,
    agent: String,
    prompt: String,
    context: String,
    status: String,
    activity: Activity,
    last_seen: u64,
    attention: crate::attention::View,
    card: crate::agent_cards::Card,
    background_tasks: Value,
}
type PaneTarget = (String, String, String);
fn retain_disconnected(
    items: &mut Vec<Item>,
    previous: &[Item],
    at: u64,
    reason: &str,
    present: Option<&HashSet<PaneTarget>>,
) {
    for old in previous {
        if at.saturating_sub(old.last_seen) > 300
            || items.iter().any(|item| item.id == old.id)
            || present.is_some_and(|targets| {
                !targets.contains(&(old.session.clone(), old.window.clone(), old.pane.clone()))
            })
        {
            continue;
        }
        let mut item = old.clone();
        item.status = "disconnected".into();
        item.activity = Activity {
            state: AgentState::Disconnected,
            source: "transport".into(),
            reason: reason.into(),
            evidence_at: Some(old.last_seen),
            observed_at: at,
            transition: None,
        };
        items.push(item);
    }
}
pub(crate) fn prompt(text: &str) -> Option<String> {
    let lines: Vec<_> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    // Require a recognizable question and actual choices in the screen's tail.
    // General shell output, agent activity, and an idle input cursor aren't requests.
    let tail = &lines[lines.len().saturating_sub(16)..];
    let question = tail.iter().rposition(|line| {
        let l = line.to_lowercase();
        [
            "would you like",
            "do you want",
            "allow ",
            "approve",
            "permission",
            "proceed?",
            "(y/n)",
        ]
        .iter()
        .any(|s| l.contains(s))
    })?;
    let choices = tail[question..].iter().any(|l| {
        let l = l.trim_start_matches(['❯', '›', '>', ' ']);
        l.starts_with("1.") || l.starts_with("1)") || l.to_lowercase().contains("(y/n)")
    });
    let footer = tail.last()?.to_lowercase();
    let live = footer.contains("esc")
        || footer.contains("enter")
        || footer.contains("(y/n)")
        || footer.starts_with("2.")
        || footer.starts_with("3.")
        || footer.starts_with("2)")
        || footer.starts_with("3)");
    (choices && live).then(|| tail[question].chars().take(240).collect())
}
async fn hydrate(state: &AppState, mut snapshot: Snapshot) -> Snapshot {
    for host in &mut snapshot.hosts {
        for item in &mut host.items {
            item.attention = state.attention.view(&item.attention.key).await;
            item.attention.needs_attention =
                item.activity.state == AgentState::Approval || item.attention.unread();
        }
    }
    let scopes = snapshot
        .hosts
        .iter()
        .flat_map(|h| {
            h.items
                .iter()
                .map(|i| (i.attention.key.clone(), i.attention.instance.clone()))
        })
        .collect();
    if let Ok(cards) = crate::agent_cards::views(state, scopes).await {
        for (item, card) in snapshot
            .hosts
            .iter_mut()
            .flat_map(|h| h.items.iter_mut())
            .zip(cards)
        {
            item.card = card;
        }
    }
    snapshot
}
pub(crate) async fn snapshot(State(state): State<Arc<AppState>>) -> Json<Snapshot> {
    let mut cache = state.queue.cache.lock().await;
    if let Some((at, epoch, value)) = &*cache
        && *epoch == state.queue.epoch.load(Ordering::Relaxed)
        && at.elapsed() < Duration::from_secs(4)
    {
        return Json(hydrate(&state, value.clone()).await);
    }
    let previous = cache
        .as_ref()
        .map(|(_, _, snapshot)| snapshot.hosts.clone())
        .unwrap_or_default();
    let epoch = state.queue.epoch.load(Ordering::Relaxed);
    let hosts = state.registry.list().await.hosts;
    let results = stream::iter(hosts.into_iter().map(|host| {
        let state = state.clone();
        let before = previous.iter().find(|h| h.id == host.id && h.connection_revision == host.connection_revision).map(|h| h.items.clone()).unwrap_or_default();
        async move {
            let mut result = HostResult { id:host.id.clone(), name:host.name, connection_revision:host.connection_revision.clone(), error:None, limited:false, items:vec![] };
            let mut present=None;
            let scan = async {
                let machine = state.registry.get(&host.id).await.map_err(|e| anyhow::anyhow!(e.1))?;
                let inventory = tmux::inventory(&machine.transport).await?;
                present=Some(inventory.sessions.iter().flat_map(|s|s.windows.iter().flat_map(move|w|w.panes.iter().map(move|p|(s.id.clone(),w.id.clone(),p.id.clone())))).collect::<HashSet<PaneTarget>>());
                // One bounded process-discovery RPC per host, not per shell pane.
                // Keep the cheap tmux-name fallback for hosts without /proc support.
                let discovery=machine.transport.agent_request(json!({"action":"discover_agents"})).await;
                let mut providers=std::collections::HashMap::new();
                if let Ok(value)=discovery && let Some(agents)=value["ok"]["agents"].as_array() {
                    result.limited |= value["ok"]["limited"]==true;
                    for agent in agents.iter().take(256) {
                        if let (Some(pane),Some(provider))=(agent["pane"].as_str(),agent["provider"].as_str())
                            && matches!(provider,"codex"|"claude"|"pi") {
                            providers.insert(pane.to_owned(),provider.to_owned());
                        }
                    }
                } else { result.limited=true; }
                let mut seen = std::collections::HashSet::new();
                for session in inventory.sessions {
                    for window in session.windows {
                        for pane in window.panes {
                            let command = pane.command.to_lowercase();
                            let hinted=if command.contains("codex"){Some("codex")}else if command.contains("claude"){Some("claude")}else if command=="pi"||command=="pi-coding-agent"{Some("pi")}else{None};
                            let provider=providers.get(&pane.id).cloned().or_else(||hinted.map(str::to_owned));
                            let Some(provider)=provider else {continue;};
                            if !seen.insert(pane.id.clone()) { continue; }
                            if seen.len() > 32 { result.limited = true; continue; }
                            let (endpoint,attention_key)=crate::attention::scope(&machine.config,&session.id,&window.id,&pane.id);
                            let (watch,version)=state.attention.observation_args(&attention_key).await;
                            let observation = machine.transport.agent_request(json!({"action":"status", "session":session.id,"window":window.id,"pane":pane.id,"conversation":watch,"known_reply_version":version})).await;
                            let (context, activity, instance, reply, background_tasks) = match observation {
                                // A dead/replaced foreground process is retained below
                                // with its original last-seen time, never refreshed as live.
                                Ok(value) if value["status"] == 409 => continue,
                                Ok(value) if value.get("ok").is_some() => {
                                    let value = &value["ok"];
                                    let text = value["context"].as_str().unwrap_or("").to_owned();
                                    let activity = Activity::from_value(&value["activity"], &text);
                                    let instance=value["instance"].as_str().map(str::to_owned);
                                    let reply=serde_json::from_value::<crate::attention::Reply>(value["reply"].clone()).ok();
                                    (text, activity, instance, reply, value["background_tasks"].clone())
                                }
                                _ => (String::new(), Activity::unknown("Agent observation unavailable; refresh or open terminal"),None,None,Value::Null),
                            };
                            let attention=match state.attention.observe((&attention_key,&endpoint),instance.as_deref(),&activity,reply,true,None).await {
                                Ok(view)=>view,
                                Err(error)=>{result.error=Some(error.1);crate::attention::View::default()},
                            };
                            let detected = prompt(&context);
                            result.items.push(Item {
                                id:format!("{}/{}/{}/{}/{}",host.id,host.connection_revision,session.id,window.id,pane.id),
                                session:session.id.clone(), session_name:session.name.clone(), window:window.id.clone(), window_name:window.name.clone(),
                                pane:pane.id, project:pane.cwd, agent:provider,
                                status:if activity.state == AgentState::Approval {"attention"} else {"live"}.into(),
                                prompt:detected.unwrap_or_else(|| if activity.state == AgentState::Approval {if activity.source == "pi_bridge" {"Agent is waiting for input"} else {"Agent is awaiting approval"}} else {"Live agent"}.into()),
                                context:context.chars().take(24000).collect(), activity, last_seen:now(), attention,card:Default::default(),background_tasks,
                            });
                        }
                    }
                }
                Ok::<_, anyhow::Error>(())
            };
            match tokio::time::timeout(Duration::from_secs(13), scan).await {
                Ok(Ok(())) => {},
                Ok(Err(e)) => result.error = Some(e.to_string()),
                Err(_) => result.error = Some("Scan timed out".into()),
            }
            // Never retain observations across an endpoint edit or host removal.
            if !state.registry.get(&host.id).await.is_ok_and(|m| m.connection_revision == host.connection_revision) {
                result.items.clear(); result.error = Some("Machine changed; refreshing".into()); return result;
            }
            let reason = if result.error.is_some() { "Machine unavailable; showing last observed agent" } else if result.limited { "Agent was not observed within the scan limit" } else { "Agent is no longer foreground in this pane" };
            retain_disconnected(&mut result.items, &before, now(), reason,present.as_ref());
            result
        }
    })).buffer_unordered(4).collect().await;
    let snapshot = Snapshot {
        checked_at: now(),
        hosts: results,
    };
    *cache = Some((Instant::now(), epoch, snapshot.clone()));
    Json(hydrate(&state, snapshot).await)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disconnection_keeps_last_seen_and_expires_without_refreshing_it() {
        let item = Item {
            id: "target".into(),
            session: "$0".into(),
            session_name: "s".into(),
            window: "@0".into(),
            window_name: "w".into(),
            pane: "%0".into(),
            project: "/tmp".into(),
            agent: "codex".into(),
            prompt: "Live agent".into(),
            context: String::new(),
            status: "live".into(),
            activity: Activity::unknown("No evidence"),
            last_seen: 100,
            attention: crate::attention::View::default(),
            card: Default::default(),
            background_tasks: Value::Null,
        };
        let mut items = vec![];
        retain_disconnected(
            &mut items,
            std::slice::from_ref(&item),
            200,
            "Host offline",
            None,
        );
        assert_eq!(items[0].activity.state, AgentState::Disconnected);
        assert_eq!(items[0].last_seen, 100);
        let mut expired = vec![];
        retain_disconnected(&mut expired, &items, 401, "Host offline", None);
        assert!(expired.is_empty());
        let mut live = vec![item.clone()];
        retain_disconnected(&mut live, &items, 201, "Host offline", None);
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].activity.state, AgentState::Unknown);
    }
    #[test]
    fn confirmed_deleted_targets_are_not_retained_but_probe_failures_are() {
        let old = Item {
            id: "old".into(),
            session: "$1".into(),
            session_name: "work".into(),
            window: "@1".into(),
            window_name: "agent".into(),
            pane: "%1".into(),
            project: "/tmp".into(),
            agent: "codex".into(),
            prompt: "Live agent".into(),
            context: String::new(),
            status: "live".into(),
            activity: Activity::unknown("Unavailable"),
            last_seen: 100,
            attention: Default::default(),
            card: Default::default(),
            background_tasks: Value::Null,
        };
        let mut missing = vec![];
        retain_disconnected(
            &mut missing,
            std::slice::from_ref(&old),
            101,
            "Unavailable",
            Some(&HashSet::new()),
        );
        assert!(missing.is_empty());
        let present = HashSet::from([("$1".into(), "@1".into(), "%1".into())]);
        let mut existing = vec![];
        retain_disconnected(
            &mut existing,
            std::slice::from_ref(&old),
            101,
            "Probe failed",
            Some(&present),
        );
        assert_eq!(existing.len(), 1);
        assert_eq!(existing[0].activity.state, AgentState::Disconnected);
        let wrong_session = HashSet::from([("$2".into(), "@1".into(), "%1".into())]);
        let mut moved = vec![];
        retain_disconnected(&mut moved, &[old], 101, "Moved", Some(&wrong_session));
        assert!(moved.is_empty());
    }
    #[test]
    fn native_pi_status_is_not_overridden_by_old_terminal_prompts() {
        let activity = Activity::from_value(
            &json!({"state":"working","source":"pi_bridge","reason":"Native bridge","observed_at":1}),
            "Do you want to proceed? (y/n)",
        );
        assert_eq!(activity.state, AgentState::Working);
    }
    #[test]
    fn requires_choices_and_live_footer() {
        assert!(
            prompt("Would you like to run this command?\n❯ 1. Yes\n  2. No\nEsc to cancel")
                .is_some()
        );
        assert!(prompt("Do you want to proceed? (y/n)").is_some());
        assert!(prompt("Would you like to run this command?\n1. Yes\n2. No\nNow executing tests\nTests passed").is_none());
        assert!(prompt("Agent idle\n› ").is_none());
        assert!(prompt("permission denied").is_none());
    }
}
