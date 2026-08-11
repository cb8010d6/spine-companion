# Codex MCP Bridge

[English](codex-mcp.md) | [简体中文](codex-mcp.zh-CN.md)

The bridge is a local stdio MCP server. Codex launches it, the bridge calls the
companion HTTP API, and the desktop renderer reacts to state changes.

```mermaid
flowchart LR
  Codex["Codex session"] --> MCP["spine_companion MCP server"]
  MCP --> API["Companion HTTP API"]
  API --> Renderer["Tauri renderer"]
  Renderer --> Spine["Pixi Spine runtime"]
```

For installed Tauri builds, prefer **Manager > AI Integrations**. It writes a
stable executable-based entry and creates a backup before changing the config.

Installed entry shape:

```toml
[mcp_servers.spine_companion]
command = "<install-dir>/spine-companion.exe"
args = ["--mcp"]
env = { COMPANION_API = "http://127.0.0.1:17388", COMPANION_SOURCE = "codex-mcp", COMPANION_SOURCE_LABEL = "Codex" }
```

Source workflow fallback:

```bash
bun run mcp:install:codex
```

This writes:

```toml
[mcp_servers.spine_companion]
command = "bun"
args = ["<repo-root>/scripts/mcp-companion-server.mjs"]
env = { COMPANION_API = "http://127.0.0.1:17388", COMPANION_SOURCE = "codex-mcp", COMPANION_SOURCE_LABEL = "Codex" }
```

Restart Codex or open a new session after installing. The current Codex session
usually cannot hot-load newly added MCP servers.

Tools exposed:

- `companion_get_state`: read current desktop state.
- `companion_set_state`: set one of the state machine states.
- `companion_reminder`: schedule a local reminder.
- `companion_report_ai_phase`: map generic AI work phases into companion states.
- `companion_report_codex_phase`: map Codex phases like `editing`, `reviewing`,
  `succeeded`, or `failed` into companion states. This is kept as a
  compatibility alias.

The companion desktop app or `bun run dev:api` must be running before these
tools are useful.

MCP does not push Codex status automatically by itself. It exposes tools; the AI
client must be instructed to call them. Use `bun run skill:install` and
`bun run ai:configure -- --target all` to install persistent reporting rules for
supported tools.
