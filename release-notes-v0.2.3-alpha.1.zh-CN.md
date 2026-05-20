# Spine Companion v0.2.3-alpha.1

这是 develop 通道 alpha 版本，重点是启动稳定性和首次上手体验。

## 变更

- 损坏的 `companion.local.json` 和 `reminders.json` 不再导致启动崩溃，会回退并记录警告。
- Electron 增加单实例处理；本地 API 端口冲突时显示更友好的启动错误。
- `codex-mcp` 上报非 idle 工作阶段时会自动显示 companion 窗口，避免窗口隐藏后看不到进度气泡。
- 新增 `bun scripts/report-status.cjs <phase> "<message>"`，当 AI 工具没有发现 MCP 时可走本地 HTTP fallback。
- Manager 增加本地 `.skel` 文件导入按钮。
- 首次启动且没有配置本地 Spine 素材时自动打开 Manager。
- WebSocket 状态源会忽略畸形消息，不再让 renderer 崩溃。
- 移除 `bun run start` 中的开发者本机素材路径。

## 验证

- `bun run test`
- `bun run build`
- `bun run check`
- `bun run check:mcp`
- `cargo test`
