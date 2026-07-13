# Spine Companion v0.2.6-rc.1

本候选版集中提升系统级桌面交互可靠性，并收紧普通用户每天使用的操作界面。

## 变更

- 增加用户可选更新通道：自动、仅正式版，或预发布版。
- AI 集成为 Codex、Claude、VS Code、Cursor、Gemini 和 OpenCode 增加可识别的本地矢量图标，运行时不依赖网络加载。
- 移除只覆盖人物中央小块的命中框，在所有支持的缩放比例下覆盖大部分可见 Spine 模型。
- Renderer 持续上报最新人物区域，由 Rust 统一负责鼠标进入/离开切换；Windows 下包含 18px 恢复扩展区和 80ms 离开滞后。
- 将 Tauri Quick Panel 的失焦关闭下沉到原生窗口焦点事件。Pin 后保持显示，原生下拉菜单使用短暂交互锁避免误关闭。
- 增加 Windows 托盘单击/双击区分：延迟单击切换 Quick Panel，双击直接打开 Manager，且不会同时弹出 Panel。
- 精简并本地化托盘菜单。日常操作保留在一级菜单，诊断、GPU 恢复、API/配置目录和调试状态移入“高级与调试”。
- 主题增加“跟随系统 / 浅色 / 深色”，默认跟随系统，并实时响应系统主题变化；Manager、Quick Panel 和桌宠窗口共用同一主题能力。
- 将 Quick Panel 收敛为单屏工具面板。提醒和更新改为紧凑徽标，不再占用完整滚动区块。
- Tauri 设置页不再显示当前不支持的全局快捷键控件，避免与诊断说明冲突。
- 修复 Tauri 合并运行时设置时丢失 locale、theme 等非 Rust UI 字段的问题。
- Tauri HTTP API 增加 `GET /config` 和 `GET /history`，保持本地集成兼容。
- 增加人物命中覆盖和系统主题解析的回归测试。

## 范围

- Tauri 继续作为推荐运行时；Electron 保持 legacy。
- 远程模型源 catalog 和 Manager 一级导航合并安排到后续 0.2.6 RC。
- 本版本不包含任何受版权保护的 Spine 模型素材。
