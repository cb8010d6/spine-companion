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
| 打包应用本地 API | `src-tauri` 中使用 SSE 的 Axum HTTP server |
| 窗口拖动与定位 | Tauri 原生窗口 API |
| 托盘、Manager、Quick Panel | Tauri 窗口与托盘事件 |
| 设置与模型管理 | 经过校验的 Tauri command |
| AI 集成配置 | 带备份的 Tauri 文件系统 command |

## 打包应用 API 契约

打包应用的集成契约是本地 HTTP 加 Server-Sent Events。健康检查和状态接口位于配置的本地
origin，`GET /events` 用于推送状态和提醒事件。WebSocket endpoint 不属于打包应用 API 契约。
浏览器预览可以有其他 provider，但面向安装版应用的集成应使用 HTTP 和 SSE。

状态、提醒和最近历史只保存在当前应用会话的内存中，应用退出后会重置。模型文件、用户设置
和 AI 配置备份保存在用户数据中，升级和恢复方式见[部署指南](../guides/deployment.zh-CN.md)。
