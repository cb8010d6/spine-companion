# Spine Companion v0.2.6-rc.7

[English](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.7.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.7.zh-CN.md)

本候选版扩展 Ark-Models 覆盖范围，并继续收紧 Manager 与渲染器的长期运行行为。

## 主要变化

- 增加三个按需加载的 Ark-Models 目录：909 个基建小人、88 个动态立绘和 1913 个敌人。
  安装包不包含任何第三方模型素材。
- 每个模型明确标记为“完整桌宠动作”“仅展示”或“实验性”；动态立绘和敌人下载前会显示
  动作兼容提示。
- 模型缺少 Relax、Move、Interact、Sit、Sleep 或 Special 时，自动回退到 Idle、Default
  或首个可用动作。
- 元数据目录固定到不可变的上游 commit，并使用 Git blob digest 校验下载，无需镜像版权素材。
- 修复慢速 Manager 页面覆盖用户后来打开页面的异步导航竞态。
- 下载进度只更新对应模型卡片，保留预览、键盘焦点、筛选和页码；完成后同步更新顶部统计。
- 原生渲染恢复时保留桌宠窗口位置、尺寸和隐藏状态。
- 窗口隐藏时暂停 JavaScript 健康恢复，睡眠唤醒或重新显示后提供恢复宽限期。

Windows 仍是主要支持平台；Linux 和未签名 macOS 包继续作为实验版本。
