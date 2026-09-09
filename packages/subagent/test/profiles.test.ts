import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { discoverProfiles, parseProfile, profileTools, selectProfile, summarizeProfiles, type ProfileSource } from "../src/profiles.ts";

const text = (name = "reviewer", tools = "read", instructions = "Inspect the assigned scope. Cite evidence.") => `---\nname: ${name}\ndescription: Review a bounded task.\ntools: ${tools}\n---\n${instructions}\n`;
const source: ProfileSource = { scope: "user", directory: "/profiles" };
function setup(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "subagent-profiles-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const save = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  const sources: ProfileSource[] = ["extension", "user", "project"].map((scope) => ({ scope: scope as ProfileSource["scope"], directory: join(root, scope) }));
  return { root, save, sources };
}

test("profiles accept CSV and YAML tool lists without extra dependencies", () => {
  for (const tools of ["read, grep", "[read, grep]", "\n  - read\n  - grep"]) {
    const profile = parseProfile(text("reviewer", tools), source, "/profiles/reviewer.md");
    assert.deepEqual(profile.tools, ["read", "grep"]);
    assert.equal(profile.reference.name, "reviewer");
    assert.match(profile.reference.sha256, /^[a-f0-9]{64}$/);
    assert.match(profile.instructions, /Cite evidence/);
  }
});

test("invalid, unsupported and ambiguous profile fields fail closed", () => {
  const cases = [
    text().replace("name: reviewer", "name: Other"),
    text().replace("name: reviewer", "name: different"),
    text().replace("description: Review a bounded task.", "description: 12"),
    text().replace("tools: read", "model: other/model\ntools: read"),
    text("reviewer", "bash, subagent"), text("reviewer", "[]"), text("reviewer", "[read, read]"),
    text().replace("tools: read", "tools: [read"),
    text().replace("name: reviewer", "name: reviewer\nname: duplicate"),
    text().replace("tools: read\n", ""), text("reviewer", "read", ""),
    "No frontmatter", "---\nname: reviewer", "---\n- array\n---\nBody",
    text().replace("tools: read\n---", "tools: read\n---invalid\n---"),
  ];
  for (const value of cases) assert.throws(() => parseProfile(value, source, "/profiles/reviewer.md"));
  assert.throws(() => parseProfile(text("reviewer", "read", "x".repeat(32768)), source, "/profiles/reviewer.md"), /32 KiB/);
});

test("project overrides user overrides extension, and list excludes instruction bodies", (t) => {
  const { save, sources } = setup(t);
  for (const scope of ["extension", "user", "project"]) save(`${scope}/reviewer.md`, text("reviewer", "read", `${scope} instructions`));
  const catalog = discoverProfiles(sources);
  assert.equal(selectProfile(catalog, "reviewer").reference.scope, "project");
  assert.equal(selectProfile(discoverProfiles(sources.slice(0, 2)), "reviewer").reference.scope, "user");
  assert.ok(!JSON.stringify(summarizeProfiles(catalog)).includes("project instructions"));
  assert.equal(catalog.profiles.length, 1);
});

test("broken higher-priority overrides do not silently select lower-priority profiles", (t) => {
  const { save, sources } = setup(t);
  save("user/reviewer.md", text());
  save("project/reviewer.md", "---\nname: broken");
  const catalog = discoverProfiles(sources);
  assert.equal(catalog.profiles.length, 0);
  assert.throws(() => selectProfile(catalog, "reviewer"), /invalid or ambiguous/);
  save("project/reviewer.md", text());
  assert.equal(selectProfile(discoverProfiles(sources), "reviewer").reference.scope, "project");
});

test("duplicate names in a scope are ambiguous, not dependent on directory traversal order", (t) => {
  const { save, sources } = setup(t);
  save("user/a/reviewer.md", text());
  save("user/b/reviewer.md", text());
  const catalog = discoverProfiles(sources);
  assert.equal(catalog.profiles.length, 0);
  assert.match(catalog.diagnostics[0].error, /Duplicate/);
  assert.throws(() => selectProfile(catalog, "missing"), /Unknown profile/);
});

test("directory grouping does not require a role registry; changes are discovered on next call", (t) => {
  const { root, save, sources } = setup(t);
  save("user/security/reviewer.md", text());
  const first = selectProfile(discoverProfiles(sources), "reviewer");
  save("user/security/reviewer.md", text("reviewer", "read", "Changed instructions."));
  const second = selectProfile(discoverProfiles(sources), "reviewer");
  assert.notEqual(first.reference.sha256, second.reference.sha256);
  assert.notEqual(first.instructions, second.instructions);
  rmSync(join(root, "user/security/reviewer.md"));
  assert.throws(() => selectProfile(discoverProfiles(sources), "reviewer"), /Unknown profile/);
});

test("profile tools can be narrowed but never widened", () => {
  const profile = parseProfile(text("reviewer", "read, grep"), source, "/profiles/reviewer.md");
  assert.deepEqual(profileTools(profile), ["read", "grep"]);
  assert.deepEqual(profileTools(profile, ["read"]), ["read"]);
  assert.throws(() => profileTools(profile, ["bash"]), /tool ceiling/);
});

test("symlink profile files are rejected and directory symlinks are not traversed", (t) => {
  const { root, save, sources } = setup(t);
  save("external/reviewer.md", text());
  mkdirSync(join(root, "user"));
  symlinkSync(join(root, "external/reviewer.md"), join(root, "user/reviewer.md"));
  symlinkSync(join(root, "external"), join(root, "user/linked"));
  const catalog = discoverProfiles(sources);
  assert.equal(catalog.profiles.length, 0);
  assert.match(catalog.diagnostics[0].error, /symlinks/);
});

test("bounded discovery rejects oversized files and excessive nesting", (t) => {
  const { save, sources } = setup(t);
  save("user/reviewer.md", text("reviewer", "read", "x".repeat(40000)));
  assert.throws(() => selectProfile(discoverProfiles(sources), "reviewer"), /32 KiB/);
  save(`user/${"deep/".repeat(9)}reviewer.md`, text());
  assert.throws(() => discoverProfiles(sources), /scan limit/);
});
