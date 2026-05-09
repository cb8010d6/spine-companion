# Runtime Bridge Capability Matrix

Spine Companion currently supports both Electron and Tauri runtimes. The renderer talks to both through `window.companion`; Electron exposes it from `src/main/preload.cjs`, while Tauri installs the same shape from `src/renderer/tauri-bridge.js`.

| Capability | Electron | Tauri | Notes |
| --- | --- | --- | --- |
| Load public config | `companion:get-config` | `get_config` command | Both return renderer-safe config. |
| Read current state | `companion:get-state` | `get_state` command | Both return the current normalized state snapshot. |
| Set state | `companion:set-state` | `set_companion_state` command | Used by UI controls, reminders, and external providers. |
| Create reminder | `companion:create-reminder` | `create_reminder_cmd` command | Tauri stores reminders in Rust; Electron uses the shared JS store. |
| Subscribe to state | `companion:state` IPC | `companion:state` event | Used by renderer and AI status bridge feedback. |
| Subscribe to UI settings | `companion:ui` IPC | `companion:ui` event | Electron tray currently emits this; Tauri menu coverage is smaller. |
| Subscribe to scale commands | `companion:scale` IPC | `companion:scale` event | Electron tray currently emits this; Tauri menu coverage is smaller. |
| Drag start | `companion:drag-start` IPC | `start_drag` command | Electron manually moves the window; Tauri delegates to native dragging. |
| Drag move/end | `companion:drag-move/end` IPC | no-op bridge methods | Tauri handles the drag natively after start. |
| Mouse passthrough | `setIgnoreMouseEvents` | `set_ignore_cursor_events` | Renderer throttles hit testing with `requestAnimationFrame`. |
| Tray menu | Full menu | Minimal show/quit menu | Tauri still needs parity for UI toggles and scale actions. |

## Follow-up Work

- Add Tauri tray actions for HUD visibility, bubble visibility, bubble style, always-on-top, drag mode, and scale.
- Add a shared bridge contract test that compares method names exposed by Electron preload and Tauri bridge.
- Keep renderer code using `window.companion` only; runtime-specific behavior should stay in preload/bridge layers.
