# Release Plan

[English](release-plan.md) | [简体中文](release-plan.zh-CN.md)

## Branch Rules

- `main`: build Windows, Linux, and macOS packages and publish GitHub Release
  assets.
- `develop`: run CI checks only. Do not publish releases.
- Version tags like `v0.1.1`: publish a normal versioned release.
- Untagged `main` pushes: publish or update the `main-latest` prerelease.

## Platforms

- Windows: portable x64 exe.
- Linux: x64 AppImage and deb.
- macOS: unsigned x64 and arm64 dmg/zip.

macOS signing and notarization require Apple Developer credentials and are not
enabled by default.

## Local Commands

```bash
npm run release:win
npm run release:linux
npm run release:mac
```

Use GitHub Actions for macOS and Linux release builds.
