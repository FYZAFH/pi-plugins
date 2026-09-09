import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { boundedText, canonicalCwd, isWriter, overlaps, resolveTools, workspaceRoot } from "../src/policy.ts";
import { FileRunStore } from "../src/store.ts";
import type { RunSnapshot } from "../src/protocol.ts";

test("tool ceilings reject unsupported tools rather than silently widening permissions", () => {
  assert.deepEqual(resolveTools(undefined, ["read", "write", "bash"]), ["read"]);
  assert.throws(() => resolveTools(["write"], ["read"]), /unavailable/);
  assert.throws(() => resolveTools(["subagent"], ["subagent"]), /unavailable/);
  assert.throws(() => resolveTools(undefined, []), /No supported tools/);
  assert.equal(isWriter(["bash"]), true);
  assert.equal(isWriter(["read", "find"]), false);
});

test("cwd canonicalization handles symlinks, nested directories and path boundaries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "subagent-cwd-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "repo"));
  await symlink(join(root, "repo"), join(root, "alias"));
  assert.equal(await canonicalCwd("alias", root), await canonicalCwd("repo", root));
  await writeFile(join(root, "file"), "not a directory");
  await assert.rejects(canonicalCwd("file", root), /directory/);
  assert.ok(overlaps("/repo", "/repo/src"));
  assert.ok(overlaps("/repo/src", "/repo"));
  assert.ok(!overlaps("/repo", "/repo-other"));
  await mkdir(join(root, "repo/.git"));
  await mkdir(join(root, "repo/src"));
  await mkdir(join(root, "repo/tests"));
  const src = await canonicalCwd("repo/src", root);
  const tests = await canonicalCwd("repo/tests", root);
  assert.equal(await workspaceRoot(src), await workspaceRoot(tests));
  await mkdir(join(root, "worktree"));
  await writeFile(join(root, "worktree/.git"), "gitdir: /some/repo/.git/worktrees/fixture\n");
  const worktree = await canonicalCwd("worktree", root);
  assert.equal(await workspaceRoot(worktree), worktree);
  assert.notEqual(await workspaceRoot(worktree), await workspaceRoot(src));
});

test("UTF-8 truncation never splits a code point", () => {
  for (const size of [0, 1, 2, 3, 4, 5, 8, 10]) {
    const result = boundedText("漢😀étext", size);
    assert.ok(Buffer.byteLength(result.text) <= size);
    assert.ok(!result.text.includes("�"));
  }
});

test("file artifacts are private, bounded, and atomically replaced", (t) => {
  const root = mkdtempSync(join(tmpdir(), "subagent-store-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new FileRunStore(root, "parent");
  const directory = store.create("run", "task", "Frozen profile instructions.");
  assert.equal(readFileSync(join(directory, "instructions.txt"), "utf8"), "Frozen profile instructions.");
  assert.equal(statSync(join(directory, "instructions.txt")).mode & 0o777, 0o600);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, "task.txt")).mode & 0o777, 0o600);
  const snapshot: RunSnapshot = {
    version: 1, id: "run", parentSessionId: "parent", revision: 1,
    label: "test", cwd: root, workspace: root, tools: ["read"], model: "fixture", state: "running", createdAt: Date.now(), artifactDir: directory,
  };
  store.save(snapshot);
  store.save({ ...snapshot, revision: 2, state: "completed" });
  assert.equal(JSON.parse(readFileSync(join(directory, "status.json"), "utf8")).revision, 2);
  assert.equal(store.output("run", "x".repeat(300000)).truncated, true);
  assert.ok(statSync(join(directory, "output.txt")).size <= 256 * 1024);
  store.log("run", { output: "x".repeat(2 * 1024 * 1024) });
  store.log("run", { output: "ignored" });
  assert.equal(readFileSync(join(directory, "events.jsonl"), "utf8").trim(), '{"type":"log_truncated","limitBytes":1048576}');
  store.close();
  assert.equal(JSON.parse(readFileSync(join(store.directory, "closed.json"), "utf8")).version, 1);
});

test("retention prunes only old closed stores, never unclosed stores or unrelated directories", (t) => {
  const root = mkdtempSync(join(tmpdir(), "subagent-retention-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const old = new FileRunStore(root, "old");
  old.close();
  writeFileSync(join(old.directory, "closed.json"), JSON.stringify({ version: 1, closedAt: Date.now() - 8 * 86400000 }));
  const open = new FileRunStore(root, "open");
  assert.throws(() => statSync(old.directory), { code: "ENOENT" });
  mkdirSync(join(root, "unrelated"));
  const next = new FileRunStore(root, "next");
  assert.ok(statSync(open.directory).isDirectory());
  assert.ok(statSync(join(root, "unrelated")).isDirectory());
  next.close();
  open.close();
});
