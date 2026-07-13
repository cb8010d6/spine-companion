# Spine Companion v0.1.2

[English](release-notes-v0.1.2.md) | [简体中文](release-notes-v0.1.2.zh-CN.md)

## Fixes

- Fix flickering while dragging by keeping drag-run animation local and avoiding repeated `Move` restarts.
- Mirror the running pose left/right without restarting the animation when only direction changes.
- Make Windows tray creation more reliable by using a PNG native image instead of an SVG data URL.
- Create the tray before the window is shown and set the Windows AppUserModelId.
- Add a Codex-style progress bubble next to the model for state messages.
- Add a tray toggle for the progress bubble.
- Clamp model layout scale to prevent occasional oversized unrecoverable renders.
- Keep recent progress visible briefly even when the state returns to idle.
- Stabilize progress bubble anchoring so message height and small model scales do not push it too far upward.
- Add task completion notifications that dismiss on click.
- Add tray toggles for bubble shadow, background style, and drag mode.
- Add a light progress bubble theme with a white background and dark text.
- Let transparent empty window areas pass mouse events through to windows underneath.
- Scale the companion mouse hit area dynamically so smaller models keep less empty drag margin.

## Build Notes

- Bun-based Electron/Vite build migration and macOS Apple Silicon release checks were proposed by Collaborator k1mlka luojunyuan.

## Windows Quick Start

1. Download `spine-companion-0.1.2-windows-x64-portable.exe`.
2. Put `companion.local.json` next to the exe.
3. Double-click the exe.
