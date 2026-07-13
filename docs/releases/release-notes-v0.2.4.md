# Spine Companion v0.2.4

This stable release turns the v0.2.4 release-candidate line into the recommended daily build for the Tauri runtime.

## Highlights

- Added GPU/WebView2 recovery controls while keeping hardware acceleration enabled by default.
- Improved click-through and hitbox behavior for transparent desktop areas.
- Fixed Tauri drag distance drift by relying on native OS dragging after drag intent is detected.
- Kept avatar click interaction separate from dragging so click animations still play normally.
- Improved task, reminder, and AI-source status semantics.
- Added AI integration detection, configuration, and MCP test groundwork for Codex, VS Code, OpenCode, MiMoCode, and compatible clients.
- Added diagnostics export support for easier debugging of GPU, WebView, model, MCP, config, reminders, and recent state history.

## Runtime Notes

- Tauri is now the recommended runtime.
- Electron remains documented as legacy and is no longer the target for new features.
- Hardware acceleration remains enabled by default. Use Manager recovery actions if WebView2 or the GPU driver enters a bad state.
