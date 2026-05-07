# 素材

[English](README.md) | [简体中文](README.zh-CN.md)

仓库刻意不包含商业或游戏模型素材。

本地测试时，把 Spine 3.8 兼容模型目录放在仓库外，或放在已忽略的 `local-assets/`
目录，然后运行：

```bash
npm run setup:assets -- "C:\path\to\amiya_spine"
```

该目录需要包含 `.skel`、`.atlas` 和 atlas 引用的 `.png` 贴图。脚本会写入
`companion.local.json`，这个文件已被 git 忽略。
