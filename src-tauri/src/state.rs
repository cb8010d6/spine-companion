use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

/// Canonical list of allowed companion states.
const STATES: &[&str] = &[
    "idle", "working", "reviewing", "running", "success", "failed", "waiting", "sleeping",
    "reminder",
];

fn build_aliases() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("move", "running"),
        ("run", "running"),
        ("review", "reviewing"),
        ("special", "reviewing"),
        ("interact", "reminder"),
        ("sleep", "sleeping"),
        ("fail", "failed"),
        ("wait", "waiting"),
    ])
}

pub fn normalize_state_id(value: &str) -> String {
    let raw = value.trim().to_lowercase();
    let aliases = build_aliases();
    let raw_str = raw.as_str();
    let normalized = aliases.get(raw_str).unwrap_or(&raw_str);
    if STATES.contains(normalized) {
        normalized.to_string()
    } else {
        "idle".to_string()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionState {
    pub state: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub direction: String,
    #[serde(default, rename = "updatedAt")]
    pub updated_at: String,
    #[serde(default, rename = "reminderId", skip_serializing_if = "Option::is_none")]
    pub reminder_id: Option<String>,
    #[serde(default, rename = "autoReturnMs", skip_serializing_if = "Option::is_none")]
    pub auto_return_ms: Option<u64>,
    #[serde(default, rename = "returnTo", skip_serializing_if = "Option::is_none")]
    pub return_to: Option<String>,
}

impl Default for CompanionState {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            id: "idle".to_string(),
            message: String::new(),
            source: "system".to_string(),
            direction: "right".to_string(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            reminder_id: None,
            auto_return_ms: None,
            return_to: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SetStateInput {
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default, rename = "autoReturnMs")]
    pub auto_return_ms: Option<u64>,
    #[serde(default, rename = "returnTo")]
    pub return_to: Option<String>,
    #[serde(default, rename = "reminderId")]
    pub reminder_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub text: String,
    #[serde(rename = "dueAt")]
    pub due_at: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub fired: bool,
    #[serde(rename = "firedAt", skip_serializing_if = "Option::is_none")]
    pub fired_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreateReminderInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default, rename = "inSeconds")]
    pub in_seconds: Option<f64>,
    #[serde(default, rename = "delayMs")]
    pub delay_ms: Option<u64>,
    #[serde(default, rename = "dueAt")]
    pub due_at: Option<String>,
    #[serde(default)]
    pub at: Option<String>,
    #[serde(default, rename = "durationMs")]
    pub duration_ms: Option<u64>,
    #[serde(default, rename = "returnTo")]
    pub return_to: Option<String>,
}

pub type StateStore = Arc<RwLock<CompanionState>>;
pub type StateBroadcast = broadcast::Sender<CompanionState>;

pub fn create_state_store(initial: &str) -> (StateStore, StateBroadcast) {
    let state = CompanionState {
        state: normalize_state_id(initial),
        id: normalize_state_id(initial),
        ..Default::default()
    };
    let store = Arc::new(RwLock::new(state));
    let (tx, _) = broadcast::channel(64);
    (store, tx)
}

pub async fn set_state(
    store: &StateStore,
    tx: &StateBroadcast,
    input: SetStateInput,
) -> CompanionState {
    let mut current = store.write().await;
    let requested = input
        .state
        .as_deref()
        .or(input.id.as_deref())
        .or(input.status.as_deref());
    let next_state = match requested {
        Some(s) => normalize_state_id(s),
        None => current.state.clone(),
    };
    let direction = if next_state == "running" {
        input
            .direction
            .clone()
            .unwrap_or_else(|| current.direction.clone())
    } else {
        "right".to_string()
    };

    current.state = next_state.clone();
    current.id = next_state;
    current.direction = direction;
    current.updated_at = chrono::Utc::now().to_rfc3339();
    current.source = input
        .source
        .clone()
        .unwrap_or_else(|| current.source.clone());
    if let Some(msg) = &input.message {
        current.message = msg.clone();
    }
    current.reminder_id = input.reminder_id.clone();
    current.auto_return_ms = input.auto_return_ms;
    current.return_to = input.return_to.clone();

    let snapshot = current.clone();
    drop(current);
    let _ = tx.send(snapshot.clone());
    snapshot
}

pub fn snapshot_sync(store: &StateStore) -> CompanionState {
    // For Tauri commands that need a quick sync snapshot
    store.blocking_read().clone()
}
