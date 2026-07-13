# Spine Companion v0.1.3

[English](release-notes-v0.1.3.md) | [简体中文](release-notes-v0.1.3.zh-CN.md)

## 运行时

- 补齐 Tauri P1 reminders 路径：Rust 端现在支持创建、列表、触发和自动返回。
- Tauri Axum API 增加 `/assets/spine/*` 本地 Spine 素材服务。
- Tauri 运行时配置会读取仓库配置、本地配置和环境变量覆盖。
- Tauri 状态更新会 emit 到 renderer bridge，UI 不再只依赖轮询。

## CI 与发布

- 为 Tauri 后端增加 `cargo test` 和 `cargo check` 覆盖。
- CI 增加 Windows、Linux、macOS 的 Tauri build job。
- Release workflow 增加 Tauri package job 并上传 Tauri bundle artifacts。
- CI/release 中加入 Vitest，和项目检查、MCP 检查一起运行。

## 说明

- Bun 迁移和 macOS Apple Silicon release 验证由 Collaborator k1mlka luojunyuan 提出。
- macOS 公开发布仍建议配置 Apple 签名/公证 secrets，以减少 Gatekeeper 拦截。
