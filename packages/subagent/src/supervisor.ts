import { randomUUID } from "node:crypto";
import { boundedText, isWriter, overlaps } from "./policy.ts";
import { isTerminal, type RunSnapshot, type RunSummary } from "./protocol.ts";
import type { ExecutionInput, Executor } from "./executor.ts";
import type { RunStore } from "./store.ts";

interface Run {
  snapshot: RunSnapshot;
  input?: ExecutionInput;
  controller: AbortController;
  finished: Promise<void>;
  resolveFinished: () => void;
  timeoutMs: number;
  storageError?: string;
}
export interface SupervisorOptions {
  parentSessionId: string;
  executor: Executor;
  store: RunStore;
  concurrency?: number;
  queueLimit?: number;
  runLimit?: number;
  onChange?: (snapshot: RunSnapshot) => void;
  onComplete?: (snapshot: RunSnapshot) => void;
}

export class Supervisor {
  private readonly runs = new Map<string, Run>();
  private readonly active = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly options: SupervisorOptions;
  private closed = false;
  private closing?: Promise<void>;

  constructor(options: SupervisorOptions) {
    this.options = options;
    for (const value of [options.concurrency ?? 4, options.queueLimit ?? 16, options.runLimit ?? 64]) {
      if (!Number.isInteger(value) || value < 1) throw new Error("Run limits must be positive integers.");
    }
  }

  get parentSessionId(): string { return this.options.parentSessionId; }
  list(): RunSummary[] {
    return [...this.runs.values()].map(({ snapshot }) => {
      const { output: _output, ...summary } = structuredClone(snapshot);
      return summary;
    });
  }
  status(id: string): RunSnapshot { return structuredClone(this.get(id).snapshot); }
  private get(id: string): Run {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Unknown run in this parent session: ${id}`);
    return run;
  }

  spawn(input: ExecutionInput, label: string, timeoutMs: number, workspace = input.cwd): RunSnapshot {
    if (this.closed) throw new Error("Subagent runtime is shutting down.");
    if (this.runs.size >= (this.options.runLimit ?? 64)) throw new Error("Run limit reached (64 by default). Reload or start a new parent session after reviewing the run records.");
    const queued = [...this.runs.values()].filter((run) => run.snapshot.state === "queued").length;
    if (this.active.size >= (this.options.concurrency ?? 4) && queued >= (this.options.queueLimit ?? 16)) {
      throw new Error("Subagent queue is full. Wait for existing work before spawning more tasks.");
    }
    if (isWriter(input.tools)) {
      const conflict = [...this.runs.values()].find(({ snapshot }) =>
        !isTerminal(snapshot.state) && isWriter(snapshot.tools) && overlaps(snapshot.workspace, workspace));
      if (conflict) throw new Error(`Writer conflict with run ${conflict.snapshot.id}. Use an isolated cwd or wait.`);
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600_000) throw new Error("timeoutMs must be between 1 and 3600000.");
    const id = randomUUID();
    const deferred = Promise.withResolvers<void>();
    const snapshot: RunSnapshot = {
      version: 1, id, parentSessionId: this.parentSessionId, revision: 1,
      label, cwd: input.cwd, workspace, tools: [...input.tools], model: `${input.model.provider}/${input.model.id}`,
      state: "queued", createdAt: Date.now(), artifactDir: this.options.store.create(id, input.task),
    };
    this.options.store.save(snapshot); // Launch is not accepted unless its initial record is saved.
    const run: Run = { snapshot, input, controller: new AbortController(), finished: deferred.promise, resolveFinished: deferred.resolve, timeoutMs };
    this.runs.set(id, run);
    this.notify(run);
    this.pump();
    return this.status(id);
  }

  private notify(run: Run): void {
    try { this.options.onChange?.(structuredClone(run.snapshot)); } catch { /* Observers cannot own execution. */ }
    for (const listener of [...this.listeners]) listener();
  }

  private publish(run: Run): void {
    run.snapshot.revision++;
    try { this.options.store.save(run.snapshot); }
    catch (error) {
      run.storageError = `Artifact write failed: ${String(error)}`;
      run.snapshot.error = run.storageError;
      if (!isTerminal(run.snapshot.state)) {
        run.snapshot.state = "cancelling";
        run.controller.abort();
      } else if (run.snapshot.state === "completed") run.snapshot.state = "failed";
    }
    this.notify(run);
  }

  private complete(run: Run): void {
    run.input = undefined;
    run.snapshot.finishedAt = Date.now();
    run.snapshot.activity = undefined;
    this.active.delete(run.snapshot.id);
    this.publish(run);
    run.resolveFinished();
    if (!this.closed) {
      try { this.options.onComplete?.(structuredClone(run.snapshot)); }
      catch { this.setNotification(run.snapshot.id, "failed"); }
    }
    this.pump();
  }

  private pump(): void {
    if (this.closed) return;
    for (const run of this.runs.values()) {
      if (this.active.size >= (this.options.concurrency ?? 4)) break;
      if (run.snapshot.state !== "queued") continue;
      this.active.add(run.snapshot.id);
      run.snapshot.state = "running";
      run.snapshot.startedAt = Date.now();
      this.publish(run);
      // execute() contains its own error/cleanup boundary; no fire-and-forget rejection.
      void this.execute(run);
    }
  }

  private async execute(run: Run): Promise<void> {
    const timer = setTimeout(() => this.cancel(run.snapshot.id, "timeout"), run.timeoutMs);
    try {
      run.controller.signal.throwIfAborted();
      const result = await this.options.executor(run.input!, run.controller.signal, {
        activity: (activity) => {
          if (run.snapshot.state !== "running") return;
          run.snapshot.activity = boundedText(activity, 256).text;
          this.publish(run);
        },
        event: (event) => {
          try { this.options.store.log(run.snapshot.id, event); }
          catch (error) {
            run.storageError = `Event log failed: ${String(error)}`;
            this.cancel(run.snapshot.id);
          }
        },
      });
      const preview = boundedText(result.output);
      run.snapshot.output = preview.text;
      const saved = this.options.store.output(run.snapshot.id, result.output);
      run.snapshot.outputTruncated = preview.truncated || saved.truncated;
      run.snapshot.error = result.error ?? (saved.truncated ? "Final report exceeded the 256 KiB artifact limit; output was truncated." : undefined);
      run.snapshot.state = run.snapshot.error ? "failed" : "completed";
    } catch (error) {
      run.snapshot.error = boundedText(error instanceof Error ? error.message : String(error), 2048).text;
      run.snapshot.state = "failed";
    } finally {
      clearTimeout(timer);
      if (run.snapshot.cancelReason) {
        run.snapshot.state = run.snapshot.cancelReason === "timeout" ? "timed_out" : "cancelled";
      }
      if (run.storageError) {
        run.snapshot.state = "failed";
        run.snapshot.error = run.storageError;
      }
      this.complete(run);
    }
  }

  cancel(id: string, reason: "user" | "timeout" | "shutdown" = "user"): RunSnapshot {
    const run = this.get(id);
    if (isTerminal(run.snapshot.state) || run.snapshot.state === "cancelling") return this.status(id);
    const queued = run.snapshot.state === "queued";
    run.snapshot.cancelReason = reason;
    run.snapshot.state = "cancelling";
    run.controller.abort();
    if (queued) {
      run.snapshot.state = reason === "timeout" ? "timed_out" : "cancelled";
      this.complete(run);
    } else this.publish(run);
    return this.status(id);
  }

  setNotification(id: string, status: "accepted" | "failed"): void {
    const run = this.get(id);
    run.snapshot.notification = status;
    this.publish(run);
  }

  async wait(ids: string[], timeoutMs = 30_000, signal?: AbortSignal): Promise<RunSnapshot[]> {
    ids.forEach((id) => this.get(id));
    signal?.throwIfAborted();
    if (ids.every((id) => isTerminal(this.get(id).snapshot.state))) return ids.map((id) => this.status(id));
    await new Promise<void>((resolve, reject) => {
      const clean = () => { clearTimeout(timer); this.listeners.delete(check); signal?.removeEventListener("abort", abort); };
      const check = () => { if (ids.every((id) => isTerminal(this.get(id).snapshot.state))) { clean(); resolve(); } };
      const abort = () => { clean(); reject(signal?.reason ?? new Error("Wait cancelled")); };
      const timer = setTimeout(() => { clean(); resolve(); }, timeoutMs);
      this.listeners.add(check);
      signal?.addEventListener("abort", abort, { once: true });
      check();
    });
    return ids.map((id) => this.status(id));
  }

  async settled(id: string): Promise<RunSnapshot> {
    await this.get(id).finished;
    return this.status(id);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const run of this.runs.values()) this.cancel(run.snapshot.id, "shutdown");
    this.closing = Promise.all([...this.runs.values()].map((run) => run.finished)).then(() => { this.options.store.close(); });
    return this.closing;
  }
}
