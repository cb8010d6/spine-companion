# Spine Companion v0.2.6-rc.11

[English](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.11.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/main/docs/releases/release-notes-v0.2.6-rc.11.zh-CN.md)

This is the final planned preview before v0.2.6 stable. It freezes new features
and focuses on first-run clarity, AI integration verification, local security,
model-source transparency, and reproducible releases.

## Improvements

- Open Manager Library when no active character is configured. The companion no
  longer offers a hidden direct download of a test model; users can choose a
  catalog entry or import a model they are allowed to use.
- Require explicit acknowledgement before previewing or downloading catalog
  models whose license metadata is `NOASSERTION` or carries a source warning.
  Network and cache work starts only after acknowledgement. No third-party model
  binaries are bundled with Spine Companion.
- Separate the packaged MCP self-test from the first real AI work report. AI
  Integrations now shows both steps, supports Test All, persists progress, and
  recognizes legacy source aliases without mislabeling the active tool. The UI
  now labels this accurately as a Companion MCP self-test; it does not claim to
  launch or verify the third-party AI application itself. Undetected clients no
  longer expose candidate config or instruction paths.
- Restrict the local API to verified loopback addresses and strict local/Tauri
  CORS origins. The packaged API contract is HTTP plus SSE; `/ws` remains a
  development-only adapter. Reminders and recent history are session-scoped.
- Add a machine-readable HTTP/MCP contract and parity tests for the JavaScript
  development bridge and packaged Rust runtime. The source MCP server now
  reports the same version as the application. New read-only
  `companion_get_diagnostics` and `companion_test_bridge` tools verify the local
  bridge without changing companion state or returning local paths and secrets.
  The installed executable also supports read-only `--status --json` and
  `--doctor --json` checks without opening a window or changing state.
- Reduce Manager to five daily-use destinations: Dashboard, Library, AI
  Integrations, Settings, and Diagnostics. Installed models and downloads are
  Library tabs; Avatar Studio is under Settings > Labs. Major catalog, model,
  integration, renderer, and export failures now offer bounded Retry and Open
  Diagnostics actions while offline catalog caches remain non-blocking.
- Make the per-user `companion.local.json` the only writable runtime config.
  Repository, working-directory, and executable-local files remain read-only
  compatibility layers, with the user layer loaded last. Diagnostics shows the
  canonical write path, loaded layers, and active environment variable names
  without exposing values.
- Persist bounded Avatar Studio planning jobs so an AI-assisted planning task
  can be inspected and resumed with explicit context. This does not run or
  resume an AI process. Windows lock acquisition now handles transient sharing
  errors with the existing bounded timeout.
- Replace the developer-first README path with a no-terminal Library and Manager
  workflow and a current Manager Library screenshot. Add current platform
  support, upgrade/uninstall and data retention guidance, security policy,
  contribution guidance, and repository templates.
- Add exact tag/version/release-note preflight checks, packaged Windows MCP
  smoke testing, a strict five-package artifact matrix, SHA-256 release
  manifests, and commit-pinned GitHub Actions. A release tag must resolve to the
  exact current `main` commit before any package can be published.
  Windows CI now installs the public rc.10 package, upgrades it in place to the
  candidate, checks the packaged MCP version, uninstalls it, and verifies user
  data retention.

## Compatibility And Known Limits

- Windows 10/11 x64 is the stable target for v0.2.6.
- The rc.11 Windows installer is not Authenticode-signed and may show a
  Microsoft Defender SmartScreen warning. This is a disclosed, non-blocking
  limitation for this release.
- Linux x64 and unsigned macOS packages remain previews. Native transparent-area
  passthrough is implemented only on Windows; other platforms keep an
  interactive fallback.
- Ark-Models catalog entries remain third-party references with unverified
  redistribution rights. Review the displayed source information and use only
  models for which you have permission. No third-party model binaries are
  included in the application packages.
- Avatar Studio remains experimental and does not claim automatic layer
  separation, rigging, animation authoring, or Spine Editor export.
- Update channels control release checks and the recommended download link. The
  application does not silently install updates.

## Validation

- 271 JavaScript tests and 130 Rust tests pass locally, together with project,
  MCP, coverage, frontend build, Rust check, and format checks.
- The release workflow validates all versions against the tag, builds Windows,
  Linux, macOS Intel, and macOS Apple Silicon packages, runs the packaged Windows
  upgrade/installer/MCP smoke test, and publishes a `SHA256SUMS.txt` manifest.
  The Windows package smoke also verifies the installed read-only status and
  doctor commands.

## Please Test Before Stable

- Upgrade from rc.10 on Windows and confirm the existing model, position, scale,
  settings, and AI configuration are retained.
- With a clean profile, choose or import a first character without using a
  terminal or editing JSON.
- Configure one AI tool, run its self-test, restart or open a new AI session,
  and confirm the first real work report completes the final setup step.
- Preview, download, activate, switch, and remove models; verify that source
  acknowledgement appears when required and failures preserve the current model.
- Exercise drag, touch, wheel zoom, transparent-area clicks, renderer restart,
  and GPU recovery on Windows.
