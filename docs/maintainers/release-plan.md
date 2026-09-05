# Release Plan

[English](release-plan.md) | [简体中文](release-plan.zh-CN.md)

## Release Scope

Spine Companion v0.2.6 is feature-frozen while the final preview is validated.
Only reliability, first-run clarity, recovery, documentation, and release
engineering changes belong in this line.

The support promise is intentionally asymmetric:

| Platform | v0.2.6 support level | Package |
| --- | --- | --- |
| Windows 10/11 x64 | Stable target | NSIS `.exe` |
| Linux x64 | Preview | `.AppImage`, `.deb` |
| macOS Intel | Unsigned Preview | `.dmg` |
| macOS Apple Silicon | Unsigned Preview | `.dmg` |

Linux and macOS builds use an interactive fallback for the transparent
companion window. Native transparent-area passthrough is not a supported claim
until each platform has its own implementation and real-device acceptance.

## Branch And Tag Rules

- Pull requests and ordinary branch pushes run CI only.
- Release artifacts are published only from a version tag such as
  `v0.2.6-rc.11` or `v0.2.6`.
- A release tag must point at the reviewed merge commit on `main`.
- Never infer the release SHA from a stale local remote-tracking ref. Verify the
  tag and `main` with `git ls-remote` before publishing.
- Prerelease tags containing `alpha`, `beta`, or `rc` create a GitHub
  prerelease. The stable `v0.2.6` tag creates a normal release.

## Automated Gates

Before a tag is created, run:

```bash
bun install --frozen-lockfile
bun run lint
bun run type-check
bun run test
bun run test:coverage
bun run check
bun run check:mcp
bun run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
bun run release:preflight -- --tag v0.2.6-rc.11
```

Use the actual intended tag in the final command. The release workflow repeats
the version and notes preflight, packages all four targets, runs the packaged
Windows MCP and installer lifecycle smoke, and publishes `SHA256SUMS.txt`.

The Windows gate covers silent install, installed API startup, packaged MCP,
silent uninstall, and user-data retention. The v0.2.6 final preview also tests
an in-place upgrade from the public rc.10 installer.

Use Bun 1.3.13 and the Rust toolchain pinned in `rust-toolchain.toml`.
`type-check` currently checks the shared state, input, catalog, and integration
logic listed in `jsconfig.json`; it is not whole-renderer TypeScript coverage.
ESLint checks the frontend, scripts, and tests. Never replace frozen installs
or strict lint with permissive commands to make a release pass.

Run the Release workflow manually on the final candidate branch before tagging.
Manual runs validate and package without publishing. Record its exact commit
SHA and every job result; if any source or lockfile changes, validate the new
commit again. Fixture screenshots and installer retention tests do not replace
the hardware-dependent manual gate below.

## Manual Final-Preview Gate

The final preview is not promoted to stable until Windows testing confirms:

1. Upgrade from rc.10 retains the selected model, per-model presentation,
   window position, settings, and AI configuration.
2. A clean profile reaches the Library without a terminal or hand-written JSON.
3. Model preview/download requires acknowledgement when license metadata is
   unverified, and a failed operation preserves the current model.
4. AI setup shows detection, configuration, restart guidance, packaged self-test,
   first real report, and safe restore as separate states.
5. Mouse, touch, wheel zoom, drag, transparent-area input, renderer restart,
   sleep/resume, and GPU recovery remain usable.
6. The installer and release notes identify Windows as the stable target and
   Linux/macOS as previews.

Record failures with an exported diagnostics report and the exact package
checksum. Do not promote the preview while a reproducible release blocker is
open.

## External Dependencies And Honest Limits

These items cannot be completed by repository code alone and are not represented
as implemented. They are disclosed, non-blocking limitations for v0.2.6 rather
than hidden release claims:

- Windows/macOS signing and macOS notarization require trusted signing identity
  and credentials. Unsigned status must remain visible in release notes.
- Ark-Models entries remain third-party references with `NOASSERTION` until a
  rights holder provides verifiable permission or licensing evidence.
- Automatic rigging and final Spine runtime export require a lawful Spine Editor
  or equivalent licensed export chain. Avatar Jobs are planning records only.

### Linux Dependency Advisory

The Linux Preview currently inherits `glib 0.18.5` through Tauri's GTK/WebKit
stack. [GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g)
affects its `VariantStrIter` implementation; the upstream fixed version is
`0.20.0`, which cannot replace GTK 0.18's dependency independently. The Windows
target does not include `glib`. Keep the advisory open and track a compatible
upstream stack update separately; do not describe Linux Preview as having a
clean dependency audit or dismiss the advisory because it is a preview.

## Publishing

1. Merge the reviewed final-preview branch to `main`.
2. Fetch and verify the exact remote `main` commit.
3. Create an annotated version tag on that exact commit and push the tag.
4. Wait for validation and every package job to succeed.
5. Verify the release body matches the corresponding file under
   `docs/releases/`.
6. Verify the Windows installer, Linux AppImage and DEB, both macOS DMGs, and
   `SHA256SUMS.txt` are present.
7. Download the Windows artifact, compare its SHA-256 value, and perform the
   user acceptance checklist before promoting to stable.

The stable `v0.2.6` release is created only after the final preview passes this
manual gate. Do not rename a prerelease asset or reuse an older workflow run.
