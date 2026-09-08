# Minimal Subagent design

Status: proposed implementation contract, not an implemented API.

## Purpose

Delegate a bounded task to a generic child Pi session. The parent supplies the task and authority; the extension owns execution and observability. There is no role catalog, workflow language, planning system, or acceptance engine.

## Boundaries

```text
Pi tool adapter → run supervisor → Pi session executor
                       ↓
                run records and events
                       ↓
              optional future observers
```

These are modules within one plugin, not separate packages or a shared framework. The executor must be injectable for deterministic supervisor tests.

- Executor: create the child, select explicit resources/tools, prompt, observe, abort, and dispose.
- Supervisor: run IDs, concurrency, writer coordination, terminal-state decisions, and storage.
- Adapter: tool schema, parent ownership, bounded output, and host messages.
- Future observers: read public snapshots and request controls. They do not own lifecycle state.

## Proposed tool surface

One tool named `subagent`, with actions:

| Action | Purpose |
| --- | --- |
| `spawn` | Start one task and return its run ID. |
| `status` | Inspect a run, or list this parent's runs when no ID is supplied. |
| `wait` | Wait for selected runs, with a bounded wait duration. |
| `cancel` | Request cancellation; return the actual current state. |

`spawn` accepts a task, optional short label, optional working directory, and an explicit built-in tool allowlist. The default tool set is the read-only subset allowed by the host. A task must not silently receive tools unavailable to the parent. An unsupported or overridden tool requires an explicit supported integration, not a bypass to the SDK built-in.

An explicit context packet may be supplied as task input. Version one uses fresh conversation history only. Do not expose a `fork` flag until fork behavior is implemented and tested.

Start with the parent's model and thinking level; no model routing or profile registry. Unsupported parent-provider integration must fail visibly.

Parallelism is multiple `spawn` calls. Sequencing is consuming one result before spawning the next task. No `chain`, `tasks`, or script execution surface is needed.

The final schema and parameter names will be fixed alongside adapter tests, not treated as stable by this document.

## Lifecycle

```text
queued → running → completed | failed
   │        ↓
   └────→ cancelling → cancelled | timed_out
```

A queued cancellation can settle immediately. A running cancellation is a request, not proof of termination. Do not release concurrency or writer ownership until execution and cleanup have settled. Preserve whether cancellation came from the user, timeout, or host shutdown. Completion/cancellation races must have one terminal outcome.

Recovered records that cannot be tied to a live executor become `interrupted`; never infer success or silently rerun a potentially mutating task.

`completed` means execution produced a normally terminated final report. It does not mean the parent accepted the task. A task-level blocker is reported in the result, not inferred from arbitrary prose as a special lifecycle state.

## Defaults and scope

- Fresh history and explicit resources; no ambient child extensions, Skills, templates, or automatic project-context discovery.
- Supply relevant repository instructions in the handoff; omission must not be hidden behind a claim that the child inherited them.
- Read-only tools by default, excluding arbitrary shell execution.
- No delegation tool exposed to children. This prevents native recursive tool delegation, not arbitrary process spawning if shell access is later granted.
- Bounded active concurrency and pending queue. Saturation produces a visible capacity response rather than unlimited growth.
- One plugin-managed writer per canonical workspace. Canonicalize paths and handle nested directories and symlink aliases before asserting this guarantee.
- No automatic worktree creation. Callers supply isolated working directories when needed.

Tool restrictions are not a filesystem sandbox. `cwd` establishes path resolution, not a jail. Shell access is mutation-capable and can affect other paths or processes. Parent edits, other sessions, and external programs are not automatically protected by a plugin-local writer lock. Document these limits and do not permit the parent to overlap its own writes with a delegated writer as an orchestration practice.

## Background execution

The first background implementation is concurrent with the parent conversation, inside the parent process. It does not survive Pi exit. Do not call it detached or durable execution.

- Interactive completion uses a parent-owned custom host message, not a fabricated user message.
- Include run ID, lifecycle state, a bounded result preview, and an artifact reference.
- Mark notification acceptance only after the host accepts the send operation; expose delivery failures independently of task success.
- Shutdown, reload, and session replacement cancel and drain owned children before releasing resources. Never deliver an old child's result into a replacement parent session.
- Print/JSON behavior needs explicit drain semantics or a clear unsupported-mode error. Do not advertise async support in these modes until tested.
- `wait` is useful for programmatic/run-to-completion consumers. Ordinary interactive orchestration should use completion notifications instead of status polling.

No hard timeout guarantee is possible if an in-process provider or tool ignores cancellation. Keep such a run visibly cancelling and retain its execution ownership. A subprocess executor can be considered later if hard termination becomes a requirement.

## Records and optional integration

Use versioned JSON-safe records with run ID, parent session ID, label, task reference, canonical cwd/workspace identity, tools, model, timestamps, state, result reference, and error reason. Store records privately outside the source repository; full task/output content is sensitive and must not enter event diagnostics by default.

Return bounded previews with explicit truncation notices. Preserve full reports in managed artifacts. Specify retention before release so artifacts and in-memory history cannot grow without bound.

Expose snapshots and namespaced state-change events with schema version, parent ID, run ID, and revision. Observers must recover from a snapshot; events are not durable truth. Observer failures must not change execution outcomes.

An optional public control/discovery interface can let a future panel inspect and cancel tasks without requiring either plugin to import the other's private modules. Concrete event names and transport should follow the working supervisor API, not precede it.

## Acceptance checklist

### Milestone A: execution kernel

- [ ] Explicit resources, cwd, tools, model, and fresh history.
- [ ] Multi-block final output and terminal-reason classification.
- [ ] Preserve errors and partial reports; reject missing or truncated final completion.
- [ ] Abort before start, during creation, during model streaming, and during tool execution.
- [ ] Cleanup and subscription detachment on every exit path.

### Milestone B: run supervisor

- [ ] Concurrent readers, bounded queue, and deterministic capacity behavior.
- [ ] Writer conflicts, path aliases, queued cancellation, timeout races, and shutdown.
- [ ] Stable run IDs, bounded snapshots, private artifacts, retention, interrupted recovery.
- [ ] Observer exceptions do not alter runs.

### Milestone C: Pi integration

- [ ] Tool registration, runtime input validation, host capability ceilings, provider handling.
- [ ] Correct-parent notification and notification-failure reporting.
- [ ] Safe reload, session replacement, and supported headless behavior.
- [ ] One short English Skill matching only implemented APIs.
- [ ] Independent package installation with no sibling plugin dependency.

Dedicated UI, todo/update_plan, live steering, retained-session resume, and forked context remain later work. No capability is complete merely because its SDK primitive passed the research experiment.
