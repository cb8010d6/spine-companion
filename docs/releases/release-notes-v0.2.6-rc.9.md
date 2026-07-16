# Spine Companion v0.2.6-rc.9

[English](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.9.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.9.zh-CN.md)

This release candidate focuses on renderer stability, predictable input, and a
safer model-library pipeline.

## Improvements

- Keep one Pixi application for the companion and replace Spine instances only
  after the next model has loaded. Shared asset handles now release loader,
  atlas, texture, and base-texture resources after the last consumer exits.
- Drive Spine animation from one Pixi ticker, expose track health diagnostics,
  and recover stalled looping tracks through replay, instance rebuild, and
  finally WebView reconstruction with cooldown and rate limiting.
- Convert custom touch, pen, and mouse-fallback drag distances from WebView CSS
  pixels to native physical pixels. High-DPI touch movement now matches the
  user's gesture instead of moving the companion a shorter distance.
- Update pointer bounds from the current Spine runtime pose, use tighter entry
  and delayed exit margins, and suspend passthrough switching while dragging.
- Add explicit display, 60 FPS, and 30 FPS modes. The default still follows the
  display refresh rate and never changes automatically.
- Open the model library from local cache, aggregate all enabled sources, and
  update download progress on the affected card instead of rebuilding the page.
- Stream catalog and model downloads with 16 MiB catalog, 64 MiB file, and
  256 MiB model limits. Downloads use unique staging directories, cancellable
  commits, HTTPS redirect checks, integrity verification, and startup cleanup.
- Commit model metadata atomically with downloaded assets, preventing dynamic
  illustrations from being temporarily or permanently classified as operators.
- Fix system-language detection, AI connection indicators, native tray labels,
  and lazy-load the Spine preview runtime in Manager and Quick Panel.

## Validation

- 217 JavaScript tests and 89 Rust tests passed. Project checks, MCP bridge
  checks, the packaged MCP smoke test, and the frontend production build also
  passed locally.
- All 2,909 current Ark model entries were audited; no legitimate catalog file
  or model exceeds the new download limits.
- The Windows Tauri NSIS package is built as the primary release artifact.

The one-hour high-refresh stability soak remains a manual release gate. Linux
and unsigned macOS packages remain experimental.
