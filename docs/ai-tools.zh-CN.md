# AI 工具接入

[English](ai-tools.md) | [简体中文](ai-tools.zh-CN.md)

Spine Companion 优先通过 MCP 接入 AI 工具；不支持 MCP 的工具可以走本地 HTTP API。
Tauri 安装包内置自包含 MCP 入口，普通用户应优先使用安装后的应用可执行文件，
不要再引用 Codex 会话目录或源码仓库里的脚本。

## Manager 自动配置

打开 **Manager > AI Integrations**，可以检测本机常见 AI 工具，并在你确认后写入
MCP 配置。写入前会创建带时间戳的备份；配置成功后会标记为 **Needs restart**，
需要重启对应 AI 工具。

第一版支持 Codex、Claude Desktop、Cursor / VS Code、Roo / Cline、
Gemini / Antigravity、OpenCode、MiMoCode。MiMoCode 缺少公开 MCP 配置文档，
因此属于 best-effort 支持；如果格式变化，优先使用页面里的复制模板。

## 手动 MCP 配置

安装后的 Tauri 应用：

```json
{
  "mcpServers": {
    "spine_companion": {
      "command": "C:/Program Files/Spine Companion/spine-companion.exe",
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

OpenCode 使用官方的 `mcp` 配置形态，`command` 是数组：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "spine_companion": {
      "type": "local",
      "command": ["C:/Program Files/Spine Companion/spine-companion.exe", "--mcp"],
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

源码开发兜底：

```json
{
  "mcpServers": {
    "spine_companion": {
      "command": "node",
      "args": ["C:/path/to/spine-companion/scripts/mcp-companion-server.mjs"],
      "env": {
        "COMPANION_API": "http://127.0.0.1:17388",
        "COMPANION_SOURCE": "my-tool-mcp",
        "COMPANION_SOURCE_LABEL": "My Tool"
      }
    }
  }
}
```

MCP stdio 服务端通常不能可靠知道是哪一个父应用启动了它。稳定开放的接入方式是：
在 MCP 客户端配置里写入 `COMPANION_SOURCE` 和 `COMPANION_SOURCE_LABEL`。
以后新出的 AI 工具只要能启动本地 stdio MCP server，并能设置 env，就可以接入。

## HTTP 兜底

```bash
curl -X POST http://127.0.0.1:17388/state \
  -H "Content-Type: application/json" \
  -d '{"state":"working","source":"ai-tool"}'
```

MCP 本身不会自动推送状态。AI 工具必须有指令，在工作阶段主动调用
`companion_report_ai_phase`。`companion_report_codex_phase` 仍保留为旧 Codex 指令的兼容别名。
