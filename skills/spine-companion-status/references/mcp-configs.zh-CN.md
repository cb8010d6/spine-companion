# MCP 配置参考

[English](mcp-configs.md) | [简体中文](mcp-configs.zh-CN.md)

当某个工具无法由脚本自动配置时，复制这些配置形状。

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

## HTTP 兜底

```bash
curl -X POST http://127.0.0.1:17388/state \
  -H "Content-Type: application/json" \
  -d '{"state":"working","source":"ai-tool"}'
```

支持状态：`idle`、`working`、`reviewing`、`running`、`success`、`failed`、
`waiting`、`sleeping`、`reminder`。
