# Spine Companion v0.2.4-rc.4

提醒实时刷新与 Tauri 对齐修复版。

## 变更

- Electron 状态库的提醒列表变更会实时转发到主窗口、快捷面板和管理器。
- IPC、HTTP SSE、WebSocket、Tauri bridge 都补齐实时提醒订阅。
- AI 工具创建、触发或删除提醒后，常驻后台的快捷面板会自动刷新提醒列表。
- Rust 状态库和 Tauri API server 会下发提醒列表事件。
- Tauri 在支持通知时补齐任务完成和提醒的系统通知。
- Tauri 快捷面板不再因为原生下拉菜单短暂失焦而自动关闭。
- 相比 rc.3 略微放大模型命中区，让拖动更容易，同时继续收紧上方透明空白区域。
- 单击交互动画延长播放，并使用正常混合过渡回到 idle，减少切回卡顿。
- 用户可见的 status panel 控制改名为 Debug HUD，降低误解。
