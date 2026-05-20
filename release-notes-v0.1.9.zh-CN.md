# Spine Companion v0.1.9

## 重点

- Tauri 版托盘控制补齐：状态面板、进度气泡、气泡阴影、气泡背景、拖动模式、缩放、状态切换、打开 API、打开配置目录。
- 修复 Tauri 版重复托盘图标：只保留 Rust 代码创建的带菜单图标。
- 增加应用内设置面板和模型管理入口。
- 增加 Ark-Models 示例 catalog，可在界面中下载并导入 `Amiya Guard Skin #16`，导入后立即加载。
- 增加 Codex repo-local 插件 `spine-companion-status`，用于一键安装状态上报 skill/MCP 配置。
- 增加 Tauri portable-with-assets 本地打包脚本。

## 说明

公开仓库和公开 release 仍不内置 Ark-Models 或其他版权素材。模型导入功能会把素材下载到用户本地配置目录；portable-with-assets 脚本只建议本地自用或确认授权后分发。

## 验证

- `bun run test`
- `bun run check`
- `bun run check:mcp`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `bun run build`
- `bun run tauri:build`
