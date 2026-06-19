# Spine Companion v0.2.4-rc.7

[English](release-notes-v0.2.4-rc.7.md) | [简体中文](release-notes-v0.2.4-rc.7.zh-CN.md)

## 变化

- 增加 renderer 健康检查和 WebView2/GPU reset 恢复命令。
- 托盘和 Manager 诊断页新增重启渲染器、清理 WebView GPU 缓存操作。
- 收紧鼠标命中框，并增加可选命中框调试覆盖层。
- 修正拖动时的屏幕像素位移计算。
- reviewing 动画改为循环片段，减少重复播放时的卡顿感。
- AI Integrations 新增 MCP 测试按钮。
- Manager 新增实验性的 Avatar Studio 页面，用于说明本地形象包工作流。

## 说明

- 硬件加速仍默认开启。应用会在检测到渲染层失活时恢复窗口，但不会静默切换到软件渲染。
- Avatar Studio 目前是实验入口，不代表已经可以生成可商用品质的 Spine rig。
