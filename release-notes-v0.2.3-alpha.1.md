# Spine Companion v0.2.3-alpha.1

Develop-channel alpha focused on startup resilience and first-run usability.

## Changes

- Ignore damaged `companion.local.json` and `reminders.json` files instead of
  crashing during startup.
- Add Electron single-instance handling and friendlier startup errors for local
  API port conflicts.
- Reveal the companion window when `codex-mcp` reports a non-idle work phase, so
  progress bubbles can appear even if the window had been hidden.
- Add `bun scripts/report-status.cjs <phase> "<message>"` as a local HTTP
  fallback for AI tools when MCP discovery is unavailable.
- Add a Manager button to import a local `.skel` file directly.
- Open Manager automatically on first launch when no local Spine asset is
  configured.
- Harden WebSocket state provider against malformed messages.
- Remove the developer-specific sample asset path from `bun run start`.

## Validation

- `bun run test`
- `bun run build`
- `bun run check`
- `bun run check:mcp`
- `cargo test`
