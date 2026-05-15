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

1. 从 GitHub Release 下载最新 Windows 安装包或便携包。
2. 推荐把 `companion.local.json` 放到用户配置目录：

```text
%APPDATA%\spine-companion\companion.local.json
```

也可以放在 exe 同目录：

```json
{
  "spine": {
    "assetDir": "C:\\path\\to\\spine_model_folder",
    "skel": "model.skel"
  }
}
```

3. 双击启动。右下角托盘菜单可以打开配置目录、显示状态面板、缩放、切换状态和退出。

### 从源码运行

```bash
bun install
bun run setup:assets -- "C:\path\to\amiya_spine"
bun run dev
```

Tauri 版候选运行：

```bash
bun run tauri:dev
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
bun run mcp:install:codex
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
bun run skill:install
bun run ai:configure -- --target all
```

其他 MCP 工具可以参考 [docs/ai-tools.zh-CN.md](docs/ai-tools.zh-CN.md)。

## Codex 插件一键安装

仓库内提供了 repo-local Codex 插件：

```text
plugins/spine-companion-status
```

在支持插件市场文件的 Codex 环境中，可通过 `.agents/plugins/marketplace.json`
安装 `Spine Companion Status`。插件会提供同名 skill 和 `spine_companion` MCP
桥接配置，默认使用 Bun 启动本地桥接服务。

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

设置面板提供模型选择和下载导入。内置 Ark-Models 示例只会下载到本地配置目录；仓库和公开 release 不包含素材本体。

## 开源注意事项

- 不要提交 `.skel`、`.atlas` 或贴图文件。
- 本地模型路径放在 `companion.local.json` 或环境变量中。
- 公共配置模板使用 `companion.config.example.json`。

## macOS Release 签名

GitHub Actions 可以构建未签名的 macOS 包，但 Apple Silicon 用户可能会遇到
“已损坏”或“无法打开”的 Gatekeeper 提示。正式公开发布 macOS 包时，建议在
GitHub 仓库 secrets 中配置以下值，让 electron-builder 自动签名和公证：

- `MACOS_CERTIFICATE`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_TEAM_ID`
