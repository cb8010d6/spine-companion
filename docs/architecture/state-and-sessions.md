# State, Sessions, and Temporary Displays

Spine Companion displays reported AI work. It does not execute tasks or inspect
an IDE to discover unreported progress. Configuration and a successful MCP
self-test are not evidence of a real AI task report.

## Compatible Inputs

`POST /state`, `POST /state/:id`, `companion_set_state`, and both phase-reporting
MCP tools retain their existing state names and aliases. `id` still means a state
alias. Optional metadata adds isolation without requiring old clients to change:

```json
{
  "state": "running",
  "source": "codex-mcp",
  "sourceLabel": "Codex",
  "sessionId": "client-provided-session-id",
  "eventId": "event-12",
  "sequence": 12,
  "message": "Running tests"
}
```

- `sessionId` must come from the client. A tool name, process ID, or MCP
  connection is not a reliable AI session identifier.
- Without `sessionId`, one aggregate record is retained per source. Concurrent
  sessions from the same legacy source cannot be distinguished.
- `eventId` deduplicates retries within that source/session. Clients needing
  reliable ordering should also supply an increasing `sequence`. Without a
  sequence, new events are accepted in arrival order, not presumed execution order.
- `updatedAt` records receipt by Companion, not a client-provided clock.
- `sessionEnded: true` explicitly closes the record. It does not imply success.
  Use a new session ID for a new session, not the ID of a closed one.
- `eventKind: demo` and `eventKind: self-test` are temporary display events,
  not real sessions or first reports. The older self-test message prefix is also
  recognized. These markers are protocol declarations, not authentication.

Session records and recent deduplication IDs are bounded in memory. They are
runtime-only, as in the previous state/history implementation. Models, user
configuration, saved AI integration configuration, and window presentation are
not migrated or rewritten by this feature.

At most 64 records and 128 recent event IDs per record are retained. Finished or
explicitly ended, unfocused records may expire after 24 hours or be evicted at
capacity. Unfinished work is not expired merely for silence. At capacity with no
eligible record, a new session is rejected without changing existing work.
Deduplication and closed-session rejection apply only while the record is retained;
clients must not reuse a closed session ID.

## Display Policy

Each source/session retains its latest business state independently. Automatic
selection prefers unfinished work or requests for attention over completed work.
Waiting for user input outranks running work. Freshness is a separate warning,
not a reason to invent a new task state.
Finishing session B must not erase session A's running state. The Dashboard allows
explicit focus and a return to automatic selection; focus does not change the
underlying report.

A reminder is a temporary display over that retained business state. New reports
can update the underlying task while the reminder is visible. On expiry or
dismissal the current effective task is restored with its source and message,
not a timer's old snapshot or a mechanical `idle` transition.

`revision` identifies the current display. `POST /state/dismiss {"revision": 7}`
only dismisses that exact revision. A delayed renderer callback cannot dismiss a
new report. Dragging and one-shot interactions are local presentation operations;
they must not post an old saved task state back to the API.

## Reminder Cancellation

An explicitly repeated reminder ID replaces its pending schedule. Cancellation
and firing are serialized; cancellation before firing prevents any later state,
bubble, or notification from that schedule. If firing wins the race first, the
already-delivered notification cannot be recalled, but cancellation removes the
active display and prevents further callbacks. Repeated deletion returns
`deleted: false` and HTTP 404. Old generations never fire for a replacement ID.
Replacing an already-fired ID dismisses only its active overlay. An invalid
replacement leaves the existing schedule untouched. At the 128-reminder limit,
new IDs are rejected rather than silently cancelling another reminder. A zero
display duration keeps the reminder visible until dismissed; a future `dueAt`
is not shortened to one day.

## Freshness and Events

Five minutes without a report means "may be out of date", not "disconnected",
"failed", "complete", or "idle". No high-frequency AI reporting is required.
The UI ages existing timestamps locally rather than polling the client.

Newly accepted real reports carry `lastReport` event metadata even if another
session is currently selected. Reads, focus changes, restores, duplicates, demos,
and self-tests do not create that metadata. This separates first-real-report
tracking and notification decisions from whichever animation happens to be shown.
Explicit `notify: false` and the user's existing notification settings remain
authoritative; restoring or focusing an old result must not notify again.

Additional local endpoints are `GET /sessions` and `POST /sessions/focus` with
`{ "source": "codex-mcp", "sessionId": "..." }`, or `{ "source": null }`
for automatic selection. Existing MCP tools gain optional metadata; there is no
new task executor or mandatory client adapter.

SSE state and reminder lists are independent channels, not a cross-channel
transaction. Each starts with its snapshot followed by newer updates; consumers
must not infer a global order between the two event names. Reconnecting consumers
read current snapshots rather than treating them as new real reports.

## Separate Follow-ups

Avatar job records already have a bounded store, backup recovery, and a
cross-process marker lock. The marker's age-based stale recovery still deserves
an independent change to an OS-backed file lock: elapsed time alone does not prove
that an owner is dead. This concerns experimental Avatar planning records, not
model files or user AI configuration, and is not claimed fixed by the state work.

Windows remains the stable target; Linux/macOS remain Preview and Avatar Studio
remains Experimental. There is no cloud synchronization, telemetry, automatic
rigging, or bundled image-generation model in this change.
