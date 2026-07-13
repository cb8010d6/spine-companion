# Spine Companion v0.2.5-rc.2

这是基于 v0.2.5-rc.1 的小型稳定性修复版。

## 变更

- 禁止 Tauri 桌宠主窗口被系统缩放、最大化或全屏化。
- legacy Electron 快捷面板也加入最大化/全屏防护。

## 说明

- 本版没有修改状态机、MCP 生命周期、命中框、字体加载或渲染默认策略。
- 目标是降低 Windows Aero Snap / 意外最大化导致窗口和模型异常放大的风险，同时不改变现有交互模型。

## 验证

- `bun run test`
- `bun run check`
- `bun run check:mcp`
- `cargo test --manifest-path src-tauri\Cargo.toml`
