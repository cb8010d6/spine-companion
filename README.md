# Spine Companion

[English](README.md) | [简体中文](README.zh-CN.md)

Spine Companion is a local desktop status companion for AI-assisted coding. It
turns reported work phases into character animation, reminders, and a small
at-a-glance status surface, so you can see when an AI task is working, waiting
for you, reviewing, or complete without leaving your usual workspace.

It complements your IDE, terminal, and AI client; it does not replace any of
them. The companion only shows phases that an integrated client actively
reports, which keeps the status explicit instead of guessing from unrelated
desktop activity.

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

MCP configuration makes reporting tools available; it does not automatically
reveal every AI state. The AI client must call the reporting tool during its
work, and the companion must remain running. Run the packaged self-test first,
then start a real task and confirm its first report in **Manager > AI
Integrations**.

## Features

- Transparent, always-on-top Spine rendering with drag, click, zoom, and state animations.
- Manager Library, Installed models, downloads, diagnostics, settings, and update checks.
- Local reminders, progress bubble, tray controls, and recent state history.
- Codex and other MCP-capable AI integrations with backup and restore support.
- Browser preview and local HTTP/SSE integration for development and automation.
- Avatar Studio (Experimental) for trying and restoring local character changes.

## Platform Matrix

| Platform | Support target | Release package |
| --- | --- | --- |
| Windows 10/11 x64 | Stable target | NSIS `.exe` |
| macOS Apple Silicon | Preview | `.dmg` |
| macOS Intel | Preview | `.dmg` |
| Linux x64 | Preview | `.AppImage`, `.deb` |

Preview packages are unsigned and may be affected by desktop environment, GPU
driver, window compositing, or Gatekeeper behavior. They are useful for
evaluation but are not the stable support target.

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
