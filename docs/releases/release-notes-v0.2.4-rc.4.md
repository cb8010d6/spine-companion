# Spine Companion v0.2.4-rc.4

Reminder reactivity and Tauri parity prerelease.

## Changes

- Forwards reminder list changes from the Electron state store to the main window, quick panel, and manager.
- Adds realtime reminder subscriptions for IPC, HTTP SSE, WebSocket, and Tauri bridge providers.
- Refreshes the quick panel reminder list when AI tools create, fire, or delete reminders while the panel is hidden.
- Emits Tauri reminder updates from the Rust state store and API server.
- Adds Tauri system notifications for task completion and reminders when notification support is available.
- Keeps the Tauri quick panel open while native dropdown menus are active to avoid blur-close glitches.
- Slightly expands the model hitbox from rc.3 so dragging is easier while keeping the upper transparent area tighter.
- Lets click interaction animations play through longer and returns to idle with normal mix transitions.
- Renames the user-facing status panel control to Debug HUD.
