# 部署与启动指南

[English](deployment.md) | [简体中文](deployment.zh-CN.md)

本文说明如何从 release 或源码启动 Spine Companion、放置本地 Spine 素材、使用状态 API，
以及连接 Codex/MCP。

## 1. 环境要求

- Bun 1.3 或更新版本。
- 如果要贡献代码，需要 Git。
- 一个本地 Spine 3.8 兼容模型目录，包含 `.skel`、`.atlas` 和贴图文件。

已验证技术栈：

- `pixi.js@6.5.10`
- `pixi-spine@3.1.2`
- Spine 3.8 `.skel/.atlas/.png`

## 2. 最简单的 Windows Release 启动

1. 下载最新 Windows 安装包或便携包。
2. 打开右下角托盘菜单，选择 `Open Config Folder`，在打开的目录里创建 `companion.local.json`。
3. 写入并修改路径：

```json
{
  "spine": {
    "assetDir": "C:\\path\\to\\spine_model_folder",
    "skel": "model.skel"
  }
}
```

4. 双击启动。如果没有显示模型，托盘菜单再次选择 `Open Config Folder` 检查配置文件位置。

Release 版也会读取：

```text
%APPDATA%\spine-companion\companion.local.json
```

安装目录同级的 `companion.local.json` 也会读取，但用户配置目录更稳定，覆盖安装不会影响。

## 3. 从源码运行

```bash
git clone https://github.com/cb8010d6/spine-companion.git
cd spine-companion
bun install
bun run setup:assets -- "C:\path\to\spine_model_folder"
bun run dev
```

Tauri 版候选运行：

```bash
bun run tauri:dev
```

Tauri 版托盘菜单提供：显示窗口、显示/隐藏状态面板、显示/隐藏进度气泡、切换气泡阴影和背景、拖动模式、缩放、切换状态、打开本地 API、打开配置目录和退出。

内置设置面板也提供模型选择。选择 `Amiya Guard Skin #16` 后点击
`Download and use`，应用会从 `isHarryh/Ark-Models` 下载素材到本机配置目录，并写入
`companion.local.json`。下载完成后会直接切换加载；素材只保存在本机，不会提交到仓库。

浏览器预览：

```bash
bun run dev:api
bun run dev:renderer
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

## 5. AI / MCP 集成

安装后的 Tauri 版本优先打开 **Manager > AI Integrations**，在那里检测并配置
已安装的 AI 工具。Manager 会写入稳定的应用可执行文件路径，并在修改配置前创建备份。

安装版配置形态：

```toml
[mcp_servers.spine_companion]
command = "C:/Program Files/Spine Companion/spine-companion.exe"
args = ["--mcp"]
env = { COMPANION_API = "http://127.0.0.1:17388", COMPANION_SOURCE = "codex-mcp", COMPANION_SOURCE_LABEL = "Codex" }
```

源码开发兜底：

```bash
bun run mcp:install:codex
```

安装后需要重启 Codex 或打开新会话。MCP 本身不会自动推送状态，它只暴露工具；
AI 客户端必须被指示主动调用工具。自动配置常见工具：

```bash
bun run skill:install
bun run ai:configure -- --target all
```

## 6. Codex 插件一键安装

仓库包含 repo-local 插件：

```text
plugins/spine-companion-status
```

支持 `.agents/plugins/marketplace.json` 的 Codex 环境会看到 `Spine Companion Status`。
安装后它会提供：

- `spine-companion-status` skill。
- `spine_companion` MCP server 配置。
- 默认使用 `bun` 启动 `plugins/spine-companion-status/scripts/mcp-companion-server.mjs`。

插件仍然需要桌面应用或 `bun run dev:api` 正在运行，否则 MCP 工具无法连接本地 API。

## 7. 构建与发布

检查：

```bash
bun run check
bun run check:mcp
bun run build
```

本地 Windows 打包：

```bash
bun run release:win
```

macOS/Linux release 由 GitHub Actions 在对应 runner 上构建。

本地自用 Tauri portable-with-assets 文件夹：

```bash
bun run tauri:portable:assets
```

输出目录：

```text
release/Spine Companion Portable/
release/Spine Companion Portable.zip
```

这个脚本会下载 Ark-Models 测试素材到 portable 文件夹的 `models/` 目录。它只适合本地自用或你确认授权后的分发；公开开源 release 不应内置这些素材。

## 8. 排错

- 模型缺失：重新运行 `bun run setup:assets -- "C:\path\to\spine_model_folder"`。
- 端口冲突：设置 `COMPANION_PORT`，并同步更新 MCP 的 `COMPANION_API`。
- Codex 看不到 MCP 工具：确认 `~/.codex/config.toml` 有 `[mcp_servers.spine_companion]`，然后重启 Codex。
- macOS arm64 无法打开：GitHub Actions 生成的未签名 macOS 包可能被 Gatekeeper 拦截，Apple Silicon 上更常见。只对你信任来源下载的包使用下面方法：
  - 方法 1：把 `Spine Companion.app` 拖到 `/Applications`，右键点 App，选择“打开”，弹窗里再次点“打开”。
  - 方法 2：打开 Terminal 执行：
    ```bash
    xattr -dr com.apple.quarantine "/Applications/Spine Companion.app"
    open "/Applications/Spine Companion.app"
    ```
  - 正式签名和公证暂时不做。后续公开发布时，再在 GitHub secrets 配置 `MACOS_CERTIFICATE`、`MACOS_CERTIFICATE_PASSWORD`、`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`、`APPLE_TEAM_ID`。
- 动画大小不一致：调整 `companion.config.json` 中的 `spine.scale`、`spine.framePadding`、`spine.stageBottomInset`、`spine.fitStates`、`spine.mixDurationMs`。
