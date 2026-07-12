# Spine Companion v0.2.6-rc.4

本次 Windows / Tauri 候选版修复远程模型目录和下载流程，并加入安全、按需的
模型预览缓存。应用不会在启动时下载整个模型库，也不会在仓库或安装包中包含
第三方模型与缩略图。

## 主要变化

- 修复 Tauri 扁平 catalog 数据被 Manager 错误读取的问题，模型名称、来源、
  Spine 版本和下载入口现在能正确显示。
- 模型库支持选择模型源，并可按名称或 ID 实时搜索。
- 增加单模型“预览”和“预览当前页”。当前页最多 24 个模型，并发限制为 3，
  不会继续加载其他页面。
- 预览资产由 Rust 后端按需下载并执行 SHA-256 校验，再通过本地 API 提供给
  Spine runtime；WebView 不会直接访问远程资产。
- 生成的静态缩略图仅缓存在用户本机。模型更新后会根据文件签名自动失效；
  预览资产最多保留 48 个模型，缩略图最多保留 80 张。
- 已安装模型优先显示 catalog 或 `.companion-model.json` 中的真实名称；旧安装
  项不再只能显示目录 ID。
- 修复 ChatGPT/Codex、VS Code、Antigravity 和 OpenCode 的集成图标，并将
  Antigravity 与 Gemini 分开识别。
- Tauri CI 与 Release 跳过遗留 Electron 二进制下载，避免无关下载失败和额度浪费。

## 素材与版权说明

仓库和安装包不包含 Ark-Models 或《明日方舟》模型文件，也不提交由这些模型
生成的预览图。第三方素材只会在用户主动下载或预览时保存到本机缓存。请在使用
或再次分发前自行确认上游授权条款。

## 验证项目

- 171 项 Vitest 测试
- 70 项 Rust 测试
- Bun 工程检查与 MCP bridge 自检
- Vite 生产构建
- Tauri Windows NSIS 安装包构建
- GitHub `Check` 与 `Tauri check`
