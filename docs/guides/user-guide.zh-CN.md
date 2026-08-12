# Spine Companion 用户指南

[English](user-guide.md) | [简体中文](user-guide.zh-CN.md)

这份文档面向普通用户：如何启动、导入模型、连接 AI 工具，以及不用改源码就能调整效果。

## 30 秒启动

1. 从最新 GitHub Release 安装 Spine Companion。
2. 在 Windows 右下角托盘里找到 Spine Companion 图标。
3. 右键打开 **Manager**。
4. 进入 **Library** 下载目录模型，然后点击 **Set Active**。
5. 如果大小或位置不合适，进入 **Settings** 调整 scale 和 offset。

应用不会内置版权 Spine 素材。Manager 下载的素材只会放在你的本地应用数据目录。

## 托盘菜单

日常操作优先用托盘菜单：

- **Show Companion**：把透明伴随窗口显示回来。
- **Manager**：打开模型和设置管理界面。
- **Status Panel**：打开紧凑状态面板。
- **Bubble**：显示或隐藏人物旁边的进展气泡。
- **Always On Top**：切换是否置顶。
- **Zoom**：调整人物大小。
- **State**：手动测试 idle、working、running、success、failed 等状态。
- **Open Config Folder**：打开本地配置和模型目录。

## Manager

Manager 主要有五个页面：

- **Dashboard**：集中查看当前模型、AI 来源、本地 Bridge、渲染健康、提醒和更新。
- **Library**：通过 **浏览模型**、**已安装**、**下载** 三个标签搜索目录来源、管理本地模型和查看传输错误。
  - **基建小人**支持完整桌宠动作。
  - **动态立绘**以展示为主，任务状态通常回退到 Idle/Default。
  - **敌人**的上游动画命名不统一，因此标记为实验性。
  动作支持有限的模型会在下载前提示；任务状态和消息仍会正常工作。
- **AI 集成**：检测、配置、测试 AI 工具，并在需要时安全恢复原配置。
- **Settings**：调整缩放、位置、语言、主题和气泡表现。
- **Diagnostics**：检查本地 API、模型路径、MCP 配置、状态历史和更新状态。

Avatar Studio 是 **Settings > 实验功能** 下的实验工具，不再占用日常一级导航。

大部分设置会热更新。修改 scale 和 offset 后，运行中的伴随窗口应该无需重启即可更新。

## 状态和提醒

Spine Companion 默认在 `127.0.0.1:17388` 提供本地状态 API。

```bash
curl http://127.0.0.1:17388/state
curl -X POST http://127.0.0.1:17388/state -H "Content-Type: application/json" -d "{\"state\":\"working\",\"message\":\"Building\"}"
curl -X POST http://127.0.0.1:17388/reminders -H "Content-Type: application/json" -d "{\"text\":\"Stretch\",\"inSeconds\":60}"
```

状态、提醒和最近历史只保存在当前应用会话中，应用退出后会重置。模型文件、设置和 AI 配置
备份保存在用户数据中，设计上会跨应用重启或升级保留。

## AI 工具配置

打开 **Manager > AI 集成**，选择检测到的工具，检查将修改的文件和备份信息后点击配置。
运行安装包内置自检，安装或复制界面显示的 Agent 指令，再重启 AI 工具或打开新会话。
只有 Manager 收到第一次真实工作上报后才算完成；自检成功本身不代表 AI 已开始主动上报。

AI 工具上报状态时，Spine Companion 必须正在运行。源码脚本和手动 MCP 模板只是开发者
兜底方案，见 [AI 工具指南](ai-tools.zh-CN.md)，不是安装版用户的前置条件。

## 常见问题

如果模型窗口消失：

- 在托盘菜单里点击 **Show Companion**。
- 打开 **Manager > Diagnostics** 检查 API 和素材路径。
- 确认当前模型目录里有 `.skel`、`.atlas` 和 `.png` 文件。

如果看到 missing asset 或 `XMLHttpRequest failed`：

- 进入 **Manager > Library > 已安装** 确认当前模型目录。
- 在 **Library** 重新下载模型。
- 如果 `companion.local.json` 使用相对路径，不要只移动配置文件而不移动模型目录。

如果 Codex 或其他 AI 工具一直是 idle：

- 确认 Spine Companion 正在运行。
- 打开 **Manager > AI 集成**，选择对应工具并执行 **测试连接**。
- 重启 Codex 或打开新会话。
- 运行一次真实任务后，确认 Manager 不再显示“等待首次上报”。
- 在 **Manager > Diagnostics** 查看 MCP 配置路径。

如果只有托盘图标但没有窗口：

- 右键托盘图标选择 **Show Companion**。
- 检查多显示器切换后窗口是否跑到屏幕外。
- 在 **Manager > Settings** 重置 scale 和 offset。

## 触摸屏与触控笔

- 单击人物会播放互动动作。
- 使用单指或触控笔拖动桌宠窗口。
- 在人物区域双指缩放可调整模型大小。
- 缩放、偏移和构图会按模型分别保存。可在 **Manager > 设置 > 模型构图** 中选择
  保持原有自动布局、聚焦角色或显示完整动态立绘。
- 检测到粗指针设备时，Manager 控件会使用更大的触摸目标。
- Windows 继续使用原生动态命中区域。Linux 和 macOS 当前优先保证窗口可交互，
  暂不启用完整的透明空白区域穿透。macOS 触控板缩放通过 WebView 的滚轮手势路径处理；
  Apple 当前没有提供带触摸屏的 Mac。

如果 Windows 可靠性监视器出现 `LiveKernelEvent 141`、`0x80263001`，
或者透明窗口变成黑色矩形：

- 优先按 Windows 显卡驱动 / DWM 桌面合成 reset 处理，不要先当成模型缺失。
- 如果桌面合成一直不可用，尝试更新或回退显卡驱动，并重启 Windows。
- 在 **Manager > Settings** 关闭 **硬件加速**，然后完全退出并重启
  Spine Companion。这样 Windows WebView2 会以软件渲染方式启动。应用不会自动切换。
- 在 **Manager > Diagnostics** 查看 **GPU 渲染**，确认当前配置模式。

## 发布前检查

```bash
bun run lint
bun run check:mcp
bun run test
bun run test:coverage
bun run type-check
cd src-tauri && cargo test && cargo check
```
