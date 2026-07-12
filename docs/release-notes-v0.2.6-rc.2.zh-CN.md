# Spine Companion v0.2.6-rc.2

本次候选版本重点完善 Manager 的可发现性、Avatar Pack 工作流、模型浏览体验和 Windows 托盘行为。

## 主要变化

- Manager 顶栏新增常驻语言选择器，支持跟随系统、English 和中文；切换后当前页面与导航立即更新。
- 修复 Windows 托盘左键单击同时弹出 Quick Panel 和系统右键菜单的问题；现在左键只打开 Quick Panel。
- 保留托盘双击快捷操作：双击会取消待执行的单击动作，并直接打开 Manager。
- 重做 Avatar Studio 的“选择、校验、保存/安装”流程；紧凑窗口下路径输入框与操作按钮不再重叠。
- Avatar Pack 新增原生文件夹选择器，并展示已登记的本地 Pack，可直接打开目录或重新校验。
- 显示 Avatar Pack 的预览图、可编辑图层和 Spine runtime 导出就绪状态。
- 模型库新增全部、已安装、可下载筛选，以及目录摘要、兼容性与授权标记、来源链接和更清晰的空状态。
- 修复紧凑宽度下侧栏产品名被截断的问题，改为稳定换行显示。
- 新增 Tauri 托盘点击行为的回归测试。

## 范围说明

- Tauri 仍是推荐运行时，Electron 继续作为 legacy 版本保留。
- Avatar Studio 只校验和管理用户拥有合法权利的 Pack，不会宣称能把单张图片自动生成专业 Spine rig。
- 带缓存与完整性校验的远程多模型源目录留待后续候选版本实现。
- 仓库和安装包均不包含任何受版权保护的 Spine 模型素材。

## 验证结果

- 152 项 JavaScript 测试通过。
- 64 项 Rust 测试通过。
- 项目检查、MCP 自检、renderer 构建和 Windows Tauri 安装包构建通过。
