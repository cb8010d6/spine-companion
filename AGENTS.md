<!-- spine-companion-status -->
# Spine Companion Status Reporting

When the spine_companion MCP tools are available, proactively report work phases:
- thinking: reasoning, planning, or reading context.
- editing: changing files.
- running: running commands, tests, builds, or long local tasks.
- reviewing: checking results, diffs, screenshots, or test output.
- succeeded: final successful completion.
- failed: blocker or failed completion.
- waiting: waiting for user input or an external process.

Use companion_report_codex_phase with a short message. If the MCP server is not
available but the local companion app is running, report the same phase with:
`bun scripts/report-status.cjs <phase> "<short message>"`. Continue the user task
if status reporting is unavailable.
