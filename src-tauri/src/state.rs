use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, RwLock};
use tokio::task::AbortHandle;

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

const MAX_SOURCE_LEN: usize = 128;
const MAX_SOURCE_LABEL_LEN: usize = 128;
const MAX_SESSION_ID_LEN: usize = 128;
const MAX_EVENT_ID_LEN: usize = 128;
const MAX_MESSAGE_LEN: usize = 8 * 1024;
const MAX_REMINDER_TEXT_LEN: usize = 8 * 1024;
const MAX_EVENT_IDS_PER_SESSION: usize = 128;
const MAX_SESSIONS: usize = 64;
const SESSION_STALE_AFTER_MS: i64 = 5 * 60 * 1000;
const SESSION_RETENTION_MS: i64 = 24 * 60 * 60 * 1000;
const MAX_DELAY_MS: u64 = 24 * 60 * 60 * 1000;
const MAX_REMINDERS: usize = 128;
const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;

static NEXT_REMINDER_ID: AtomicU64 = AtomicU64::new(1);

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LastReport {
    pub source: String,
    #[serde(
        default,
        rename = "sourceLabel",
        skip_serializing_if = "Option::is_none"
    )]
    pub source_label: Option<String>,
    #[serde(default, rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub state: String,
    #[serde(default)]
    pub message: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(default, rename = "eventId", skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u64>,
    #[serde(default, rename = "eventKind", skip_serializing_if = "Option::is_none")]
    pub event_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
    #[serde(
        default,
        rename = "sourceLabel",
        skip_serializing_if = "Option::is_none"
    )]
    pub source_label: Option<String>,
    #[serde(default, rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, rename = "eventId", skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u64>,
    #[serde(
        default,
        rename = "sessionEnded",
        skip_serializing_if = "Option::is_none"
    )]
    pub session_ended: Option<bool>,
    #[serde(default, rename = "eventKind", skip_serializing_if = "Option::is_none")]
    pub event_kind: Option<String>,
    #[serde(default)]
    pub revision: u64,
    #[serde(
        default,
        rename = "lastReport",
        skip_serializing_if = "Option::is_none"
    )]
    pub last_report: Option<LastReport>,
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
            source_label: None,
            session_id: None,
            event_id: None,
            sequence: None,
            session_ended: None,
            event_kind: None,
            revision: 0,
            last_report: None,
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
    #[serde(default, rename = "sourceLabel")]
    pub source_label: Option<String>,
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
    #[serde(default, rename = "sessionId")]
    pub session_id: Option<String>,
    #[serde(default, rename = "eventId")]
    pub event_id: Option<String>,
    #[serde(default)]
    pub sequence: Option<u64>,
    #[serde(default, rename = "sessionEnded")]
    pub session_ended: Option<bool>,
    #[serde(default, rename = "eventKind")]
    pub event_kind: Option<String>,
    #[serde(default, rename = "updatedAt")]
    pub updated_at: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionSummary {
    pub source: String,
    #[serde(
        default,
        rename = "sourceLabel",
        skip_serializing_if = "Option::is_none"
    )]
    pub source_label: Option<String>,
    #[serde(default, rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub state: String,
    pub message: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub stale: bool,
    pub ended: bool,
    pub granularity: String,
    #[serde(default, rename = "eventId", skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FocusedSession {
    pub source: String,
    #[serde(default, rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionList {
    pub sessions: Vec<SessionSummary>,
    pub focused: Option<FocusedSession>,
    #[serde(rename = "staleAfterMs")]
    pub stale_after_ms: u64,
}

pub type StateBroadcast = broadcast::Sender<CompanionState>;
pub type ReminderStore = Arc<RwLock<Vec<Reminder>>>;
pub type ReminderBroadcast = broadcast::Sender<Vec<Reminder>>;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SessionKey {
    source: String,
    session_id: Option<String>,
}

#[derive(Debug, Clone)]
struct SessionRecord {
    snapshot: CompanionState,
    ended: bool,
    updated_at_ms: i64,
    event_ids: VecDeque<String>,
    last_sequence: Option<u64>,
    order: u64,
}

#[derive(Debug, Clone)]
struct DisplayOverlay {
    token: u64,
    reminder_id: Option<String>,
    restore: CompanionState,
    return_to: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RuntimeState {
    current: CompanionState,
    sessions: HashMap<SessionKey, SessionRecord>,
    focused: Option<SessionKey>,
    overlay: Option<DisplayOverlay>,
    next_token: u64,
    auto_return: Option<AutoReturnGuard>,
    next_reminder_generation: u64,
    reminder_generations: HashMap<String, u64>,
    reminder_tasks: HashMap<String, AbortHandle>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AutoReturnGuard {
    token: u64,
    reminder_id: bool,
}

pub type StateStore = Arc<RwLock<RuntimeState>>;

#[derive(Debug)]
struct ApplyResult {
    snapshot: CompanionState,
    changed: bool,
    schedule: Option<(tokio::time::Instant, AutoReturnGuard)>,
}

pub fn create_state_store(initial: &str) -> (StateStore, StateBroadcast) {
    let normalized = normalize_state_id(initial);
    let state = CompanionState {
        state: normalized.clone(),
        id: normalized,
        ..Default::default()
    };
    let runtime = RuntimeState {
        current: state,
        sessions: HashMap::new(),
        focused: None,
        overlay: None,
        next_token: 0,
        auto_return: None,
        next_reminder_generation: 0,
        reminder_generations: HashMap::new(),
        reminder_tasks: HashMap::new(),
    };
    let store = Arc::new(RwLock::new(runtime));
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

pub async fn get_state(store: &StateStore) -> CompanionState {
    let mut runtime = store.write().await;
    cleanup_sessions_locked(&mut runtime, now_ms_i64());
    runtime.current.clone()
}

pub async fn set_state(
    store: &StateStore,
    tx: &StateBroadcast,
    input: SetStateInput,
) -> Result<CompanionState, String> {
    let result = {
        let mut runtime = store.write().await;
        let result = apply_input_locked(&mut runtime, input)?;
        if result.changed {
            // Sending while the runtime lock is held preserves event ordering
            // against a concurrent reminder fire/delete or newer report.
            let _ = tx.send(result.snapshot.clone());
        }
        result
    };

    if result.changed {
        if let Some((deadline, guard)) = result.schedule {
            spawn_auto_return(store.clone(), tx.clone(), deadline, guard);
        }
    }
    Ok(result.snapshot)
}

pub async fn list_sessions(store: &StateStore) -> SessionList {
    let mut runtime = store.write().await;
    cleanup_sessions_locked(&mut runtime, now_ms_i64());
    let now = now_ms_i64();
    let mut sessions = runtime
        .sessions
        .values()
        .map(|record| {
            let age = now.saturating_sub(record.updated_at_ms);
            SessionSummary {
                source: record.snapshot.source.clone(),
                source_label: record.snapshot.source_label.clone(),
                session_id: record.snapshot.session_id.clone(),
                state: record.snapshot.state.clone(),
                message: record.snapshot.message.clone(),
                updated_at: record.snapshot.updated_at.clone(),
                stale: age > SESSION_STALE_AFTER_MS,
                ended: record.ended,
                granularity: if record.snapshot.session_id.is_some() {
                    "session".to_string()
                } else {
                    "source".to_string()
                },
                event_id: record.snapshot.event_id.clone(),
                sequence: record.snapshot.sequence,
            }
        })
        .collect::<Vec<_>>();
    sessions.sort_by(|a, b| {
        a.source
            .cmp(&b.source)
            .then_with(|| a.session_id.cmp(&b.session_id))
    });
    SessionList {
        sessions,
        focused: runtime.focused.as_ref().map(focused_from_key),
        stale_after_ms: SESSION_STALE_AFTER_MS as u64,
    }
}

pub async fn focus_session(
    store: &StateStore,
    tx: &StateBroadcast,
    source: Option<String>,
    session_id: Option<String>,
) -> Result<CompanionState, String> {
    let result = {
        let mut runtime = store.write().await;
        cleanup_sessions_locked(&mut runtime, now_ms_i64());
        let result =
            match source {
                None => {
                    runtime.focused = None;
                    refresh_display_locked(&mut runtime, false)
                }
                Some(source) => {
                    let source = crate::source_registry::normalize_source(
                        &validate_nonempty_string("source", &source, MAX_SOURCE_LEN)?,
                    );
                    let session_id = session_id
                        .map(|id| validate_nonempty_string("sessionId", &id, MAX_SESSION_ID_LEN))
                        .transpose()?;
                    let key = find_session_key(&runtime, &source, session_id.as_deref())
                        .ok_or_else(|| "Session not found.".to_string())?;
                    runtime.focused = Some(key.clone());
                    runtime.overlay = None;
                    runtime.auto_return = None;
                    runtime.next_token = runtime.next_token.saturating_add(1);
                    let record = runtime
                        .sessions
                        .get(&key)
                        .expect("session key just resolved");
                    let mut next = record.snapshot.clone();
                    next.revision = runtime.current.revision.saturating_add(1);
                    clear_internal_metadata(&mut next, true);
                    runtime.current = next.clone();
                    Ok(next)
                }
            };
        if let Ok(snapshot) = &result {
            let _ = tx.send(snapshot.clone());
        }
        result
    };
    result
}

pub async fn dismiss_display(
    store: &StateStore,
    tx: &StateBroadcast,
    expected_revision: u64,
) -> CompanionState {
    {
        let mut runtime = store.write().await;
        if runtime.current.revision != expected_revision {
            return runtime.current.clone();
        }
        let previous = runtime.current.clone();
        runtime.auto_return = None;
        if runtime.overlay.is_some() {
            restore_overlay_locked(&mut runtime)
        } else {
            if matches!(runtime.current.state.as_str(), "success" | "failed") {
                runtime.focused = None;
            }
            refresh_display_locked(&mut runtime, true).unwrap_or_else(|_| runtime.current.clone())
        };
        let snapshot = runtime.current.clone();
        if snapshot != previous {
            let _ = tx.send(snapshot.clone());
        }
        snapshot
    }
}

fn apply_input_locked(
    runtime: &mut RuntimeState,
    mut input: SetStateInput,
) -> Result<ApplyResult, String> {
    validate_input(&input)?;
    for text in [
        &mut input.source_label,
        &mut input.session_id,
        &mut input.event_id,
    ]
    .into_iter()
    .flatten()
    {
        *text = text.trim().to_string();
    }
    cleanup_sessions_locked(runtime, now_ms_i64());

    let effective = effective_snapshot_locked(runtime);
    let source = input
        .source
        .as_deref()
        .unwrap_or(effective.source.as_str())
        .trim()
        .to_ascii_lowercase();
    let event_kind = input
        .event_kind
        .as_deref()
        .map(normalize_event_kind)
        .transpose()?;
    let ai_report = is_real_ai_report(&source, event_kind.as_deref())
        && !is_self_test_message(input.message.as_deref());

    if ai_report {
        let session_id = input.session_id.clone();
        let key = SessionKey {
            source: source.clone(),
            session_id: session_id.clone(),
        };
        if let Some(record) = runtime.sessions.get(&key) {
            if record.ended
                || input
                    .event_id
                    .as_ref()
                    .is_some_and(|id| record.event_ids.contains(id))
            {
                return Ok(ApplyResult {
                    snapshot: runtime.current.clone(),
                    changed: false,
                    schedule: None,
                });
            }
            if let (Some(incoming), Some(previous)) = (input.sequence, record.last_sequence) {
                if incoming <= previous {
                    return Ok(ApplyResult {
                        snapshot: runtime.current.clone(),
                        changed: false,
                        schedule: None,
                    });
                }
            }
        }

        make_session_room_locked(runtime, &key)?;
        let existing = runtime.sessions.get(&key).cloned();
        let previous = existing
            .as_ref()
            .map(|record| record.snapshot.clone())
            .unwrap_or_else(|| CompanionState {
                source: source.clone(),
                source_label: input
                    .source_label
                    .clone()
                    .or_else(|| Some(crate::source_registry::source_display_name(&source, None))),
                ..Default::default()
            });
        let next = state_from_input(&previous, &input, &source, event_kind.clone(), true)?;
        let next_revision = runtime.current.revision.saturating_add(1);
        let updated_at_ms = parse_timestamp_ms(&next.updated_at).unwrap_or_else(now_ms_i64);
        let mut event_ids = existing
            .as_ref()
            .map(|record| record.event_ids.clone())
            .unwrap_or_default();
        if let Some(event_id) = &input.event_id {
            event_ids.push_back(event_id.clone());
            while event_ids.len() > MAX_EVENT_IDS_PER_SESSION {
                event_ids.pop_front();
            }
        }
        let ended = existing.as_ref().is_some_and(|record| record.ended)
            || input.session_ended == Some(true);
        runtime.sessions.insert(
            key,
            SessionRecord {
                snapshot: next.clone(),
                ended,
                updated_at_ms,
                event_ids,
                last_sequence: input
                    .sequence
                    .or_else(|| existing.and_then(|record| record.last_sequence)),
                order: next_revision,
            },
        );

        let report = LastReport {
            source: next.source.clone(),
            source_label: next.source_label.clone(),
            session_id: next.session_id.clone(),
            state: next.state.clone(),
            message: next.message.clone(),
            updated_at: next.updated_at.clone(),
            event_id: next.event_id.clone(),
            sequence: next.sequence,
            event_kind: Some(event_kind.unwrap_or_else(|| "report".to_string())),
            notify: next.notify,
        };
        if runtime.overlay.is_some() {
            let mut underlay = choose_display_snapshot_locked(runtime).unwrap_or(next.clone());
            underlay.last_report = None;
            let display_matches_report =
                underlay.source == next.source && underlay.session_id == next.session_id;
            clear_transient_metadata(&mut underlay, !display_matches_report);
            if let Some(overlay) = runtime.overlay.as_mut() {
                overlay.restore = underlay;
            }
            // Business reports update the underlying task but never cancel the
            // temporary overlay's independent deadline.
            runtime.current.revision = runtime.current.revision.saturating_add(1);
            runtime.current.last_report = None;
            return Ok(ApplyResult {
                snapshot: snapshot_with_report(&runtime.current, Some(report)),
                changed: true,
                schedule: None,
            });
        }

        let display = choose_display_snapshot_locked(runtime).unwrap_or(next);
        let display_matches_report = display.source == source && display.session_id == session_id;
        runtime.current = display;
        runtime.current.revision = next_revision;
        clear_transient_metadata(&mut runtime.current, !display_matches_report);
        Ok(ApplyResult {
            snapshot: snapshot_with_report(&runtime.current, Some(report)),
            changed: true,
            schedule: None,
        })
    } else {
        let next = state_from_input(&effective, &input, &source, event_kind, false)?;
        let next_revision = runtime.current.revision.saturating_add(1);
        let duration_ms = input.auto_return_ms.unwrap_or(0).min(MAX_DELAY_MS);
        let wants_overlay = duration_ms > 0;
        if wants_overlay {
            let restore = runtime
                .overlay
                .as_ref()
                .map(|overlay| overlay.restore.clone())
                .unwrap_or_else(|| effective.clone());
            runtime.next_token = runtime.next_token.saturating_add(1);
            let token = runtime.next_token;
            runtime.overlay = Some(DisplayOverlay {
                token,
                reminder_id: input.reminder_id.clone(),
                restore,
                return_to: input
                    .return_to
                    .clone()
                    .map(|value| normalize_state_id(&value)),
            });
            runtime.current = next;
            runtime.current.revision = next_revision;
            runtime.auto_return = Some(AutoReturnGuard {
                token,
                reminder_id: input.reminder_id.is_some(),
            });
            Ok(ApplyResult {
                snapshot: runtime.current.clone(),
                changed: true,
                schedule: Some((
                    tokio::time::Instant::now() + Duration::from_millis(duration_ms),
                    AutoReturnGuard {
                        token,
                        reminder_id: input.reminder_id.is_some(),
                    },
                )),
            })
        } else {
            runtime.overlay = None;
            runtime.auto_return = None;
            runtime.next_token = runtime.next_token.saturating_add(1);
            runtime.current = next;
            runtime.current.revision = next_revision;
            Ok(ApplyResult {
                snapshot: runtime.current.clone(),
                changed: true,
                schedule: None,
            })
        }
    }
}

fn state_from_input(
    previous: &CompanionState,
    input: &SetStateInput,
    source: &str,
    event_kind: Option<String>,
    report: bool,
) -> Result<CompanionState, String> {
    let requested = input
        .state
        .as_deref()
        .or(input.id.as_deref())
        .or(input.status.as_deref());
    let next_state = requested
        .map(normalize_state_id)
        .unwrap_or_else(|| previous.state.clone());
    let direction = if next_state == "running" {
        input
            .direction
            .as_deref()
            .unwrap_or(previous.direction.as_str())
            .trim()
            .to_ascii_lowercase()
    } else {
        "right".to_string()
    };
    let has_requested_state = requested.is_some();
    let message = if let Some(message) = &input.message {
        message.clone()
    } else if has_requested_state && input.preserve_message != Some(true) {
        String::new()
    } else {
        previous.message.clone()
    };
    // `updatedAt` is the server receive timestamp.  The optional input field
    // is retained for forward-compatible deserialization but is never trusted
    // as a report clock.
    let updated_at = chrono::Utc::now().to_rfc3339();
    let mut next = CompanionState {
        state: next_state.clone(),
        id: next_state,
        message,
        source: source.to_string(),
        direction,
        updated_at,
        reminder_id: if report {
            None
        } else {
            input.reminder_id.clone()
        },
        auto_return_ms: if report { None } else { input.auto_return_ms },
        return_to: if report {
            None
        } else {
            input.return_to.clone()
        },
        notify: input.notify,
        source_label: input.source_label.clone().or_else(|| {
            (source == previous.source)
                .then(|| previous.source_label.clone())
                .flatten()
        }),
        session_id: input.session_id.clone(),
        event_id: input.event_id.clone(),
        sequence: input.sequence,
        session_ended: input.session_ended,
        event_kind,
        revision: previous.revision,
        last_report: None,
    };
    if next.direction != "left" && next.direction != "right" {
        next.direction = "right".to_string();
    }
    Ok(next)
}

fn snapshot_with_report(state: &CompanionState, report: Option<LastReport>) -> CompanionState {
    let mut snapshot = state.clone();
    snapshot.last_report = report;
    snapshot
}

fn clear_internal_metadata(state: &mut CompanionState, notify_false: bool) {
    state.last_report = None;
    state.event_kind = None;
    state.event_id = None;
    state.sequence = None;
    state.session_ended = None;
    state.reminder_id = None;
    state.auto_return_ms = None;
    state.return_to = None;
    if notify_false {
        state.notify = Some(false);
    }
}

fn clear_transient_metadata(state: &mut CompanionState, notify_false: bool) {
    state.last_report = None;
    state.reminder_id = None;
    state.auto_return_ms = None;
    state.return_to = None;
    if notify_false {
        state.notify = Some(false);
    }
}

fn is_self_test_message(message: Option<&str>) -> bool {
    message
        .map(str::trim_start)
        .is_some_and(|message| message.starts_with("[Spine Companion self-test]"))
}

fn effective_snapshot_locked(runtime: &RuntimeState) -> CompanionState {
    runtime
        .overlay
        .as_ref()
        .map(|overlay| overlay.restore.clone())
        .unwrap_or_else(|| runtime.current.clone())
}

fn choose_display_snapshot_locked(runtime: &RuntimeState) -> Option<CompanionState> {
    if let Some(key) = &runtime.focused {
        return runtime
            .sessions
            .get(key)
            .map(|record| record.snapshot.clone());
    }
    runtime
        .sessions
        .values()
        .max_by(|a, b| {
            session_priority(a)
                .cmp(&session_priority(b))
                .then_with(|| a.updated_at_ms.cmp(&b.updated_at_ms))
                .then_with(|| a.order.cmp(&b.order))
                .then_with(|| a.snapshot.source.cmp(&b.snapshot.source))
                .then_with(|| a.snapshot.session_id.cmp(&b.snapshot.session_id))
        })
        .map(|record| record.snapshot.clone())
}

fn session_priority(record: &SessionRecord) -> (u8, u8) {
    let completed = record.ended || matches!(record.snapshot.state.as_str(), "success" | "failed");
    if completed {
        (0, 0)
    } else if record.snapshot.state == "waiting" {
        (3, 0)
    } else if matches!(
        record.snapshot.state.as_str(),
        "working" | "reviewing" | "running"
    ) {
        (2, 0)
    } else {
        (1, 0)
    }
}

fn refresh_display_locked(
    runtime: &mut RuntimeState,
    clear_terminal: bool,
) -> Result<CompanionState, String> {
    if let Some(display) = choose_display_snapshot_locked(runtime) {
        let has_unfinished = runtime
            .sessions
            .values()
            .any(|record| session_priority(record).0 >= 2);
        if clear_terminal
            && runtime.focused.is_none()
            && matches!(runtime.current.state.as_str(), "success" | "failed")
            && !has_unfinished
            && matches!(display.state.as_str(), "success" | "failed")
        {
            let next = CompanionState {
                revision: runtime.current.revision.saturating_add(1),
                notify: Some(false),
                ..Default::default()
            };
            runtime.current = next.clone();
            runtime.overlay = None;
            runtime.auto_return = None;
            return Ok(next);
        }
        runtime.overlay = None;
        runtime.auto_return = None;
        runtime.next_token = runtime.next_token.saturating_add(1);
        let mut next = display;
        next.revision = runtime.current.revision.saturating_add(1);
        clear_internal_metadata(&mut next, true);
        runtime.current = next.clone();
        return Ok(next);
    }
    if clear_terminal && matches!(runtime.current.state.as_str(), "success" | "failed") {
        runtime.next_token = runtime.next_token.saturating_add(1);
        let next = CompanionState {
            revision: runtime.current.revision.saturating_add(1),
            notify: Some(false),
            ..Default::default()
        };
        runtime.current = next.clone();
        return Ok(next);
    }
    Ok(runtime.current.clone())
}

fn restore_overlay_locked(runtime: &mut RuntimeState) -> CompanionState {
    let Some(overlay) = runtime.overlay.take() else {
        return runtime.current.clone();
    };
    runtime.auto_return = None;
    runtime.next_token = runtime.next_token.saturating_add(1);
    let mut restored = overlay.restore;
    // `returnTo` is a compatibility fallback for one-shot local displays.  A
    // retained AI record is authoritative: old clients commonly supplied
    // `returnTo: idle`, and letting that value win would erase the task while
    // its reminder was visible.
    let has_retained_effective = runtime.sessions.contains_key(&SessionKey {
        source: restored.source.clone(),
        session_id: restored.session_id.clone(),
    });
    if !has_retained_effective {
        if let Some(return_to) = overlay.return_to {
            restored.state = return_to.clone();
            restored.id = return_to;
            restored.message.clear();
        }
    }
    restored.revision = runtime.current.revision.saturating_add(1);
    clear_internal_metadata(&mut restored, true);
    runtime.current = restored.clone();
    restored
}

fn spawn_auto_return(
    store: StateStore,
    tx: StateBroadcast,
    deadline: tokio::time::Instant,
    guard: AutoReturnGuard,
) {
    tokio::spawn(async move {
        tokio::time::sleep_until(deadline).await;
        let mut runtime = store.write().await;
        if runtime.auto_return != Some(guard)
            || runtime
                .overlay
                .as_ref()
                .is_none_or(|overlay| overlay.token != guard.token)
        {
            return;
        }
        let snapshot = restore_overlay_locked(&mut runtime);
        // Keep the guard check, restore, and notification in one critical
        // section so a newer report cannot be followed by this old callback.
        let _ = tx.send(snapshot);
    });
}

fn validate_input(input: &SetStateInput) -> Result<(), String> {
    if let Some(value) = &input.message {
        validate_string("message", value, MAX_MESSAGE_LEN)?;
    }
    if let Some(value) = &input.source {
        validate_nonempty_string("source", value, MAX_SOURCE_LEN)?;
    }
    if let Some(value) = &input.source_label {
        validate_nonempty_string("sourceLabel", value, MAX_SOURCE_LABEL_LEN)?;
    }
    if let Some(value) = &input.session_id {
        validate_nonempty_string("sessionId", value, MAX_SESSION_ID_LEN)?;
    }
    if let Some(value) = &input.event_id {
        validate_nonempty_string("eventId", value, MAX_EVENT_ID_LEN)?;
    }
    if let Some(sequence) = input.sequence {
        if sequence > MAX_SEQUENCE {
            return Err("sequence exceeds the safe integer limit.".to_string());
        }
    }
    if let Some(value) = &input.event_kind {
        normalize_event_kind(value)?;
    }
    if let Some(value) = &input.updated_at {
        validate_string("updatedAt", value, 128)?;
        if parse_timestamp_ms(value).is_none() {
            return Err("updatedAt must be an RFC3339 timestamp.".to_string());
        }
    }
    if let Some(value) = &input.return_to {
        validate_nonempty_string("returnTo", value, 32)?;
    }
    if let Some(value) = &input.direction {
        validate_nonempty_string("direction", value, 16)?;
    }
    if input
        .auto_return_ms
        .is_some_and(|value| value > MAX_DELAY_MS)
    {
        return Err("autoReturnMs exceeds the 24 hour limit.".to_string());
    }
    Ok(())
}

fn validate_string(name: &str, value: &str, max: usize) -> Result<String, String> {
    if value.len() > max {
        return Err(format!("{name} exceeds the {max} byte limit."));
    }
    if value.contains('\0') {
        return Err(format!("{name} contains a NUL byte."));
    }
    Ok(value.to_string())
}

fn validate_nonempty_string(name: &str, value: &str, max: usize) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{name} must not be empty."));
    }
    validate_string(name, trimmed, max)
}

fn normalize_event_kind(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    match value.as_str() {
        "report" | "demo" | "self-test" => Ok(value),
        _ => Err("eventKind must be report, demo, or self-test.".to_string()),
    }
}

fn is_real_ai_report(source: &str, event_kind: Option<&str>) -> bool {
    if matches!(event_kind, Some("demo" | "self-test")) {
        return false;
    }
    if matches!(
        source.trim().to_ascii_lowercase().as_str(),
        "system" | "tray" | "renderer" | "reminder" | "auto-return" | "idle-timeout"
    ) {
        return false;
    }
    crate::source_registry::is_ai_source(source)
}

fn find_session_key(
    runtime: &RuntimeState,
    source: &str,
    session_id: Option<&str>,
) -> Option<SessionKey> {
    if let Some(session_id) = session_id {
        let key = SessionKey {
            source: source.to_string(),
            session_id: Some(session_id.to_string()),
        };
        return runtime.sessions.contains_key(&key).then_some(key);
    }
    let aggregate = SessionKey {
        source: source.to_string(),
        session_id: None,
    };
    if runtime.sessions.contains_key(&aggregate) {
        return Some(aggregate);
    }
    runtime
        .sessions
        .iter()
        .filter(|(key, _)| key.source == source)
        .max_by_key(|(_, record)| record.updated_at_ms)
        .map(|(key, _)| key.clone())
}

fn focused_from_key(key: &SessionKey) -> FocusedSession {
    FocusedSession {
        source: key.source.clone(),
        session_id: key.session_id.clone(),
    }
}

fn cleanup_sessions_locked(runtime: &mut RuntimeState, now: i64) {
    let cutoff = now.saturating_sub(SESSION_RETENTION_MS);
    runtime.sessions.retain(|key, record| {
        runtime.focused.as_ref() == Some(key) || record.updated_at_ms >= cutoff
    });
    if runtime
        .focused
        .as_ref()
        .is_some_and(|key| !runtime.sessions.contains_key(key))
    {
        runtime.focused = None;
    }
}

fn make_session_room_locked(runtime: &mut RuntimeState, key: &SessionKey) -> Result<(), String> {
    if runtime.sessions.contains_key(key) {
        return Ok(());
    }
    while runtime.sessions.len() >= MAX_SESSIONS {
        let candidate = runtime
            .sessions
            .iter()
            .filter(|(key, record)| {
                runtime.focused.as_ref() != Some(*key) && session_priority(record).0 == 0
            })
            .min_by(|(_, a), (_, b)| {
                a.updated_at_ms
                    .cmp(&b.updated_at_ms)
                    .then_with(|| a.snapshot.source.cmp(&b.snapshot.source))
                    .then_with(|| a.snapshot.session_id.cmp(&b.snapshot.session_id))
            })
            .map(|(key, _)| key.clone())
            .ok_or_else(|| {
                "Session limit reached; end an existing session before reporting a new one."
                    .to_string()
            })?;
        runtime.sessions.remove(&candidate);
    }
    Ok(())
}

fn now_ms_i64() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn now_ms() -> u128 {
    now_ms_i64().max(0) as u128
}

fn parse_timestamp_ms(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.timestamp_millis())
}

fn due_at_ms(input: &CreateReminderInput) -> i64 {
    let now = chrono::Utc::now();
    if let Some(value) = input.due_at.as_deref().or(input.at.as_deref()) {
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(value) {
            return parsed.timestamp_millis();
        }
    }
    if let Some(seconds) = input
        .in_seconds
        .filter(|value| value.is_finite() && *value >= 0.0)
    {
        return now.timestamp_millis() + (seconds * 1000.0).round() as i64;
    }
    if let Some(delay) = input.delay_ms {
        return now.timestamp_millis() + delay.min(MAX_DELAY_MS) as i64;
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
) -> Reminder {
    let now = chrono::Utc::now();
    let due_ms = due_at_ms(&input);
    let requested_id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let id = requested_id
        .filter(|value| value.len() <= MAX_EVENT_ID_LEN && !value.contains('\0'))
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "rem_{}_{}",
                now_ms(),
                NEXT_REMINDER_ID.fetch_add(1, Ordering::Relaxed)
            )
        });
    let text = input
        .text
        .clone()
        .or(input.message.clone())
        .unwrap_or_else(|| "Reminder".to_string());
    let text = truncate_string(&text, MAX_REMINDER_TEXT_LEN);
    let reminder = Reminder {
        id: id.clone(),
        text: text.clone(),
        due_at: chrono::DateTime::<chrono::Utc>::from_timestamp_millis(due_ms)
            .unwrap_or(now)
            .to_rfc3339(),
        created_at: now.to_rfc3339(),
        fired: false,
        fired_at: None,
        snooze_after_ms: input
            .snooze_after_ms
            .unwrap_or(5 * 60 * 1000)
            .min(MAX_DELAY_MS),
    };

    let generation = {
        let mut runtime = store.write().await;
        let mut list = reminders.write().await;
        if let Some(previous) = runtime.reminder_tasks.remove(&id) {
            previous.abort();
        }
        runtime.next_reminder_generation = runtime.next_reminder_generation.saturating_add(1);
        let generation = runtime.next_reminder_generation;
        runtime.reminder_generations.insert(id.clone(), generation);
        list.retain(|item| item.id != id);
        list.push(reminder.clone());
        while list.len() > MAX_REMINDERS {
            let index = list.iter().position(|item| item.fired).unwrap_or(0);
            let removed = list.remove(index);
            runtime.reminder_generations.remove(&removed.id);
            if let Some(task) = runtime.reminder_tasks.remove(&removed.id) {
                task.abort();
            }
        }
        let _ = reminder_tx.send(list.clone());
        generation
    };

    let store_for_fire = store.clone();
    let tx_for_fire = tx.clone();
    let reminders_for_fire = reminders.clone();
    let reminder_tx_for_fire = reminder_tx.clone();
    let duration_ms = input.duration_ms.unwrap_or(5000).min(MAX_DELAY_MS);
    let return_to = input.return_to.clone();
    let delay_ms = (due_ms - chrono::Utc::now().timestamp_millis())
        .max(0)
        .min(MAX_DELAY_MS as i64) as u64;
    let deadline = tokio::time::Instant::now() + Duration::from_millis(delay_ms);
    let store_for_registration = store.clone();
    let id_for_registration = id.clone();
    let task = tokio::spawn(async move {
        tokio::time::sleep_until(deadline).await;

        let (state_snapshot, reminder_snapshot, token) = {
            let mut runtime = store_for_fire.write().await;
            let mut list = reminders_for_fire.write().await;
            if runtime.reminder_generations.get(&id).copied() != Some(generation) {
                return;
            }
            let Some(item) = list.iter_mut().find(|item| item.id == id) else {
                return;
            };
            if item.fired {
                return;
            }
            item.fired = true;
            item.fired_at = Some(chrono::Utc::now().to_rfc3339());
            let effective = effective_snapshot_locked(&runtime);
            runtime.next_token = runtime.next_token.saturating_add(1);
            let token = runtime.next_token;
            let restore = runtime
                .overlay
                .as_ref()
                .map(|overlay| overlay.restore.clone())
                .unwrap_or(effective);
            runtime.overlay = Some(DisplayOverlay {
                token,
                reminder_id: Some(id.clone()),
                restore,
                return_to: return_to.clone().map(|value| normalize_state_id(&value)),
            });
            let display = CompanionState {
                state: "reminder".to_string(),
                id: "reminder".to_string(),
                message: text.clone(),
                source: "reminder".to_string(),
                direction: "right".to_string(),
                updated_at: chrono::Utc::now().to_rfc3339(),
                reminder_id: Some(id.clone()),
                auto_return_ms: Some(duration_ms),
                return_to: return_to.clone(),
                notify: None,
                source_label: None,
                session_id: None,
                event_id: None,
                sequence: None,
                session_ended: None,
                event_kind: None,
                revision: runtime.current.revision.saturating_add(1),
                last_report: None,
            };
            runtime.current = display.clone();
            runtime.auto_return = Some(AutoReturnGuard {
                token,
                reminder_id: true,
            });
            runtime.reminder_generations.remove(&id);
            runtime.reminder_tasks.remove(&id);
            let _ = reminder_tx_for_fire.send(list.clone());
            let _ = tx_for_fire.send(display.clone());
            (display, list.clone(), token)
        };
        let _ = reminder_snapshot;
        let _ = state_snapshot;
        spawn_auto_return(
            store_for_fire,
            tx_for_fire,
            tokio::time::Instant::now() + Duration::from_millis(duration_ms),
            AutoReturnGuard {
                token,
                reminder_id: true,
            },
        );
    });
    let abort = task.abort_handle();
    let mut runtime = store_for_registration.write().await;
    if runtime
        .reminder_generations
        .get(&id_for_registration)
        .copied()
        == Some(generation)
    {
        runtime.reminder_tasks.insert(id_for_registration, abort);
    } else {
        abort.abort();
    }

    reminder
}

pub async fn delete_reminder(
    store: &StateStore,
    tx: &StateBroadcast,
    reminders: &ReminderStore,
    reminder_tx: &ReminderBroadcast,
    id: &str,
) -> bool {
    let deleted = {
        let mut runtime = store.write().await;
        let mut list = reminders.write().await;
        let before = list.len();
        list.retain(|item| item.id != id);
        let deleted = list.len() != before;
        if deleted {
            if let Some(task) = runtime.reminder_tasks.remove(id) {
                task.abort();
            }
            runtime.reminder_generations.remove(id);
            let should_restore = runtime
                .overlay
                .as_ref()
                .is_some_and(|overlay| overlay.reminder_id.as_deref() == Some(id));
            let restored = should_restore.then(|| restore_overlay_locked(&mut runtime));
            let _ = reminder_tx.send(list.clone());
            if let Some(snapshot) = restored {
                let _ = tx.send(snapshot);
            }
        }
        deleted
    };
    deleted
}

fn truncate_string(value: &str, max: usize) -> String {
    if value.len() <= max {
        return value.to_string();
    }
    let mut end = max;
    while !value.is_char_boundary(end) {
        end = end.saturating_sub(1);
    }
    value[..end].to_string()
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

    #[tokio::test(start_paused = true)]
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
        .await
        .unwrap();
        assert_eq!(state.state, "reminder");
        for _ in 0..3 {
            tokio::task::yield_now().await;
        }
        tokio::time::advance(Duration::from_millis(20)).await;
        for _ in 0..3 {
            tokio::task::yield_now().await;
        }
        assert_eq!(get_state(&store).await.state, "working");
    }

    #[tokio::test(start_paused = true)]
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
        .await
        .unwrap();
        set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("reminder".to_string()),
                auto_return_ms: Some(20),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(get_state(&store).await.message, "");
        for _ in 0..3 {
            tokio::task::yield_now().await;
        }
        tokio::time::advance(Duration::from_millis(20)).await;
        for _ in 0..3 {
            tokio::task::yield_now().await;
        }
        assert_eq!(get_state(&store).await.state, "working");
        assert_eq!(get_state(&store).await.message, "Building");
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
        .await;
        assert_eq!(reminder.text, "Check");
        assert_eq!(list_reminders(&reminders).await.len(), 1);
        let created = reminder_rx.recv().await.unwrap();
        assert_eq!(created.len(), 1);
        assert!(!created[0].fired);
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(get_state(&store).await.state, "reminder");
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
        .await;

        assert_eq!(list_reminders(&reminders).await.len(), 1);
        assert!(list_reminders(&create_reminder_store()).await.is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn deleting_a_reminder_cancels_its_pending_timer() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("cancel-me".to_string()),
                text: Some("Do not fire".to_string()),
                delay_ms: Some(1_000),
                ..Default::default()
            },
        )
        .await;

        for _ in 0..3 {
            tokio::task::yield_now().await;
        }
        assert!(delete_reminder(&store, &tx, &reminders, &reminder_tx, "cancel-me").await);
        tokio::time::advance(Duration::from_secs(2)).await;
        for _ in 0..3 {
            tokio::task::yield_now().await;
        }

        assert!(list_reminders(&reminders).await.is_empty());
        assert_ne!(get_state(&store).await.state, "reminder");
    }

    #[tokio::test(start_paused = true)]
    async fn a_reminder_restores_the_effective_task_when_return_to_is_omitted() {
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
        .await
        .unwrap();
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                id: Some("restore-task".to_string()),
                text: Some("Break".to_string()),
                delay_ms: Some(1_000),
                duration_ms: Some(2_000),
                ..Default::default()
            },
        )
        .await;

        for _ in 0..3 {
            tokio::task::yield_now().await;
        }
        tokio::time::advance(Duration::from_secs(1)).await;
        for _ in 0..3 {
            tokio::task::yield_now().await;
        }
        assert_eq!(get_state(&store).await.state, "reminder");

        tokio::time::advance(Duration::from_secs(2)).await;
        for _ in 0..3 {
            tokio::task::yield_now().await;
        }
        let restored = get_state(&store).await;
        assert_eq!(restored.state, "working");
        assert_eq!(restored.source, "codex");
        assert_eq!(restored.message, "Building");
    }

    #[tokio::test]
    async fn duplicate_and_late_events_do_not_broadcast() {
        let (store, tx) = create_state_store("idle");
        let mut rx = tx.subscribe();
        let first = set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("working".to_string()),
                source: Some("codex-mcp".to_string()),
                session_id: Some("one".to_string()),
                event_id: Some("e1".to_string()),
                sequence: Some(2),
                event_kind: Some("report".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(rx.recv().await.is_ok());
        let duplicate = set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("failed".to_string()),
                source: Some("codex-mcp".to_string()),
                session_id: Some("one".to_string()),
                event_id: Some("e1".to_string()),
                sequence: Some(3),
                event_kind: Some("report".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(duplicate.revision, first.revision);
        assert_eq!(duplicate.state, first.state);
        assert!(duplicate.last_report.is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn replacing_temporary_displays_keeps_revisions_monotonic() {
        let (store, tx) = create_state_store("idle");
        let working = set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("working".into()),
                source: Some("codex-mcp".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let first = set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("reminder".into()),
                source: Some("renderer".into()),
                auto_return_ms: Some(500),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let second = set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("reviewing".into()),
                source: Some("renderer".into()),
                event_kind: Some("demo".into()),
                auto_return_ms: Some(1000),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(first.revision > working.revision);
        assert!(second.revision > first.revision);
        let ignored = dismiss_display(&store, &tx, first.revision).await;
        assert_eq!(ignored, second);
    }

    #[tokio::test]
    async fn waiting_outranks_newer_running_reports() {
        let (store, tx) = create_state_store("idle");
        for (state, session) in [("waiting", "approval"), ("running", "tests")] {
            set_state(
                &store,
                &tx,
                SetStateInput {
                    state: Some(state.into()),
                    source: Some("codex-mcp".into()),
                    session_id: Some(session.into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        }
        assert_eq!(
            get_state(&store).await.session_id.as_deref(),
            Some("approval")
        );
    }

    #[tokio::test]
    async fn dismissing_a_focused_completion_restores_unfinished_work() {
        let (store, tx) = create_state_store("idle");
        for (state, session) in [("working", "A"), ("success", "B")] {
            set_state(
                &store,
                &tx,
                SetStateInput {
                    state: Some(state.into()),
                    source: Some("codex-mcp".into()),
                    session_id: Some(session.into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        }
        let focused = focus_session(&store, &tx, Some("codex-mcp".into()), Some("B".into()))
            .await
            .unwrap();
        let dismissed = dismiss_display(&store, &tx, focused.revision).await;
        assert_eq!(dismissed.state, "working");
        assert_eq!(dismissed.session_id.as_deref(), Some("A"));
        assert_eq!(dismissed.notify, Some(false));
        assert!(list_sessions(&store).await.focused.is_none());
    }

    #[tokio::test]
    async fn ended_sessions_ignore_late_reports_without_inventing_a_result() {
        let (store, tx) = create_state_store("idle");
        let ended = set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("working".into()),
                source: Some("codex-mcp".into()),
                session_id: Some("A".into()),
                session_ended: Some(true),
                sequence: Some(2),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let mut events = tx.subscribe();
        let late = set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("success".into()),
                source: Some("codex-mcp".into()),
                session_id: Some("A".into()),
                sequence: Some(3),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(late.revision, ended.revision);
        let session = &list_sessions(&store).await.sessions[0];
        assert!(session.ended);
        assert_eq!(session.state, "working");
        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn report_identity_is_normalized_consistently_with_focus() {
        let (store, tx) = create_state_store("idle");
        for source in [" Codex-MCP ", "codex-mcp"] {
            set_state(
                &store,
                &tx,
                SetStateInput {
                    state: Some("working".into()),
                    source: Some(source.into()),
                    session_id: Some(" session-1 ".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        }
        let sessions = list_sessions(&store).await;
        assert_eq!(sessions.sessions.len(), 1);
        assert_eq!(sessions.sessions[0].source, "codex-mcp");
        assert!(focus_session(
            &store,
            &tx,
            Some(" CODEX-MCP ".into()),
            Some("session-1".into())
        )
        .await
        .is_ok());
    }

    #[tokio::test]
    async fn capacity_never_silently_evicts_unfinished_sessions() {
        let (store, tx) = create_state_store("idle");
        for i in 0..MAX_SESSIONS {
            set_state(
                &store,
                &tx,
                SetStateInput {
                    state: Some("working".into()),
                    source: Some("codex-mcp".into()),
                    session_id: Some(format!("job-{i}")),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        }
        let before = get_state(&store).await;
        let result = set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("working".into()),
                source: Some("codex-mcp".into()),
                session_id: Some("overflow".into()),
                ..Default::default()
            },
        )
        .await;
        assert!(result.unwrap_err().contains("Session limit"));
        assert_eq!(get_state(&store).await, before);
        set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("success".into()),
                source: Some("codex-mcp".into()),
                session_id: Some("job-0".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("working".into()),
                source: Some("codex-mcp".into()),
                session_id: Some("overflow".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let sessions = list_sessions(&store).await;
        assert_eq!(sessions.sessions.len(), MAX_SESSIONS);
        assert!(!sessions
            .sessions
            .iter()
            .any(|session| session.session_id.as_deref() == Some("job-0")));
    }

    #[tokio::test]
    async fn focused_work_is_not_removed_by_retention_cleanup() {
        let (store, tx) = create_state_store("idle");
        set_state(
            &store,
            &tx,
            SetStateInput {
                state: Some("working".into()),
                source: Some("codex-mcp".into()),
                session_id: Some("focus".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        focus_session(&store, &tx, Some("codex-mcp".into()), Some("focus".into()))
            .await
            .unwrap();
        {
            let mut runtime = store.write().await;
            let old = now_ms_i64() - SESSION_RETENTION_MS - 1;
            for record in runtime.sessions.values_mut() {
                record.updated_at_ms = old;
            }
        }
        let list = list_sessions(&store).await;
        assert!(list.focused.is_some());
        assert_eq!(list.sessions.len(), 1);
        assert!(list.sessions[0].stale);
        assert_eq!(list.sessions[0].state, "working");
    }
}
