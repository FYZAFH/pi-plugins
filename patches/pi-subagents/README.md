# Local pi-subagents drawer maintenance

## State and provenance

- Official upstream: <https://github.com/nicobailon/pi-subagents>.
- Prepared Git submodule: `vendor/pi-subagents`, detached at **v0.67.0**, commit `aa75b3353836f7868898e3bd58234d21eaff1463` (1,618 reachable commits). Original `LICENSE`, agents, skills and prompt templates are untouched.
- Both `origin` and `upstream` point at official upstream. `.gitmodules` uses the official HTTPS URL, not a local-only path or nonexistent fork.
- Distribution uses the parent repository's official-base gitlink plus the complete patch below. The submodule checkout has uncommitted UI changes; there is no customized submodule commit or remote fork. Development-run evidence below predates the parent's authorized publication and records the state at validation time.
- `base.json` pins the base, patch hash and file inventory. `unified-drawer.patch` includes **both new files**, not just tracked-file diffs.

**A parent gitlink does not store uncommitted submodule changes.** The parent records the official base gitlink and this patch directory; another clone reproduces the customization by applying the patch below. For a clone that needs no patch step, the UI changes must later be committed and pushed to an authorized user fork; then change `.gitmodules` to that fork and record the reachable customized gitlink. No such fork currently exists or is authorized.

## Activation status: NOT activated

Global settings remain unchanged:

```json
{
  "packages": [{
    "source": "npm:pi-subagents@0.67.0",
    "skills": ["skills/pi-subagents/SKILL.md"],
    "prompts": []
  }],
  "subagents": { "disableBuiltins": true }
}
```

The patch passed typecheck, focused unit/integration tests and isolated offline real Pi 0.85.1 RPC/TUI checks. A separately run **unchanged upstream** process-tree test failed with `kill EPERM` at `test/unit/owned-process-tree.test.ts:90`. Per the activation gate, runtime testing stopped and the official npm source stayed active. This failure was not suppressed or worked around. No current-session reload or paid-provider test occurred. No settings backup was needed because settings were not written.

After resolving that gate and reviewing the patch, back up the **latest** settings, then change only the existing package's source and add the presentation preference:

```json
{
  "packages": [{
    "source": "/Users/fh/Code/pi-plugins/vendor/pi-subagents",
    "skills": ["skills/pi-subagents/SKILL.md"],
    "prompts": []
  }],
  "subagents": { "disableBuiltins": true, "commandMode": "compact" }
}
```

Merge those fields; do not replace the entire settings file or add a second package/extension. Keep the custom maintenance agent's `inheritSkills: false`. Keep all bundled resources on disk; filtering is entirely configuration-based. Use a fresh Pi session when authorized, not a reload of the current session. Removing `commandMode`, or setting it to `"full"`, restores upstream human entry points. The preference is global, validated, read at extension load, and never changes execution/model/permission policy.

## Drawer behavior

Compact TUI `/subagents` with no arguments and upstream **Ctrl+Alt+F** open the existing Fleet first. Escape from Fleet opens the category selector; Escape from a category goes back, and Escape from the root closes. Selecting Runs → Fleet returns to the original live inspector. This is a small navigation shell delegating to upstream surfaces, not a new status/execution engine.

- **Runs:** Fleet; guided original `/run`; Stop's original selector/confirmation; guided Steer/Detach; Costs.
- **Agents:** original browse/edit menus; a confirmed JSON Create form using the original slash management bridge, validation and policy. Empty discovery remains empty; no default role is invented. Create remains reachable even with zero agents.
- **Workflows:** read-only catalog and guided execution of enabled prompt workflows; packaged help. Catalog intersects host-enabled prompt provenance with upstream-supported workflow paths. `prompts: []` excludes packaged defaults from this catalog. The old explicit `/prompt-workflow list` still has upstream disk-discovery semantics for compatibility, even for templates excluded from host discovery. Prompts outside upstream-supported package/user/project directories are not represented as runnable workflows here.
- **More:** guided existing schedule/mission actions (JSON fields must satisfy upstream validation); Diagnostics; Models/Profiles/Watchdog status and command-mode instructions; Help; original handlers with guided argument input. There is no invented schedule inspector, cron implementation or mission runner. Explicit schedule Run, workflow Run and other execution commands may launch work; merely opening/navigating menus does not.

Forms retain original validators and add explicit confirmation for management JSON. They cannot change the selected action. Schedule Create can provide its required workflow script/path. Host inputs/editors supply normal editing/IME behavior. The drawer itself has no input editor, timers, subscriptions or cached theme strings; overlay keyboard handling uses the injected keybinding manager and rows are width/height bounded. Shutdown aborts outstanding drawer forms/bridge requests and closes its current overlay. Fleet retains its upstream lifecycle/disposal behavior. No main-editor text is set by the drawer.

## Slash registration / RPC compatibility

**All 19 original registrations remain callable in both modes.** Compact mode changes TUI completion suggestions only, plus the no-argument TUI `/subagents` and Fleet shortcut entry point. With arguments, `/subagents` retains original administration behavior. In RPC/print/JSON it always retains original behavior. `get_commands` still reports the full registration list; compact mode is **not** command removal or an authority boundary.

The public `ctx.ui.addAutocompleteProvider` wraps the host's complete provider and filters its returned slash items. It does not merely offer a parallel provider. Filtering uses exact extension provenance and invocation names, preserving other extensions (including collision suffixes), built-ins, skills, argument completions and file completions. Another later extension can intentionally replace the provider or reintroduce suggestions; this patch does not monkeypatch editor internals. The generic Skill remains available as `/skill:pi-subagents`.

| Registration source | Commands |
| --- | --- |
| `src/watchdog/register-main.ts` | `subagents-watchdog` |
| `src/slash/prompt-workflows.ts` | `prompt-workflow` |
| `src/slash/slash-commands.ts` | `subagents`, `run`, `subagent-cost`, `subagents-doctor`, `subagents-inspect-rpc`, `subagents-guide`, `subagents-refine`, `subagents-fleet`, `subagents-detach`, `subagents-stop`, `subagents-steer`, `subagents-models`, `subagents-profiles`, `subagents-load-profile`, `subagents-refresh-provider-models`, `subagents-generate-profiles`, `subagents-check-profile` |

`subagents-inspect-rpc` is the slash-based host inspection bridge. It remains registered with unchanged correlated-widget behavior, although excluded from compact human suggestions and Other commands. The event-bus RPC bridge (`subagents:rpc:v1:*`), slash execution bridge and prompt-template input bridge do not register additional slash names and are unchanged. All model tools, including `subagent`, `bg_wait` and supervisor tools, retain original names, schemas and authority.

## Reproduce from the parent patch

From a fresh parent clone containing `.gitmodules`, the official base gitlink and this patch directory:

```sh
git submodule update --init vendor/pi-subagents
# Must print aa75b3353836f7868898e3bd58234d21eaff1463:
git -C vendor/pi-subagents rev-parse HEAD
# Inspect first; stop if this has local changes:
git -C vendor/pi-subagents status --short
# Check SHA-256 against base.json:
shasum -a 256 patches/pi-subagents/unified-drawer.patch
git -C vendor/pi-subagents apply --check ../../patches/pi-subagents/unified-drawer.patch
git -C vendor/pi-subagents apply ../../patches/pi-subagents/unified-drawer.patch
(cd vendor/pi-subagents && npm ci --ignore-scripts && npm run typecheck)
```

On this already-patched checkout, use `git apply --reverse --check` to verify instead of applying twice. Patch reproduction was checked against a pristine `git archive v0.67.0`; all four patched/new files compared byte-for-byte. `npm ci` preserves upstream lockfile and uses its test SDK shim; real host loading is a separate gate.

When updating this distribution, record `.gitmodules`, `vendor/pi-subagents`, and `patches/pi-subagents/` together with relevant installation documentation. The gitlink must still point at the official base when using patch storage. Do not stage unrelated root changes or use root `git add -A`.

## Validate / update

```sh
cd vendor/pi-subagents
npm run typecheck
node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test \
  test/unit/unified-drawer.test.ts test/unit/agent-management.test.ts \
  test/unit/fleet.test.ts test/unit/fleet-status.test.ts \
  test/unit/fleet-transcript.test.ts test/unit/slash-bridge.test.ts
node --experimental-strip-types --import ./test/support/register-loader.mjs --test \
  test/integration/slash-commands.test.ts test/integration/slash-live-state.test.ts
# Separate upstream environment gate; do not suppress failure:
node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test test/unit/owned-process-tree.test.ts
```

For an update, fetch official upstream tags, inspect release notes/API changes and use a **fresh** worktree at the new tag. Do not reset or stash this working tree. Apply/check this small patch there, resolve UI-only conflicts, then rerun typecheck, focused tests, the process-tree gate and offline real-host RPC/TUI checks. Re-inventory registrations, compare model schemas and verify effective resource filters. Regenerate the complete patch against the new base, explicitly including new files with `git diff --no-index /dev/null <file>`, then update `base.json` and prove reproduction in a pristine archive. Keep the upstream LICENSE/history. Only then update the parent gitlink and consider source activation with a fresh settings backup.

### Evidence from this run

Logs and exact offline host harness/probe: **`/tmp/pi-drawer-validation/`**.

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts` | Pass; upstream lockfile unchanged |
| Upstream `npm run typecheck` | Pass before and after patch |
| Focused units, including 9 new drawer tests | **166 pass**, 0 skipped |
| Slash integration | **45 pass**, 0 skipped |
| Offline real Pi RPC | Full commands, unique tool registrations, no default agents/prompts, generic Skill only, no model turns |
| Offline real Pi TUI (PTY) | Public composed `/` and `/sub` suggestions: only owned unified entry; unrelated probe retained; Fleet → categories → empty Agents → close keyboard path |
| Upstream process-tree gate | **1 pass, 1 fail (`kill EPERM`), 1 platform skip**; no full-suite success claimed |
| Reproducible patch | Apply/check and four-file byte comparisons pass |

`host-check.py` and `host-probe.ts` are the executed local evidence scripts, not a paid smoke. The first harness attempts exposed EOF timing and probe-wrapper ordering problems; the final run explicitly loads vendor then probe under `--no-extensions` to inspect the final composed provider. The isolated package-only RPC load also reached the complete unique inventory. Global settings never changed.

Outstanding real-terminal checks: native IME text entry in guided forms; draft/cursor preservation through shortcut opening/closing; actual theme changes and very narrow/short resize while Fleet and forms are open; session replacement with a live Fleet; live-run controls with authorized work. Unit tests cover bounded rendering/theme changes and drawer shutdown, and the PTY covered the empty navigation path, not these complete physical-terminal scenarios. Required independent reviewer gate remains pending.
