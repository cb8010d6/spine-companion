# Spine Companion v0.2.7-alpha.1

[English](https://github.com/cb8010d6/spine-companion/blob/v0.2.7-alpha.1/docs/releases/release-notes-v0.2.7-alpha.1.md) | [简体中文](https://github.com/cb8010d6/spine-companion/blob/v0.2.7-alpha.1/docs/releases/release-notes-v0.2.7-alpha.1.zh-CN.md)

This opt-in alpha focuses on reliable AI work status and reminders, with small
Manager and Quick Panel refinements. Keep v0.2.6 if you need the stable release.
Companion displays what AI clients report; configuring MCP does not automatically
reveal every task, and a bridge self-test is not a real AI work report.

## Changes

- Cancelled or replaced reminders no longer fire through old timers. Dismissing
  a temporary reminder restores the current effective task instead of blindly
  returning to idle. Old callbacks cannot overwrite newer reports.
- Optional client-provided session IDs isolate interleaved tasks. Completing one
  session does not erase another working session. Older callers remain supported
  and are grouped by source; tool names or process IDs are not invented sessions.
- Lightweight session focus and freshness indicators show the source and last
  update. Silence means information may be stale, not success, failure, or a
  confirmed disconnect. Sessions remain local and reset when the app exits.
- Self-tests and demos stay separate from real reports. Duplicate events and
  focus changes do not replay notifications; existing mute settings remain valid.
- Avatar job records use OS-backed file locking instead of age-based lock-file
  takeover. This protects job writes, not all concurrent pack editing.
- Manager and Quick Panel share clearer button states, theme contrast, spacing,
  and narrow-window styling. No renderer, hit-testing, or frame-rate redesign.

## Upgrade And Test

Exit the old app before installing, including its tray process. Old and new
Avatar job-lock protocols must not write the same store concurrently. Back up
important user data before trying an alpha. Existing models, settings and AI
configuration should be retained; reminders and live sessions are not persisted.

Please test reminder cancellation during AI work, two reporting sessions, focus
switching, muted notifications, and settings/model retention after upgrading.
Windows sleep/resume, renderer restart and daily input behavior still need alpha
user acceptance; automated packaging checks do not replace native testing.

## Boundaries

- Windows 10/11 x64 remains the stable support target, but this build is an alpha.
- Linux/macOS remain Preview, with interactive fallback rather than native
  transparent-area passthrough. Installers are unsigned; macOS is not notarized.
- Linux retains the known `glib` advisory documented in the
  [release plan](https://github.com/cb8010d6/spine-companion/blob/v0.2.7-alpha.1/docs/maintainers/release-plan.md#linux-dependency-advisory).
- Avatar Studio remains Experimental. No automatic rigging, Spine export,
  cloud sync, bundled generation model, or character store is introduced.
- Third-party model rights still require permission from their rights holders.

The release pipeline gates publication on strict frontend/Rust checks, package
builds and Windows clean-install/upgrade smoke tests. SHA256SUMS.txt accompanies
the five platform packages. Further work proceeds separately from this alpha.
