# 运行时 Bridge

[English](runtime-bridge.md) | [简体中文](runtime-bridge.zh-CN.md)

Spine Companion 只使用 Tauri 作为桌面运行时。Renderer 通过
`src/renderer/tauri-bridge.js` 安装的稳定 `window.companion` 接口调用 Rust command
并订阅原生事件。

保留与具体框架无关的接口名称是有意设计：UI 依赖小而明确的应用契约，不需要在各业务
模块中散落原生 API。浏览器预览使用 HTTP provider，不会伪造不支持的桌面 command。

| 能力 | 原生实现 |
| --- | --- |
| 状态与提醒 | Rust 状态存储、Tauri command/event |
| 本地 HTTP/SSE/WebSocket | `src-tauri` 中的 Axum server |
| 窗口拖动与定位 | Tauri 原生窗口 API |
| 托盘、Manager、Quick Panel | Tauri 窗口与托盘事件 |
| 设置与模型管理 | 经过校验的 Tauri command |
| AI 集成配置 | 带备份的 Tauri 文件系统 command |

Electron 已在 v0.2.6-rc.5 退役。历史 release notes 会继续保留双运行时时期的事实记录，
但不再代表当前架构。
