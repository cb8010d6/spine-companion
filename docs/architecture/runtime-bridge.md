# Runtime Bridge

[English](runtime-bridge.md) | [简体中文](runtime-bridge.zh-CN.md)

Spine Companion uses Tauri as its only desktop runtime. The renderer talks to
native Rust commands and events through the stable `window.companion` interface
installed by `src/renderer/tauri-bridge.js`.

Keeping the interface name independent from Tauri is intentional: renderer
features depend on a small application contract instead of importing native APIs
throughout UI code. Browser preview uses HTTP providers and does not emulate
unsupported desktop commands.

| Capability | Native implementation |
| --- | --- |
| State and reminders | Rust state store and Tauri commands/events |
| Local HTTP/SSE/WebSocket | Axum server in `src-tauri` |
| Window dragging and placement | Tauri native window APIs |
| Tray, Manager, and Quick Panel | Tauri windows and tray events |
| Settings and model management | Validated Tauri commands |
| AI integration configuration | Tauri filesystem commands with backups |

Electron was retired in v0.2.6-rc.5. Historical release notes still describe
the former dual-runtime implementation, but they are not current architecture
documentation.
