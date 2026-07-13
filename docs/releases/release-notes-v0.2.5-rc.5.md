# Spine Companion v0.2.5-rc.5

This prerelease turns AI Integrations into a guided setup workspace for ordinary users.

## Changes

- Reworks AI Integrations into a compact tool list with a focused detail panel.
- Adds filters for detected, configured, and attention-needed tools.
- Guides each integration through detection, MCP configuration, agent instructions, and a live connection test.
- Adds one-click installation of managed agent instructions while preserving unrelated user content.
- Creates a timestamped backup before updating an existing instruction file.
- Uses rollback-safe file replacement on Windows and keeps repeated installs idempotent.
- Keeps advanced paths and templates available without making them the primary workflow.
- Reorganizes Settings into clearer appearance, behavior, interaction, rendering, diagnostics, and reminder sections.
- Adds a development-only Manager preview harness for responsive visual checks.

This release does not silently configure or restart AI tools. Users review configuration changes and restart the affected tool when requested.
