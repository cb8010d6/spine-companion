# Spine Companion v0.1.9

## Highlights

- Filled out the Tauri tray controls: status panel, progress bubble, bubble shadow, bubble background, drag mode, zoom, state switching, open API, and open config folder.
- Fixed duplicate Tauri tray icons by keeping only the Rust-created tray icon with the full menu.
- Added an in-app settings panel and model management entry point.
- Added an Ark-Models catalog entry for `Amiya Guard Skin #16`; the app can download, import, and load it immediately.
- Added the repo-local Codex plugin `spine-companion-status` for one-click status-reporting skill/MCP setup.
- Added a local Tauri portable-with-assets packaging script.

## Notes

The public repository and public releases still do not bundle Ark-Models or other copyrighted assets. The import flow downloads model files into the user's local config folder; the portable-with-assets script is intended for local use or distribution only when you have confirmed asset redistribution rights.

## Verified

- `bun run test`
- `bun run check`
- `bun run check:mcp`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `bun run build`
- `bun run tauri:build`
