# MCP Config Reference

[English](mcp-configs.md) | [简体中文](mcp-configs.zh-CN.md)

Use these shapes when a tool cannot be configured by the bundled script.

## MCP server

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

## Codex TOML

```toml
[mcp_servers.spine_companion]
command = "node"
args = ["C:/path/to/spine-companion/scripts/mcp-companion-server.mjs"]
env = { COMPANION_API = "http://127.0.0.1:17388" }
```

## HTTP fallback

```bash
curl -X POST http://127.0.0.1:17388/state \
  -H "Content-Type: application/json" \
  -d '{"state":"working","source":"ai-tool"}'
```

Supported states are `idle`, `working`, `reviewing`, `running`, `success`,
`failed`, `waiting`, `sleeping`, and `reminder`.
