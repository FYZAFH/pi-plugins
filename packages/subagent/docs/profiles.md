# Optional Agent Profiles

Profiles are reusable instructions and tool ceilings, not new executors. No profiles are bundled or enabled automatically. Direct task delegation remains supported.

## Create a profile

Save `security-reviewer.md` in one of these locations:

- User: `<Pi agent dir>/subagent-profiles/` (normally `~/.pi/agent/subagent-profiles/`).
- Project: `<parent cwd>/.pi/subagent-profiles/`, only when the parent project is trusted. Ancestor directories are not searched: trusting a subdirectory does not implicitly trust its checkout root.
- Extension: a directory contributed by another installed extension through the optional discovery event below.

Nested directories may organize profiles. The filename, not the grouping directory, defines the unique name. Use the dedicated `subagent-profiles` directory; existing `pi-subagents` agent files are not automatically imported.

```markdown
---
name: security-reviewer
description: Review authentication and authorization code for concrete defects.
tools: read
---

Inspect the assigned scope for concrete security defects.
Do not modify files.
Report evidence, file locations, and minimal corrective actions.
Distinguish verified defects from assumptions and unresolved questions.
```

Supported frontmatter fields:

| Field | Requirement |
| --- | --- |
| `name` | Required; lowercase letters/digits separated by hyphens, 1..64 characters; must match the filename without `.md`. |
| `description` | Required; non-empty, up to 300 characters. |
| `tools` | Required; a non-empty comma-separated string or YAML list of supported native tool names. Duplicates are rejected. |

The Markdown body contains non-empty English instructions. Unknown fields fail validation; model selection, inheritance, runner configuration, Skills, and arbitrary tool providers are not supported. Profiles append to the framework's base instructions and do not expose controls for nested delegation or changing runtime defaults. Shell access remains mutation-capable and is not a sandbox.

## Discover and launch

```javascript
subagent({ action: "profiles" })
subagent({ action: "profiles", profile: "security-reviewer" })
subagent({
  action: "spawn",
  profile: "security-reviewer",
  task: "Review src/auth and its tests for authorization regressions. Cite concrete evidence."
})
```

Human commands: `/subagent-profiles` and `/subagent-profiles security-reviewer`.

Discovery returns names, descriptions, tools, scope, source path, content hash, and validation diagnostics. It does not inject all profile bodies into the parent prompt. Profiles are loaded on each discovery/launch request; no reload is needed after editing a file.

The task is always required. A profile does not supply the specific objective or the parent's conversation context. Paths in instructions are interpreted in the child cwd, not the profile directory; no variables, includes, or templates are expanded. The profile name is the default run label unless an explicit label is supplied.

## Resolution and authority

Precedence is **trusted project > user > extension**. Duplicate names within one scope are errors, not arbitrary first-file wins. Invalid higher-priority files reserve their filename: they do not silently fall back to a lower-priority role. Listing reports diagnostics while valid, unrelated profiles remain usable.

A profile's tools are a ceiling, not a grant. All must also be active native built-ins in the parent. A call may provide a smaller `tools` list; adding a tool outside the profile is rejected. Unsupported, disabled, or overridden host tools are never silently substituted or enabled. If a profile requests `grep` but the parent only enables `read`, either enable the native tool explicitly or narrow the launch to `tools: ["read"]`.

Profile writer defaults participate in the same writer coordination and parent mutation barrier as direct launches. Prompt text is not a sandbox; parent hook-based policies are still not inherited.

Project discovery is anchored to the **parent's trusted current directory**, not to `spawn.cwd` or an ancestor's `.pi` directory. Supplying another working directory cannot activate that directory's project profiles. Profiles from installed extensions are trusted extension configuration; the extension remains responsible for which directories it contributes.

Instructions and metadata are captured before queueing. Editing/deleting the source file does not change an accepted run. Run snapshots include the selected profile's name, scope, path, and SHA-256. `instructions.txt` stores the exact selected body used for that run; `task.txt` remains the specific handoff. These are private artifacts, not files to commit.

## Optional extension contribution

A plugin can supply its own profile files without depending on this package or importing its internals:

```typescript
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const directory = fileURLToPath(new URL("./profiles/", import.meta.url));
  const off = pi.events.on("pi-plugins:subagent:profile-sources", (event) => {
    const request = event as {
      version?: number;
      addDirectory?: (directory: string) => void;
    };
    if (request?.version === 1) request.addDirectory?.(directory);
  });
  pi.on("session_shutdown", () => off());
}
```

The event carries `{ version: 1, parentSessionId, addDirectory }`. Contributions must be synchronous and use absolute directory paths. Retained/async callbacks are ignored. Repeated identical directory contributions in a scope are deduplicated. If this framework is absent, the event is never requested and the contributing plugin continues to work normally.

The optional TypeScript contract is exported through `@fyzafh/pi-subagent/protocol`. The event string above avoids a mandatory runtime dependency.

## Bounds

Each file is limited to 32 KiB and must be regular UTF-8 Markdown with closed YAML frontmatter. Profile-file symlinks and nested directory symlinks are not followed. Explicit source roots may themselves be symlinks. Discovery is bounded to 32 source contributions, 256 directories, 256 Markdown files, and eight nested directory levels. Hidden entries are ignored. Missing source roots are allowed; unreadable roots and scan-limit violations fail discovery rather than selecting an incomplete catalog.

No recursive profile inheritance or automatically growing role registry is introduced. Add files, not branches in the executor.
