# Pi Subagent

A small, generic delegation extension for Pi. One tool, one Skill, no role catalog or workflow engine.

**Status:** experimental 0.1 implementation. Offline SDK and extension integration tests pass against Pi 0.85.1. Real-provider and interactive terminal smoke tests are still required before treating it as production-ready. Not published to npm.

## Install from a checkout

```bash
git clone https://github.com/FYZAFH/pi-plugins.git
cd pi-plugins
pi install ./packages/subagent
```

Or try it for one session without changing installed packages:

```bash
pi -e ./packages/subagent/src/index.ts --skill ./packages/subagent/skills/subagent/SKILL.md
```

Install the plugin directory, **not the monorepo root**. The host Pi supplies the SDK and schema dependencies. No other plugin in this repository is required. Do not enable this together with another extension registering a `subagent` tool, such as `pi-subagents`.

## Use

Ask naturally:

```text
Delegate a read-only inspection of the authentication flow. Return the relevant files and concrete risks.
```

Or load `/skill:subagent` for the generic delegation guide.

- `subagent`: spawn, inspect, wait for, and cancel tasks.
- `/subagents [run-id]`: inspect run state.
- `/subagent-stop <run-id>`: cancel a task.

In the TUI, child runs return a run ID and notify the parent when complete. Outside the TUI, spawn waits for completion. Children run in the parent process; they do not survive Pi exit.

## Defaults

- Fresh conversation history; relevant context must be included in the handoff.
- Read-only native host tools; mutation tools require explicit selection.
- Parent model/provider and thinking level, without copying credentials to disk.
- No child extensions, Skills, ambient project instructions, nested delegation tool, or automatic model fallback.
- Four concurrent runs, sixteen queued runs, and sixty-four accepted runs per parent runtime.
- Checkout-aware writer coordination and a conservative parent built-in mutation barrier.
- Private, bounded reports/logs and optional state-change events for future panels.

Tool allowlists and working directories are **not an OS sandbox**. Parent hook-based permission policies are not inherited. Cancellation is cooperative and does not roll back edits. Runtime completion is not acceptance. See [API and limitations](docs/api.md) before enabling write access.

## Development

From the repository root:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
```

Tests use offline fixture providers, not real model credentials. All model-facing prompts are English.

## Design history

- [Research and evidence](https://github.com/FYZAFH/pi-plugins/blob/main/packages/subagent/docs/research.md)
- [Design and milestone status](https://github.com/FYZAFH/pi-plugins/blob/main/packages/subagent/docs/design.md)
- [Generic delegation Skill](skills/subagent/SKILL.md)
- [Initial standalone SDK experiment](https://github.com/FYZAFH/pi-plugins/blob/main/packages/subagent/experiments/README.md)

Future work includes a dedicated panel, retained-session continuation, and stronger isolation if needed. Planning tools (`todo` / `update_plan`) and delivery workflows remain separate plugins or Skills.
