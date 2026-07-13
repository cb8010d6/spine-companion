# Spine Companion v0.2.1

v0.2.1 完成了更完整的 v0.2 计划，但不把项目版本过快跳到 1.0。这个版本重点是：
更容易上手、更容易诊断、更适合发布。

## 重点变化

- 新增共享设计 token 和可复用 UI 基础组件，统一 companion、panel 和 Manager 的视觉基础。
- 新增中英文 i18n 基础设施和语言文件。
- 重构 Manager：更安全的 DOM 渲染、模型库搜索、本地模型操作、设置热更新、下载状态、
  诊断、状态历史和更新检查。
- 新增 onboarding 和友好的错误恢复界面，模型缺失或加载失败时更容易处理。
- 新增提醒持久化、有限状态历史、可选空闲超时，以及提醒触发后的桌面通知。
- Electron 和 Tauri bridge 都支持切换当前模型。
- 新增全局快捷键和开机启动相关 bridge hook。
- 状态面板新增快速状态按钮、模型预览样式、更新状态和基于历史记录的进展文字。
- 新增 lint/type-check/coverage 脚本，并扩展测试覆盖：配置、provider、DOM 工具、
  i18n、更新检查、状态历史、提醒持久化和本地 HTTP history 端点。

## 发布说明

- 本版本仍不内置任何版权 Spine 素材。
- Tauri 支持继续保留，但日常使用上 Electron 仍然是功能最完整的运行时。
- GitHub Actions 生成的 macOS 包如未配置签名 secrets，仍可能是未签名产物。

## 验证

- `bun run lint`
- `bun run check:mcp`
- `bun run test`
- `bun run test:coverage`
- `bun run type-check`
- `cargo test`
- `cargo check`
