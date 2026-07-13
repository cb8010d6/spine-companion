# Spine Companion v0.2.3-rc.4

这是 v0.2.3 推 main 前的交互阻断问题修复 RC。

## 修复

- `Open Manager` 现在会等待打开结果，并容忍非关键的聚焦/置顶失败，尤其改善已安装 Tauri 包中的无反应问题。
- 打开 Manager 后或模型成功加载后，会隐藏 setup/onboarding 悬浮层。
- 恢复单击反馈：单击会重播交互动画，并自动回到 idle。
- 拖动方向切换更及时，停止拖动后立即回到 idle，不再继续跑步。
- 延长默认 success 的 Special 片段，让任务完成动作完整播放后再回 idle。

## 说明

这版 RC 需要用安装后的构建验证通过，再考虑发布稳定 main 版本。
