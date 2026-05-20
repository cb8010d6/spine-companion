# Spine Companion

[English](README.md) | [简体中文](README.zh-CN.md)

Spine Companion 是一个开源桌面陪伴应用 MVP，面向 Spine 3.8 模型。它基于
Electron、`pixi.js@6.5.10` 和 `pixi-spine@3.1.2`，可以直接渲染
`.skel/.atlas/.png`，并提供透明背景、窗口置顶、拖拽、缩放、点击互动、状态切换、
本地状态 API、MCP 桥接、进度气泡、托盘控制、简单提醒和工具化的 Manager 窗口。

## 素材策略

本仓库不包含明日方舟、Ark-Models 或任何其他受版权保护的模型素材。只有在你有权使用
相关素材时，才应把它们作为本地测试材料。本仓库只保留代码、示例和配置说明。

本地素材配置写入 `companion.local.json`，该文件已被 git 忽略。

## 快速开始

### 使用 Release 构建

1. 从 GitHub Release 下载最新的 Windows 安装包或便携包。
2. 推荐把 `companion.local.json` 放到当前用户的配置目录：

```text
%APPDATA%\spine-companion\companion.local.json
```

也可以把它放在 exe 同目录：

```json
{
  "spine": {
    "assetDir": "C:\\path\\to\\spine_model_folder",
    "skel": "model.skel"
  }
}
```

3. 双击启动应用。托盘菜单可以打开配置目录、显示状态面板、打开 Manager 窗口、缩放、
   切换状态以及退出。

### 从源码运行

```bash
bun install
bun run setup:assets -- "C:\path\to\amiya_spine"
bun run dev
```

从源码运行 Tauri 候选版本：

```bash
bun run tauri:dev
```

部署、启动、MCP 和排障步骤见 [docs/deployment.zh-CN.md](docs/deployment.zh-CN.md)。
偏 UI 的使用说明见 [docs/user-guide.zh-CN.md](docs/user-guide.zh-CN.md)。

渲染器预览地址：

```text
http://127.0.0.1:17389?api=http://127.0.0.1:17388
```

如果只想在浏览器中预览 API 和渲染器，不启动 Electron：

```bash
bun run dev:renderer
bun run dev:api
```

这里的 MVP 指最小可用纵向切片：桌面壳、实时 Spine 渲染、状态切换、本地状态 API、
提醒和 MCP 桥接。它不是一个 spritesheet 导出工具。

## 本地状态 API

默认 API 地址是 `http://127.0.0.1:17388`。

```bash
curl http://127.0.0.1:17388/state
curl -X POST http://127.0.0.1:17388/state -H "Content-Type: application/json" -d "{\"state\":\"working\",\"source\":\"curl\"}"
curl -X POST http://127.0.0.1:17388/reminders -H "Content-Type: application/json" -d "{\"text\":\"stand up\",\"inSeconds\":30}"
```

状态事件也可以通过以下方式订阅：

- SSE: `GET /events`
- WebSocket: `ws://127.0.0.1:17388/ws`

## Codex MCP 桥接

MCP server 允许 Codex 通过本地 API 读取和更新 companion 状态。

```bash
bun run mcp:install:codex
```

这个命令会向 `~/.codex/config.toml` 追加一个 `spine_companion` MCP server 配置。
安装后需要重启 Codex，或打开一个新的 session。

可用 MCP 工具：

- `companion_get_state`
- `companion_set_state`
- `companion_reminder`
- `companion_report_codex_phase`

Codex 使用 MCP bridge 时，companion 应用或本地 API 必须保持运行。

安装可复用的状态汇报 skill，并配置常见 AI 工具：

```bash
bun run skill:install
bun run ai:configure -- --target all
```

支持的目标包括 Codex Desktop、Codex CLI、Cursor、Claude Desktop、Claude Code 和
Claude CLI。不支持 MCP 工具的环境可以复制 [docs/ai-tools.zh-CN.md](docs/ai-tools.zh-CN.md)
里的 JSON 片段。

## 一键 Codex 插件

仓库内包含一个本地 Codex 插件：

```text
plugins/spine-companion-status
```

支持 repo marketplace 文件的 Codex 环境可以从 `.agents/plugins/marketplace.json` 安装
`Spine Companion Status`。该插件提供状态汇报 skill，以及默认通过 Bun 启动的
`spine_companion` MCP bridge 配置。

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
| `reviewing` | `Special`，可配置 `review` 片段 |
| `success` | `Special`，可配置 `success` 片段 |

动画切换使用 Spine runtime 的 `stateData.setMix` 和按转场配置的 `mixDuration`。渲染器在
启动时会采样所有已映射状态动画，并使用稳定的显示帧，让 `Sit`、`Sleep`、`Move` 和
`Special` 保持一致的尺寸范围。`Special` 片段在 `companion.config.json` 中配置。

## Provider 层

渲染器支持这些状态来源：

- Electron IPC，桌面应用使用。
- 本地 HTTP 轮询，浏览器预览和简单集成使用。
- JSON 轮询，适合写入状态文件的脚本。
- WebSocket，适合 push 风格的桥接服务。

MCP bridge 的设计形态见 [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md)。

## 桌面控制

Windows 托盘菜单可以显示或隐藏状态面板、切换窗口置顶、显示或隐藏进度气泡、缩放模型、
重置尺寸、切换状态以及退出。拖拽透明舞台会移动窗口；水平拖拽会临时切换到 `running`
状态，并根据方向镜像模型。

Manager 提供可搜索的模型库、已安装模型操作、下载状态、可热应用的缩放和偏移设置、
诊断、更新检查和最近状态历史。内置的 Ark-Models catalog 条目只会下载到本地配置目录；
本仓库和公开 release 都不包含模型素材文件。

## FAQ

**为什么应用显示 missing asset？**
打开 Manager > Diagnostics，确认当前模型目录包含 `.skel`、`.atlas` 和 `.png` 文件。
如果模型是通过 Library 下载的，可以尝试在 Installed 中重新设为 active。

**为什么 Codex 一直停在 idle？**
MCP bridge 只有在 companion 应用或本地 API 运行时才可用。运行
`bun run mcp:install:codex`，重启 Codex，然后检查 Manager > Diagnostics。

**应该使用哪个 runtime？**
Electron 目前是日常使用最完整的 runtime。Tauri 构建已经包含在仓库中并持续改进，但部分
平台行为仍需要更多测试。

## 开源说明

- 不要提交受版权保护模型的 `.skel`、`.atlas` 或贴图文件。
- 本地模型路径应保存在 `companion.local.json` 或环境变量中。
- 使用 `companion.config.example.json` 作为公开配置模板。
- `assets/` 下的占位目录只用于说明素材放置方式。

## macOS Release 签名

GitHub Actions 可以构建未签名的 macOS 产物，但 Apple Silicon 用户可能会遇到 Gatekeeper
提示，例如 “damaged” 或 “cannot be opened”。如果要提供公开 macOS 下载，请配置以下仓库
secrets，让 electron-builder 对 DMG/ZIP 产物进行签名和 notarize：

- `MACOS_CERTIFICATE`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_TEAM_ID`
