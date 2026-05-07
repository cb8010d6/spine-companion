# 部署与启动指南

[English](deployment.md) | [简体中文](deployment.zh-CN.md)

本文说明如何从 release 或源码启动 Spine Companion、放置本地 Spine 素材、使用状态 API，
以及连接 Codex/MCP。

## 1. 环境要求

- Node.js 20 或更新版本。
- npm 10 或更新版本。
- 如果要贡献代码，需要 Git。
- 一个本地 Spine 3.8 兼容模型目录，包含 `.skel`、`.atlas` 和贴图文件。

已验证技术栈：

- `pixi.js@6.5.10`
- `pixi-spine@3.1.2`
- Spine 3.8 `.skel/.atlas/.png`

## 2. 最简单的 Windows Release 启动

1. 下载 `spine-companion-0.1.2-windows-x64-portable.exe`。
2. 在 exe 同目录创建 `companion.local.json`。
3. 写入并修改路径：

```json
{
  "spine": {
    "assetDir": "C:\\path\\to\\spine_model_folder",
    "skel": "model.skel"
  }
}
```

4. 双击 exe。

Release 版也会读取：

```text
%APPDATA%\spine-companion\companion.local.json
```

## 3. 从源码运行

```bash
git clone https://github.com/cb8010d6/spine-companion.git
cd spine-companion
npm install
npm run setup:assets -- "C:\path\to\spine_model_folder"
npm run dev
```

浏览器预览：

```bash
npm run dev:api
npm run dev:renderer
```

打开：

```text
http://127.0.0.1:17389?api=http://127.0.0.1:17388
```

## 4. 状态 API

默认地址：

```text
http://127.0.0.1:17388
```

读取状态：

```bash
curl http://127.0.0.1:17388/state
```

设置状态：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:17388/state `
  -ContentType "application/json" `
  -Body '{"state":"reviewing","source":"powershell"}'
```

支持状态：`idle`、`working`、`reviewing`、`running`、`success`、`failed`、
`waiting`、`sleeping`、`reminder`。

提醒：

```bash
curl -X POST http://127.0.0.1:17388/reminders ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"stand up\",\"inSeconds\":30}"
```

事件流：

- SSE: `GET /events`
- WebSocket: `ws://127.0.0.1:17388/ws`

## 5. Codex/MCP 桥接

```bash
npm run mcp:install:codex
```

安装后需要重启 Codex 或打开新会话。MCP 本身不会自动推送状态，它只暴露工具；
AI 客户端必须被指示主动调用工具。自动配置常见工具：

```bash
npm run skill:install
npm run ai:configure -- --target all
```

## 6. 构建与发布

检查：

```bash
npm run check
npm run check:mcp
npm run build
```

本地 Windows 打包：

```bash
npm run release:win
```

macOS/Linux release 由 GitHub Actions 在对应 runner 上构建。

## 7. 排错

- 模型缺失：重新运行 `npm run setup:assets -- "C:\path\to\spine_model_folder"`。
- 端口冲突：设置 `COMPANION_PORT`，并同步更新 MCP 的 `COMPANION_API`。
- Codex 看不到 MCP 工具：确认 `~/.codex/config.toml` 有 `[mcp_servers.spine_companion]`，然后重启 Codex。
- 动画大小不一致：调整 `companion.config.json` 中的 `spine.scale`、`spine.framePadding`、`spine.stageBottomInset`、`spine.fitStates`、`spine.mixDurationMs`。
