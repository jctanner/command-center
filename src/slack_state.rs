//! CC-local Slack metadata. Never stores message text or writes to Slack.
use crate::{ApiError, AppState};
use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, io::Write, path::PathBuf, sync::Arc};

#[derive(Clone, Default, Deserialize, Serialize, PartialEq)]
pub(crate) struct ChannelState {
    pub read: Option<String>,
    pub latest: Option<String>,
    pub pinned: bool,
}
#[derive(Clone, Default, Deserialize, Serialize, PartialEq)]
pub(crate) struct ThreadState {
    channel: String,
    ts: String,
    followed: bool,
    read: Option<String>,
    latest: Option<String>,
    checked_at: u64,
    #[serde(default)]
    incomplete: bool,
}
#[derive(Clone, Default, Deserialize, Serialize, PartialEq)]
pub(crate) struct LocalState {
    pub scope: String,
    pub version: u64,
    pub channels: BTreeMap<String, ChannelState>,
    #[serde(default)]
    pub threads: BTreeMap<String, ThreadState>,
}
pub(crate) fn stamp(value: &str) -> Option<(u64, u32)> {
    let (seconds, fraction) = value.split_once('.')?;
    if !(8..=16).contains(&seconds.len())
        || fraction.len() != 6
        || !seconds
            .bytes()
            .chain(fraction.bytes())
            .all(|v| v.is_ascii_digit())
    {
        return None;
    }
    Some((seconds.parse().ok()?, fraction.parse().ok()?))
}
fn newer(a: &str, b: &str) -> bool {
    stamp(a) > stamp(b)
}
fn observe(local: &mut LocalState, id: &str, ts: &str) {
    if stamp(ts).is_none() || (!local.channels.contains_key(id) && local.channels.len() >= 1000) {
        return;
    }
    let entry = local.channels.entry(id.into()).or_default();
    if entry.read.is_none() {
        entry.read = Some(ts.into());
    }
    if entry.latest.as_deref().is_none_or(|old| newer(ts, old)) {
        entry.latest = Some(ts.into());
    }
}
pub(crate) async fn persist(path: Option<PathBuf>, value: &LocalState) -> Result<(), ApiError> {
    let Some(path) = path else {
        return Ok(());
    };
    let bytes = serde_json::to_vec(value).unwrap();
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(std::path::Path::new("."));
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        file.write_all(&bytes)?;
        file.as_file().sync_all()?;
        file.persist(path).map_err(|e| e.error)?;
        Ok(())
    })
    .await
    .map_err(|_| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not save Slack read positions".into(),
        )
    })?
    .map_err(|_| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not save Slack read positions".into(),
        )
    })
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Change {
    revision: String,
    connection_revision: String,
    action: String,
    channel: Option<String>,
    ts: Option<String>,
    pinned: Option<bool>,
    thread_ts: Option<String>,
    followed: Option<bool>,
}
pub(crate) async fn change(
    State(state): State<Arc<AppState>>,
    Json(body): Json<Change>,
) -> Result<Json<Value>, ApiError> {
    if !["get", "pin", "read", "follow", "thread_read"].contains(&body.action.as_str()) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Invalid Slack state action".into(),
        ));
    }
    update(
        &state,
        &body.revision,
        &body.connection_revision,
        None,
        Some(&body),
    )
    .await
    .map(Json)
}
pub(crate) async fn update(
    state: &AppState,
    revision: &str,
    connection: &str,
    observation: Option<&Value>,
    change: Option<&Change>,
) -> Result<Value, ApiError> {
    let settings = state.slack.settings.lock().await;
    if settings.revision != revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Slack source changed; reload settings".into(),
        ));
    }
    let source = settings.source.as_ref().ok_or_else(|| {
        ApiError(
            StatusCode::BAD_REQUEST,
            "Configure a Slack source first".into(),
        )
    })?;
    let machine = state.registry.get(&source.host).await?;
    if machine.connection_revision != connection {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Source connection changed; reload settings".into(),
        ));
    }
    let scope = format!(
        "{revision}/{}",
        crate::attention::scope(&machine.config, "", "", "").0
    );
    let mut stored = state.slack.local.lock().await;
    let mut next = if stored.scope == scope {
        stored.clone()
    } else {
        LocalState {
            scope,
            version: stored.version,
            ..Default::default()
        }
    };
    if let Some(data) = observation {
        if let Some(channels) = data["channels"].as_array() {
            for channel in channels {
                if let Some(id) = channel["id"].as_str() {
                    if next.channels.len() < 1000 {
                        next.channels.entry(id.into()).or_default();
                    }
                    if let Some(ts) = channel["latest"].as_str() {
                        observe(&mut next, id, ts);
                    }
                }
            }
        }
        // Search and thread previews never advance channel read metadata.
        if data["operation"] == "history"
            && let Some(messages) = data["messages"].as_array()
            && let Some((id, ts)) = messages
                .iter()
                .filter_map(|m| Some((m["channel"].as_str()?, m["ts"].as_str()?)))
                .max_by_key(|(_, ts)| stamp(ts))
        {
            observe(&mut next, id, ts);
        }
    }
    if let Some(data) = observation.filter(|v| v["operation"] == "thread")
        && let (Some(channel), Some(root), Some(messages)) = (
            data["thread_channel"].as_str(),
            data["thread_ts"].as_str(),
            data["messages"].as_array(),
        )
        && stamp(root).is_some()
    {
        let key = format!("{channel}/{root}");
        if !next.threads.contains_key(&key)
            && next.threads.len() >= 100
            && let Some(old) = next
                .threads
                .iter()
                .find(|(_, t)| !t.followed)
                .map(|(key, _)| key.clone())
        {
            next.threads.remove(&old);
        }
        let entry = next.threads.entry(key).or_insert_with(|| ThreadState {
            channel: channel.into(),
            ts: root.into(),
            ..Default::default()
        });
        let latest = messages
            .iter()
            .flat_map(|m| [m["ts"].as_str(), m["latest_reply"].as_str()])
            .flatten()
            .filter(|ts| stamp(ts).is_some())
            .max_by_key(|ts| stamp(ts));
        if let Some(latest) = latest {
            if entry.read.is_none() {
                entry.read = Some(latest.into());
            }
            if entry.latest.as_deref().is_none_or(|old| newer(latest, old)) {
                entry.latest = Some(latest.into());
            }
        }
        if let Some(root) = messages.iter().find(|m| m["ts"] == root) {
            entry.incomplete = data["next_cursor"].as_str().is_some_and(|c| !c.is_empty())
                && root["latest_reply"]
                    .as_str()
                    .is_none_or(|ts| stamp(ts).is_none());
        } else if data["next_cursor"].as_str().is_none_or(str::is_empty) {
            entry.incomplete = false;
        }
        entry.checked_at = entry
            .checked_at
            .max(data["checked_at"].as_u64().unwrap_or(0));
    }
    if let Some(change) = change.filter(|c| c.action == "follow" || c.action == "thread_read") {
        let channel = change
            .channel
            .as_deref()
            .ok_or_else(|| ApiError(StatusCode::BAD_REQUEST, "Missing thread channel".into()))?;
        let root = change
            .thread_ts
            .as_deref()
            .filter(|ts| stamp(ts).is_some())
            .ok_or_else(|| ApiError(StatusCode::BAD_REQUEST, "Invalid thread root".into()))?;
        let key = format!("{channel}/{root}");
        if change.action == "follow"
            && change.followed == Some(true)
            && next.threads.values().filter(|t| t.followed).count() >= 50
            && !next.threads.get(&key).is_some_and(|t| t.followed)
        {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "Follow up to 50 threads; unfollow one before adding another".into(),
            ));
        }
        let entry = next.threads.get_mut(&key).ok_or_else(|| {
            ApiError(
                StatusCode::BAD_REQUEST,
                "Open this thread before following or acknowledging it".into(),
            )
        })?;
        if change.action == "follow" {
            entry.followed = change
                .followed
                .ok_or_else(|| ApiError(StatusCode::BAD_REQUEST, "Missing follow state".into()))?;
        } else {
            let ts = change
                .ts
                .as_deref()
                .filter(|ts| stamp(ts).is_some())
                .ok_or_else(|| {
                    ApiError(StatusCode::BAD_REQUEST, "Invalid thread read cursor".into())
                })?;
            if entry
                .latest
                .as_deref()
                .is_none_or(|latest| newer(ts, latest))
            {
                return Err(ApiError(
                    StatusCode::CONFLICT,
                    "Read cursor exceeds observed thread replies".into(),
                ));
            }
            if entry.read.as_deref().is_none_or(|old| newer(ts, old)) {
                entry.read = Some(ts.into());
            }
        }
    }
    if let Some(change) = change.filter(|c| c.action == "pin" || c.action == "read") {
        let entry = change
            .channel
            .as_ref()
            .and_then(|id| next.channels.get_mut(id))
            .ok_or_else(|| {
                ApiError(
                    StatusCode::BAD_REQUEST,
                    "Open or load this channel before updating it".into(),
                )
            })?;
        if change.action == "pin" {
            entry.pinned = change
                .pinned
                .ok_or_else(|| ApiError(StatusCode::BAD_REQUEST, "Missing pin state".into()))?;
        } else {
            let ts = change
                .ts
                .as_deref()
                .filter(|ts| stamp(ts).is_some())
                .ok_or_else(|| {
                    ApiError(StatusCode::BAD_REQUEST, "Invalid read timestamp".into())
                })?;
            if entry
                .latest
                .as_deref()
                .is_none_or(|latest| newer(ts, latest))
            {
                return Err(ApiError(
                    StatusCode::CONFLICT,
                    "Read position exceeds observed Slack history".into(),
                ));
            }
            if entry.read.as_deref().is_none_or(|old| newer(ts, old)) {
                entry.read = Some(ts.into());
            }
        }
    }
    if next != *stored {
        next.version += 1;
        persist(state.slack.local_path.clone(), &next).await?;
        *stored = next;
    }
    Ok(serde_json::to_value(&*stored).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn metadata_survives_restart_without_content() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config.slack.json");
        let path = config.with_extension("state.json");
        let mut local = LocalState {
            scope: "source/connection".into(),
            ..Default::default()
        };
        observe(&mut local, "C000001", "1700000000.000001");
        local.channels.get_mut("C000001").unwrap().pinned = true;
        local.threads.insert(
            "C000001/1700000000.000001".into(),
            ThreadState {
                channel: "C000001".into(),
                ts: "1700000000.000001".into(),
                followed: true,
                read: Some("1700000001.000001".into()),
                latest: Some("1700000002.000001".into()),
                checked_at: 1700000003,
                incomplete: false,
            },
        );
        persist(Some(path.clone()), &local).await.unwrap();
        let restarted = crate::slack::Slack::new(Some(config)).unwrap();
        assert!(*restarted.local.lock().await == local);
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    #[test]
    fn baseline_and_monotonic_observation() {
        let mut local = LocalState::default();
        observe(&mut local, "C000001", "1700000000.000001");
        observe(&mut local, "C000001", "1700000001.000001");
        observe(&mut local, "C000001", "1699999999.000001");
        assert_eq!(
            local.channels["C000001"].read.as_deref(),
            Some("1700000000.000001")
        );
        assert_eq!(
            local.channels["C000001"].latest.as_deref(),
            Some("1700000001.000001")
        );
        assert!(stamp("1700000000.1234567").is_none());
        assert!(stamp("1700000000.00000x").is_none());
        assert!(newer("10000000000.000000", "9999999999.999999"));
    }
}
