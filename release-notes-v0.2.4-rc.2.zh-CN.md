# Spine Companion v0.2.4-rc.2

第二个缩放交互与动画打磨预发布版本。

## 变化

- 进一步收紧人物缩小后上方透明区域的命中范围。
- 单击人物时保留交互动画，但不再弹出 Interaction progress bubble。
- working/running 的任务通知在点击人物时会继续保持，不被点击打断。
- AI running 状态使用和 idle/working 一致的放松动作；Move 跑步动作只用于实际拖动窗口。
- 人物很小时，progress bubble 会避开可见人物主体，减少遮挡。
- review / 挥手片段会持续播放，但改成带混合的重复进入，避免原生片段循环时第一帧硬跳。
- success 会先完整播放一次，再循环后半段完成/骑乘片段，直到用户点击 dismiss。

## 验证

- `bun run test`
- `bun run check`
- `bun run build`
- `cargo test`
