# Spine Companion v0.1.0

[English](release-notes-v0.1.0.md) | [简体中文](release-notes-v0.1.0.zh-CN.md)

第一个公开 MVP release。

## 包含内容

- Windows x64 portable 桌面应用。
- 透明、置顶 Electron companion 窗口。
- 通过 `pixi.js@6.5.10` 和 `pixi-spine@3.1.2` 实时渲染 Spine 3.8。
- 本地 HTTP、SSE、WebSocket 状态 API。
- 提醒支持。
- Codex MCP 桥接脚本。
- 各映射状态之间的稳定动画显示范围。

## Windows 快速开始

1. 下载 `spine-companion-0.1.0-windows-x64-portable.exe`。
2. 下载 `companion.local.example.json`，重命名为 `companion.local.json`，放在 exe 同目录。
3. 修改本地模型路径和 `.skel` 文件名。
4. 双击 exe。

## 素材声明

本 release 不包含明日方舟、Ark-Models 或其他版权 Spine 模型素材。你需要提供自己的本地
Spine 3.8 兼容模型目录。
