# Spine Companion v0.2.4-rc.8

This release candidate focuses on the remaining desktop interaction polish after rc.7.

## Fixed

- Switched Tauri window dragging to the native OS drag path after drag intent is detected, avoiding DPI/WebView coordinate drift where dragging 10 px could move the companion by a smaller distance.
- Kept click interaction behavior separate from drag start so a normal click still plays the interaction animation instead of being treated as a window move.
- Added native drag position polling so the character direction follows the actual window movement rather than the cursor position.
- Added a diagnostics export command and Manager action to create a single support report for GPU, WebView, model, MCP, configuration, reminders, and recent history.
- Tightened the scaled hitbox recovery margin so tiny avatars keep a more usable click target without growing the transparent blocking area too much.

## Notes

- Hardware acceleration remains enabled by default. Use the Manager recovery actions if WebView2 or the GPU driver enters a bad state.
- Electron remains legacy; active fixes target the Tauri runtime.
