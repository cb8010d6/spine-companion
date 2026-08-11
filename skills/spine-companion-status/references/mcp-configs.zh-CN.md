# MCP 配置参考

[English](mcp-configs.md) | [简体中文](mcp-configs.zh-CN.md)

当某个工具无法由 Manager > AI Integrations 自动配置时，复制这些配置形状。

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

## HTTP 兜底

```bash
curl -X POST http://127.0.0.1:17388/state \
  -H "Content-Type: application/json" \
  -d '{"state":"working","source":"ai-tool"}'
```

支持状态：`idle`、`working`、`reviewing`、`running`、`success`、`failed`、
`waiting`、`sleeping`、`reminder`。
