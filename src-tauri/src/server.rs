use axum::{
    extract::{Path, State as AxumState},
    http::{Method, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Json,
    },
    routing::{get, post},
    Router,
};
use serde_json::json;
use std::convert::Infallible;
use std::net::SocketAddr;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::state::{
    set_state, CreateReminderInput, SetStateInput, StateBroadcast, StateStore,
};

#[derive(Clone)]
pub struct AppState {
    pub store: StateStore,
    pub tx: StateBroadcast,
}

fn localhost_cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _| {
            if let Ok(s) = origin.to_str() {
                s.starts_with("http://127.0.0.1") || s.starts_with("http://localhost")
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

async fn get_reminders() -> impl IntoResponse {
    // Simplified — reminders will be managed via Tauri commands
    Json(json!({ "reminders": [] }))
}

async fn post_reminder(
    Json(_input): Json<CreateReminderInput>,
) -> impl IntoResponse {
    (StatusCode::CREATED, Json(json!({ "id": "todo", "text": "todo" })))
}

async fn events(AxumState(app): AxumState<AppState>) -> impl IntoResponse {
    let rx = app.tx.subscribe();
    let initial = app.store.read().await.clone();

    let initial_event = futures::stream::once(async move {
        Ok::<_, Infallible>(
            Event::default()
                .event("state")
                .json_data(initial)
                .unwrap(),
        )
    });

    let stream = BroadcastStream::new(rx).filter_map(|result| {
        result.ok().map(|state| {
            Ok::<_, Infallible>(Event::default().event("state").json_data(state).unwrap())
        })
    });

    Sse::new(initial_event.chain(stream)).keep_alive(KeepAlive::default())
}

pub async fn start_api_server(
    store: StateStore,
    tx: StateBroadcast,
    host: &str,
    port: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    let app_state = AppState {
        store,
        tx,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/state", get(get_state).post(post_state))
        .route("/state/{id}", post(post_state_by_id))
        .route("/reminders", get(get_reminders).post(post_reminder))
        .route("/events", get(events))
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
