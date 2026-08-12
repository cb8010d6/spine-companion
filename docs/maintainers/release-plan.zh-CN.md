# 发布计划

[English](release-plan.md) | [简体中文](release-plan.zh-CN.md)

## 发布范围

Spine Companion v0.2.6 在最终预览版验收期间冻结新功能。该版本线只接收可靠性、
首次使用、恢复能力、文档和发布工程改动。

平台承诺有意保持不同等级：

| 平台 | v0.2.6 支持等级 | 安装包 |
| --- | --- | --- |
| Windows 10/11 x64 | 正式版目标 | NSIS `.exe` |
| Linux x64 | 预览版 | `.AppImage`、`.deb` |
| macOS Intel | 未签名预览版 | `.dmg` |
| macOS Apple Silicon | 未签名预览版 | `.dmg` |

Linux 和 macOS 的透明桌宠窗口使用保持可交互的兼容回退。各平台分别完成原生实现和
实机验收前，不宣称支持透明区域原生穿透。

## 分支与标签规则

- Pull Request 和普通分支 push 只运行 CI。
- 只有 `v0.2.6-rc.11`、`v0.2.6` 这类版本标签会发布安装包。
- 发布标签必须指向 `main` 上已经审查的合并提交。
- 不要根据可能过期的本地远端跟踪分支推断发布 SHA。发布前使用 `git ls-remote`
  核对标签和 `main`。
- 包含 `alpha`、`beta` 或 `rc` 的标签创建 GitHub prerelease；`v0.2.6` 创建正式
  Release。

## 自动化门槛

创建标签前运行：

```bash
bun install --frozen-lockfile
bun run test
bun run check
bun run check:mcp
bun run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
bun run release:preflight -- --tag v0.2.6-rc.11
```

最后一条命令必须使用本次实际标签。Release workflow 会再次检查版本和发布说明，构建
四个平台目标，执行 Windows 安装包及 MCP smoke，并发布 `SHA256SUMS.txt`。

Windows 门槛覆盖静默安装、安装后 API 启动、安装包 MCP、静默卸载和用户数据保留。
v0.2.6 最终预览版还要从公开 rc.10 安装包执行一次原位升级测试。

## 最终预览版人工门槛

只有 Windows 实测确认以下项目后，才把最终预览版提升为正式版：

1. 从 rc.10 升级后，当前模型、每模型展示参数、窗口位置、设置和 AI 配置均保留。
2. 全新用户目录不需要终端或手写 JSON，能够直接进入模型库。
3. 许可证信息未验证的模型在预览/下载前要求确认；操作失败不会破坏当前模型。
4. AI 设置分别显示检测、配置、重启提示、安装包自检、首次真实上报和安全恢复。
5. 鼠标、触控、滚轮缩放、拖动、透明区域输入、渲染器重启、睡眠恢复和 GPU 恢复可用。
6. 安装包和发布说明明确 Windows 是正式版目标，Linux/macOS 是预览版。

发现问题时保存导出的诊断报告和安装包准确校验值。仍有可复现 release blocker 时不得
提升为正式版。

## 外部依赖与明确限制

以下项目不能只靠仓库代码完成，也不会被描述成已经实现。它们是 v0.2.6 已公开、
不阻塞发布的限制，而不是被隐藏的发布承诺：

- Windows/macOS 签名与 macOS 公证需要可信签名身份和凭据；发布说明必须继续显示
  未签名状态。
- Ark-Models 条目在权利方提供可核验的授权或许可证依据前，仍是标记为
  `NOASSERTION` 的第三方引用。
- 自动绑骨和最终 Spine runtime 导出需要合法的 Spine Editor 或等价授权导出链；
  Avatar Job 只保存规划与进度。

## 发布步骤

1. 把已审查的最终预览分支合并到 `main`。
2. 获取并核对远端 `main` 的准确提交。
3. 在该提交上创建 annotated version tag 并推送。
4. 等待验证和全部平台打包任务成功。
5. 确认 Release 正文与 `docs/releases/` 中对应文件一致。
6. 确认 Windows 安装包、Linux AppImage 和 DEB、两个 macOS DMG 以及
   `SHA256SUMS.txt` 均存在。
7. 下载 Windows 安装包，核对 SHA-256，并在提升正式版前完成人工验收清单。

只有最终预览版通过上述人工门槛后才创建 `v0.2.6`。不要把 prerelease 文件改名冒充
正式版，也不要复用旧 workflow 的安装包。
