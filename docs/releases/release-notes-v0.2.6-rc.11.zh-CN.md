# Spine Companion v0.2.6-rc.11

[English](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.11.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.11.zh-CN.md)

这是 v0.2.6 stable 前计划中的最后一个预览版。本版本冻结新功能，重点收口首次使用、
AI 集成验证、本地安全、模型来源透明度和可复现发布。

## 改进

- 没有当前角色时直接进入 Manager 模型库。桌宠不再暗中提供测试模型直链；用户可以
  主动选择目录模型，或导入自己有权使用的模型。
- 对许可证为 `NOASSERTION` 或带来源警告的目录模型，在预览或下载前要求明确确认。
  用户确认前不会开始网络请求或创建缓存；Spine Companion 不打包第三方模型文件。
- 将安装包 MCP 自检和 AI 第一次真实工作上报拆成两个步骤。AI Integrations 现在显示
  两者状态、支持“测试全部连接”、持久化进度，并正确识别旧来源别名。
- 本地 API 只允许经过验证的 loopback 地址，并严格校验本地/Tauri CORS origin。
  安装包 API 契约为 HTTP + SSE；`/ws` 仅用于开发预览。提醒和最近历史仅在本次会话有效。
- 增加机器可读的 HTTP/MCP 契约，以及 JavaScript 开发 Bridge 与 Rust 安装包运行时的
  对照测试。源码 MCP server 现在会报告与应用一致的版本号。新增只读的
  `companion_get_diagnostics` 和 `companion_test_bridge`，可在不修改桌宠状态、
  不返回本机路径和 secrets 的前提下验证本地 Bridge。
- Manager 收敛为五个日常入口：Dashboard、Library、AI 集成、设置和诊断。已安装模型与
  下载任务改为 Library 标签，Avatar Studio 移入“设置 > 实验功能”。模型目录、模型、
  AI 集成、renderer 和导出等主要错误会提供有界重试与打开诊断操作；已有离线目录缓存时
  不再弹出阻断提示。
- 用户目录中的 `companion.local.json` 成为唯一可写运行时配置。仓库、工作目录和 exe
  同级文件只作为只读兼容层，并在用户配置前加载。Diagnostics 会显示唯一写入路径、
  已加载层和生效中的环境变量名称，但不会显示变量值。
- Avatar Studio 的规划任务会进行有界持久化，便于 AI 辅助规划在明确上下文下继续；
  这不会运行或自动恢复 AI 进程。Windows 下的锁获取也会在既有超时内处理瞬时共享错误。
- README 改为无需终端的 Library/Manager 使用路径，并补充当前平台等级、升级卸载、
  数据保留、安全策略、贡献指南和仓库模板。
- 增加 tag/版本/发布说明严格预检、Windows 打包版 MCP 冒烟测试、SHA-256 清单和固定
  commit 的 GitHub Actions。Windows CI 会先安装公开的 rc.10，再原位升级到候选版本，
  核对打包 MCP 版本，完成卸载，并确认用户数据仍被保留。

## 兼容性与已知限制

- v0.2.6 的稳定目标是 Windows 10/11 x64。
- rc.11 Windows 安装包尚未进行 Authenticode 签名，可能出现 Microsoft Defender
  SmartScreen 提示；这是本次发布明确披露的非阻塞限制。
- Linux x64 与未签名 macOS 包仍是预览版。透明区域原生穿透目前只在 Windows 实现；
  其他平台保持可交互回退。
- Ark-Models 目录仍属于第三方引用，其再分发权未经本项目验证。请阅读软件显示的来源
  信息，只使用你拥有相应权限的模型；应用安装包不包含第三方模型文件。
- Avatar Studio 仍是实验功能，不声称已经自动完成拆层、绑骨、动作制作或 Spine Editor 导出。
- 更新通道只控制版本检查和推荐下载链接，应用不会静默安装更新。

## 验证

- 本地 264 项 JavaScript 测试和 127 项 Rust 测试通过；项目检查、MCP 检查、覆盖率、
  前端构建、Rust check 和格式检查均通过。
- Release workflow 会校验所有版本与 tag，构建 Windows、Linux、macOS Intel 和 macOS
  Apple Silicon 安装包，执行 Windows 升级/安装/MCP 冒烟测试，并发布 `SHA256SUMS.txt`。

## 正式版前请重点测试

- 在 Windows 从 rc.10 升级，确认现有模型、位置、缩放、设置和 AI 配置都被保留。
- 使用干净配置，不打开终端、不编辑 JSON，完成第一个角色的选择或本地导入。
- 配置一个 AI 工具，完成自检，重启或新建 AI 会话，并确认第一次真实工作上报会完成
  最后一个设置步骤。
- 预览、下载、启用、切换和删除模型，确认需要时会出现来源确认，失败时不会破坏当前模型。
- 在 Windows 验证鼠标拖动、触控、滚轮缩放、透明区域点击、重启渲染器和 GPU 恢复。
