# Spine Companion v0.2.7-alpha.1

[English](https://github.com/cb8010d6/spine-companion/blob/v0.2.7-alpha.1/docs/releases/release-notes-v0.2.7-alpha.1.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/v0.2.7-alpha.1/docs/releases/release-notes-v0.2.7-alpha.1.zh-CN.md)

本次是自愿试用的 Alpha，重点修正 AI 工作状态与提醒，并小幅打磨 Manager 和快捷
Panel。需要稳定使用的用户可继续保留 v0.2.6。Companion 展示客户端主动上报的状态；
配置 MCP 不等于自动掌握所有任务，自检成功也不等于已收到真实 AI 工作上报。

## 更新内容

- 修复取消、替换提醒后旧计时器仍可能触发的问题。临时提醒结束后恢复当前有效任务，
  不再机械回到 idle；旧回调不能覆盖新上报。
- 支持客户端提供可选 sessionId，隔离交错上报的会话。一个会话完成不抹掉另一个
  会话的工作状态。旧调用继续兼容，没有会话 ID 时按来源汇总，不用工具名或进程号
  冒充真实 AI 会话。
- 提供轻量会话关注切换、来源、更新时间与过时提示。长时间没上报只表示信息可能
  过时，不会虚构成功、失败或断开。会话仅保留在本次应用运行期间。
- 自检、演示与真实上报分开；重复事件、关注切换不会重复发送通知，静音设置仍有效。
- Avatar 任务记录改用操作系统文件锁，不再根据锁文件年龄抢占。该保护不代表所有
  Pack 编辑都支持并发。
- 改善 Manager/Panel 按钮状态、主题对比、间距和窄窗口布局，不重做渲染、命中或帧率策略。

## 升级与试用

安装前请退出旧版，包括托盘进程。新旧 Avatar 锁协议不能同时写入同一任务库。
试用 Alpha 前建议备份重要用户数据。模型、设置与 AI 配置应保留；提醒和实时会话
不跨应用重启保存。

请重点测试：AI 工作期间取消提醒、两会话交错上报、关注切换、静音，以及升级后
模型和设置保留情况。Windows 睡眠恢复、renderer 重启和日常输入体验仍需实机试用；
自动化打包检查不能代替这些验收。

## 当前边界

- Windows 10/11 x64 是稳定支持目标，但本包仍是 Alpha，不是正式稳定版。
- Linux/macOS 仍为 Preview，透明区域保持可交互回退，没有原生穿透。安装包未签名，
  macOS 未公证。
- Linux 仍有已知 glib 依赖告警，详见
  [发布计划](https://github.com/cb8010d6/spine-companion/blob/v0.2.7-alpha.1/docs/maintainers/release-plan.zh-CN.md)。
- Avatar Studio 仍为 Experimental；未加入自动绑骨、Spine 导出、云同步、本地大型
  生成模型或角色商店。第三方模型授权仍须由权利方提供。

发布流水线会检查前端/Rust 严格门禁、各平台打包和 Windows 全新安装/升级冒烟测试，
通过后才发布五个平台包及 SHA256SUMS.txt。其余工作独立推进，不塞入本次 Alpha。
