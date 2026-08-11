# MCP Config Reference

[English](mcp-configs.md) | [简体中文](mcp-configs.zh-CN.md)

Use these shapes when a tool cannot be configured by Manager > AI Integrations.

## MCP server

```json
{
  "mcpServers": {
    "spine_companion": {
      "command": "<install-dir>/spine-companion.exe",
      "args": ["--mcp"],
      "env": {
        "COMPANION_API": "http://127.0.0.1:17388",
        "COMPANION_SOURCE": "my-tool-mcp",
        "COMPANION_SOURCE_LABEL": "My Tool"
      }
    }
  }
}
```

## Codex TOML

```toml
[mcp_servers.spine_companion]
command = "<install-dir>/spine-companion.exe"
args = ["--mcp"]
env = { COMPANION_API = "http://127.0.0.1:17388", COMPANION_SOURCE = "codex-mcp", COMPANION_SOURCE_LABEL = "Codex" }
```

## OpenCode

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "spine_companion": {
      "type": "local",
      "command": ["<install-dir>/spine-companion.exe", "--mcp"],
      "enabled": true,
      "environment": {
        "COMPANION_API": "http://127.0.0.1:17388",
        "COMPANION_SOURCE": "opencode-mcp",
        "COMPANION_SOURCE_LABEL": "OpenCode"
      }
    }
  }
}
```

## HTTP fallback

```bash
curl -X POST http://127.0.0.1:17388/state \
  -H "Content-Type: application/json" \
  -d '{"state":"working","source":"ai-tool"}'
```

Supported states are `idle`, `working`, `reviewing`, `running`, `success`,
`failed`, `waiting`, `sleeping`, and `reminder`.
