---
name: spine-companion-status
description: Configure AI coding tools to report work phases to a local Spine Companion desktop app. Use when a user wants Codex, Cursor, Claude Desktop, Claude Code, or other MCP-capable AI tools to automatically update companion states through the Spine Companion MCP bridge or local HTTP API.
---

# Spine Companion Status

[English](SKILL.md) | [简体中文](SKILL.zh-CN.md)

使用这个 skill 把 AI 工具接到本地 Spine Companion。

## 流程

1. 找到 Spine Companion 仓库根目录，必须包含 `scripts/mcp-companion-server.mjs`。
2. 确认桌面应用或 API 正在 `http://127.0.0.1:17388` 运行。
3. 运行配置脚本：

```bash
node scripts/configure-ai-tools.cjs --repo C:\path\to\spine-companion --target all
```

单独配置时可用 `--target codex`、`codex-cli`、`cursor`、`claude-desktop`、
`claude-code` 或 `claude-cli`。

4. 重启对应 AI 工具。大多数 MCP client 不会热加载新增 server。
5. 要求工具调用 `companion_report_ai_phase`，或用 HTTP 手动验证：

```bash
curl -X POST http://127.0.0.1:17388/state -H "Content-Type: application/json" -d "{\"state\":\"working\",\"source\":\"manual-check\"}"
```

## 上报规则

当 Spine Companion MCP 工具可用时，主动上报阶段：

- `thinking`：推理、计划、读取上下文。
- `editing`：修改文件。
- `running`：运行命令、测试、构建或长任务。
- `reviewing`：检查结果、diff、截图或测试输出。
- `succeeded`：成功完成。
- `failed`：遇到阻塞或失败结束。
- `waiting`：等待用户输入或外部进程。

消息保持简短。优先使用 `companion_report_ai_phase`；`companion_report_codex_phase`
只是旧 Codex 指令的兼容别名。如果 MCP 没有被工具发现，但本地 companion 应用正在运行，可以使用仓库内
fallback：`bun scripts/report-status.cjs running "Running checks"`。Companion 不可用时
不要中断用户任务。

## 工具支持

- Codex Desktop / Codex CLI：写入 `~/.codex/config.toml` 和 `~/.codex/AGENTS.md`。
- Cursor：写入 `.cursor/mcp.json` 和 `.cursor/rules/spine-companion-status.mdc`。
- Claude Desktop：写入用户 `claude_desktop_config.json`。
- Claude Code / Claude CLI：写入 workspace `.mcp.json` 和 `CLAUDE.md`。
- 其他工具：使用 Manager > AI Integrations、本地 HTTP API，或复制 `references/mcp-configs.md` 中的 MCP 配置。
