//! Observed unread activity, computed from CC metadata without fetching Slack content.
use crate::{ApiError, AppState, slack_state::stamp};
use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};

#[derive(Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Filter {
    #[default]
    All,
    Channels,
    Dms,
    Threads,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Query {
    revision: String,
    connection_revision: String,
    #[serde(default)]
    filter: Filter,
}
#[derive(Serialize)]
struct Item {
    id: String,
    kind: &'static str,
    channel: String,
    name: String,
    thread_ts: Option<String>,
    read: String,
    latest: String,
    pinned: bool,
    incomplete: bool,
}
fn unread(value: &Value) -> Option<(&str, &str)> {
    let read = value["read"].as_str()?;
    let latest = value["latest"].as_str()?;
    (stamp(latest)? > stamp(read)?).then_some((read, latest))
}
fn collect(metadata: &Value, names: &HashMap<String, String>) -> Vec<Item> {
    let mut items = Vec::new();
    if let Some(channels) = metadata["channels"].as_object() {
        for (id, value) in channels {
            if !id.starts_with(['C', 'G', 'D']) {
                continue;
            }
            if let Some((read, latest)) = unread(value) {
                let kind = if id.starts_with('D') { "dm" } else { "channel" };
                items.push(Item {
                    id: format!("{kind}/{id}"),
                    kind,
                    channel: id.clone(),
                    name: names.get(id).unwrap_or(id).clone(),
                    thread_ts: None,
                    read: read.into(),
                    latest: latest.into(),
                    pinned: value["pinned"] == true,
                    incomplete: false,
                });
            }
        }
    }
    if let Some(threads) = metadata["threads"].as_object() {
        for (key, value) in threads {
            if value["followed"] != true {
                continue;
            }
            if let Some((read, latest)) = unread(value)
                && let (Some(channel), Some(ts)) = (value["channel"].as_str(), value["ts"].as_str())
                && stamp(ts).is_some()
            {
                items.push(Item {
                    id: format!("thread/{key}"),
                    kind: "thread",
                    channel: channel.into(),
                    name: names
                        .get(channel)
                        .map(String::as_str)
                        .unwrap_or(channel)
                        .into(),
                    thread_ts: Some(ts.into()),
                    read: read.into(),
                    latest: latest.into(),
                    pinned: false,
                    incomplete: value["incomplete"] == true,
                });
            }
        }
    }
    items.sort_by(|a, b| {
        stamp(&b.latest)
            .cmp(&stamp(&a.latest))
            .then_with(|| a.id.cmp(&b.id))
    });
    items.truncate(1050);
    items
}
pub(crate) async fn snapshot(
    State(state): State<Arc<AppState>>,
    Json(query): Json<Query>,
) -> Result<Json<Value>, ApiError> {
    // Validate before cache access and again when taking the snapshot.
    crate::slack_state::update(
        &state,
        &query.revision,
        &query.connection_revision,
        None,
        None,
    )
    .await?;
    let names = state
        .slack
        .cached_names(&query.revision, &query.connection_revision)
        .await;
    let metadata = crate::slack_state::update(
        &state,
        &query.revision,
        &query.connection_revision,
        None,
        None,
    )
    .await?;
    let items = collect(&metadata, &names);
    let counts = json!({"all":items.len(),"channels":items.iter().filter(|i| i.kind=="channel").count(),"dms":items.iter().filter(|i| i.kind=="dm").count(),"threads":items.iter().filter(|i| i.kind=="thread").count()});
    let items: Vec<_> = items
        .into_iter()
        .filter(|i| match query.filter {
            Filter::All => true,
            Filter::Channels => i.kind == "channel",
            Filter::Dms => i.kind == "dm",
            Filter::Threads => i.kind == "thread",
        })
        .collect();
    Ok(Json(
        json!({"revision":query.revision,"connection_revision":query.connection_revision,"version":metadata["version"],"counts":counts,"items":items,"observed_only":true}),
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_observed_unread_and_followed_threads_are_aggregated() {
        let state = json!({"channels":{
            "C000001":{"read":"1700000000.000001","latest":"1700000001.000001"},
            "D000001":{"read":"1700000000.000001","latest":"1700000002.000001","pinned":true},
            "C000002":{"read":null,"latest":"1700000004.000001"},
            "C000003":{"read":"1700000005.000001","latest":"invalid"}},
            "threads":{
            "C000001/1700000000.000001":{"channel":"C000001","ts":"1700000000.000001","followed":true,"read":"1700000000.000001","latest":"1700000003.000001"},
            "ignored":{"channel":"C000001","ts":"1700000000.000001","followed":false,"read":"1700000000.000001","latest":"1700000009.000001"}}});
        let items = collect(&state, &HashMap::new());
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].kind, "thread");
        assert_eq!(items[1].kind, "dm");
        assert!(items[1].pinned);
        assert!(!serde_json::to_string(&items).unwrap().contains("text"));
    }
}
