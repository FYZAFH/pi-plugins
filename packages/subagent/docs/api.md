# Subagent API (0.1, experimental)

Tested against Pi 0.85.1 and Node 24.5.0. No sibling plugin is required.

## Tool

`subagent` supports four actions. Invalid combinations fail as tool errors.

### Spawn

```javascript
subagent({
  action: "spawn",
  task: "Inspect the provided scope and return a cited report.",
  label: "Inspect the scope",           // optional, up to 100 characters
  cwd: "/absolute/path/to/project",     // optional, relative to parent cwd if relative
  tools: ["read"],                     // optional, available read/search tools by default
  timeoutMs: 600000                    // optional, 1..3600000 ms
})
```

A task must be non-empty and at most 32,000 characters. The child gets fresh history and no automatically discovered extensions, Skills, prompt templates, context files, or project settings. Include relevant instructions and evidence in the handoff. Prompt template expansion is disabled.

The model and thinking level are captured from the parent at launch. Provider streaming is delegated to the host's public provider object; credentials are resolved through the host on demand, not copied to disk. There is no silent model fallback. Providers implementing the standard Pi interface are supported by this bridge; only an offline fixture provider has been tested so far. Parent provider-request hooks and other extension event hooks are **not** inherited.

Supported tools: `read`, `grep`, `find`, `ls`, `edit`, `write`, `bash`. Only active native host built-ins may be selected. An extension overriding a built-in makes that name unavailable to this plugin, rather than being bypassed. Parent hook-based policies are not reproduced in child sessions; use a real sandbox when needed.

In TUI mode, spawn returns an initial snapshot with a run ID. On completion, a custom message with the result is queued as a follow-up for the owning parent. In print, JSON, and RPC modes, spawn waits until the child settles and returns the final snapshot; a failed child makes that spawn tool call fail with its ID and artifact location. Those modes do not leave detached work behind or send duplicate completion messages.

### Status

```javascript
subagent({ action: "status" })                 // summaries, no report text
subagent({ action: "status", id: "<run-id>" }) // one full snapshot
```

IDs must match exactly and belong to this parent runtime. Completed records remain queryable until runtime shutdown or reload. Report previews are limited to 8 KiB; tool text is additionally limited to 24 KiB. Query individual IDs if a list is truncated.

### Wait

```javascript
subagent({ action: "wait", ids: ["<run-id>"], timeoutMs: 30000 })
```

Wait for all selected runs to become terminal or for the wait duration to elapse. Duration is 1..60,000 ms. Waiting is event-driven, not polling. A wait timeout or abort does not cancel the tasks. TUI users normally rely on automatic completion messages instead.

### Cancel

```javascript
subagent({ action: "cancel", id: "<run-id>" })
```

Cancellation is idempotent. Queued runs can settle immediately. Running work becomes `cancelling` and keeps its capacity and writer ownership until execution and cleanup settle. A task timeout uses the same mechanism and eventually becomes `timed_out`. Cancellation does not roll back files. Non-cooperative tools/providers can keep the runtime in `cancelling`; there is no OS hard-kill guarantee.

## Commands

- `/subagents`: list runs.
- `/subagents <run-id>`: inspect a run.
- `/subagent-stop <run-id>`: request cancellation.

These are text commands, not a dedicated panel.

## Limits and coordination

Defaults are currently fixed: 4 running children, 16 queued children, 64 accepted runs per parent runtime. The cumulative cap includes completed runs. Reload or start a new session to establish a new runtime after reviewing existing results.

Native child delegation is disabled by omitting the `subagent` tool. Shell access can still start arbitrary programs; this is not a sandbox.

Writer conflicts are rejected for equal or nested canonical workspaces, including symlink aliases. Within Git, the nearest ancestor containing a `.git` file/directory is the checkout root, so sibling directories share a writer lock and separate worktrees have separate locks. Outside Git, canonical cwd is the workspace identity. Locks cover only this plugin's current supervisor, not other parent sessions or processes. Tools can still access paths outside cwd; use explicitly isolated worktrees for independent writers.

Parent `edit`, `write`, `bash`, and `powershell` calls are conservatively blocked while any plugin-managed writer is queued/running/cancelling. A child writer cannot be launched in the same parent tool batch as a mutation-capable built-in. Custom tools, user `!` commands, other sessions, and external programs are outside this barrier. Do not bypass it.

## Artifacts and lifecycle

Artifacts are stored under `<Pi agent dir>/subagent-runs/runs-<owner hash>-<random>/` (normally `~/.pi/agent/subagent-runs/`). Each run has:

- `task.txt`: original handoff.
- `status.json`: atomic snapshot with revision and lifecycle state.
- `output.txt`: final or partial report, up to 256 KiB; overflow explicitly fails the run.
- `events.jsonl`: finalized child messages, capped at approximately 1 MiB with an explicit truncation record.

Directories are created with mode 0700 and files with mode 0600 on POSIX. Artifacts can contain source code, task data, and tool outputs; do not publish them automatically. Disk-write failures surface as execution failures rather than false success.

A graceful shutdown cancels and drains runs, suppresses new parent notifications, and writes a closed-store marker. Closed stores older than seven days are pruned when a new store opens. Unclosed stores are retained for manual inspection, including after a crash. There is no automatic crash recovery, historical status import, or resume in 0.1. On-disk `running` after a crash is stale evidence, not proof of a live process. State is not reconstructed from the parent conversation tree.

`completed` describes runtime/report completion, not task acceptance. Inspect the report and validation yourself. Child token usage and cost are not yet aggregated into the parent footer; do not interpret parent totals as the total cost of delegation. The `interrupted` protocol state is reserved for future recovery; this version does not emit it.

## Optional plugin integration

No mandatory imports are needed. Use the host's `pi.events` bus:

- `pi-plugins:subagent:changed`: `{ version: 1, parentSessionId, runId, revision, state }`.
- `pi-plugins:subagent:request`: `{ version: 1, parentSessionId, action, id?, reply }`.

Request actions are `list`, `status`, and `cancel`. `reply` receives `{ runs }` or `{ error }`. A list works before the first run and returns an empty array. Requests for another parent or an unsupported protocol version receive no reply. This is an in-process extension contract, not a network RPC API or security boundary.

An optional consumer should use a bounded discovery timeout and keep working if no provider replies. Subscribe to changes, then request snapshots; reconcile by revision. Events are not durable state and are not parent-model completion messages. Payloads intentionally exclude task text and report bodies.

Types and constants are exported from `@fyzafh/pi-subagent/protocol` for consumers that choose a dependency. A panel can instead use the documented event names without installing or importing this package. It must not read private supervisor objects.

Notification acceptance means Pi accepted `sendMessage`, not that the model has processed or acknowledged the report. A failed send is recorded as `notification: "failed"`; the run itself remains inspectable. Exactly-once delivery across crashes is not claimed.
