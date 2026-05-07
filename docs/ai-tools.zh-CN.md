# AI 工具接入

[English](ai-tools.md) | [简体中文](ai-tools.zh-CN.md)

Spine Companion 优先通过 MCP 接入 AI 工具；不支持 MCP 的工具可以走本地 HTTP API。

## 自动配置

```bash
npm run skill:install
npm run ai:configure -- --target all
```

目标：

- `codex` / `codex-cli`：写入 `~/.codex/config.toml` 和 `~/.codex/AGENTS.md`。
- `cursor`：写入 `.cursor/mcp.json` 和 `.cursor/rules/spine-companion-status.mdc`。
- `claude-desktop`：写入 `claude_desktop_config.json`。
- `claude-code`：写入 `.mcp.json` 和 `CLAUDE.md`。
- `claude-cli`：优先调用 `claude mcp add-json ... --scope user`，失败时写 workspace fallback。

配置后需要重启对应 AI 工具。

## 手动 MCP 配置

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

## HTTP 兜底

```bash
curl -X POST http://127.0.0.1:17388/state \
  -H "Content-Type: application/json" \
  -d '{"state":"working","source":"ai-tool"}'
```

MCP 本身不会自动推送状态。AI 工具必须有指令，在工作阶段主动调用
`companion_report_codex_phase`。
