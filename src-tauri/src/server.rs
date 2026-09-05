use axum::{
    extract::{Path, State as AxumState},
    http::{header, HeaderMap, Method, StatusCode, Uri},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Json, Response,
    },
    routing::{delete, get, post},
    Router,
};
use serde_json::json;
use std::convert::Infallible;
use std::net::IpAddr;
use std::path::{Path as FsPath, PathBuf};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::state::{
    create_reminder, delete_reminder, dismiss_display, focus_session, get_state as read_state,
    list_reminders, list_sessions, set_state, CompanionState, CreateReminderInput, Reminder,
    ReminderBroadcast, ReminderStore, SetStateInput, StateBroadcast, StateStore,
};
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, RwLock};

pub type AssetRootStore = Arc<RwLock<Option<PathBuf>>>;
pub type PublicConfigStore = Arc<Mutex<serde_json::Value>>;
pub type HistoryStore = Arc<Mutex<Vec<crate::state::CompanionState>>>;

#[derive(Clone)]
pub struct AppState {
    pub store: StateStore,
    pub tx: StateBroadcast,
    pub reminders: ReminderStore,
    pub reminder_tx: ReminderBroadcast,
    pub asset_root: AssetRootStore,
    pub preview_root: PathBuf,
    pub public_config: PublicConfigStore,
    pub history: HistoryStore,
}

fn validate_loopback_host(host: &str) -> Result<(), String> {
    let value = host.trim();
    if value.eq_ignore_ascii_case("localhost")
        || value
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
    {
        return Ok(());
    }
    Err(format!(
        "Companion API host \"{value}\" must be loopback in v0.2.6."
    ))
}

fn origin_is_allowed(origin: &str) -> bool {
    if origin == "null" {
        return true;
    }
    let Ok(uri) = origin.parse::<Uri>() else {
        return false;
    };
    if uri.path() != "/" || uri.query().is_some() {
        return false;
    }
    let Some(scheme) = uri.scheme_str() else {
        return false;
    };
    let Some(authority) = uri.authority() else {
        return false;
    };
    if authority.as_str().contains('@') {
        return false;
    }
    let host = authority.host().trim_matches(['[', ']']);
    if scheme == "tauri" {
        return host.eq_ignore_ascii_case("localhost");
    }
    if scheme != "http" && scheme != "https" {
        return false;
    }
    host.eq_ignore_ascii_case("tauri.localhost") || validate_loopback_host(host).is_ok()
}

fn loopback_cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _| {
            origin.to_str().is_ok_and(origin_is_allowed)
        }))
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers(tower_http::cors::Any)
}

async fn health(AxumState(app): AxumState<AppState>) -> impl IntoResponse {
    let state = read_state(&app.store).await;
    Json(json!({ "ok": true, "state": state }))
}

async fn get_state(AxumState(app): AxumState<AppState>) -> impl IntoResponse {
    let state = read_state(&app.store).await;
    Json(state)
}

async fn get_config(AxumState(app): AxumState<AppState>) -> impl IntoResponse {
    let config = app
        .public_config
        .lock()
        .map(|value| value.clone())
        .unwrap_or_else(|_| json!({}));
    Json(config)
}

async fn get_history(AxumState(app): AxumState<AppState>) -> impl IntoResponse {
    let history = app
        .history
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    Json(json!({ "history": history }))
}

async fn post_state(
    AxumState(app): AxumState<AppState>,
    Json(input): Json<SetStateInput>,
) -> Response {
    state_response(set_state(&app.store, &app.tx, input).await)
}

async fn post_state_by_id(
    AxumState(app): AxumState<AppState>,
    Path(id): Path<String>,
    Json(mut input): Json<SetStateInput>,
) -> Response {
    input.state = Some(id);
    state_response(set_state(&app.store, &app.tx, input).await)
}

fn state_response(result: Result<crate::state::CompanionState, String>) -> Response {
    match result {
        Ok(state) => Json(state).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response(),
    }
}

#[derive(serde::Deserialize)]
pub struct FocusSessionInput {
    pub source: Option<String>,
    #[serde(default, rename = "sessionId")]
    pub session_id: Option<String>,
}

#[derive(serde::Deserialize)]
struct DismissInput {
    revision: u64,
}

async fn get_sessions(AxumState(app): AxumState<AppState>) -> impl IntoResponse {
    Json(list_sessions(&app.store).await)
}

async fn post_focus_session(
    AxumState(app): AxumState<AppState>,
    Json(input): Json<FocusSessionInput>,
) -> Response {
    state_response(focus_session(&app.store, &app.tx, input.source, input.session_id).await)
}

async fn post_dismiss_state(
    AxumState(app): AxumState<AppState>,
    Json(input): Json<DismissInput>,
) -> impl IntoResponse {
    Json(dismiss_display(&app.store, &app.tx, input.revision).await)
}

async fn get_reminders(AxumState(app): AxumState<AppState>) -> impl IntoResponse {
    Json(json!({ "reminders": list_reminders(&app.reminders).await }))
}

async fn post_reminder(
    AxumState(app): AxumState<AppState>,
    Json(input): Json<CreateReminderInput>,
) -> Response {
    match create_reminder(&app.store, &app.tx, &app.reminders, &app.reminder_tx, input).await {
        Ok(reminder) => (StatusCode::CREATED, Json(reminder)).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response(),
    }
}

async fn delete_reminder_route(
    AxumState(app): AxumState<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let deleted = delete_reminder(&app.store, &app.tx, &app.reminders, &app.reminder_tx, &id).await;
    let status = if deleted {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    };
    (status, Json(json!({ "deleted": deleted, "id": id })))
}

async fn subscribe_state_channel(
    store: &StateStore,
    tx: &StateBroadcast,
) -> (broadcast::Receiver<CompanionState>, CompanionState) {
    // The state store does not expose its internal runtime fields here.  Subscribe
    // first, then use the monotonic display revision to discard events that belong
    // to the snapshot (or an earlier one) while retaining every newer update.
    let rx = tx.subscribe();
    let initial = read_state(store).await;
    (rx, initial)
}

async fn subscribe_reminder_channel(
    reminders: &ReminderStore,
    tx: &ReminderBroadcast,
) -> (broadcast::Receiver<Vec<Reminder>>, Vec<Reminder>) {
    // All reminder producers hold this store's write lock while broadcasting.  A
    // read lock therefore makes subscription and cloning one indivisible boundary:
    // events before it are represented by the snapshot, and events after it remain
    // queued for the receiver.
    let list = reminders.read().await;
    let rx = tx.subscribe();
    (rx, list.clone())
}

fn state_update_stream(
    rx: broadcast::Receiver<CompanionState>,
    initial_revision: u64,
) -> impl futures::Stream<Item = CompanionState> {
    BroadcastStream::new(rx).filter_map(move |result| {
        result
            .ok()
            .filter(|state| state.revision > initial_revision)
    })
}

fn state_event_stream(
    rx: broadcast::Receiver<CompanionState>,
    initial_revision: u64,
) -> impl futures::Stream<Item = Result<Event, Infallible>> {
    state_update_stream(rx, initial_revision)
        .map(|state| Ok::<_, Infallible>(Event::default().event("state").json_data(state).unwrap()))
}

fn reminder_event_stream(
    rx: broadcast::Receiver<Vec<Reminder>>,
) -> impl futures::Stream<Item = Result<Event, Infallible>> {
    BroadcastStream::new(rx).filter_map(|result| {
        result.ok().map(|reminders| {
            Ok::<_, Infallible>(
                Event::default()
                    .event("reminders")
                    .json_data(reminders)
                    .unwrap(),
            )
        })
    })
}

/*
 * State and reminder events are independent channels; no ordering guarantee is
 * made between their respective SSE event names.
 */
async fn events(AxumState(app): AxumState<AppState>) -> impl IntoResponse {
    let (rx, initial) = subscribe_state_channel(&app.store, &app.tx).await;
    let initial_revision = initial.revision;
    let (reminder_rx, initial_reminders) =
        subscribe_reminder_channel(&app.reminders, &app.reminder_tx).await;

    let initial_event = futures::stream::once(async move {
        Ok::<_, Infallible>(Event::default().event("state").json_data(initial).unwrap())
    });
    let initial_reminders_event = futures::stream::once(async move {
        Ok::<_, Infallible>(
            Event::default()
                .event("reminders")
                .json_data(initial_reminders)
                .unwrap(),
        )
    });

    let stream = state_event_stream(rx, initial_revision);
    let reminder_stream = reminder_event_stream(reminder_rx);

    let live_stream = futures::stream::select(stream, reminder_stream);
    Sse::new(
        initial_event
            .chain(initial_reminders_event)
            .chain(live_stream),
    )
    .keep_alive(KeepAlive::default())
}

fn file_content_type(file: &FsPath) -> &'static str {
    match file
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "atlas" => "text/plain; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "skel" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}

fn encode_url_path_segment(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{:02X}", byte),
        })
        .collect::<Vec<_>>()
        .join("")
}

fn encode_atlas_texture_line(line: &str) -> String {
    let trimmed = line.trim();
    let lower = trimmed.to_ascii_lowercase();
    let looks_like_texture = !trimmed.is_empty()
        && !line.starts_with(char::is_whitespace)
        && (lower.ends_with(".png")
            || lower.ends_with(".jpg")
            || lower.ends_with(".jpeg")
            || lower.ends_with(".webp"));
    if looks_like_texture {
        encode_url_path_segment(trimmed)
    } else {
        line.to_string()
    }
}

fn rewrite_atlas_texture_urls(text: &str) -> String {
    text.lines()
        .map(encode_atlas_texture_line)
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_inside(root: &FsPath, file: &FsPath) -> bool {
    file.strip_prefix(root).is_ok()
}

async fn get_spine_asset(
    AxumState(app): AxumState<AppState>,
    Path(relative): Path<String>,
) -> Response {
    let root = app.asset_root.read().await.clone();
    let Some(root) = root.as_ref() else {
        return (StatusCode::NOT_FOUND, "No Spine assetDir is configured.").into_response();
    };
    let relative = relative.trim_start_matches(['/', '\\']);
    let file = root.join(relative);
    let Ok(file) = file.canonicalize() else {
        return (StatusCode::NOT_FOUND, "Asset not found").into_response();
    };
    if !is_inside(root, &file) || !file.is_file() {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    match tokio::fs::read(&file).await {
        Ok(bytes) => {
            let mut headers = HeaderMap::new();
            headers.insert(
                header::CONTENT_TYPE,
                header::HeaderValue::from_static(file_content_type(&file)),
            );
            if file
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("atlas"))
                .unwrap_or(false)
            {
                let text = String::from_utf8_lossy(&bytes);
                return (StatusCode::OK, headers, rewrite_atlas_texture_urls(&text))
                    .into_response();
            }
            (StatusCode::OK, headers, bytes).into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "Asset not found").into_response(),
    }
}

async fn get_preview_asset(
    AxumState(app): AxumState<AppState>,
    Path((model_id, relative)): Path<(String, String)>,
) -> Response {
    if model_id.is_empty() || model_id == "." || model_id == ".." || model_id.contains(['/', '\\'])
    {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    let root = app.preview_root.join(model_id);
    let Ok(root) = root.canonicalize() else {
        return (StatusCode::NOT_FOUND, "Preview not found").into_response();
    };
    let relative = relative.trim_start_matches(['/', '\\']);
    let Ok(file) = root.join(relative).canonicalize() else {
        return (StatusCode::NOT_FOUND, "Preview asset not found").into_response();
    };
    if !is_inside(&root, &file) || !file.is_file() {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    match tokio::fs::read(&file).await {
        Ok(bytes) => {
            let mut headers = HeaderMap::new();
            headers.insert(
                header::CONTENT_TYPE,
                header::HeaderValue::from_static(file_content_type(&file)),
            );
            if file
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("atlas"))
                .unwrap_or(false)
            {
                let text = String::from_utf8_lossy(&bytes);
                return (StatusCode::OK, headers, rewrite_atlas_texture_urls(&text))
                    .into_response();
            }
            (StatusCode::OK, headers, bytes).into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "Preview asset not found").into_response(),
    }
}

fn build_router(app_state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/state", get(get_state).post(post_state))
        .route("/config", get(get_config))
        .route("/history", get(get_history))
        .route("/state/:id", post(post_state_by_id))
        .route("/reminders", get(get_reminders).post(post_reminder))
        .route("/sessions", get(get_sessions))
        .route("/sessions/focus", post(post_focus_session))
        .route("/state/dismiss", post(post_dismiss_state))
        .route("/reminders/:id", delete(delete_reminder_route))
        .route("/events", get(events))
        .route("/assets/spine/*path", get(get_spine_asset))
        .route("/assets/previews/:model_id/*path", get(get_preview_asset))
        .layer(loopback_cors())
        .with_state(app_state)
}

pub async fn start_api_server(
    app_state: AppState,
    host: &str,
    port: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    validate_loopback_host(host)
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
    let addresses = tokio::net::lookup_host((host, port))
        .await?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| !address.ip().is_loopback()) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("Companion API host \"{host}\" resolved outside loopback."),
        )
        .into());
    }
    let addr = addresses[0];
    let app = build_router(app_state);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Companion API listening on {}", listener.local_addr()?);

    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{create_reminder_broadcast, create_reminder_store, create_state_store};
    use axum::{body::Body, http::Request};
    use futures::StreamExt as FuturesStreamExt;
    use tower::ServiceExt;

    #[test]
    fn accepts_only_loopback_api_hosts() {
        for host in ["localhost", "127.0.0.1", "127.42.0.7", "::1"] {
            assert!(validate_loopback_host(host).is_ok(), "{host}");
        }
        for host in [
            "0.0.0.0",
            "192.168.1.10",
            "example.com",
            "127.0.0.1.example.com",
        ] {
            assert!(validate_loopback_host(host).is_err(), "{host}");
        }
    }

    #[test]
    fn cors_accepts_tauri_and_real_loopback_origins() {
        for origin in [
            "null",
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
            "http://localhost:17389",
            "https://127.42.0.7",
            "http://[::1]:17389",
        ] {
            assert!(origin_is_allowed(origin), "{origin}");
        }
    }

    #[test]
    fn cors_rejects_malicious_similar_hosts() {
        for origin in [
            "http://localhost.example.com",
            "http://127.0.0.1.example.com",
            "https://tauri.localhost.example.com",
            "http://example.com",
            "ws://127.0.0.1:17388",
            "http://user@localhost",
            "http://localhost/path",
        ] {
            assert!(!origin_is_allowed(origin), "{origin}");
        }
    }

    #[tokio::test]
    async fn file_type_matches_spine_assets() {
        assert_eq!(file_content_type(FsPath::new("a.png")), "image/png");
        assert_eq!(
            file_content_type(FsPath::new("a.atlas")),
            "text/plain; charset=utf-8"
        );
        assert_eq!(
            file_content_type(FsPath::new("a.skel")),
            "application/octet-stream"
        );
    }

    #[tokio::test]
    async fn app_state_can_store_reminders() {
        let (store, tx) = create_state_store("idle");
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        let reminder = create_reminder(
            &store,
            &tx,
            &reminders,
            &reminder_tx,
            CreateReminderInput {
                text: Some("API".to_string()),
                delay_ms: Some(1000),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(reminder.text, "API");
        assert_eq!(list_reminders(&reminders).await.len(), 1);
    }

    fn state_fixture() -> (Router, AppState) {
        let (store, tx) = create_state_store("idle");
        let data = AppState {
            store,
            tx,
            reminders: create_reminder_store(),
            reminder_tx: create_reminder_broadcast(),
            asset_root: Arc::new(RwLock::new(None)),
            preview_root: std::env::temp_dir(),
            public_config: Arc::new(Mutex::new(json!({}))),
            history: Arc::new(Mutex::new(Vec::new())),
        };
        (build_router(data.clone()), data)
    }

    async fn request_json(
        app: &Router,
        method: &str,
        uri: &str,
        body: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test(start_paused = true)]
    async fn reminder_capacity_errors_are_preserved_by_http() {
        let (app, data) = state_fixture();
        for index in 0..128 {
            assert_eq!(
                request_json(
                    &app,
                    "POST",
                    "/reminders",
                    json!({"id":format!("bounded-{index}"), "delayMs":60000})
                )
                .await
                .0,
                StatusCode::CREATED
            );
        }
        assert_eq!(
            request_json(
                &app,
                "POST",
                "/reminders",
                json!({"id":"overflow", "delayMs":60000})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(list_reminders(&data.reminders).await.len(), 128);
    }

    #[tokio::test(start_paused = true)]
    async fn http_cancellation_prevents_late_state_and_notification_events() {
        let (app, data) = state_fixture();
        let mut events = data.tx.subscribe();
        assert_eq!(
            request_json(
                &app,
                "POST",
                "/reminders",
                json!({"id":"cancel", "delayMs":1000})
            )
            .await
            .0,
            StatusCode::CREATED
        );
        assert_eq!(
            request_json(&app, "DELETE", "/reminders/cancel", json!({}))
                .await
                .0,
            StatusCode::OK
        );
        assert_eq!(
            request_json(&app, "DELETE", "/reminders/cancel", json!({}))
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        tokio::time::advance(std::time::Duration::from_secs(2)).await;
        tokio::task::yield_now().await;
        assert_eq!(
            request_json(&app, "GET", "/state", json!({})).await.1["state"],
            "idle"
        );
        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn http_sessions_preserve_aliases_reject_late_events_and_guard_dismissal() {
        let (app, _data) = state_fixture();
        let (status, _) = request_json(&app, "POST", "/state", json!({"id":"workING", "source":"codex-mcp", "sessionId":"A", "sequence":2, "eventId":"A-2"})).await;
        assert_eq!(status, StatusCode::OK);
        let (_, after_b) = request_json(&app, "POST", "/state", json!({"state":"success", "source":"codex-mcp", "sessionId":"B", "sequence":1, "eventId":"B-1"})).await;
        assert_eq!(after_b["state"], "working");
        assert_eq!(after_b["lastReport"]["sessionId"], "B");
        let (_, late) = request_json(
            &app,
            "POST",
            "/state",
            json!({"state":"failed", "source":"codex-mcp", "sessionId":"A", "sequence":1}),
        )
        .await;
        assert_eq!(late["revision"], after_b["revision"]);
        let (_, duplicate) = request_json(&app, "POST", "/state", json!({"state":"failed", "source":"codex-mcp", "sessionId":"B", "sequence":1, "eventId":"B-1"})).await;
        assert_eq!(duplicate["revision"], after_b["revision"]);
        let (_, list) = request_json(&app, "GET", "/sessions", json!({})).await;
        assert_eq!(list["sessions"].as_array().unwrap().len(), 2);
        let (_, focused) = request_json(
            &app,
            "POST",
            "/sessions/focus",
            json!({"source":"codex-mcp", "sessionId":"B"}),
        )
        .await;
        assert_eq!(focused["state"], "success");
        assert!(focused.get("lastReport").is_none());
        let (_, stale_dismiss) = request_json(
            &app,
            "POST",
            "/state/dismiss",
            json!({"revision":after_b["revision"]}),
        )
        .await;
        assert_eq!(stale_dismiss["revision"], focused["revision"]);
        assert_eq!(
            request_json(&app, "POST", "/sessions/focus", json!({"source":null}))
                .await
                .1["state"],
            "working"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn http_reminder_returns_to_latest_work_not_idle() {
        let (app, _) = state_fixture();
        request_json(
            &app,
            "POST",
            "/state",
            json!({"state":"working", "source":"codex-mcp"}),
        )
        .await;
        request_json(
            &app,
            "POST",
            "/reminders",
            json!({"id":"break", "delayMs":1000, "durationMs":2000}),
        )
        .await;
        tokio::time::advance(std::time::Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        assert_eq!(
            request_json(&app, "GET", "/state", json!({})).await.1["state"],
            "reminder"
        );
        request_json(
            &app,
            "POST",
            "/state",
            json!({"state":"running", "source":"codex-mcp", "message":"Tests still running"}),
        )
        .await;
        tokio::time::advance(std::time::Duration::from_secs(2)).await;
        tokio::task::yield_now().await;
        let (_, restored) = request_json(&app, "GET", "/state", json!({})).await;
        assert_eq!(restored["state"], "running");
        assert_eq!(restored["message"], "Tests still running");
        assert_eq!(restored["source"], "codex-mcp");
    }

    #[tokio::test]
    async fn state_sse_drops_snapshot_revision_but_keeps_newer_updates() {
        let (tx, _) = broadcast::channel(8);
        let rx = tx.subscribe();
        let mut stream = state_update_stream(rx, 7);

        let snapshot = CompanionState {
            revision: 7,
            ..Default::default()
        };
        tx.send(snapshot).unwrap();

        let newer = CompanionState {
            state: "working".to_string(),
            id: "working".to_string(),
            revision: 8,
            ..Default::default()
        };
        tx.send(newer.clone()).unwrap();

        assert_eq!(FuturesStreamExt::next(&mut stream).await, Some(newer));
    }

    #[tokio::test]
    async fn reminder_sse_snapshot_boundary_does_not_replay_locked_update() {
        let reminders = create_reminder_store();
        let reminder_tx = create_reminder_broadcast();
        let first = Reminder {
            id: "first".to_string(),
            text: "First".to_string(),
            due_at: "2026-01-01T00:00:00Z".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            fired: false,
            fired_at: None,
            snooze_after_ms: 300_000,
        };

        // Match the producer critical section: mutate, broadcast, then release
        // the write lock. The subscriber must observe this in its initial list,
        // rather than replaying the already-accounted-for broadcast.
        let mut writer = reminders.write().await;
        writer.push(first.clone());
        let preexisting_receiver = reminder_tx.subscribe();
        reminder_tx.send(writer.clone()).unwrap();
        drop(preexisting_receiver);
        let reminders_for_subscriber = reminders.clone();
        let tx_for_subscriber = reminder_tx.clone();
        let subscriber = tokio::spawn(async move {
            subscribe_reminder_channel(&reminders_for_subscriber, &tx_for_subscriber).await
        });
        tokio::task::yield_now().await;
        drop(writer);

        let (mut rx, initial) = subscriber.await.unwrap();
        assert_eq!(initial.len(), 1);
        assert_eq!(initial[0].id, "first");
        assert!(matches!(
            rx.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        ));

        let second = Reminder {
            id: "second".to_string(),
            text: "Second".to_string(),
            due_at: "2026-01-01T00:00:01Z".to_string(),
            created_at: "2026-01-01T00:00:01Z".to_string(),
            fired: false,
            fired_at: None,
            snooze_after_ms: 300_000,
        };
        let update = {
            let mut writer = reminders.write().await;
            writer.push(second);
            let update = writer.clone();
            reminder_tx.send(update.clone()).unwrap();
            update
        };
        let observed = rx.recv().await.unwrap();
        assert_eq!(observed.len(), update.len());
        assert_eq!(observed.last().map(|item| item.id.as_str()), Some("second"));
    }

    #[tokio::test]
    async fn rejects_non_loopback_host_before_binding() {
        let (store, tx) = create_state_store("idle");
        let error = start_api_server(
            AppState {
                store,
                tx,
                reminders: create_reminder_store(),
                reminder_tx: create_reminder_broadcast(),
                asset_root: Arc::new(RwLock::new(None)),
                preview_root: std::env::temp_dir(),
                public_config: Arc::new(Mutex::new(json!({}))),
                history: Arc::new(Mutex::new(Vec::new())),
            },
            "0.0.0.0",
            0,
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("loopback"));
    }

    #[test]
    fn strips_route_wildcard_leading_slash_for_asset_paths() {
        let relative = "/amiya.skel".trim_start_matches(['/', '\\']);
        assert_eq!(relative, "amiya.skel");
    }

    #[test]
    fn rewrites_hash_texture_names_in_atlas_text() {
        let text = "build_char_1001_amiya2_sale#16.png\nsize: 956,956\nB_HandD_FA\n  rotate: true";
        let rewritten = rewrite_atlas_texture_urls(text);
        assert!(rewritten.starts_with("build_char_1001_amiya2_sale%2316.png\n"));
        assert!(rewritten.contains("\nB_HandD_FA\n"));
    }

    #[tokio::test]
    async fn preview_asset_route_serves_a_cached_model_file() {
        let root = std::env::temp_dir().join(format!(
            "spine-companion-preview-route-{}",
            std::process::id()
        ));
        let model_dir = root.join("amiya");
        std::fs::create_dir_all(&model_dir).unwrap();
        std::fs::write(model_dir.join("model.skel"), b"preview").unwrap();
        let (store, tx) = create_state_store("idle");
        let app = build_router(AppState {
            store,
            tx,
            reminders: create_reminder_store(),
            reminder_tx: create_reminder_broadcast(),
            asset_root: Arc::new(RwLock::new(None)),
            preview_root: root.clone(),
            public_config: Arc::new(Mutex::new(json!({}))),
            history: Arc::new(Mutex::new(Vec::new())),
        });

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/assets/previews/amiya/model.skel")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let _ = std::fs::remove_dir_all(root);
    }
}
