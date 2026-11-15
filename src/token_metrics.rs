//! Bounded numeric-only accounting; never cache transcript text or infer model limits.
use crate::transport::Transport;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;
const MAX: u64 = 9_007_199_254_740_991;
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
struct Counts {
    input: Option<u64>,
    output: Option<u64>,
    cached_input: Option<u64>,
    cache_write: Option<u64>,
    reasoning_output: Option<u64>,
    total: Option<u64>,
}
impl Counts {
    fn safe(&mut self) {
        for v in [
            &mut self.input,
            &mut self.output,
            &mut self.cached_input,
            &mut self.cache_write,
            &mut self.reasoning_output,
            &mut self.total,
        ] {
            if v.is_some_and(|v| v > MAX) {
                *v = None;
            }
        }
    }
    fn merge(&mut self, new: &Self) {
        for (old, new) in [
            (&mut self.input, new.input),
            (&mut self.output, new.output),
            (&mut self.cached_input, new.cached_input),
            (&mut self.cache_write, new.cache_write),
            (&mut self.reasoning_output, new.reasoning_output),
            (&mut self.total, new.total),
        ] {
            if new.is_some() {
                *old = new;
            }
        }
    }
}
#[derive(Clone, Default, Deserialize)]
#[serde(default)]
struct Node {
    billable: bool,
    id: String,
    parent: Option<String>,
    usage: Option<Counts>,
    context: bool,
    invalidate: bool,
    model: Option<String>,
    window: Option<u64>,
    recorded_at: Option<String>,
}
#[derive(Default, Deserialize)]
#[serde(default)]
struct Batch {
    source: String,
    provider: String,
    conversation: String,
    instance: Option<String>,
    association: String,
    cursor: Value,
    records: Vec<Node>,
    snapshot: Option<Counts>,
    context: Option<Context>,
    context_invalidated: bool,
    model: Option<String>,
    recorded_at: Option<String>,
    complete: bool,
    gap: bool,
    reset: bool,
    leaf: Value,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
struct Context {
    used: Option<u64>,
    window: Option<u64>,
}
#[derive(Default)]
struct Entry {
    source: String,
    provider: String,
    conversation: String,
    instance: Option<String>,
    association: String,
    cursor: Value,
    nodes: HashMap<String, Node>,
    snapshot: Option<Counts>,
    context: Option<Node>,
    model: Option<String>,
    reported_at: Option<String>,
    leaf: Option<String>,
    complete: bool,
    gap: bool,
    limited: bool,
}
impl Entry {
    fn apply(&mut self, mut b: Batch) {
        if b.source.len() != 64
            || !matches!(b.provider.as_str(), "codex" | "claude" | "pi")
            || b.records.len() > 256
        {
            *self = Self::default();
            return;
        }
        if b.reset || self.source != b.source {
            *self = Self::default();
        }
        self.source = b.source;
        self.provider = b.provider;
        self.conversation = b.conversation;
        self.instance = b.instance;
        self.association = b.association;
        self.cursor = b.cursor;
        self.complete = b.complete;
        self.gap |= b.gap;
        if self.provider == "codex" {
            if let Some(mut snapshot) = b.snapshot {
                snapshot.safe();
                self.snapshot = Some(snapshot);
                self.reported_at = b.recorded_at.clone();
            }
            if b.context_invalidated {
                self.context = None;
            }
            let reported_context = b.context.is_some();
            if let Some(c) = b.context {
                self.context = Some(Node {
                    usage: Some(Counts {
                        total: c.used.filter(|v| *v <= MAX),
                        ..Default::default()
                    }),
                    window: c.window.filter(|v| *v > 0 && *v <= MAX),
                    recorded_at: b.recorded_at.clone(),
                    ..Default::default()
                });
            }
            if reported_context || b.context_invalidated {
                self.model = b
                    .model
                    .filter(|v| v.len() <= 200 && !v.chars().any(char::is_control));
            }
            return;
        }
        for mut node in b.records.drain(..) {
            if node.id.is_empty()
                || node.id.len() > 200
                || node.parent.as_ref().is_some_and(|v| v.len() > 200)
            {
                self.gap = true;
                continue;
            }
            let reported = node.usage.is_some();
            if let Some(usage) = node.usage.as_mut() {
                usage.safe();
            }
            node.model = node
                .model
                .filter(|v| v.len() <= 200 && !v.chars().any(char::is_control));
            node.recorded_at = node
                .recorded_at
                .filter(|v| v.len() <= 64 && !v.chars().any(char::is_control));
            node.window = node.window.filter(|v| *v > 0 && *v <= MAX);
            if self.provider == "pi" && self.nodes.contains_key(&node.id) {
                self.gap = true;
            }
            if let Some(old) = self.nodes.get(&node.id).and_then(|n| n.usage.as_ref()) {
                let mut merged = old.clone();
                if let Some(new) = node.usage.as_ref() {
                    merged.merge(new);
                }
                node.usage = Some(merged);
            }
            if self.provider == "claude"
                && let Some(c) = node.usage.as_mut()
                && let (Some(input), Some(output), Some(read), Some(write)) =
                    (c.input, c.output, c.cached_input, c.cache_write)
            {
                c.total = input
                    .checked_add(output)
                    .and_then(|n| n.checked_add(read))
                    .and_then(|n| n.checked_add(write))
                    .filter(|n| *n <= MAX);
            }
            if node.invalidate {
                self.context = None;
            }
            if node.context && reported {
                self.context = Some(node.clone());
            }
            if self.nodes.len() >= 4096 && !self.nodes.contains_key(&node.id) {
                self.limited = true;
                continue;
            }
            self.nodes.insert(node.id.clone(), node);
        }
        self.leaf = if b.leaf == json!(false) {
            self.cursor["last_id"].as_str().map(str::to_owned)
        } else {
            b.leaf.as_str().map(str::to_owned)
        };
    }
    fn totals(&self) -> Counts {
        if let Some(c) = &self.snapshot {
            return c.clone();
        }
        let billed: Vec<_> = self.nodes.values().filter(|v| v.billable).collect();
        if billed.iter().any(|v| v.usage.is_none()) {
            return Counts::default();
        }
        let values: Vec<_> = billed
            .into_iter()
            .filter_map(|v| v.usage.as_ref())
            .collect();
        if values.is_empty() {
            return Counts::default();
        }
        fn sum(values: &[&Counts], get: fn(&Counts) -> Option<u64>) -> Option<u64> {
            values
                .iter()
                .try_fold(0u64, |a, v| a.checked_add(get(v)?).filter(|v| *v <= MAX))
        }
        Counts {
            input: sum(&values, |v| v.input),
            output: sum(&values, |v| v.output),
            cached_input: sum(&values, |v| v.cached_input),
            cache_write: sum(&values, |v| v.cache_write),
            reasoning_output: sum(&values, |v| v.reasoning_output),
            total: sum(&values, |v| v.total),
        }
    }
    fn context(&self) -> Option<&Node> {
        if self.provider != "pi" {
            return self.context.as_ref();
        }
        let mut id = self.leaf.as_deref();
        let mut seen = HashSet::new();
        while let Some(key) = id {
            if !seen.insert(key) {
                return None;
            }
            let node = self.nodes.get(key)?;
            if node.invalidate {
                return None;
            }
            if node.context && node.usage.is_some() {
                return Some(node);
            }
            id = node.parent.as_deref();
        }
        None
    }
    fn view(&self) -> Value {
        if self.source.is_empty() {
            return Value::Null;
        }
        let complete = self.complete && !self.gap && !self.limited;
        let totals = if complete {
            self.totals()
        } else {
            Counts::default()
        };
        let context = if complete { self.context() } else { None };
        let note = if self.limited {
            "Session exceeds bounded accounting capacity; totals unknown"
        } else if self.gap {
            "Some native records could not be accounted for; totals unknown"
        } else if !self.complete {
            "Reading session usage incrementally"
        } else if totals.total.is_none() {
            "Not all token counts are reported by this harness"
        } else {
            "Native reported usage; context is the last reported request, not a live estimate"
        };
        json!({"source":format!("{}_native_usage",self.provider),"provider":self.provider,"conversation":self.conversation,"instance":self.instance,"association":self.association,"stale":false,"complete":complete,"limited":self.limited||self.gap,"session":totals,"input_includes_cache":self.provider=="codex","context":{"used":context.and_then(|c|c.usage.as_ref()).and_then(|c|c.total),"window":context.and_then(|c|c.window),"reported_at":context.and_then(|c|c.recorded_at.clone()).or_else(||self.reported_at.clone())},"model":context.and_then(|c|c.model.clone()).or_else(||self.model.clone()),"observed_at":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),"note":note})
    }
}
struct Slot {
    entry: Arc<Mutex<Entry>>,
    used: Instant,
}
#[derive(Default)]
pub(crate) struct Metrics {
    slots: Mutex<HashMap<String, Slot>>,
}
impl Metrics {
    pub(crate) async fn observe(
        &self,
        connection: &str,
        transport: &Transport,
        mut request: Value,
    ) -> anyhow::Result<Value> {
        let key = format!(
            "{connection}/{}/{}/{}/{}/{}",
            request["session"],
            request["window"],
            request["pane"],
            request["action"],
            request["conversation"]
        );
        let slot = {
            let mut slots = self.slots.lock().await;
            slots.retain(|_, v| {
                v.used.elapsed().as_secs() < 1800 || Arc::strong_count(&v.entry) > 1
            });
            if !slots.contains_key(&key)
                && slots.len() >= 64
                && let Some(old) = slots
                    .iter()
                    .filter(|(_, v)| Arc::strong_count(&v.entry) == 1)
                    .min_by_key(|(_, v)| v.used)
                    .map(|(k, _)| k.clone())
            {
                slots.remove(&old);
            }
            if !slots.contains_key(&key) && slots.len() >= 64 {
                None
            } else {
                let slot = slots.entry(key).or_insert_with(|| Slot {
                    entry: Arc::new(Mutex::new(Entry::default())),
                    used: Instant::now(),
                });
                slot.used = Instant::now();
                Some(slot.entry.clone())
            }
        };
        let Some(slot) = slot else {
            return transport.agent_request(request).await;
        };
        let mut entry = slot.lock().await;
        request["_collect_token_metrics"] = json!(true);
        request["_token_cursor"] = entry.cursor.clone();
        let mut response = transport.agent_request(request).await?;
        if let Some(ok) = response.get_mut("ok").filter(|v| v.is_object()) {
            let batch = ok
                .as_object_mut()
                .unwrap()
                .remove("_token_metrics")
                .unwrap_or(Value::Null);
            if let Ok(batch) = serde_json::from_value::<Batch>(batch) {
                entry.apply(batch);
            } else {
                *entry = Entry::default();
            }
            ok["token_metrics"] = entry.view();
        }
        Ok(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn batch(provider: &str, records: Value) -> Batch {
        serde_json::from_value(json!({"source":"a".repeat(64),"provider":provider,"conversation":"native-conversation","instance":"process","association":"process","complete":true,"cursor":{"offset":1,"last_id":"leaf"},"records":records})).unwrap()
    }
    fn node(id: &str, total: u64) -> Value {
        json!({"id":id,"billable":true,"context":true,"usage":{"input":total-10,"output":10,"cached_input":0,"cache_write":0,"total":total},"model":"reported-model"})
    }
    #[test]
    fn claude_updates_one_native_message_without_double_counting_or_inventing_missing_fields() {
        let mut e = Entry::default();
        e.apply(batch("claude", json!([node("message", 100)])));
        e.apply(batch(
            "claude",
            json!([{"id":"message","billable":true,"context":true,"usage":{"output":20}}]),
        ));
        assert_eq!(e.view()["session"]["total"], 110);
        e.apply(batch(
            "claude",
            json!([node("message", 120), node("next", 30)]),
        ));
        let v = e.view();
        assert_eq!(v["session"]["total"], 150);
        assert_eq!(v["session"]["input"], 130);
        assert_eq!(v["context"]["used"], 30);
        assert!(v["context"]["window"].is_null());
        e.apply(batch(
            "claude",
            json!([{"id":"missing","billable":true,"context":true}]),
        ));
        assert!(e.view()["session"]["total"].is_null());
        assert_eq!(e.view()["context"]["used"], 30);
    }
    #[test]
    fn codex_snapshots_cache_subset_and_compaction_are_not_summed_or_guessed() {
        let mut e = Entry::default();
        let mut b = batch("codex", json!([]));
        b.snapshot = Some(Counts {
            input: Some(2000),
            cached_input: Some(1900),
            output: Some(10),
            total: Some(2010),
            ..Default::default()
        });
        b.context = Some(Context {
            used: Some(142000),
            window: Some(400000),
        });
        b.model = Some("reported-model".into());
        e.apply(b);
        assert_eq!(e.view()["model"], "reported-model");
        let v = e.view();
        assert_eq!(v["session"]["total"], 2010);
        assert_eq!(v["context"]["window"], 400000);
        assert_eq!(v["input_includes_cache"], true);
        let mut b = batch("codex", json!([]));
        b.context_invalidated = true;
        e.apply(b);
        assert!(e.view()["context"]["used"].is_null());
        assert_eq!(e.view()["session"]["total"], 2010);
    }
    #[test]
    fn pi_totals_include_abandoned_work_but_context_follows_only_the_active_branch() {
        let mut a = node("a", 100);
        a["parent"] = Value::Null;
        let mut b = node("b", 200);
        b["parent"] = json!("a");
        let mut leaf = json!({"id":"leaf","parent":"a"});
        let mut e = Entry::default();
        let mut initial = batch("pi", json!([a, b, leaf]));
        initial.leaf = json!("leaf");
        e.apply(initial);
        assert_eq!(e.view()["session"]["total"], 300);
        assert_eq!(e.view()["context"]["used"], 100);
        leaf = json!({"id":"compacted","parent":"leaf","invalidate":true,"billable":true,"usage":{"total":20}});
        let mut b = batch("pi", json!([leaf]));
        b.leaf = json!("compacted");
        e.apply(b);
        assert!(e.view()["context"]["used"].is_null());
        assert_eq!(e.view()["session"]["total"], 320);
        let mut b = batch("pi", json!([]));
        b.leaf = Value::Null;
        e.apply(b);
        assert!(e.view()["context"]["used"].is_null());
    }
    #[test]
    fn incomplete_gapped_replaced_and_capacity_limited_sessions_never_claim_full_totals() {
        let mut e = Entry::default();
        let mut b = batch("claude", json!([node("first", 100)]));
        b.complete = false;
        e.apply(b);
        assert!(e.view()["session"]["total"].is_null());
        e.apply(batch("claude", json!([])));
        assert_eq!(e.view()["session"]["total"], 100);
        let mut b = batch("claude", json!([node("replacement", 20)]));
        b.reset = true;
        e.apply(b);
        assert_eq!(e.view()["session"]["total"], 20);
        let mut b = batch("claude", json!([]));
        b.gap = true;
        e.apply(b);
        assert!(e.view()["session"]["total"].is_null());
        let mut e = Entry::default();
        for group in 0..17 {
            e.apply(batch(
                "claude",
                Value::Array(
                    (0..256)
                        .map(|i| node(&format!("{group}-{i}"), 10))
                        .collect(),
                ),
            ));
        }
        assert_eq!(e.nodes.len(), 4096);
        assert!(e.view()["limited"].as_bool().unwrap());
        assert!(e.view()["session"]["total"].is_null());
    }
}
