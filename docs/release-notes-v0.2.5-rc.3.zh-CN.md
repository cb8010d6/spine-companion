# Spine Companion v0.2.5-rc.3

这个候选版本让 AI 配置更容易确认是否生效，并把 Manager 控制台完善成普通用户能直接理解的实时首页。

## 本次改动

- Manager 默认打开控制台，不再先进入模型库。
- AI 任务状态或提醒变化时，控制台会实时更新，不再反复闪过加载画面。
- AI 来源优先显示工具名称，例如 Codex、OpenCode 或 MiMoCode。
- AI 连接和画面状态改为更直观的普通用户文案。
- AI 集成的连接测试现在会完成 MCP 握手，并真正向桌宠发送一条工作消息，随后回到测试前的状态。
- 连接测试最长等待五秒，按 JSON-RPC 响应 ID 匹配结果，并确保测试进程被正确结束。
- 新增控制台状态、渲染健康、高频刷新合并、MCP 超时和响应匹配的回归测试。

## 范围说明

- Tauri 仍是推荐运行时。
- Electron 已进入 legacy 状态，本版本不为它增加新功能。
- Avatar Studio 的运行资源安装和激活将在后续 RC 中完成。

## 验证项目

- `bun run test`
- `bun run check`
- `bun run check:mcp`
- `bun run build`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `bun run tauri:build`
