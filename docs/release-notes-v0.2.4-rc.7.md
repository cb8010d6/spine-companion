# Spine Companion v0.2.4-rc.7

[English](release-notes-v0.2.4-rc.7.md) | [简体中文](release-notes-v0.2.4-rc.7.zh-CN.md)

## Changes

- Added renderer health checks and recovery commands for WebView2/GPU reset cases.
- Added tray and Manager actions to restart the renderer and clear WebView GPU cache.
- Tightened pointer hitbox sizing and added an optional hitbox debug overlay.
- Fixed drag movement to use screen-pixel deltas consistently.
- Made review animation use a looping segment for smoother repeated playback.
- Added AI Integration MCP test action.
- Added an experimental Avatar Studio page that documents the local avatar pack workflow.

## Notes

- Hardware acceleration remains enabled by default. The app recovers the renderer window when it detects a dead rendering surface; it does not silently switch to software rendering.
- Avatar Studio is an experimental planning surface. It does not yet generate production Spine rigs.
