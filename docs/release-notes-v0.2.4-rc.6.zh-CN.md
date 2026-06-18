# Spine Companion v0.2.4-rc.6

[English](release-notes-v0.2.4-rc.6.md) | [简体中文](release-notes-v0.2.4-rc.6.zh-CN.md)

这个候选版重点修复 Tauri 运行时的日常可用性问题。

## 变更

- 稳定人物模型周围的鼠标命中框恢复逻辑。
- 降低 Tauri 鼠标穿透恢复延迟，并让旧的恢复任务在状态变化后失效。
- 修复 OpenCode、MiMoCode、VS Code 及相关 MCP 客户端的 AI 集成配置检测。
- 增加 Codex/Copilot 指令说明，让 AI 工具更容易发现 Spine Companion 状态汇报方式。
- 更新架构文档，改为描述当前桌面运行时方向。
- 新增计划中的 Avatar Studio 接口文档，用于后续 AI 辅助生成角色包。

## 说明

- Pixi 和 Spine runtime 依赖保持不变，以继续兼容 Spine 3.8 资产。
- Avatar Studio 目前是未来接口文档。本版本还不会自动生成或绑定 Spine 模型。

