# Spine Companion v0.2.6-rc.6

[English](release-notes-v0.2.6-rc.6.md) | [简体中文](release-notes-v0.2.6-rc.6.zh-CN.md)

This candidate focuses on model-library continuity and long-running animation
reliability.

## Highlights

- Keep Library search, source, filter, and page state while a model downloads.
  Progress updates now patch the visible cards instead of replacing the entire
  page and refreshing the remote catalog repeatedly.
- Use `config-changed` as the single authoritative model reload event. This
  removes competing reloads that could briefly show "Unable to load model"
  after a successful download.
- Retry transient model and preview network failures once, while preserving
  clear failures for non-retryable HTTP responses.
- Return click interactions only after the actual Spine track entry completes,
  rather than waiting on an estimated timeout.
- Normalize model scale, baseline, and bubble placement from stable everyday
  states so effect-heavy animations do not distort layout between models.
- Replace hundreds of queued success/review segments with one native looping
  segment. Track progress is included in renderer health checks.
- Add a low-frequency native watchdog that rebuilds a visible WebView after its
  renderer heartbeat stops, with recovery cooldown.
- Diagnostics now reports model and preview cache size and provides safe buttons
  to open both cache folders.

Windows remains the primary supported platform. Linux and unsigned macOS builds
remain experimental. No copyrighted Ark-Models assets or generated previews are
included.
