# Spine Companion v0.2.3-alpha.3

来自 `develop` 分支的 Windows 预发布测试版。

## 修复

- 修复预发布版本检查更新的问题。alpha/beta/rc 版本现在会查询 prerelease 通道，不再只使用 GitHub 稳定版 `latest` 接口。
- 正确比较语义化预发布版本，因此 `0.2.3-alpha.2` 会被判断为新于 `0.2.3-alpha.1`，并且二者都新于 `0.2.2`。

## 整理

- 为 Pixi/Spine runtime 和 Tauri API bridge 增加 Vite 手动拆包。
- 扩充 Manager 的 i18n 覆盖，包含常用操作、设置、诊断和更新文案。
- 开始把 Manager 与 Quick Panel 的颜色收敛到共享 design tokens。
