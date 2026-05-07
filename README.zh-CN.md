# Spine Companion

[English](README.md) | [简体中文](README.zh-CN.md)

开源桌面 Spine 3.8 陪伴应用 MVP。它使用 Electron、`pixi.js@6.5.10`
和 `pixi-spine@3.1.2` 直接渲染 `.skel/.atlas/.png`，支持透明窗口、
置顶、拖动、缩放、点击互动、状态切换、本地 API、MCP 桥接、工程进展气泡、托盘控制和提醒。

## 素材策略

仓库不包含明日方舟、Ark-Models 或其他版权模型素材。你可以在本地测试自己有权使用
的素材，但不要提交 `.skel`、`.atlas` 或贴图文件。

本地素材路径写在 `companion.local.json`，该文件已被 git 忽略。

## 快速开始

### 使用 Release

1. 从 GitHub Release 下载 `spine-companion-0.1.2-windows-x64-portable.exe`。
2. 在 exe 同目录创建 `companion.local.json`：

```json
{
  "spine": {
    "assetDir": "C:\\path\\to\\spine_model_folder",
    "skel": "model.skel"
  }
}
```

3. 双击 exe 启动。

### 从源码运行

```bash
npm install
npm run setup:assets -- "C:\path\to\amiya_spine"
npm run dev
```

详细部署、启动、MCP 和排错见 [docs/deployment.zh-CN.md](docs/deployment.zh-CN.md)。

浏览器预览地址：

```text
http://127.0.0.1:17389?api=http://127.0.0.1:17388
```

## 本地状态 API

默认 API 地址是 `http://127.0.0.1:17388`。

```bash
curl http://127.0.0.1:17388/state
curl -X POST http://127.0.0.1:17388/state -H "Content-Type: application/json" -d "{\"state\":\"working\",\"source\":\"curl\"}"
curl -X POST http://127.0.0.1:17388/reminders -H "Content-Type: application/json" -d "{\"text\":\"stand up\",\"inSeconds\":30}"
```

事件流：

- SSE: `GET /events`
- WebSocket: `ws://127.0.0.1:17388/ws`

## Codex MCP 桥接

```bash
npm run mcp:install:codex
```

这会把 `spine_companion` MCP server 写入 `~/.codex/config.toml`。安装后需要重启
Codex 或打开新会话。

可用工具：

- `companion_get_state`
- `companion_set_state`
- `companion_reminder`
- `companion_report_codex_phase`

如果希望 Codex Desktop、Codex CLI、Cursor、Claude Desktop、Claude Code、Claude CLI
自动配置状态上报：

```bash
npm run skill:install
npm run ai:configure -- --target all
```

其他 MCP 工具可以参考 [docs/ai-tools.zh-CN.md](docs/ai-tools.zh-CN.md)。

## 状态与动画

| 状态 | Spine 动画 |
| --- | --- |
| `idle` | `Relax` |
| `working` | `Relax` |
| `running` | `Move` |
| `reminder` | `Interact` |
| `waiting` | `Sit` |
| `failed` | `Sleep` |
| `sleeping` | `Sleep` |
| `reviewing` | `Special` 的 `review` 片段 |
| `success` | `Special` 的 `success` 片段 |

动画切换使用 Spine runtime mixing，不导出 spritesheet。渲染器会在启动时采样各状态动画，
用稳定包围盒保持不同动作的显示范围一致。

## 桌面控制

Windows 托盘菜单可以显示/隐藏状态面板、显示/隐藏工程进展气泡、切换置顶、缩放、重置大小、切状态和退出。
拖动透明舞台会移动窗口；横向拖动时会临时进入 `running`，并按左右方向镜像模型。

## 开源注意事项

- 不要提交 `.skel`、`.atlas` 或贴图文件。
- 本地模型路径放在 `companion.local.json` 或环境变量中。
- 公共配置模板使用 `companion.config.example.json`。
