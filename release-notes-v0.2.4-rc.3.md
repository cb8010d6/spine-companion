# Spine Companion v0.2.4-rc.3

Runtime panel and interaction polish prerelease.

## Changes

- Reworks the tray status panel into a runtime console instead of a manual state switcher.
- Shows current AI source, task message, bridge/API health, active model, reminders, updates, and compact display controls.
- Moves manual state buttons behind debug mode (`?debug` or `ui.debugPanel: true`).
- Localizes the new panel labels in English and Chinese.
- Keeps live working/running/reviewing task bubbles visible when the character is clicked.
- Only success/failed task-result states are dismissed by clicking the character.
- Extends the direct click interaction so the Interact animation can finish.
- Tightens the transparent model hitbox and reduces padding at small scales.
- Fixes Tauri mouse passthrough on Windows so transparent areas stay click-through until the cursor enters the model hitbox.
- Smooths the success tail by replaying the configured tail segment with mix transitions instead of relying on a hard native segment loop.
