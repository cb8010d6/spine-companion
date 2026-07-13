# Spine Companion v0.2.3-alpha.2

这是 `develop` 分支的 Windows 测试预发布版本。

## 修复

- 本地导入 Spine 模型前先验证资源完整性：选择的 `.skel` 同目录必须至少包含一个 `.atlas` 和一个 `.png` 贴图。
- 导入失败时显示清晰错误，不再等渲染器后续报通用加载失败。
- 记住桌宠窗口位置和尺寸，重启后恢复。
- 新增 `ui.autoRevealOnMcp`，Codex MCP 状态更新可自动唤出桌宠；用户关闭后不会被强制显示。
- 热重载失败时回到标准模型错误卡片，避免静默坏掉。
- 本地状态服务关闭时同步清理 SSE 连接。

## 说明

- 这个 prerelease 只发布 Windows 小安装包。
- 仓库和 release 仍不包含受版权限制的 Spine 模型素材。
