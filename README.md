# Spine Companion

[English](README.md) | [简体中文](README.zh-CN.md)

Spine Companion turns a Spine 3.8 character into a quiet desktop companion that
reflects your work through animation, reminders, and local AI-tool status.

## Download

Download the current package from the [GitHub Releases](https://github.com/cb8010d6/spine-companion/releases)
page. The Windows package is the stable target. macOS and Linux packages are
unsigned previews for evaluation.

Verify a downloaded file with `SHA256SUMS.txt` attached to the same release.

![Spine Companion Manager showing the model Library](docs/media/manager-library-v0.2.6.png)

## First Character, No Terminal

1. Install Spine Companion and start it from the desktop or Start menu.
2. Open **Manager > Library**, choose a compatible character, and select
   **Download and use**.
3. Open **Manager > Settings** to tune scale and position, then use the tray
   menu to show the companion.

The Library keeps downloaded models in the user data area. You do not need to
edit a JSON file or run a command for this first-use path.

## Manager Connect AI: Codex

1. Open **Manager > AI Integrations** and select **Codex**.
2. Review the proposed MCP entry and confirm. Manager writes the installed app
   executable entry and creates a backup before changing Codex configuration.
3. Restart Codex or open a new session, then keep Spine Companion running while
   Codex reports work phases.

The integration uses a local stdio MCP entry backed by the companion's local
HTTP API. Detailed MCP fields, fallback setup, and troubleshooting live in the
[Codex MCP guide](docs/guides/codex-mcp.md).

## Features

- Transparent, always-on-top Spine rendering with drag, click, zoom, and state animations.
- Manager Library, Installed models, downloads, diagnostics, settings, and update checks.
- Local reminders, progress bubble, tray controls, and recent state history.
- Codex and other MCP-capable AI integrations with backup and restore support.
- Browser preview and local HTTP/SSE integration for development and automation.
- Avatar Studio for trying and restoring local character changes.

## Platform Matrix

| Platform | Support target | Release package |
| --- | --- | --- |
| Windows 10/11 x64 | Stable target | NSIS `.exe` |
| macOS Apple Silicon | Unsigned Preview | `.dmg` |
| macOS Intel | Unsigned Preview | `.dmg` |
| Linux x64 | Unsigned Preview | `.AppImage`, `.deb` |

Preview packages may be affected by desktop environment, GPU driver, window
compositing, or Gatekeeper behavior. They are useful for evaluation but are not
the stable support target.

## Model Compatibility And Rights

Spine Companion loads Spine 3.8-compatible model folders containing a skeleton,
atlas, and the referenced textures. Animation coverage depends on the model's
actual animation names and metadata.

This repository and its releases do not include Arknights, Ark-Models, or other
copyrighted model files. Download or use a model only when you have permission
to do so, and follow the upstream license and attribution requirements. A model
being listed in the Library does not grant redistribution rights.

## Docs

- [User guide](docs/guides/user-guide.md)
- [Deployment, upgrade, and troubleshooting](docs/guides/deployment.md)
- [AI tool integrations](docs/guides/ai-tools.md)
- [Codex MCP integration](docs/guides/codex-mcp.md)
- [Architecture overview](docs/architecture/overview.md)
- [Runtime bridge contract](docs/architecture/runtime-bridge.md)
- [Release notes](docs/releases/README.md)

## Development

Source development uses Bun 1.3.13 or newer and Rust stable. The normal source
workflow is:

```bash
bun install
bun run dev
```

Before submitting changes, run:

```bash
bun run test
bun run check
bun run check:mcp
bun run build
```

Native packaging and model setup details are in the [deployment guide](docs/guides/deployment.md).
See [CONTRIBUTING.md](CONTRIBUTING.md) for repository workflow and review expectations.

## Security And License

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability. Do not put
secrets, private model files, or unredacted diagnostics in public issues.

Spine Companion is released under the [MIT License](LICENSE). Third-party
notices are collected separately in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
