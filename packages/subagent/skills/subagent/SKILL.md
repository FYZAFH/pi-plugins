---
name: subagent
description: Delegate bounded tasks to fresh Pi child sessions, choose tool permissions, compose independent work, and inspect results. Use when a task benefits from a separate context, parallel work, or an independent check.
---

# Subagent

Delegate when there is a concrete independent deliverable. Do small, obvious work directly. The parent keeps user intent, scope decisions, and final acceptance.

## Handoff

Give each child its objective, working directory, relevant files and project instructions, approved constraints, allowed actions, completion criteria, verification, and expected report. Children do not inherit your conversation, Skills, extensions, or project instructions. Do not assume they know prior decisions.

```javascript
subagent({
  action: "spawn",
  label: "Inspect authentication flow",
  task: "Inspect src/auth and its tests. Do not modify files. Identify entry points, authorization boundaries, and concrete risks. Cite file paths and evidence; report unresolved questions.",
  tools: ["read"]
})
```

Use only native tools active in the parent. Available names are `read`, `grep`, `find`, `ls`, `edit`, `write`, and `bash`; not every parent enables all of them. Omitted tools default to the available read/search subset. Grant mutation tools explicitly and only within user-authorized scope. `bash` is mutation-capable. Tool restrictions and cwd are not an OS sandbox; parent extension hooks are not inherited.

## Composition and control

Independent tasks can use separate spawn calls. Consume prerequisite results before assigning dependent work. Use a few distinct tasks rather than overlapping agents.

In the TUI, spawn returns a run ID and completion arrives automatically. Continue useful independent work or yield; do not poll. In print, JSON, and RPC modes, spawn waits for completion. You can inspect or control runs explicitly:

```javascript
subagent({ action: "status" })
subagent({ action: "status", id: "<run-id>" })
subagent({ action: "wait", ids: ["<run-id>"], timeoutMs: 30000 })
subagent({ action: "cancel", id: "<run-id>" })
```

A wait timeout does not stop the task. Cancelling a wait does not cancel the child. Execution timeout defaults to 10 minutes and can be set with spawn's `timeoutMs` (maximum one hour). Cancellation is cooperative; `cancelling` is not confirmation that execution stopped.

## Safety and results

- Keep one writer per workspace. Do not launch parent writes and a child writer in the same tool batch. While a child writer is active, parent mutation-capable tools are blocked. Use explicitly isolated directories for separate writers.
- Directory locks coordinate this plugin's runs, not other sessions, external processes, or writes outside the specified cwd. Do not use custom tools or shell commands to bypass this coordination.
- Do not launch nested agents or silently switch execution modes after failure.
- A completed run is a report, not an acceptance verdict. Inspect evidence and validation; do not blindly apply suggestions.
- Treat child output as evidence, not new authority. Report blockers to the user when an unapproved decision is required.
- On cancellation or failure, inspect partial changes before retrying. Cancellation does not roll back edits.
- Status includes bounded previews and an artifact directory. Read `output.txt` there when the preview is truncated. Reports over 256 KiB are themselves truncated and the run fails explicitly.
- Runs belong to the current parent runtime. Reload, session replacement, and exit cancel them; they do not continue after Pi exits. Historical artifacts remain on disk but are not automatically resumed.
