# Spine Companion v0.2.6-rc.7.2

[English](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.7.2.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.7.2.zh-CN.md)

本次热修修复 rc7.1 无法构建的问题，并完成第一轮桌面触控输入兼容。

## 修复内容

- 统一模型下载、本地启用和目录安装的激活结果结构，恢复 Tauri 正常编译。
- 从 Downloads 页面重试远程模型时保留完整目录元数据。
- 将 JavaScript 模块统一为 LF，修复 Windows 下 Vitest 导入带 shebang 脚本失败。
- 增加单指和触控笔拖动、双指缩放、`pointercancel` 清理以及画布触摸手势抑制。
- 在粗指针设备上使用更大的 Manager 控件。
- 在 macOS 和 Linux 尚未实现原生动态透明命中检测前，优先保证桌宠窗口可交互。

Windows 仍是主要支持平台。Linux 和未签名 macOS 包继续作为实验版本；这两个系统
当前会优先保证鼠标和触摸输入可靠，因此透明空白区域穿透能力暂时受限。
