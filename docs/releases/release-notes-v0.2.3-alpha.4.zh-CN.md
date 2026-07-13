# Spine Companion v0.2.3-alpha.4

这个预发布版主要补齐日常可用性和稳定性短板。

## 重点变化
- 拆清 `state`、消息气泡、任务完成通知、提醒的展示语义。
- 状态切换默认清空旧消息，只有显式传 `preserveMessage` 才保留。
- `success` / `failed` 只有 AI 任务来源或显式 `notify: true` 才弹任务完成通知，避免手动点状态也误弹。
- 统一识别 Codex、Claude、Cursor、Cline/Roo、Gemini、Antigravity 和 local AI 状态来源。
- Panel 和 Manager 增加提醒列表与删除。
- 下载增加单文件 30 秒超时、更清楚的失败原因和下载后模型校验。
- 校验 `.atlas` 引用的贴图文件，避免缺 PNG 后才在渲染时报错。
- Diagnostics 增加模型健康检查和日志导出。
- IPC 输入增加轻量校验，覆盖状态、设置、模型导入、提醒和打开目录。
- Renderer 增加全局错误兜底和 Provider 连接异常提示。
- Quick Panel 增加 pin/unpin，并修复开关样式污染。

## 说明
- alpha4 仍建议优先使用 Electron 运行时。
- Tauri 继续作为实验运行时，托盘、通知、透明窗口点击穿透等行为还在追平。
- 本预发布版优先发布 Windows 安装包用于测试。
