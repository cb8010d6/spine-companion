# Spine Companion v0.2.0

## 新特性
- **管理窗口 (Manager UI)**: 托盘菜单新增独立的管理界面（Manager Window），采用纯工具化深色风格。
- **模型库 (Library)**: 可以在管理窗口中直接浏览并下载兼容的 Spine 模型，支持无需重启的无缝热加载。
- **配置与设置 (Settings)**: 可通过 UI 直接配置模型缩放 (Scale)、位置偏移 (Offset) 以及气泡样式，实时热更新。
- **任务管理与下载 (Downloads)**: 真实跟踪资源下载进度，支持失败重试与状态查看。
- **诊断面板 (Diagnostics)**: 直观查看本地 API 健康状态、MCP 桥接状态以及各项核心运行时的资产验证。
- **托盘快捷控制 (Tray Quick Controls)**: 恢复实用的原生右键菜单，支持显示/隐藏、气泡和状态面板开关、状态快捷切换、诊断、配置目录和本地 API。
- **Quick Panel**: 新增托盘快速面板，并读取真实的当前状态、MCP 和本地 API 诊断结果，不再只是静态占位。
- **Electron & Tauri 双支持**: 在优先向 Tauri v2 推进架构的同时，保持对原有 Electron 环境的全面兼容。

## 资产合规
- 本项目严格遵守版权合规性。任何下载的模型素材都会被统一隔离放置于本地配置中，受到 gitignore 保护，确保包含在 Ark-Models 中的任何知识产权（如 .skel, .atlas, .png 等）均不进入公开仓库。

## 开发者
- 引入了 `companion:model-imported`、`companion:config-changed` 和 `companion:download-progress` 内部 IPC 信号系统。
- 完善了 Vite 构建选项以支持独立的 Manager 窗口渲染入口。
- 将 Tauri capabilities 更新为支持完整多窗口。
- 增加 UI 设置归一化、MCP 诊断路径和托盘菜单覆盖的聚焦测试。
