import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boundedText } from "./policy.ts";
import type { RunSnapshot } from "./protocol.ts";

export interface RunStore {
  create(id: string, task: string, instructions?: string): string;
  save(snapshot: RunSnapshot): void;
  output(id: string, text: string): { truncated: boolean };
  log(id: string, event: unknown): void;
  close(): void;
}

export class FileRunStore implements RunStore {
  readonly directory: string;
  private logBytes = new Map<string, number>();

  constructor(root: string, parentId: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    // Only prune closed stores created by this plugin. Never infer a live run died by age.
    for (const name of readdirSync(root)) {
      if (!/^runs-[a-f0-9]{12}-[a-zA-Z0-9]+$/.test(name)) continue;
      const path = join(root, name);
      if (lstatSync(path).isSymbolicLink()) continue;
      const marker = join(path, "closed.json");
      if (!existsSync(marker)) continue;
      try {
        const data = JSON.parse(readFileSync(marker, "utf8"));
        if (data.version === 1 && Number.isFinite(data.closedAt) && Date.now() - data.closedAt > 7 * 86400_000) {
          rmSync(path, { recursive: true });
        }
      } catch { /* An unreadable store is retained for manual inspection. */ }
    }
    const owner = createHash("sha256").update(parentId).digest("hex").slice(0, 12);
    this.directory = mkdtempSync(join(root, `runs-${owner}-`));
    chmodSync(this.directory, 0o700);
  }

  private atomic(path: string, data: string): void {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, data, { mode: 0o600, flag: "wx" });
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  create(id: string, task: string, instructions?: string): string {
    const directory = join(this.directory, id);
    mkdirSync(directory, { mode: 0o700 });
    this.atomic(join(directory, "task.txt"), task);
    if (instructions !== undefined) this.atomic(join(directory, "instructions.txt"), instructions);
    return directory;
  }

  save(snapshot: RunSnapshot): void {
    this.atomic(join(this.directory, snapshot.id, "status.json"), JSON.stringify(snapshot, null, 2));
  }

  output(id: string, text: string): { truncated: boolean } {
    const bounded = boundedText(text, 256 * 1024);
    this.atomic(join(this.directory, id, "output.txt"), bounded.text);
    return { truncated: bounded.truncated };
  }

  log(id: string, event: unknown): void {
    const current = this.logBytes.get(id) ?? 0;
    if (current >= 1024 * 1024) return;
    const text = `${JSON.stringify(event)}\n`;
    const bytes = Buffer.byteLength(text);
    const line = current + bytes <= 1024 * 1024 ? text : '{"type":"log_truncated","limitBytes":1048576}\n';
    writeFileSync(join(this.directory, id, "events.jsonl"), line, { mode: 0o600, flag: "a" });
    this.logBytes.set(id, line === text ? current + bytes : 1024 * 1024);
  }

  close(): void {
    this.atomic(join(this.directory, "closed.json"), JSON.stringify({ version: 1, closedAt: Date.now() }));
  }
}
