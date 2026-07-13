# Spine Companion v0.2.5-rc.3

This release candidate makes AI setup easier to verify and turns the Manager Dashboard into a live, user-facing home screen.

## Changes

- Manager now opens on Dashboard instead of Library.
- Dashboard updates live when AI task state or reminders change, without flashing a loading screen.
- AI source names use the configured tool label, such as Codex, OpenCode, or MiMoCode.
- Connection and display health use plain-language status text.
- AI Integration testing now completes the MCP handshake, sends a real work update, and returns to the previous companion state.
- MCP tests have a five-second deadline, match JSON-RPC response IDs, and always stop the test process.
- Added regression coverage for Dashboard state selection, renderer health, burst refreshes, MCP timeouts, and response matching.

## Scope

- Tauri remains the recommended runtime.
- Electron is legacy and receives no new functionality in this release.
- Avatar Studio runtime installation and activation remain planned for a later RC.

## Validation

- `bun run test`
- `bun run check`
- `bun run check:mcp`
- `bun run build`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `bun run tauri:build`
