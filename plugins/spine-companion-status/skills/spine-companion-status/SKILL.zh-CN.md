---
name: spine-companion-status
description: 通过内置 MCP 桥接或本地 HTTP API，让 Codex 等 AI 编程工具把工作阶段自动上报给本地 Spine Companion 桌面应用。
---

# Spine Companion 状态上报

当用户希望 Codex 或其他 AI 编程工具自动更新 Spine Companion 桌面状态时使用本 skill。

## 前置条件

- Spine Companion 桌面应用正在运行。
- 本地 API 默认可通过 `http://127.0.0.1:17388` 访问，或设置 `COMPANION_API` 覆盖。
- 已安装 Bun，并且 `bun` 在 `PATH` 中。

## Codex 行为

当 `spine_companion` MCP 服务可用时，主动上报阶段：

- `thinking`：阅读、推理、规划。
- `editing`：修改文件。
- `running`：运行命令、测试、构建或较长任务。
- `reviewing`：检查 diff、截图、日志或测试输出。
- `succeeded`：任务成功完成。
- `failed`：遇到阻塞或失败结束。
- `waiting`：等待用户输入或外部进程。

使用 `companion_report_ai_phase` 并附带简短消息。`companion_report_codex_phase` 仍是兼容旧 Codex 指令的别名。如果 MCP 服务不可用，继续完成用户任务，不要因此中断。

## HTTP 兜底

MCP 不可用时，工具或脚本可以直接请求本地 API：

```bash
curl -X POST http://127.0.0.1:17388/state \
  -H "Content-Type: application/json" \
  -d "{\"state\":\"working\",\"source\":\"codex-http\",\"message\":\"Working\"}"
```

允许的状态：`idle`、`working`、`reviewing`、`running`、`success`、`failed`、`waiting`、`sleeping`、`reminder`。
