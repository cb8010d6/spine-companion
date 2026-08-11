# Runtime Bridge

[English](runtime-bridge.md) | [简体中文](runtime-bridge.zh-CN.md)

Spine Companion uses Tauri as its only desktop runtime. The renderer talks to
native Rust commands and events through the stable `window.companion` interface
installed by `src/renderer/tauri-bridge.js`.

Keeping the interface name independent from Tauri is intentional: renderer
features depend on a small application contract instead of importing native APIs
throughout UI code. Browser preview uses HTTP providers and does not emulate
unsupported desktop commands.

The machine-readable shared HTTP and MCP surface is recorded in
`src/shared/runtime-contract.json`. Contract tests keep the source-development
bridge aligned with the packaged Rust runtime while explicitly allowing the
packaged Avatar Studio MCP extensions and the development-only `/ws` adapter.

| Capability | Native implementation |
| --- | --- |
| State and reminders | Rust state store and Tauri commands/events |
| Packaged local API | Axum HTTP server with SSE events in `src-tauri` |
| Window dragging and placement | Tauri native window APIs |
| Tray, Manager, and Quick Panel | Tauri windows and tray events |
| Settings and model management | Validated Tauri commands |
| AI integration configuration | Tauri filesystem commands with backups |

## Packaged API Contract

The packaged application's integration contract is local HTTP plus Server-Sent
Events. The health and state endpoints are available at the configured local
origin; `GET /events` streams state and reminder events. A WebSocket endpoint is
not part of the packaged API contract. Browser-only providers may have other
transport adapters, but integrations targeting the installed application should
use HTTP and SSE.

State, reminders, and recent history are held in memory for the current
application session. They are reset when the application exits. Model files,
user settings, and AI configuration backups live in user data and follow the
upgrade and restore guidance in the [deployment guide](../guides/deployment.md).
