# Spine Companion v0.2.5-rc.2

This RC is a small stability pass over v0.2.5-rc.1.

## Changes

- Prevent the Tauri companion window from being resized, maximized, or fullscreened by the OS/window manager.
- Apply the same maximize/fullscreen guard to the legacy Electron quick panel.

## Notes

- No state-machine, MCP lifecycle, hitbox, font-loading, or renderer-default changes are included in this RC.
- The goal is to reduce Windows Aero Snap / accidental maximize issues without changing the interaction model.

## Validation

- `bun run test`
- `bun run check`
- `bun run check:mcp`
- `cargo test --manifest-path src-tauri\Cargo.toml`
