# 部署与启动指南

[English](deployment.md) | [简体中文](deployment.zh-CN.md)

本文说明如何从 release 或源码启动 Spine Companion、放置本地 Spine 素材、使用状态 API，
以及连接 Codex/MCP。

## 1. 环境要求

- Bun 1.3 或更新版本；从源码开发还需要 Rust stable。
- 如果要贡献代码，需要 Git。
- 一个本地 Spine 3.8 兼容模型目录，包含 `.skel`、`.atlas` 和贴图文件。

已验证技术栈：

- `pixi.js@6.5.10`
- `pixi-spine@3.1.2`
- Spine 3.8 `.skel/.atlas/.png`

Linux 源码构建还需要 WebKitGTK 4.1、AppIndicator、librsvg 和 patchelf。Ubuntu/Debian：

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

macOS 源码构建需要 Xcode Command Line Tools。原生安装包应在对应系统构建，GitHub
Actions 的 release matrix 会分别执行。

## 2. 最简单的 Release 启动

1. 从 GitHub Release 下载 Windows NSIS、macOS DMG、Linux AppImage 或 DEB。
   Windows 是稳定目标；macOS 和 Linux 包是未签名预览版。
2. 启动应用，打开 **Manager > Library**，选择角色并点击 **Download and use**。
   如果使用有授权的本地模型，点击 **导入本地 .skel**，再到 **Library > 已安装** 管理。
3. 打开 **Manager > Settings** 调整大小和位置。如果没有显示模型，打开
   **Manager > Diagnostics**，确认模型目录包含兼容的 skeleton、atlas 以及引用的贴图。

Release 版也会读取：

```text
%APPDATA%\spine-companion\companion.local.json
```

安装目录同级的 `companion.local.json` 也会读取，但用户配置目录更稳定，覆盖安装不会影响。

### 配置层与唯一写入位置

打包后的 Tauri 运行时把用户配置目录中的文件作为唯一可写的 canonical 配置：

```text
<用户配置目录>/companion.local.json
```

仓库根目录、当前工作目录和 exe 所在目录中的 `companion.local.json` 只作为只读
legacy 兼容层读取。它们会先于用户配置加载，因此用户配置始终拥有最高优先级。
模型激活、显示设置以及 Manager 的其他修改只写入 canonical 文件，不会覆盖 legacy 文件。

相对路径形式的 `spine.assetDir` 会按照提供该字段的配置层所在目录解析。打开
**Manager > Diagnostics** 可以看到唯一写入路径和实际加载的配置层，便于排查覆盖来源；
诊断不会显示配置内容或 secrets。

浏览器/源码适配器 `src/backend/config.cjs` 也保持相同优先级，方便开发调试；它只是开发适配器，
不是另一套打包运行时。

## 3. 升级、卸载与保留数据

升级或卸载前先退出 Spine Companion；如果模型或配置重要，可通过 `Open Config Folder`
备份整个目录。安装目录和用户数据目录是分开的。

升级时直接安装新版本即可。用户配置、下载的模型、预览缓存、日志和 AI 集成备份保存在
用户数据中；应用版本和 renderer 会被替换。升级后如果模型没有激活，打开
**Manager > Library > 已安装** 再次设为 active。

卸载时使用操作系统的正常卸载入口。它会移除已安装应用，但不要求删除用户数据目录。
确认不再需要模型、设置、日志或备份后，再手动删除该目录。

### 恢复 AI 配置

Manager 写入 AI 工具配置前会创建备份。打开 **Manager > AI Integrations**，选择已配置的
工具，在可恢复时点击 **Restore Previous Config**。恢复会为当前被替换的文件再创建安全副本，
并要求重启对应 AI 工具。如果目标文件在 Manager 写入后被手动修改，恢复会停止，避免覆盖
更新后的内容。

## 4. 从源码运行

```bash
git clone https://github.com/cb8010d6/spine-companion.git
cd spine-companion
bun install
bun run setup:assets -- <model-folder>
bun run dev
```

`bun run dev` 已直接启动 Tauri。以下别名与它等价：

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

## 5. 状态 API

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

打包应用的 API 契约是 HTTP 加 SSE。状态、提醒和最近历史只保存在当前应用会话内存中，
应用退出后会重置。

## 6. AI / MCP 集成

安装后的 Tauri 版本优先打开 **Manager > AI Integrations**，在那里检测并配置
已安装的 AI 工具。Manager 会写入稳定的应用可执行文件路径，并在修改配置前创建备份。

安装版配置形态：

```toml
[mcp_servers.spine_companion]
command = "<install-dir>/spine-companion.exe"
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

## 7. Codex 插件一键安装

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

## 8. 构建与发布

检查：

```bash
bun run check
bun run check:mcp
bun run build
```

在当前操作系统构建原生安装包：

```bash
bun run release:win    # Windows NSIS
bun run release:mac    # macOS app + DMG
bun run release:linux  # Linux DEB + AppImage
```

产物位于 `src-tauri/target/release/bundle/`。原生包应在对应操作系统上构建；完整平台
矩阵由 GitHub Actions 执行。

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

## 9. 排错

- 模型缺失：重新选择 **Manager > Library > 已安装** 中的模型，或使用源码流程指定模型目录。
- 端口冲突：设置 `COMPANION_PORT`，并同步更新 MCP 的 `COMPANION_API`。
- Codex 看不到 MCP 工具：确认 `~/.codex/config.toml` 有 `[mcp_servers.spine_companion]`，然后重启 Codex。
- AI 集成失败：在 **Manager > AI Integrations** 使用 **Restore Previous Config**，确认目标文件
  没有被其他程序更新，再重新配置。
- 状态或提醒在重启后消失：这是预期行为；它们和最近历史只属于当前应用会话。模型、设置和
  AI 配置备份才是会保留的用户数据。
- macOS arm64 无法打开：GitHub Actions 生成的未签名 macOS 包可能被 Gatekeeper 拦截，Apple Silicon 上更常见。只对你信任来源下载的包使用下面方法：
  - 方法 1：把 `Spine Companion.app` 拖到系统 Applications 文件夹，右键点 App，选择“打开”，弹窗里再次点“打开”。
  - 方法 2：打开 Terminal 执行：
    ```bash
    xattr -dr com.apple.quarantine "<path-to-Spine Companion.app>"
    open "<path-to-Spine Companion.app>"
    ```
  - 正式签名和公证暂时不做。后续公开发布时，再在 GitHub secrets 配置 `MACOS_CERTIFICATE`、`MACOS_CERTIFICATE_PASSWORD`、`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`、`APPLE_TEAM_ID`。
- 动画大小不一致：调整 `companion.config.json` 中的 `spine.scale`、`spine.framePadding`、`spine.stageBottomInset`、`spine.fitStates`、`spine.mixDurationMs`。
