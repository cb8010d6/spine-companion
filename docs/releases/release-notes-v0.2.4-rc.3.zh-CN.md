# Spine Companion v0.2.4-rc.3

运行态面板和交互体验修复版。

## 变更

- 将托盘 status panel 改成运行态小控制台，不再默认显示手动切状态按钮。
- 面板显示当前 AI 来源、任务消息、Bridge/API 健康、当前模型、提醒、更新和少量显示开关。
- 手动状态按钮移入 debug 模式（`?debug` 或 `ui.debugPanel: true`）。
- 新面板文案补齐中英文切换。
- 点击人物时保留 working/running/reviewing 的实时任务气泡。
- 只有 success/failed 这类任务结果状态会在点击人物后回到 idle。
- 延长单击人物的 Interact 播放时间，避免撒花/交互动画没播完就回到原动作。
- 收紧透明模型命中区域，并降低小缩放比例下的命中 padding。
- 修复 Windows Tauri 鼠标穿透逻辑：透明区域保持穿透，只有鼠标进入模型命中区才恢复可点击。
- success 后半段改为带混合的重复片段，减少原生片段循环的硬跳。
