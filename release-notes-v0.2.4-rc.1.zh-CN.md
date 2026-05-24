# Spine Companion v0.2.4-rc.1

用于测试缩放交互修复的预发布版本。

## 变化

- 人物缩小后收紧可交互命中区域。
- 修复 Windows 高 DPI 下拖动距离比例不准的问题。
- 拖动人物时隐藏 progress bubble。
- 人物缩得很小时，progress bubble 会更明显地缩小并向侧边避让，减少遮挡头部。

## 验证

- `bun run test`
- `bun run check`
- `bun run build`
- `cargo test`
