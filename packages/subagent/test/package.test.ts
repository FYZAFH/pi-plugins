import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

test("packed plugin loads through Pi without sibling packages or local node_modules", { timeout: 30000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "subagent-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], { cwd: packageRoot, encoding: "utf8" }));
  const files: string[] = packed[0].files.map((file: { path: string }) => file.path);
  assert.ok(files.includes("src/index.ts"));
  assert.ok(files.includes("src/profiles.ts"));
  assert.ok(files.includes("docs/profiles.md"));
  assert.ok(files.includes("skills/subagent/SKILL.md"));
  assert.ok(!files.some((file) => file.startsWith("test/") || file.startsWith("node_modules/")));
  execFileSync("tar", ["-xf", join(root, packed[0].filename), "-C", root]);
  const manifest = JSON.parse(await readFile(join(root, "package/package.json"), "utf8"));
  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(manifest.pi.extensions, ["./src/index.ts"]);
  const loader = new DefaultResourceLoader({
    cwd: root, agentDir: root,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: [join(root, "package/src/index.ts")],
    additionalSkillPaths: [join(root, "package/skills")],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.equal(loader.getExtensions().extensions.length, 1);
  assert.equal(loader.getSkills().skills.length, 1);
  assert.equal(loader.getSkills().skills[0].name, "subagent");
  assert.deepEqual(loader.getSkills().diagnostics, []);
});
