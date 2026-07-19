# Spine Companion v0.2.6-rc.10

[English](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.10.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.10.zh-CN.md)

本候选版本继续完成 rc.9 稳定性修复之后的 Windows 输入与模型库改造。

## 改进

- 根据当前可见的 Spine 附件生成最多 16 个命中区域。Windows 原生指针监控会直接
  使用这些区域，小模型更容易点中，角色之间的透明空隙也更容易穿透。
- 按模型保存缩放、偏移和构图模式。滚轮、触控双指缩放、桌宠内控件和 Manager
  现在写入同一份展示配置，不会把上一个模型的位置和大小带到下一个模型。
- 增加“自动”“角色聚焦”“完整画面”三种构图。旧用户默认保持原有自动行为，
  不会被静默裁切或强制放大。
- 将模型搜索、分页、安装状态筛选、预览解析和安装解析下沉到 Rust Catalog Store。
  预览与安装命令只接收 `sourceId + modelId`，下载地址和文件清单由后端从已验证的
  本地目录缓存中解析。
- 增加 Kimi Code CLI 官方 MCP 配置，使用 `~/.kimi/mcp.json`，并补齐 Kimi 来源名称、
  图标、指令和诊断信息。
- Diagnostics 会明确显示穿透能力。Windows 显示原生多区域支持；macOS、Linux X11
  和 Linux Wayland 在完成真机验证前显示“保持可交互”的兼容回退。

## 兼容性

- Windows 10/11 仍是主要支持平台。
- Linux 与未签名 macOS 包仍为实验支持；当前不会宣称已支持透明空白区域原生穿透。
- 硬件加速和跟随显示器刷新率仍为默认设置。

## 验证

- 223 项 JavaScript 测试和 100 项 Rust 测试通过；项目检查、MCP 检查、前端构建、
  打包版 MCP 自检和 Windows NSIS 构建均通过。
- macOS、X11 和 Wayland 原生穿透仍属于后续平台任务，不作为未经实机验证的 rc.10
  已完成功能宣传。
