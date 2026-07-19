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

- **Library**：浏览支持的目录模型，按名称或来源搜索，下载并激活已安装模型。
  - **基建小人**支持完整桌宠动作。
  - **动态立绘**以展示为主，任务状态通常回退到 Idle/Default。
  - **敌人**的上游动画命名不统一，因此标记为实验性。
  动作支持有限的模型会在下载前提示；任务状态和消息仍会正常工作。
- **Installed**：查看本地模型，打开文件夹，设为当前模型，或删除未使用模型。
- **Downloads**：查看最近下载进度和错误。
- **Settings**：调整缩放、位置、语言、主题和气泡表现。
- **Diagnostics**：检查本地 API、模型路径、MCP 配置、状态历史和更新状态。

大部分设置会热更新。修改 scale 和 offset 后，运行中的伴随窗口应该无需重启即可更新。

## 状态和提醒

Spine Companion 默认在 `127.0.0.1:17388` 提供本地状态 API。

```bash
curl http://127.0.0.1:17388/state
curl -X POST http://127.0.0.1:17388/state -H "Content-Type: application/json" -d "{\"state\":\"working\",\"message\":\"Building\"}"
curl -X POST http://127.0.0.1:17388/reminders -H "Content-Type: application/json" -d "{\"text\":\"Stretch\",\"inSeconds\":60}"
```

提醒会持久化到用户配置目录，重启应用后仍可恢复未触发的提醒。

## AI 工具配置

可以用内置脚本配置常见 AI 工具：

```bash
bun run skill:install
bun run ai:configure -- --target all
```

Codex Desktop 和 Codex CLI 也可以单独配置：

```bash
bun run mcp:install:codex
```

配置后需要重启 AI 工具或打开新会话。AI 工具上报状态时，Spine Companion 应用或本地 API 必须正在运行。

## 常见问题

如果模型窗口消失：

- 在托盘菜单里点击 **Show Companion**。
- 打开 **Manager > Diagnostics** 检查 API 和素材路径。
- 确认当前模型目录里有 `.skel`、`.atlas` 和 `.png` 文件。

如果看到 missing asset 或 `XMLHttpRequest failed`：

- 进入 **Manager > Installed** 确认当前模型目录。
- 在 **Library** 重新下载模型。
- 如果 `companion.local.json` 使用相对路径，不要只移动配置文件而不移动模型目录。

如果 Codex 或其他 AI 工具一直是 idle：

- 确认 Spine Companion 正在运行。
- 重新执行 `bun run mcp:install:codex`。
- 重启 Codex 或打开新会话。
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
