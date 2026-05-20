use axum::{
    extract::{Path, State as AxumState},
    http::{header, HeaderMap, Method, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Json, Response,
    },
    routing::{get, post},
    Router,
};
use serde_json::json;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::{Path as FsPath, PathBuf};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::state::{
    create_reminder, list_reminders, set_state, CreateReminderInput, ReminderStore, SetStateInput,
    StateBroadcast, StateStore,
};
use std::sync::Arc;
use tokio::sync::RwLock;

pub type AssetRootStore = Arc<RwLock<Option<PathBuf>>>;

#[derive(Clone)]
pub struct AppState {
    pub store: StateStore,
    pub tx: StateBroadcast,
    pub reminders: ReminderStore,
    pub asset_root: AssetRootStore,
}

fn localhost_cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _| {
            if let Ok(s) = origin.to_str() {
                s.starts_with("http://127.0.0.1")
                    || s.starts_with("http://localhost")
                    || s.starts_with("http://tauri.localhost")
                    || s.starts_with("https://tauri.localhost")
                    || s.starts_with("tauri://localhost")
                    || s == "null"
            } else {
                false
            }
        }))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(tower_http::cors::Any)
}

async fn health(AxumState(app): AxumState<AppState>) -> impl IntoResponse {
    let state = app.store.read().await.clone();
    Json(json!({ "ok": true, "state": state }))
}

async fn get_state(AxumState(app): AxumState<AppState>) -> impl IntoResponse {
    let state = app.store.read().await.clone();
    Json(state)
}

async fn post_state(
    AxumState(app): AxumState<AppState>,
    Json(input): Json<SetStateInput>,
) -> impl IntoResponse {
    let result = set_state(&app.store, &app.tx, input).await;
    Json(result)
}

async fn post_state_by_id(
    AxumState(app): AxumState<AppState>,
    Path(id): Path<String>,
    Json(mut input): Json<SetStateInput>,
) -> impl IntoResponse {
    input.state = Some(id);
    let result = set_state(&app.store, &app.tx, input).await;
    Json(result)
}

async fn get_reminders(AxumState(app): AxumState<AppState>) -> impl IntoResponse {
    Json(json!({ "reminders": list_reminders(&app.reminders).await }))
}

async fn post_reminder(
    AxumState(app): AxumState<AppState>,
    Json(input): Json<CreateReminderInput>,
) -> impl IntoResponse {
    let reminder = create_reminder(&app.store, &app.tx, &app.reminders, input).await;
    (StatusCode::CREATED, Json(reminder))
}

async fn events(AxumState(app): AxumState<AppState>) -> impl IntoResponse {
    let rx = app.tx.subscribe();
    let initial = app.store.read().await.clone();

    let initial_event = futures::stream::once(async move {
        Ok::<_, Infallible>(Event::default().event("state").json_data(initial).unwrap())
    });

    let stream = BroadcastStream::new(rx).filter_map(|result| {
        result.ok().map(|state| {
            Ok::<_, Infallible>(Event::default().event("state").json_data(state).unwrap())
        })
    });

    Sse::new(initial_event.chain(stream)).keep_alive(KeepAlive::default())
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

pub async fn start_api_server(
    store: StateStore,
    tx: StateBroadcast,
    reminders: ReminderStore,
    asset_root: AssetRootStore,
    host: &str,
    port: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    let app_state = AppState {
        store,
        tx,
        reminders,
        asset_root,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/state", get(get_state).post(post_state))
        .route("/state/{id}", post(post_state_by_id))
        .route("/reminders", get(get_reminders).post(post_reminder))
        .route("/events", get(events))
        .route("/assets/spine/*path", get(get_spine_asset))
        .layer(localhost_cors())
        .with_state(app_state);

    let addr: SocketAddr = format!("{}:{}", host, port).parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Companion API listening on {}", addr);

    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{create_reminder_store, create_state_store};

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
        let reminder = create_reminder(
            &store,
            &tx,
            &reminders,
            CreateReminderInput {
                text: Some("API".to_string()),
                delay_ms: Some(1000),
                ..Default::default()
            },
        )
        .await;
        assert_eq!(reminder.text, "API");
        assert_eq!(list_reminders(&reminders).await.len(), 1);
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
}
