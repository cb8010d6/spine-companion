# Spine Companion v0.2.3

面向 Tauri 桌面陪伴应用的稳定性与交互修复版本。

## 重点变化

- 修复安装版 Manager 打不开或无法恢复的问题，改善托盘/Manager 窗口恢复逻辑。
- 打开 Manager 或模型加载成功后隐藏 setup/onboarding 悬浮层。
- 恢复单击交互反馈，并在反馈播放后自动回到 idle。
- 改善拖动行为：左右方向切换更及时，拖动时跑步，停止拖动后回 idle。
- 缩放或托盘切换后重新收紧透明窗口命中范围，减少人物周围空白区域挡住下层窗口的问题。
- 小托盘面板在没有静态预览图时也会渲染 Spine 预览。
- success 完整播放任务完成动作后保持完成姿态，直到用户点击再回 idle。
- Electron 仍保留为推荐运行时；Tauri 作为当前重点测试和发布候选运行时。

## 验证

- `bun run test`
- `bun run check`
- `bun run build`
- `cargo test`
- GitHub Actions Windows package workflow

## 说明

Release 不包含有版权的 Spine 模型素材。请通过 Manager 下载测试素材，或导入本地模型。
