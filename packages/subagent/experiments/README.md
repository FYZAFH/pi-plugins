# SDK feasibility experiment

This is an offline research spike, not the Subagent extension. It exercises real Pi sessions with a deterministic, in-memory model provider. It does not call a real model or load user credentials, settings, or extensions.

## Run

Requires Node.js with `node:test`, `Promise.withResolvers`, and the experimental parent-URL form of `import.meta.resolve` (tested with Node 24.5.0), plus an installed Pi npm package (tested with Pi 0.85.1).

```bash
PI_OFFLINE=1 \
PI_SDK_PACKAGE_DIR="$(npm root -g)/@earendil-works/pi-coding-agent" \
node --experimental-import-meta-resolve --test packages/subagent/experiments/sdk.test.mjs
```

Alternatively, omit `PI_SDK_PACKAGE_DIR` when the SDK is resolvable as a local dependency. The resolution flag is for this standalone experiment, not a planned requirement for the plugin.

The test uses a temporary directory and removes it afterward. The synthetic provider has a placeholder key and a custom stream handler; no live credentials are needed. No global Pi installation or configuration is modified.

## Covered behavior

1. Separate session identities and histories, parallel prompting, explicit resource isolation, and the read-only tool set.
2. A real `read` tool call resolves against the child working directory.
3. A model-requested `write` call cannot execute when absent from the allowlist.
4. A provider error can settle `prompt()` without rejecting its promise.
5. Cooperative abort reaches the provider and settles the prompt.
6. A persistent session retains multi-block final output; unsubscribed listeners receive no events; repeated disposal does not throw.

Node reports seven passing tests because it counts the parent test as well as the six behavior cases.

## Not established by this experiment

- Real provider authentication, rate limits, retry/compaction behavior, or cost accounting.
- Host-extension integration, parent notifications, shutdown races, or background/headless behavior.
- OS-level sandboxing, hard termination, subprocess-tree cleanup, or cross-process writer locks.
- Complete resource-leak freedom. Successful process exit and listener detachment are useful checks, not a proof.
- Session resume, forked context, or crash recovery.
