# Spine Companion v0.2.6-rc.6

[English](release-notes-v0.2.6-rc.6.md) | [简体中文](release-notes-v0.2.6-rc.6.zh-CN.md)

本候选版集中修复模型库操作连续性和长时间动画可靠性。

## 主要变化

- 下载模型时保留模型库的搜索、来源、筛选和页码；下载进度只增量更新当前卡片，不再替换
  整个页面或反复刷新远程目录。
- 将 `config-changed` 作为模型重载的唯一权威事件，消除下载完成后多次重载竞争导致的
  “Unable to load model” 偶发错误。
- 模型和预览遇到临时网络错误时自动短暂重试一次；确定性的 HTTP 错误仍会立即显示。
- 单击互动改为等待 Spine 动画轨道真正播放完成后回切，不再依赖估算倒计时。
- 使用 idle、working、running、waiting 等稳定日常动作统一模型尺寸、基线和气泡位置，
  避免特效范围影响不同模型的显示比例。
- success/review 不再预排数百段动画，改为一个 Spine 原生循环段；渲染健康检查同时监控
  动画轨道是否前进。
- 增加低频原生看门狗：可见 WebView 心跳中断时自动重建，并设置恢复冷却，正常运行开销
  极低。
- Diagnostics 显示模型缓存和预览缓存的文件数、占用空间，并可安全打开两个缓存目录。

Windows 仍是主要支持平台；Linux 和未签名 macOS 包继续作为实验版本。Release 不包含
Ark-Models 版权模型或生成的预览素材。
