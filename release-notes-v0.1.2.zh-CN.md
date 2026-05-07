# Spine Companion v0.1.2

[English](release-notes-v0.1.2.md) | [简体中文](release-notes-v0.1.2.zh-CN.md)

## 修复

- 修复拖动时人物闪烁：拖动中的 run 动画改为 renderer 本地播放，不再反复写全局状态。
- 仅左右方向变化时只镜像模型，不重启 `Move` 动画。
- Windows 托盘图标改用 PNG native image，避免 SVG data URL 在托盘里不显示。
- 托盘在窗口显示前创建，并设置 Windows AppUserModelId。
- 增加类似 Codex pet 的工程进展气泡，显示状态消息。
- 托盘菜单增加工程进展气泡开关。

## Windows 快速开始

1. 下载 `spine-companion-0.1.2-windows-x64-portable.exe`。
2. 把 `companion.local.json` 放在 exe 同目录。
3. 双击 exe。
