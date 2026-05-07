# 发布计划

[English](release-plan.md) | [简体中文](release-plan.zh-CN.md)

## 分支规则

- `main`：构建 Windows、Linux、macOS 包，并发布 GitHub Release assets。
- `develop`：只跑 CI 检查，不发布 release。
- `v0.1.1` 这类版本 tag：发布正式版本 release。
- 没有 tag 的 `main` push：发布或更新 `main-latest` prerelease。

## 平台

- Windows：x64 portable exe。
- Linux：x64 AppImage 和 deb。
- macOS：未签名的 x64/arm64 dmg 和 zip。

macOS 签名与公证需要 Apple Developer 凭据，默认不启用。

## 本地命令

```bash
npm run release:win
npm run release:linux
npm run release:mac
```

macOS 和 Linux release 建议交给 GitHub Actions 在对应 runner 上构建。
