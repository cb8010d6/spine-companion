# Spine Companion v0.2.5-rc.1

这个候选版本完成 v0.2.5 的第一轮功能闭环。

## 新增

- AI Integrations 增加 MCP 测试、Agent 指令生成、指令文件状态和可编辑 Custom MCP 模板。
- Manager 默认进入 Dashboard，展示当前模型、AI 来源、Bridge/API 健康、提醒、更新和渲染器健康。
- Avatar Studio 现在可以校验并导入本地 avatar pack。
- 增加实验性 MCP 工具：avatar 要求、创建任务、更新任务、校验 pack 和导入 pack。

## 边界

- Avatar Studio 管理用户本地拥有版权或使用权的形象包，不声称能把单张平面图自动变成专业 Spine runtime rig。
- 没有 Spine Editor 或其他合法导出路径时，应用只能校验/导入中间包，或导入已有 `.skel/.atlas/.png` 导出。
