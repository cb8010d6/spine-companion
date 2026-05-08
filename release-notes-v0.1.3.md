# Spine Companion v0.1.3

[English](release-notes-v0.1.3.md) | [简体中文](release-notes-v0.1.3.zh-CN.md)

## Runtime

- Complete the Tauri P1 path for reminders: Rust now creates, lists, fires, and auto-returns reminders.
- Serve local Spine assets from the Tauri Axum API at `/assets/spine/*`.
- Load Tauri runtime config from committed config, local config, and environment overrides.
- Emit Tauri state updates to the renderer bridge so the UI updates without polling-only behavior.

## CI And Release

- Add Rust `cargo test` and `cargo check` coverage for the Tauri backend.
- Add Tauri build jobs to CI across Windows, Linux, and macOS.
- Add Tauri package jobs to release workflow and upload Tauri bundle artifacts.
- Run Vitest in CI/release alongside existing project and MCP checks.

## Notes

- Bun migration and macOS Apple Silicon release validation were proposed by Collaborator k1mlka luojunyuan.
- macOS public releases still require Apple signing/notarization secrets for the smoothest Gatekeeper experience.
