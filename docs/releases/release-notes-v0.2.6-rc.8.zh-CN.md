# Spine Companion v0.2.6-rc.8

[English](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.8.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.8.zh-CN.md)

本次候选版重点改善模型库的加载体验，并优化动态立绘在桌面窗口中的显示尺寸。

## 改进内容

- 模型库不再用整页“加载中”阻塞界面，进入页面后立即显示完整骨架；目录、已安装和
  当前模型数量会在数据就绪后从 0 平滑滚动到真实值。
- 当前页模型使用短暂的依次渐显效果；搜索和下载进度更新不会反复播放整页动画。
- 切换模型来源时保持页面响应，并按当前来源重新计算模型数量。
- 将目录中的模型类别和兼容性元数据传递给实际渲染器。动态立绘使用更大但仍受边界
  约束的视口比例，不再套用偏保守的基建小人尺寸。
- 移除当前未实现的全局快捷键设置、误导性诊断信息和相关配置字段。
- 遵守系统“减少动态效果”设置，不使用常驻动画定时器。

## 验证结果

- 195 项 JavaScript 测试通过。
- 76 项 Rust 测试通过。
- 项目检查、MCP Bridge 检查、前端生产构建、Rust 格式检查以及 Windows Tauri NSIS
  构建均已通过。

Windows 仍是主要支持平台。Linux 和未签名 macOS 包继续作为实验版本。
