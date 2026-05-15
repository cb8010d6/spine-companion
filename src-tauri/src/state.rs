use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, RwLock};

/// Canonical list of allowed companion states.
const STATES: &[&str] = &[
    "idle",
    "working",
    "reviewing",
    "running",
    "success",
    "failed",
    "waiting",
    "sleeping",
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
    #[serde(
        default,
        rename = "reminderId",
        skip_serializing_if = "Option::is_none"
    )]
    pub reminder_id: Option<String>,
    #[serde(
        default,
        rename = "autoReturnMs",
        skip_serializing_if = "Option::is_none"
    )]
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
pub type ReminderStore = Arc<RwLock<Vec<Reminder>>>;

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

pub fn create_reminder_store() -> ReminderStore {
    Arc::new(RwLock::new(Vec::new()))
}

pub async fn set_state(
    store: &StateStore,
    tx: &StateBroadcast,
    input: SetStateInput,
) -> CompanionState {
    let snapshot = apply_state(store, tx, input.clone()).await;
    schedule_auto_return(store, tx, &input, &snapshot);
    snapshot
}

async fn apply_state(
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

fn schedule_auto_return(
    store: &StateStore,
    tx: &StateBroadcast,
    input: &SetStateInput,
    snapshot: &CompanionState,
) {
    if let Some(ms) = input.auto_return_ms {
        if ms > 0 {
            let store_for_return = store.clone();
            let tx_for_return = tx.clone();
            let return_to = input.return_to.clone();
            let previous_state = snapshot.state.clone();
            let updated_at = snapshot.updated_at.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
                if store_for_return.read().await.updated_at != updated_at {
                    return;
                }
                let _ = apply_state(
                    &store_for_return,
                    &tx_for_return,
                    SetStateInput {
                        state: Some(return_to.unwrap_or(previous_state)),
                        source: Some("auto-return".to_string()),
                        message: Some(String::new()),
                        ..Default::default()
                    },
                )
                .await;
            });
        }
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn due_at_ms(input: &CreateReminderInput) -> i64 {
    let now = chrono::Utc::now();
    if let Some(value) = input.due_at.as_deref().or(input.at.as_deref()) {
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(value) {
            return parsed.timestamp_millis();
        }
    }
    if let Some(seconds) = input.in_seconds {
        return now.timestamp_millis() + (seconds * 1000.0).round() as i64;
    }
    if let Some(delay) = input.delay_ms {
        return now.timestamp_millis() + delay as i64;
    }
    now.timestamp_millis() + 10_000
}

pub async fn list_reminders(reminders: &ReminderStore) -> Vec<Reminder> {
    reminders.read().await.clone()
}

pub async fn create_reminder(
    store: &StateStore,
    tx: &StateBroadcast,
    reminders: &ReminderStore,
    input: CreateReminderInput,
) -> Reminder {
    let now = chrono::Utc::now();
    let due_ms = due_at_ms(&input);
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("rem_{}", now_ms()));
    let text = input
        .text
        .clone()
        .or(input.message.clone())
        .unwrap_or_else(|| "Reminder".to_string());
    let reminder = Reminder {
        id: id.clone(),
        text: text.clone(),
        due_at: chrono::DateTime::<chrono::Utc>::from_timestamp_millis(due_ms)
            .unwrap_or(now)
            .to_rfc3339(),
        created_at: now.to_rfc3339(),
        fired: false,
        fired_at: None,
    };

    reminders.write().await.push(reminder.clone());

    let store_for_fire = store.clone();
    let tx_for_fire = tx.clone();
    let reminders_for_fire = reminders.clone();
    let duration_ms = input.duration_ms.unwrap_or(5000);
    let return_to = input.return_to.unwrap_or_else(|| "idle".to_string());
    tokio::spawn(async move {
        let delay = (due_ms - chrono::Utc::now().timestamp_millis()).max(0) as u64;
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        {
            let mut list = reminders_for_fire.write().await;
            if let Some(item) = list.iter_mut().find(|item| item.id == id) {
                item.fired = true;
                item.fired_at = Some(chrono::Utc::now().to_rfc3339());
            }
        }
        let fired = apply_state(
            &store_for_fire,
            &tx_for_fire,
            SetStateInput {
                state: Some("reminder".to_string()),
                source: Some("reminder".to_string()),
                message: Some(text),
                reminder_id: Some(id),
                auto_return_ms: Some(duration_ms),
                return_to: Some(return_to),
                ..Default::default()
            },
        )
        .await;
        schedule_auto_return(
            &store_for_fire,
            &tx_for_fire,
            &SetStateInput {
                auto_return_ms: fired.auto_return_ms,
                return_to: fired.return_to.clone(),
                ..Default::default()
            },
            &fired,
        );
    });

    reminder
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_aliases() {
        assert_eq!(normalize_state_id("move"), "running");
        assert_eq!(normalize_state_id("review"), "reviewing");
        assert_eq!(normalize_state_id("unknown"), "idle");
    }

    #[tokio::test]
    async fn set_state_updates_and_auto_returns() {
        let (store, tx) = create_state_store("idle");
        let state = set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("reminder".to_string()),
                auto_return_ms: Some(20),
                return_to: Some("working".to_string()),
                ..Default::default()
            },
        )
        .await;
        assert_eq!(state.state, "reminder");
        tokio::time::sleep(std::time::Duration::from_millis(60)).await;
        assert_eq!(store.read().await.state, "working");
    }

    #[tokio::test]
    async fn creates_lists_and_fires_reminders() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder = create_reminder(
            &store,
            &tx,
            &reminders,
            CreateReminderInput {
                text: Some("Check".to_string()),
                delay_ms: Some(10),
                duration_ms: Some(20),
                ..Default::default()
            },
        )
        .await;
        assert_eq!(reminder.text, "Check");
        assert_eq!(list_reminders(&reminders).await.len(), 1);
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        assert_eq!(store.read().await.state, "reminder");
        assert!(list_reminders(&reminders).await[0].fired);
    }
}
