# Spine Companion Status Reporting

When the `spine_companion` MCP server is configured, proactively report work
phases to the local Spine Companion desktop app.

Use `companion_report_ai_phase` with one of these phases and a short message:

- `thinking`: reasoning, planning, or reading context
- `editing`: changing files
- `running`: running commands, tests, builds, or long local tasks
- `reviewing`: checking results, diffs, screenshots, or test output
- `succeeded`: final successful completion
- `failed`: blocker or failed completion
- `waiting`: waiting for user input or an external process

If only `companion_report_codex_phase` is available, use it as a compatibility
alias. Continue the user task normally if status reporting is unavailable.
