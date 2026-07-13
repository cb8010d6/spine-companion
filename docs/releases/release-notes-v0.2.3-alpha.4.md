# Spine Companion v0.2.3-alpha.4

This prerelease focuses on daily-use reliability before the next stable cut.

## Highlights
- Separated state, message bubble, task completion notification, and reminder behavior.
- State changes now clear stale messages by default unless `preserveMessage` is set.
- Success/failed notifications only appear for AI task sources or explicit `notify: true`.
- Added shared AI source detection for Codex, Claude, Cursor, Cline/Roo, Gemini, Antigravity, and local AI bridges.
- Added reminder listing and deletion in the quick panel and Manager.
- Added per-file download timeout, better download failure reporting, and post-download Spine asset validation.
- Validates `.atlas` texture references so missing PNG files are caught before switching models.
- Added model health diagnostics and log export support.
- Hardened IPC input validation for state changes, settings, model imports, reminders, and folder opens.
- Added renderer error and provider connection fallbacks.
- Improved quick panel pinning and switch styling.

## Notes
- Electron remains the recommended runtime for this alpha.
- Tauri remains experimental while tray, notification, and transparent-window behavior continue to catch up.
- This prerelease publishes the Windows installer first for testing.
