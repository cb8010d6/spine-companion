# Spine Companion v0.1.2

[English](release-notes-v0.1.2.md) | [简体中文](release-notes-v0.1.2.zh-CN.md)

## 修复

- 修复拖动时人物闪烁：拖动中的 run 动画改为 renderer 本地播放，不再反复写全局状态。
- 仅左右方向变化时只镜像模型，不重启 `Move` 动画。
- Windows 托盘图标改用 PNG native image，避免 SVG data URL 在托盘里不显示。
- 托盘在窗口显示前创建，并设置 Windows AppUserModelId。
- 增加类似 Codex pet 的工程进展气泡，显示状态消息。
- 托盘菜单增加工程进展气泡开关。
- 限制模型布局缩放，避免偶发变得过大且无法缩小。
- 状态回到 idle 后短暂保留最近进展，避免工作中气泡立刻消失。
- 稳定工程进展气泡锚点，避免消息高度变化或模型缩小时把气泡推得过高。
- 增加任务结束通知，鼠标点击后自动消失。
- 托盘菜单增加气泡阴影、背景样式和拖动模式开关。
- 增加白底黑字的浅色工程进展气泡主题。
- 透明空白窗口区域启用鼠标穿透，避免挡住下面的窗口。
- 角色鼠标命中区域会随缩放动态调整，模型越小保留的空白拖动余量越少。

## 构建说明

- 本次使用 Bun 替代原构建链路，以及 macOS Apple Silicon release 检查，由 Collaborator k1mlka luojunyuan 提出。

## Windows 快速开始

1. 下载 `spine-companion-0.1.2-windows-x64-portable.exe`。
2. 把 `companion.local.json` 放在 exe 同目录。
3. 双击 exe。
