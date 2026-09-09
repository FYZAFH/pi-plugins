import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { TOOL_NAMES } from "./policy.ts";
import type { ProfileReference, ProfileScope, ToolName } from "./protocol.ts";

export interface ProfileSource {
  scope: ProfileScope;
  directory: string;
}
export interface Profile {
  reference: ProfileReference;
  description: string;
  tools: ToolName[];
  instructions: string;
}
export interface ProfileDiagnostic {
  name: string;
  source: string;
  error: string;
}
export interface ProfileCatalog {
  profiles: Profile[];
  diagnostics: ProfileDiagnostic[];
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BYTES = 32768;
const PRIORITY: Record<ProfileScope, number> = { extension: 0, user: 1, project: 2 };

export function parseProfile(text: string, source: ProfileSource, path: string): Profile {
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Profile exceeds 32 KiB.");
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const sections = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!sections) throw new Error("Profile requires closed YAML frontmatter.");
  if (sections[1].includes("\n---")) throw new Error("Invalid frontmatter delimiter.");
  const { frontmatter } = parseFrontmatter(`---\n${sections[1]}\n---\n`);
  const body = sections[2];
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) throw new Error("Frontmatter must be an object.");
  for (const key of Object.keys(frontmatter)) {
    if (!["name", "description", "tools"].includes(key)) throw new Error(`Unsupported profile field: ${key}`);
  }
  const name = frontmatter.name;
  if (typeof name !== "string" || name.length > 64 || !NAME.test(name)) throw new Error("name must be a lowercase hyphenated identifier (1..64 characters).");
  if (name !== basename(path, ".md")) throw new Error("name must match the Markdown filename (without .md).");
  const description = frontmatter.description;
  if (typeof description !== "string" || !description.trim() || description.length > 300) throw new Error("description must contain 1..300 characters.");
  const raw = typeof frontmatter.tools === "string" ? frontmatter.tools.split(",").map((tool) => tool.trim()) : frontmatter.tools;
  if (!Array.isArray(raw) || !raw.length || raw.length > TOOL_NAMES.length || raw.some((tool) => typeof tool !== "string" || !TOOL_NAMES.includes(tool as ToolName))) {
    throw new Error(`tools must explicitly list supported native tools: ${TOOL_NAMES.join(", ")}.`);
  }
  if (new Set(raw).size !== raw.length) throw new Error("tools must not contain duplicates.");
  if (!body.trim()) throw new Error("Profile instructions must not be empty.");
  return {
    reference: { name, scope: source.scope, path, sha256: createHash("sha256").update(text).digest("hex") },
    description: description.trim(), tools: raw as ToolName[], instructions: body.trim(),
  };
}

function readProfile(path: string): string {
  // Bound reads and refuse symlinks/non-regular files, including replacement races.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error("Profile must be a regular file no larger than 32 KiB.");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const bytes = readSync(fd, buffer, count, buffer.length - count, null);
      if (!bytes) break;
      count += bytes;
    }
    if (count > MAX_BYTES) throw new Error("Profile exceeds 32 KiB.");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, count));
  } finally { closeSync(fd); }
}

export function discoverProfiles(sources: ProfileSource[]): ProfileCatalog {
  if (sources.length > 32) throw new Error("Too many profile sources (maximum 32).");
  const diagnostics: ProfileDiagnostic[] = [];
  const scopes = new Map<ProfileScope, Map<string, Profile | null>>();
  const visited = new Set<string>();
  let files = 0;
  let directories = 0;
  for (const source of sources) {
    if (!isAbsolute(source.directory)) throw new Error("Profile source directories must be absolute.");
    const root = resolve(source.directory);
    const key = `${source.scope}:${root}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const entries = scopes.get(source.scope) ?? new Map<string, Profile | null>();
    scopes.set(source.scope, entries);
    const scan = (directory: string, depth: number): void => {
      if (++directories > 256 || depth > 8) throw new Error("Profile directory scan limit exceeded.");
      let children;
      try { children = readdirSync(directory, { withFileTypes: true }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && depth === 0) return;
        throw new Error(`Cannot scan profile directory ${directory}: ${String(error)}`);
      }
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        if (child.name.startsWith(".")) continue;
        const path = join(directory, child.name);
        if (child.isDirectory()) { scan(path, depth + 1); continue; }
        if (!child.name.endsWith(".md")) continue;
        if (++files > 256) throw new Error("Too many profile files (maximum 256).");
        const name = basename(child.name, ".md");
        if (entries.has(name)) {
          entries.set(name, null);
          diagnostics.push({ name, source: path, error: `Duplicate profile name in ${source.scope} scope.` });
          continue;
        }
        try {
          if (child.isSymbolicLink() || !child.isFile()) throw new Error("Profile files must not be symlinks or special files.");
          entries.set(name, parseProfile(readProfile(path), source, path));
        } catch (error) {
          // Reserve the name: a broken project override must not fall back to a user profile.
          entries.set(name, null);
          diagnostics.push({ name, source: path, error: String(error).slice(0, 1000) });
        }
      }
    };
    scan(root, 0);
  }
  const merged = new Map<string, Profile | null>();
  for (const [scope, entries] of [...scopes].sort(([a], [b]) => PRIORITY[a] - PRIORITY[b])) {
    for (const [name, profile] of entries) merged.set(name, profile);
  }
  return { profiles: [...merged.values()].filter((profile): profile is Profile => profile !== null).sort((a, b) => a.reference.name.localeCompare(b.reference.name)), diagnostics };
}

export function selectProfile(catalog: ProfileCatalog, name: string): Profile {
  const profile = catalog.profiles.find((item) => item.reference.name === name);
  if (profile) return profile;
  const errors = catalog.diagnostics.filter((item) => item.name === name);
  if (errors.length) throw new Error(`Profile ${name} is invalid or ambiguous: ${errors.map((item) => `${item.source}: ${item.error}`).join("; ")}`);
  throw new Error(`Unknown profile: ${name}. Use subagent action profiles to list available profiles.`);
}

export function profileTools(profile: Profile, requested?: string[]): string[] {
  if (!requested) return [...profile.tools];
  for (const tool of requested) {
    if (!profile.tools.includes(tool as ToolName)) throw new Error(`Tool ${tool} exceeds profile ${profile.reference.name}'s tool ceiling.`);
  }
  return requested;
}

export function summarizeProfiles(catalog: ProfileCatalog) {
  return { profiles: catalog.profiles.map(({ reference, description, tools }) => ({ ...reference, description, tools })), diagnostics: catalog.diagnostics };
}
