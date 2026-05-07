# AI Tool Integration

[English](ai-tools.md) | [简体中文](ai-tools.zh-CN.md)

Spine Companion supports AI tools through MCP when possible and through the
local HTTP API as a fallback.

## Automatic Setup

```bash
npm run skill:install
npm run ai:configure -- --target all
```

Targets:

- `codex` / `codex-cli`: writes `~/.codex/config.toml` and `~/.codex/AGENTS.md`.
- `cursor`: writes `.cursor/mcp.json` and `.cursor/rules/spine-companion-status.mdc`.
- `claude-desktop`: writes `claude_desktop_config.json`.
- `claude-code`: writes `.mcp.json` and `CLAUDE.md`.
- `claude-cli`: tries `claude mcp add-json ... --scope user`, then writes workspace fallback files.

Restart the configured tool after setup.

## Manual MCP Shape

```json
{
  "mcpServers": {
    "spine_companion": {
      "command": "node",
      "args": ["C:/path/to/spine-companion/scripts/mcp-companion-server.mjs"],
      "env": {
        "COMPANION_API": "http://127.0.0.1:17388"
      }
    }
  }
}
```

## HTTP Fallback

```bash
curl -X POST http://127.0.0.1:17388/state \
  -H "Content-Type: application/json" \
  -d '{"state":"working","source":"ai-tool"}'
```

MCP does not automatically push state. The AI tool must have instructions to call
`companion_report_codex_phase` during work phases.
