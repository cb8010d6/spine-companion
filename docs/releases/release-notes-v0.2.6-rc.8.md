# Spine Companion v0.2.6-rc.8

[English](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.8.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.8.zh-CN.md)

This release candidate makes the model library feel immediate and improves the
desktop presentation of dynamic illustrations.

## Improvements

- Replace the model library's blocking loading message with an immediate page
  skeleton. Catalog, installed, and active counts animate from zero when data is
  ready.
- Reveal the current page of models with a short staggered transition. Search
  and download progress updates do not replay the full-page animation.
- Keep model-source switching responsive and recalculate the visible catalog
  count for the selected source.
- Carry catalog category and compatibility metadata into the active renderer.
  Dynamic illustrations now use a larger, bounded viewport profile instead of
  inheriting the conservative operator-model fit.
- Remove the unsupported global-shortcut setting and its misleading diagnostics
  and configuration fields.
- Respect the operating system's reduced-motion preference and avoid persistent
  animation timers.

## Validation

- 195 JavaScript tests passed.
- 76 Rust tests passed.
- Project checks, MCP bridge checks, frontend production build, Rust formatting,
  and the Windows Tauri NSIS build passed.

Windows remains the primary supported platform. Linux and unsigned macOS builds
remain experimental.
