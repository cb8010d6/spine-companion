use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, RwLock};

static NEXT_REMINDER_GENERATION: AtomicU64 = AtomicU64::new(1);
const MAX_REMINDERS: usize = 128;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify: Option<bool>,
    #[serde(skip)]
    generation: u64,
    #[serde(skip)]
    overlay: Option<Box<UnderlyingState>>,
}

#[derive(Debug, Clone)]
struct UnderlyingState {
    state: String,
    message: String,
    source: String,
    direction: String,
}

impl UnderlyingState {
    fn from_state(state: &CompanionState) -> Self {
        Self {
            state: state.state.clone(),
            message: state.message.clone(),
            source: state.source.clone(),
            direction: state.direction.clone(),
        }
    }

    fn restore(&self, return_to: Option<&str>) -> CompanionState {
        let state = return_to
            .map(normalize_state_id)
            .unwrap_or_else(|| normalize_state_id(&self.state));
        CompanionState {
            state: state.clone(),
            id: state.clone(),
            message: self.message.clone(),
            source: self.source.clone(),
            direction: if state == "running" {
                self.direction.clone()
            } else {
                "right".to_string()
            },
            updated_at: chrono::Utc::now().to_rfc3339(),
            reminder_id: None,
            auto_return_ms: None,
            return_to: None,
            notify: None,
            generation: 0,
            overlay: None,
        }
    }

    fn has_active_task(&self) -> bool {
        self.state != "idle" || self.source != "system" || !self.message.is_empty()
    }
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
            notify: None,
            generation: 0,
            overlay: None,
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
    #[serde(default)]
    pub notify: Option<bool>,
    #[serde(default, rename = "preserveMessage")]
    pub preserve_message: Option<bool>,
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
    #[serde(rename = "snoozeAfterMs")]
    pub snooze_after_ms: u64,
    #[serde(skip)]
    generation: u64,
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
    #[serde(default, rename = "snoozeAfterMs")]
    pub snooze_after_ms: Option<u64>,
}

pub type StateStore = Arc<RwLock<CompanionState>>;
pub type StateBroadcast = broadcast::Sender<CompanionState>;
/// v0.2.6 reminders intentionally live only for the current runtime session.
pub type ReminderStore = Arc<RwLock<Vec<Reminder>>>;
pub type ReminderBroadcast = broadcast::Sender<Vec<Reminder>>;

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

pub fn create_reminder_broadcast() -> ReminderBroadcast {
    let (tx, _) = broadcast::channel(64);
    tx
}

pub async fn set_state(
    store: &StateStore,
    tx: &StateBroadcast,
    input: SetStateInput,
) -> CompanionState {
    let transition = apply_state_with_options(store, tx, input.clone(), false).await;
    schedule_auto_return(store, tx, &input, &transition);
    transition.snapshot
}

#[derive(Debug, Clone)]
struct StateTransition {
    snapshot: CompanionState,
    previous: CompanionState,
    generation: u64,
    overlay: bool,
}

async fn apply_state_with_options(
    store: &StateStore,
    tx: &StateBroadcast,
    input: SetStateInput,
    overlay: bool,
) -> StateTransition {
    let mut current = store.write().await;
    let transition = apply_state_locked(&mut current, input, overlay);
    drop(current);
    let _ = tx.send(transition.snapshot.clone());
    transition
}

fn apply_state_locked(
    current: &mut CompanionState,
    input: SetStateInput,
    overlay: bool,
) -> StateTransition {
    let previous = current.clone();
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
    current.id = next_state.clone();
    current.direction = direction;
    current.updated_at = chrono::Utc::now().to_rfc3339();
    current.source = input
        .source
        .clone()
        .unwrap_or_else(|| current.source.clone());
    let has_requested_state = requested.is_some();
    if let Some(msg) = &input.message {
        current.message = msg.clone();
    } else if has_requested_state && input.preserve_message != Some(true) {
        current.message.clear();
    }
    current.reminder_id = input.reminder_id.clone();
    current.auto_return_ms = input.auto_return_ms;
    current.return_to = input.return_to.clone();
    current.notify = input.notify;

    if overlay {
        current.overlay = Some(
            previous
                .overlay
                .clone()
                .unwrap_or_else(|| Box::new(UnderlyingState::from_state(&previous))),
        );
    } else if requested.is_some() || next_state != "reminder" {
        current.overlay = None;
    }
    current.generation = previous.generation.wrapping_add(1);

    StateTransition {
        snapshot: current.clone(),
        previous,
        generation: current.generation,
        overlay,
    }
}

fn schedule_auto_return(
    store: &StateStore,
    tx: &StateBroadcast,
    input: &SetStateInput,
    transition: &StateTransition,
) {
    if let Some(ms) = input.auto_return_ms {
        if ms > 0 {
            let store_for_return = store.clone();
            let tx_for_return = tx.clone();
            let return_to = input.return_to.clone();
            let previous_state = transition.previous.state.clone();
            let generation = transition.generation;
            let overlay = transition.overlay;
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
                let snapshot = {
                    let mut current = store_for_return.write().await;
                    if current.generation != generation {
                        return;
                    }
                    if overlay && current.state == "reminder" {
                        if let Some(underlying) = current.overlay.clone() {
                            let requested_return = if underlying.has_active_task() {
                                None
                            } else {
                                return_to.as_deref()
                            };
                            let mut restored = underlying.restore(requested_return);
                            restored.generation = current.generation.wrapping_add(1);
                            *current = restored.clone();
                            restored
                        } else {
                            apply_state_locked(
                                &mut current,
                                SetStateInput {
                                    state: Some(return_to.unwrap_or(previous_state)),
                                    source: Some("auto-return".to_string()),
                                    message: Some(String::new()),
                                    ..Default::default()
                                },
                                false,
                            )
                            .snapshot
                        }
                    } else {
                        apply_state_locked(
                            &mut current,
                            SetStateInput {
                                state: Some(return_to.unwrap_or(previous_state)),
                                source: Some("auto-return".to_string()),
                                message: Some(String::new()),
                                ..Default::default()
                            },
                            false,
                        )
                        .snapshot
                    }
                };
                let _ = tx_for_return.send(snapshot);
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
    reminder_tx: &ReminderBroadcast,
    input: CreateReminderInput,
) -> Result<Reminder, String> {
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
        snooze_after_ms: input.snooze_after_ms.unwrap_or(5 * 60 * 1000),
        generation: NEXT_REMINDER_GENERATION.fetch_add(1, Ordering::Relaxed),
    };

    let (snapshot, replaced_fired) = {
        let mut list = reminders.write().await;
        if !list.iter().any(|item| item.id == id) && list.len() >= MAX_REMINDERS {
            return Err(format!("Reminder limit reached ({MAX_REMINDERS})."));
        }
        let replaced_fired = list
            .iter()
            .find(|item| item.id == id)
            .map(|item| item.fired)
            .unwrap_or(false);
        if let Some(index) = list.iter().position(|item| item.id == id) {
            list[index] = reminder.clone();
        } else {
            list.push(reminder.clone());
        }
        (list.clone(), replaced_fired)
    };
    let _ = reminder_tx.send(snapshot);
    if replaced_fired {
        dismiss_reminder_overlay(store, tx, &id).await;
    }

    let store_for_fire = store.clone();
    let tx_for_fire = tx.clone();
    let reminders_for_fire = reminders.clone();
    let reminder_tx_for_fire = reminder_tx.clone();
    let generation = reminder.generation;
    let duration_ms = input.duration_ms.unwrap_or(5000);
    let return_to = input.return_to.clone();
    tokio::spawn(async move {
        let delay = (due_ms - chrono::Utc::now().timestamp_millis()).max(0) as u64;
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        let mut list = reminders_for_fire.write().await;
        let Some(item) = list
            .iter_mut()
            .find(|item| item.id == id && item.generation == generation && !item.fired)
        else {
            return;
        };
        item.fired = true;
        item.fired_at = Some(chrono::Utc::now().to_rfc3339());
        let snapshot = list.clone();
        let _ = reminder_tx_for_fire.send(snapshot);
        let fired_transition = apply_state_with_options(
            &store_for_fire,
            &tx_for_fire,
            SetStateInput {
                state: Some("reminder".to_string()),
                source: Some("reminder".to_string()),
                message: Some(text),
                reminder_id: Some(id),
                auto_return_ms: Some(duration_ms),
                return_to,
                ..Default::default()
            },
            true,
        )
        .await;
        drop(list);
        schedule_auto_return(
            &store_for_fire,
            &tx_for_fire,
            &SetStateInput {
                auto_return_ms: fired_transition.snapshot.auto_return_ms,
                return_to: fired_transition.snapshot.return_to.clone(),
                ..Default::default()
            },
            &fired_transition,
        );
    });

    Ok(reminder)
}

async fn dismiss_reminder_overlay(store: &StateStore, tx: &StateBroadcast, reminder_id: &str) {
    let snapshot = {
        let mut current = store.write().await;
        if current.state != "reminder"
            || current.source != "reminder"
            || current.reminder_id.as_deref() != Some(reminder_id)
        {
            return;
        }
        let Some(underlying) = current.overlay.clone() else {
            return;
        };
        let mut restored = underlying.restore(None);
        restored.generation = current.generation.wrapping_add(1);
        *current = restored.clone();
        restored
    };
    let _ = tx.send(snapshot);
}

pub async fn delete_reminder(
    reminders: &ReminderStore,
    reminder_tx: &ReminderBroadcast,
    id: &str,
) -> bool {
    let mut list = reminders.write().await;
    let before = list.len();
    list.retain(|item| item.id != id);
    let deleted = list.len() != before;
    if deleted {
        let _ = reminder_tx.send(list.clone());
    }
    deleted
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
    async fn set_state_clears_message_and_returns_to_previous_state() {
        let (store, tx) = create_state_store("idle");
        set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("working".to_string()),
                message: Some("Building".to_string()),
                ..Default::default()
            },
        )
        .await;
        set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("reminder".to_string()),
                auto_return_ms: Some(20),
                ..Default::default()
            },
        )
        .await;
        assert_eq!(store.read().await.message, "");
        tokio::time::sleep(std::time::Duration::from_millis(60)).await;
        assert_eq!(store.read().await.state, "working");
    }

    #[tokio::test]
    async fn creates_lists_and_fires_reminders() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        let mut reminder_rx = reminder_tx.subscribe();
        let reminder = create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                text: Some("Check".to_string()),
                delay_ms: Some(10),
                duration_ms: Some(20),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(reminder.text, "Check");
        assert_eq!(list_reminders(&reminders).await.len(), 1);
        let created = reminder_rx.recv().await.unwrap();
        assert_eq!(created.len(), 1);
        assert!(!created[0].fired);
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        assert_eq!(store.read().await.state, "reminder");
        assert!(list_reminders(&reminders).await[0].fired);
        let fired = reminder_rx.recv().await.unwrap();
        assert!(fired[0].fired);
    }

    #[tokio::test]
    async fn reminder_store_is_scoped_to_one_runtime_session() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                text: Some("Session only".to_string()),
                delay_ms: Some(60_000),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert_eq!(list_reminders(&reminders).await.len(), 1);
        assert!(list_reminders(&create_reminder_store()).await.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn deleting_pending_reminder_prevents_its_fire() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        let reminder = create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("cancelled".to_string()),
                text: Some("Cancel".to_string()),
                delay_ms: Some(100),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        tokio::task::yield_now().await;
        assert!(delete_reminder(&reminders, &reminder_tx, &reminder.id).await);
        tokio::time::advance(std::time::Duration::from_millis(100)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.state, "idle");
        assert!(list_reminders(&reminders).await.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn replacing_a_reminder_id_cancels_the_previous_generation() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("same-id".to_string()),
                text: Some("Old".to_string()),
                delay_ms: Some(100),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("same-id".to_string()),
                text: Some("New".to_string()),
                delay_ms: Some(200),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        tokio::task::yield_now().await;
        assert_eq!(list_reminders(&reminders).await.len(), 1);
        assert_eq!(list_reminders(&reminders).await[0].text, "New");
        tokio::time::advance(std::time::Duration::from_millis(100)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.state, "idle");
        tokio::time::advance(std::time::Duration::from_millis(100)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.state, "reminder");
        assert_eq!(store.read().await.message, "New");
    }

    #[tokio::test(start_paused = true)]
    async fn reminder_overlay_restores_latest_task_details() {
        let (store, tx) = create_state_store("idle");
        set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("working".to_string()),
                source: Some("codex".to_string()),
                message: Some("Building".to_string()),
                ..Default::default()
            },
        )
        .await;
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("overlay".to_string()),
                text: Some("Check".to_string()),
                delay_ms: Some(100),
                duration_ms: Some(50),
                return_to: Some("idle".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        tokio::task::yield_now().await;
        set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("running".to_string()),
                source: Some("opencode".to_string()),
                message: Some("Testing".to_string()),
                direction: Some("left".to_string()),
                ..Default::default()
            },
        )
        .await;
        tokio::time::advance(std::time::Duration::from_millis(100)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.state, "reminder");
        tokio::time::advance(std::time::Duration::from_millis(50)).await;
        tokio::task::yield_now().await;
        let restored = store.read().await.clone();
        assert_eq!(restored.state, "running");
        assert_eq!(restored.source, "opencode");
        assert_eq!(restored.message, "Testing");
        assert_eq!(restored.direction, "left");
    }

    #[tokio::test(start_paused = true)]
    async fn newer_report_invalidates_an_old_auto_return_generation() {
        let (store, tx) = create_state_store("idle");
        set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("reminder".to_string()),
                auto_return_ms: Some(100),
                return_to: Some("idle".to_string()),
                ..Default::default()
            },
        )
        .await;
        set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("working".to_string()),
                source: Some("codex".to_string()),
                message: Some("New report".to_string()),
                ..Default::default()
            },
        )
        .await;
        tokio::time::advance(std::time::Duration::from_millis(100)).await;
        tokio::task::yield_now().await;
        let latest = store.read().await.clone();
        assert_eq!(latest.state, "working");
        assert_eq!(latest.source, "codex");
        assert_eq!(latest.message, "New report");
    }

    #[tokio::test(start_paused = true)]
    async fn zero_duration_reminder_does_not_schedule_a_return() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("zero-duration".to_string()),
                text: Some("Now".to_string()),
                delay_ms: Some(100),
                duration_ms: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        tokio::task::yield_now().await;
        tokio::time::advance(std::time::Duration::from_millis(100)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.state, "reminder");
        tokio::time::advance(std::time::Duration::from_millis(5000)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.state, "reminder");
        assert!(list_reminders(&reminders).await[0].fired);
    }

    #[tokio::test(start_paused = true)]
    async fn long_due_at_is_not_truncated_to_one_day() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        let due_at = (chrono::Utc::now() + chrono::Duration::hours(25)).to_rfc3339();
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("long-date".to_string()),
                text: Some("Long".to_string()),
                due_at: Some(due_at),
                duration_ms: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        tokio::task::yield_now().await;
        tokio::time::advance(std::time::Duration::from_secs(24 * 60 * 60)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.state, "idle");
        tokio::time::advance(std::time::Duration::from_secs(60 * 60)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.message, "Long");
    }

    #[tokio::test(start_paused = true)]
    async fn replacing_an_already_fired_reminder_uses_the_new_generation() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("fired-replacement".to_string()),
                text: Some("Old".to_string()),
                delay_ms: Some(100),
                duration_ms: Some(1000),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        tokio::task::yield_now().await;
        tokio::time::advance(std::time::Duration::from_millis(100)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.message, "Old");
        set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("working".to_string()),
                source: Some("codex".to_string()),
                message: Some("New report".to_string()),
                ..Default::default()
            },
        )
        .await;
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("fired-replacement".to_string()),
                text: Some("New".to_string()),
                delay_ms: Some(200),
                duration_ms: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(store.read().await.message, "New report");
        tokio::task::yield_now().await;
        tokio::time::advance(std::time::Duration::from_millis(200)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.message, "New");
        assert_eq!(list_reminders(&reminders).await.len(), 1);
        assert!(list_reminders(&reminders).await[0].fired);
    }

    #[tokio::test(start_paused = true)]
    async fn replacing_an_already_fired_reminder_dismisses_its_overlay() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("dismissed".to_string()),
                text: Some("Old".to_string()),
                delay_ms: Some(100),
                duration_ms: Some(1000),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        tokio::task::yield_now().await;
        tokio::time::advance(std::time::Duration::from_millis(100)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.message, "Old");
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("dismissed".to_string()),
                text: Some("New".to_string()),
                delay_ms: Some(200),
                duration_ms: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(store.read().await.state, "idle");
        tokio::task::yield_now().await;
        tokio::time::advance(std::time::Duration::from_millis(200)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.message, "New");
    }

    #[tokio::test(start_paused = true)]
    async fn reminder_fire_and_delete_are_serialized_by_the_store_lock() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        let reminder = create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("race".to_string()),
                text: Some("Race".to_string()),
                delay_ms: Some(100),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        tokio::task::yield_now().await;
        tokio::time::advance(std::time::Duration::from_millis(100)).await;
        assert!(delete_reminder(&reminders, &reminder_tx, &reminder.id).await);
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.state, "idle");

        let fired = create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("race-fired".to_string()),
                text: Some("Fired".to_string()),
                delay_ms: Some(100),
                duration_ms: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        tokio::task::yield_now().await;
        tokio::time::advance(std::time::Duration::from_millis(100)).await;
        tokio::task::yield_now().await;
        assert_eq!(store.read().await.message, "Fired");
        assert!(delete_reminder(&reminders, &reminder_tx, &fired.id).await);
        assert!(!delete_reminder(&reminders, &reminder_tx, &fired.id).await);
    }

    #[tokio::test(start_paused = true)]
    async fn reminder_capacity_rejects_without_replacing_existing_entries() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        for index in 0..MAX_REMINDERS {
            create_reminder(
                &store,
                &tx,
                &reminders,
                &reminder_tx,
                CreateReminderInput {
                    id: Some(format!("bounded-{index}")),
                    delay_ms: Some(60_000),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        }
        let error = create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("overflow".to_string()),
                delay_ms: Some(60_000),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(error.contains("128"));
        assert_eq!(list_reminders(&reminders).await.len(), MAX_REMINDERS);
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("bounded-0".to_string()),
                text: Some("Replacement".to_string()),
                delay_ms: Some(60_000),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(list_reminders(&reminders).await.len(), MAX_REMINDERS);
        assert_eq!(
            list_reminders(&reminders)
                .await
                .iter()
                .find(|item| item.id == "bounded-0")
                .map(|item| item.text.as_str()),
            Some("Replacement")
        );
    }
}
