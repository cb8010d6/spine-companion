# Spine Companion v0.2.5-rc.6

This prerelease makes AI integration setup durable, recoverable, and easier to verify.

## Changes

- Persists per-tool connection test results across Manager and app restarts.
- Tracks restart-required state only after a real configuration or instruction change.
- Clears stale test results whenever the integration changes.
- Adds a clear "I've Restarted the Tool" step before connection testing.
- Shows configuration and instruction result details instead of only a generic toast.
- Adds retry and open-config actions when setup or testing fails.
- Adds a guarded restore action for the previous MCP configuration.
- Verifies live and backup files with SHA-256 before restoring, and refuses to overwrite later user edits.
- Uses a durable transaction journal and automatic reconciliation if the app stops between a config write and metadata commit.
- Serializes integration state changes and rejects stale connection-test results after a newer setup change.
- Keeps a safety copy of the replaced configuration during restore.
- Restricts configuration open, test, restore, and acknowledgement commands to the Manager window.

Integration metadata is stored separately in the Spine Companion config directory. Third-party client configuration contents are never copied into that metadata file.
