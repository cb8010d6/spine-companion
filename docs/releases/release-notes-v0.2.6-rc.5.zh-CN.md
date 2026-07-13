# Spine Companion v0.2.6-rc.5

[English](release-notes-v0.2.6-rc.5.md) | [简体中文](release-notes-v0.2.6-rc.5.zh-CN.md)

本候选版将项目正式收口到 Tauri，并恢复 macOS、Linux 实验预览包。

## 主要变化

- 退役不再测试的 Electron 主进程、preload bridge、启动器、预览截图、诊断脚本、依赖和
  builder 配置。
- 保留 renderer 使用的 `window.companion` 契约，把独立配置与本地 API 迁到与运行时无关
  的 `src/backend`。
- `bun run dev` 默认启动 Tauri；浏览器调试继续使用 `dev:renderer` 与 `dev:api`。
- Release workflow 同时构建 Windows x64、Linux x64、macOS Intel 和 macOS Apple
  Silicon。Windows 仍为主要支持平台；macOS/Linux 属于实验预览，macOS 包尚未签名。
- 修复远程 Spine 预览始终返回 HTTP 404：rc.4 的 Axum 0.7 路由使用了不兼容的动态参数
  写法，模型文件实际已经下载到本机，但 WebView 无法读取。
- 每张模型卡片明确显示模型名称与 ID；第三方条目缺少名称时生成可读的兜底名称。
- 调整模型卡片层级、间距，并把来源/下载操作改成更紧凑的图标加文字按钮。
- 当前页预览结束后显示成功数量，失败卡片可单独重试。

v0.2.6 的 rc.1 至 rc.4 Windows 安装包本来就是 Tauri NSIS 包。rc.5 删除的是已经闲置的
Electron 源码和工具链，并没有再次更换 Windows 安装包运行时。

## 平台说明

- Windows 10/11 x64：主要支持的 NSIS 安装包。
- Linux x64：实验性 AppImage 与 DEB；托盘、透明窗口、鼠标穿透以及 Wayland/X11 仍需
  在不同发行版上验证。
- macOS Intel 与 Apple Silicon：实验性未签名 DMG。Gatekeeper 处理步骤见部署文档，
  仅对可信来源下载的文件执行。

Release 不包含 Ark-Models 版权模型或从模型生成的预览素材。
