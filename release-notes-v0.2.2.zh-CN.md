# Spine Companion v0.2.2

这是 v0.2.1 Tauri 安装包的热修复版本。

## 修复

- 修复 Tauri 下 Spine 文件名包含 `#` 时的 asset URL，例如
  `build_char_1001_amiya2_sale#16.skel`。
- 新增 renderer 侧 URL 规范化，避免旧运行时配置把未编码的 `#` 文件名传给 Pixi。
- 在 public runtime config 中保留 `assetDir`，Manager 可以稳定识别当前激活模型。
- Tauri 下禁用自动鼠标穿透。之前的行为可能导致窗口无法重新收到 mouse/wheel 事件，
  表现为点击和滚轮缩放时好时坏。
- 更新检查返回当前平台/架构推荐安装包。
- Manager 的更新按钮会优先打开适合当前设备的 GitHub 下载链接。

## 验证

- `bun run test`
- `bun run build`
- `cargo test`
- `bun run tauri:build`
