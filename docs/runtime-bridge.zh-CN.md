# 运行时 Bridge 能力矩阵

Spine Companion 当前同时支持 Electron 和 Tauri。渲染进程统一通过 `window.companion` 调用能力；Electron 由 `src/main/preload.cjs` 暴露，Tauri 由 `src/renderer/tauri-bridge.js` 安装同形 API。

| 能力 | Electron | Tauri | 说明 |
| --- | --- | --- | --- |
| 读取公开配置 | `companion:get-config` | `get_config` command | 两端都返回渲染进程安全配置。 |
| 读取当前状态 | `companion:get-state` | `get_state` command | 两端都返回归一化后的状态快照。 |
| 设置状态 | `companion:set-state` | `set_companion_state` command | UI 控件、提醒和外部 provider 都会使用。 |
| 创建提醒 | `companion:create-reminder` | `create_reminder_cmd` command | Tauri 使用 Rust 存储提醒；Electron 使用共享 JS store。 |
| 订阅状态 | `companion:state` IPC | `companion:state` event | 用于渲染层和 AI 状态桥接反馈。 |
| 订阅 UI 设置 | `companion:ui` IPC | `companion:ui` event | Electron 托盘当前会发送；Tauri 菜单能力还比较少。 |
| 订阅缩放命令 | `companion:scale` IPC | `companion:scale` event | Electron 托盘当前会发送；Tauri 菜单能力还比较少。 |
| 开始拖拽 | `companion:drag-start` IPC | `start_drag` command | Electron 手动移动窗口；Tauri 交给系统原生拖拽。 |
| 拖拽移动/结束 | `companion:drag-move/end` IPC | bridge no-op | Tauri 在开始拖拽后由系统接管。 |
| 鼠标穿透 | `setIgnoreMouseEvents` | `set_ignore_cursor_events` | 渲染层已用 `requestAnimationFrame` 节流命中检测。 |
| 托盘菜单 | 完整菜单 | 最小 show/quit 菜单 | Tauri 后续需要补齐 UI 开关和缩放动作。 |

## 后续工作

- 给 Tauri 托盘补齐状态面板显示、气泡显示、气泡样式、置顶、拖拽模式和缩放动作。
- 增加 bridge contract 测试，对比 Electron preload 与 Tauri bridge 暴露的方法名。
- 渲染层继续只依赖 `window.companion`；运行时差异应留在 preload/bridge 层。
