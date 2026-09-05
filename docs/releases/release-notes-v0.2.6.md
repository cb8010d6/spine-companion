# Spine Companion v0.2.6

v0.2.6 is a Tauri-first desktop release for making AI-assisted coding work
visible without changing the way you use your IDE, terminal, or AI client.

## Highlights

- **Local work status:** when an integrated AI client reports a phase, the
  companion maps it to character animation, reminders, a progress bubble, and
  recent in-session history.
- **No-terminal first use:** Manager Library lets users review model sources,
  choose a compatible character, or import a Spine 3.8 model they are allowed
  to use. Third-party character files are not bundled.
- **AI Integrations:** detect supported local MCP clients, preview and back up
  configuration changes, install reporting guidance, run the packaged MCP
  self-test, and track the first real AI work report as a separate step.
- **Diagnostics and recovery:** inspect local API, renderer, model, and
  integration health; use bounded retry and restore actions when setup or
  loading fails.
- **Local-by-default runtime:** the packaged API stays on verified loopback
  addresses, while reminders and recent state history remain scoped to the
  current application session.

## AI Status Boundary

Spine Companion is a glanceable status surface, not an IDE, terminal, task
runner, or replacement for an AI client. MCP configuration only makes the
reporting tools available; it does not automatically reveal every AI state.
The AI client must actively call `companion_report_ai_phase` (or send a local
HTTP update) during work, and Spine Companion must remain running. The packaged
self-test verifies the companion bridge only. Start a real task after setup to
confirm that the client is reporting working, waiting, reviewing, success, or
failure phases.

## Platform And Known Limits

- Windows 10/11 x64 is the stable support target.
- Linux x64 and macOS Intel/Apple Silicon packages are unsigned previews for
  evaluation. Native transparent-area passthrough is implemented on Windows;
  other platforms keep an interactive fallback.
- Avatar Studio is an **Experimental** secondary tool under **Settings > Labs**.
  It does not claim automatic layer separation, rigging, animation authoring,
  or Spine Editor export.
- Catalog entries can refer to third-party models with unverified
  redistribution rights. Review the displayed source information and use only
  models for which you have permission.
- Update channels control checks and the recommended download link; the app
  does not silently install updates.
- Linux Preview retains a known `glib` dependency advisory pending a compatible
  GTK/WebKit update. Windows does not include this dependency. See the
  [release plan](../maintainers/release-plan.md#linux-dependency-advisory).

## Data And Upgrades

Model files, settings, and AI-configuration backups live in the per-user data
area and are intended to survive an application restart or upgrade. Reminders,
current state, and recent state history are session-scoped and reset when the
application exits.
