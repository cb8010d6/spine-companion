# Spine Companion v0.2.1

v0.2.1 completes the broader v0.2 plan without jumping the project to a 1.0
label. It focuses on making the app easier to operate, easier to diagnose, and
safer to release.

## Highlights

- Added shared design tokens and reusable UI primitives for the companion,
  panel, and Manager surfaces.
- Added English/Chinese i18n infrastructure and locale files.
- Rebuilt the Manager with safer DOM rendering, library search, installed model
  actions, settings hot-apply, download status, diagnostics, state history, and
  update checks.
- Added onboarding and friendly error recovery when assets are missing or fail
  to load.
- Added persistent reminders, bounded state history, optional idle timeout, and
  desktop notifications for reminders.
- Added active model switching from both Electron and Tauri bridges.
- Added global shortcut and autostart bridge hooks.
- Added panel quick state controls, model preview styling, update status, and
  history-derived progress text.
- Added lint/type-check/coverage scripts and expanded the test suite to cover
  config helpers, provider behavior, DOM helpers, i18n, update checks, state
  history, reminder persistence, and the local HTTP history endpoint.

## Release Notes

- This release still does not bundle copyrighted Spine assets.
- Tauri support remains included, but Electron is still the most complete runtime
  for day-to-day use.
- macOS builds from GitHub Actions may remain unsigned unless project signing
  secrets are configured.

## Verification

- `bun run lint`
- `bun run check:mcp`
- `bun run test`
- `bun run test:coverage`
- `bun run type-check`
- `cargo test`
- `cargo check`
