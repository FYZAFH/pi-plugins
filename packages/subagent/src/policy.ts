import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ToolName } from "./protocol.ts";

export const READ_TOOLS: ToolName[] = ["read", "grep", "find", "ls"];
export const TOOL_NAMES: ToolName[] = [...READ_TOOLS, "edit", "write", "bash"];

export function resolveTools(requested: string[] | undefined, allowed: string[]): ToolName[] {
  const tools = requested ?? READ_TOOLS.filter((name) => allowed.includes(name));
  if (!tools.length) throw new Error("No supported tools available. Supply an explicit supported tool allowlist.");
  for (const name of tools) {
    if (!TOOL_NAMES.includes(name as ToolName) || !allowed.includes(name)) {
      throw new Error(`Tool is unavailable or not a native host built-in: ${name}`);
    }
  }
  return [...new Set(tools)] as ToolName[];
}

export function isWriter(tools: readonly string[]): boolean {
  return tools.some((name) => ["write", "edit", "bash"].includes(name));
}

export async function canonicalCwd(cwd: string | undefined, parentCwd: string): Promise<string> {
  const path = await realpath(resolve(parentCwd, cwd ?? "."));
  if (!(await stat(path)).isDirectory()) throw new Error("Child cwd must be an existing directory.");
  return path;
}

// Git worktrees have their own .git file and therefore their own checkout root.
// No shell execution or repository config loading is needed for lock identity.
export async function workspaceRoot(cwd: string): Promise<string> {
  let current = cwd;
  while (true) {
    try {
      const git = await stat(join(current, ".git"));
      if (git.isDirectory() || git.isFile()) return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return cwd;
    current = parent;
  }
}

// Coordinate equal/nested workspace roots, including canonicalized symlink aliases.
// This does not confine tool paths or coordinate unrelated processes.
export function overlaps(a: string, b: string): boolean {
  const contains = (root: string, path: string) => {
    const rel = relative(root, path);
    return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
  };
  return contains(a, b) || contains(b, a);
}

export function boundedText(text: string, maxBytes = 8192): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text);
  if (bytes.length <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}
