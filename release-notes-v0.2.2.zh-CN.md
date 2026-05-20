# Spine Companion v0.2.2

这是 v0.2.1 Tauri 安装包的热修复版本。

## 修复

- 修复 Tauri 下 Spine 文件名包含 `#` 时的 asset URL，例如
  `build_char_1001_amiya2_sale#16.skel`。
- 新增 renderer 侧 URL 规范化，避免旧运行时配置把未编码的 `#` 文件名传给 Pixi。
- Tauri 每次返回配置时都会基于当前 `skel` 重新生成 public `assetUrl`，
  避免热更新后残留旧的未编码 URL。
- 让错误弹窗、引导弹窗和设置区域在透明窗口里保持可点击，`Retry` 和
  `Open Manager` 不再被鼠标穿透影响。
- 在 public runtime config 中保留 `assetDir`，Manager 可以稳定识别当前激活模型。
- Tauri 下禁用自动鼠标穿透。之前的行为可能导致窗口无法重新收到 mouse/wheel 事件，
  表现为点击和滚轮缩放时好时坏。
- 托盘 Quick Panel 改成类似 flyout 的行为：左键切换显示，右键打开原生菜单前先隐藏，
  失焦或按 `Esc` 会自动关闭。
- 修复 Quick Panel 开关样式，Progress Bubble 和 Status Panel 不再被拉伸成整行长条。
- Manager 和 Quick Panel 增加真实模型预览图：当前激活模型走本地 asset URL，
  模型库项目走 Ark-Models 远程 PNG URL，不包含版权素材本体。
- 更新检查返回当前平台/架构推荐安装包。
- Manager 的更新按钮会优先打开适合当前设备的 GitHub 下载链接。

## 验证

- `bun run test`
- `bun run build`
- `bun run check`
- `bun run check:mcp`
- `cargo test`
- `cargo check`
- `bun run tauri:build`
