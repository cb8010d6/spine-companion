# Spine Companion v0.1.2

[English](release-notes-v0.1.2.md) | [简体中文](release-notes-v0.1.2.zh-CN.md)

## Fixes

- Fix flickering while dragging by keeping drag-run animation local and avoiding repeated `Move` restarts.
- Mirror the running pose left/right without restarting the animation when only direction changes.
- Make Windows tray creation more reliable by using a PNG native image instead of an SVG data URL.
- Create the tray before the window is shown and set the Windows AppUserModelId.
- Add a Codex-style progress bubble next to the model for state messages.
- Add a tray toggle for the progress bubble.

## Windows Quick Start

1. Download `spine-companion-0.1.2-windows-x64-portable.exe`.
2. Put `companion.local.json` next to the exe.
3. Double-click the exe.
