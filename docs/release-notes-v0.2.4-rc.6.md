# Spine Companion v0.2.4-rc.6

[English](release-notes-v0.2.4-rc.6.md) | [简体中文](release-notes-v0.2.4-rc.6.zh-CN.md)

This release candidate focuses on daily-use stability for the Tauri runtime.

## Changes

- Stabilized pointer hitbox recovery around the companion model.
- Reduced Tauri mouse passthrough recovery latency and invalidated stale recovery
  tasks when pointer state changes.
- Fixed AI integration config detection for OpenCode, MiMoCode, VS Code, and
  related MCP clients.
- Added Codex/Copilot instruction guidance so AI tools can discover Spine
  Companion status reporting more reliably.
- Updated architecture docs to describe the current desktop runtime direction.
- Added the planned Avatar Studio interface document for future AI-assisted
  character pack generation.

## Notes

- Pixi and Spine runtime dependencies remain unchanged for Spine 3.8
  compatibility.
- Avatar Studio is documented as a future interface. This release does not yet
  generate or rig Spine models automatically.

