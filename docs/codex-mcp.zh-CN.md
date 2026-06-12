# Codex MCP 桥接

[English](codex-mcp.md) | [简体中文](codex-mcp.zh-CN.md)

桥接服务是一个本地 stdio MCP server。Codex 启动它后，桥接服务调用 companion HTTP API，
桌面 renderer 根据状态变化切换动画。

```mermaid
flowchart LR
  Codex["Codex session"] --> MCP["spine_companion MCP server"]
  MCP --> API["Companion HTTP API"]
  API --> Renderer["Tauri renderer"]
  Renderer --> Spine["Pixi Spine runtime"]
```

安装后的 Tauri 版本优先使用 **Manager > AI Integrations**。它会写入稳定的
应用可执行文件路径，并在修改配置前创建备份。

安装版配置形态：

```toml
[mcp_servers.spine_companion]
command = "C:/Program Files/Spine Companion/spine-companion.exe"
args = ["--mcp"]
env = { COMPANION_API = "http://127.0.0.1:17388", COMPANION_SOURCE = "codex-mcp", COMPANION_SOURCE_LABEL = "Codex" }
```

源码开发兜底：

```bash
npm run mcp:install:codex
```

这会写入：

```toml
[mcp_servers.spine_companion]
command = "node"
args = ["C:/path/to/spine-companion/scripts/mcp-companion-server.mjs"]
env = { COMPANION_API = "http://127.0.0.1:17388", COMPANION_SOURCE = "codex-mcp", COMPANION_SOURCE_LABEL = "Codex" }
```

安装后重启 Codex 或打开新会话。当前会话通常不会热加载新增 MCP server。

工具：

- `companion_get_state`：读取当前桌面状态。
- `companion_set_state`：设置状态机状态。
- `companion_reminder`：创建本地提醒。
- `companion_report_ai_phase`：把通用 AI 工作阶段映射到 companion 状态。
- `companion_report_codex_phase`：把 `editing`、`reviewing`、`succeeded` 等 Codex
  阶段映射到 companion 状态。这个工具保留为兼容旧指令的别名。

MCP 本身不会自动推送 Codex 状态，它只是暴露工具。要让 AI 主动上报，运行：

```bash
npm run skill:install
npm run ai:configure -- --target all
```

桌面应用或 `npm run dev:api` 必须运行，MCP 工具才有 API 可调用。
