# Subagent execution research

## Evidence baseline

- Installed Pi: `@earendil-works/pi-coding-agent` 0.85.1.
- Node.js: 24.5.0.
- pi-subagents: package version 0.66.0, commit `56f247ac86169cfffa1af9a4c07997c33804bf9a`.
- Reproducible local evidence: [SDK experiment](../experiments/README.md).

Sources reviewed:

- Pi's installed `docs/sdk.md`, `docs/extensions.md`, `docs/session-format.md`, `docs/packages.md`, and `docs/custom-provider.md`.
- Pi's installed `examples/sdk/12-full-control.ts` and `examples/extensions/subagent/{README.md,index.ts}`.
- Installed SDK declarations and implementation around `createAgentSession`, resource loading, and `AgentSession.prompt`.
- [pi-subagents child-session factory](https://github.com/nicobailon/pi-subagents/blob/56f247ac86169cfffa1af9a4c07997c33804bf9a/src/runs/shared/child-session.ts).
- Selected completion-delivery logic in [pi-subagents notify.ts](https://github.com/nicobailon/pi-subagents/blob/56f247ac86169cfffa1af9a4c07997c33804bf9a/src/runs/background/notify.ts).

Codex internals have not been audited. No design claim here depends on them.

## Findings

### Pi already supplies the session execution machinery

`createAgentSession` supplies prompting, tools, streaming events, cancellation, and session persistence. An explicit `ResourceLoader` can disable ambient resource discovery entirely. We do not need a workflow engine or agent-profile parser to delegate a task.

The offline experiment verifies parallel independent histories, a real child-cwd read, mutation-tool exclusion, provider failure semantics, cooperative cancellation, and persisted final output.

### Default discovery is inappropriate for a minimal child

An unspecified loader discovers extensions, Skills, prompts, and context files. An unspecified tool selection enables defaults. These defaults are useful for interactive Pi, but not a clear child capability boundary.

Use explicit resources and tools. Do not inherit ambient extensions or automatically expose the delegation tool to children. Supply relevant project instructions deliberately rather than copying the whole parent system prompt.

### Completion has multiple meanings

`prompt()` completion is a runtime boundary, not an acceptance verdict. A provider error can produce a terminal assistant message without rejecting the prompt promise. Inspect the final assistant message after the prompt settles; do not finalize from the first `agent_end`, which can precede retries or continuations.

Collect all text blocks from the final message. Keep partial output on failure, but label it as partial. Length-limited and missing-final-report cases need explicit failure semantics rather than a success default.

A recovered earlier error should not automatically poison a later successful final response. Conversely, successful runtime completion does not prove tests passed or a requested edit happened.

### Small examples still require review

Pi's official Subagent example uses separate CLI processes and includes profile discovery, parallel tasks, chains, and custom rendering. It is a useful reference, not the minimal design we want.

Two version-specific details should not be copied blindly:

- The example returns `isError: true` in some tool results, while the current extension documentation says tool execution errors must be thrown to set the error flag.
- Its escalation check uses `proc.killed`, which indicates a signal was sent, not that the process exited. A production subprocess runner must track actual exit separately.

### pi-subagents solves broader problems than our first version

Its child-session factory supports ambient extensions, per-launch process environment, provider registration, retained sessions, shutdown hooks, and foreground/background ownership. Some of that complexity exists specifically to support extension inheritance and detached execution.

We can avoid those costs initially by using explicit resources, no child extensions, and parent-process-owned sessions. In-process execution does not provide process isolation or a hard kill boundary.

The completion notifier also demonstrates an important reusable rule: verify parent ownership before delivering results, and do not mark a notification delivered before the host accepts it. An event-bus emission is not itself delivery to the parent model.

## Recommendation

Build a new thin extension around Pi sessions. Do not fork pi-subagents and do not copy its private loader-cache workaround or process-global environment manipulation.

Separate execution, supervision, Pi tool integration, and optional presentation. Keep one generic delegation guide. Add capabilities only against explicit acceptance cases.

## Remaining validation before an installable release

- Resolve the parent model and credentials using public host APIs, including the behavior of extension-provided models. Fail clearly when unsupported; never silently choose a different model.
- Verify tool ceilings when the parent disables or overrides built-ins. A tool name alone is not proof that bypassing an override is allowed.
- Test cancellation during creation and tools, timeout settlement, listener cleanup, and reload/session-switch races.
- Test background result delivery to the correct parent, notification failure, and print/JSON mode behavior.
- Define bounded outputs, private artifact permissions, retention, and interrupted-run reporting.
- Verify packaged loading without development dependencies and without installing another plugin.
