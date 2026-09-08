import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecutionResult, Executor } from "../src/executor.ts";
import { Supervisor } from "../src/supervisor.ts";
import { fixture, MemoryStore } from "./helpers.ts";

const { input } = await fixture();
function setup(executor: Executor, extra: Partial<ConstructorParameters<typeof Supervisor>[0]> = {}) {
  const store = new MemoryStore();
  const manager = new Supervisor({ parentSessionId: "parent", store, executor, ...extra });
  return { manager, store };
}

test("bounded concurrency and queue; no hidden unbounded fanout", async () => {
  const gates: ReturnType<typeof Promise.withResolvers<ExecutionResult>>[] = [];
  const { manager } = setup(async () => {
    const gate = Promise.withResolvers<ExecutionResult>();
    gates.push(gate);
    return gate.promise;
  }, { concurrency: 1, queueLimit: 1 });
  const first = manager.spawn(input, "first", 10000);
  const second = manager.spawn(input, "second", 10000);
  assert.equal(first.state, "running");
  assert.equal(second.state, "queued");
  assert.throws(() => manager.spawn(input, "third", 10000), /queue is full/);
  gates[0].resolve({ output: "one" });
  await manager.settled(first.id);
  assert.equal(gates.length, 2);
  gates[1].resolve({ output: "two" });
  await manager.settled(second.id);
  await manager.close();
});

test("queued cancellation does not launch; running cancellation retains writer ownership", async () => {
  const gate = Promise.withResolvers<ExecutionResult>();
  const { manager } = setup(async () => gate.promise, { concurrency: 1 });
  const writer = { ...input, cwd: "/repo", tools: ["write" as const] };
  const first = manager.spawn(writer, "writer", 10000);
  const queued = manager.spawn({ ...input, cwd: "/elsewhere" }, "reader", 10000);
  assert.equal(manager.cancel(queued.id).state, "cancelled");
  assert.equal(manager.cancel(first.id).state, "cancelling");
  assert.throws(() => manager.spawn({ ...writer, cwd: "/repo/src" }, "conflict", 10000), /Writer conflict/);
  gate.resolve({ output: "partial" });
  assert.equal((await manager.settled(first.id)).state, "cancelled");
  assert.equal(manager.cancel(first.id).state, "cancelled");
  await manager.close();
});

test("sibling cwds in the same checkout share writer ownership", async () => {
  const gate = Promise.withResolvers<ExecutionResult>();
  const { manager } = setup(async () => gate.promise);
  const writer = { ...input, tools: ["write" as const] };
  const run = manager.spawn({ ...writer, cwd: "/repo/src" }, "first", 10000, "/repo");
  assert.throws(() => manager.spawn({ ...writer, cwd: "/repo/tests" }, "second", 10000, "/repo"), /Writer conflict/);
  gate.resolve({ output: "done" });
  await manager.settled(run.id);
  await manager.close();
});

test("readers can overlap and writers in isolated directories can run together", async () => {
  const gate = Promise.withResolvers<ExecutionResult>();
  const { manager } = setup(async () => gate.promise);
  const one = manager.spawn({ ...input, cwd: "/one", tools: ["write"] }, "one", 10000);
  const two = manager.spawn({ ...input, cwd: "/two", tools: ["write"] }, "two", 10000);
  const read = manager.spawn({ ...input, cwd: "/one" }, "read", 10000);
  assert.equal([one, two, read].filter((run) => run.state === "running").length, 3);
  gate.resolve({ output: "done" });
  await Promise.all([one, two, read].map((run) => manager.settled(run.id)));
  await manager.close();
});

test("timeouts wait for cancellation settlement, never release ownership early", async () => {
  const gate = Promise.withResolvers<ExecutionResult>();
  const { manager } = setup(async () => gate.promise);
  const run = manager.spawn(input, "timeout", 5);
  await delay(20);
  assert.equal(manager.status(run.id).state, "cancelling");
  gate.resolve({ output: "partial" });
  assert.equal((await manager.settled(run.id)).state, "timed_out");
  await manager.close();
});

test("completion wins against later cancellation; observers cannot mutate state", async () => {
  const { manager } = setup(async () => ({ output: "done" }), {
    onChange(snapshot) { snapshot.label = "mutated"; throw new Error("bad observer"); },
  });
  const run = manager.spawn(input, "original", 10000);
  await manager.settled(run.id);
  assert.equal(manager.cancel(run.id).state, "completed");
  assert.equal(manager.status(run.id).label, "original");
  const copy = manager.status(run.id);
  copy.tools.push("bash");
  assert.deepEqual(manager.status(run.id).tools, ["read"]);
  await manager.close();
});

test("storage failure stops execution and reports failure instead of success", async () => {
  const store = new MemoryStore();
  let writes = 0;
  store.save = () => { if (++writes > 1) throw new Error("disk full"); };
  let launched = false;
  const { manager } = setup(async () => { launched = true; return { output: "done" }; }, { store });
  const run = manager.spawn(input, "failure", 10000);
  const done = await manager.settled(run.id);
  assert.equal(launched, false);
  assert.equal(done.state, "failed");
  assert.match(done.error!, /Artifact write failed/);
  await manager.close();
});

test("wait timeouts and aborted waits do not cancel child execution", async () => {
  const gate = Promise.withResolvers<ExecutionResult>();
  const { manager } = setup(async () => gate.promise);
  const run = manager.spawn(input, "wait", 10000);
  assert.equal((await manager.wait([run.id], 1))[0].state, "running");
  const controller = new AbortController();
  const waiting = manager.wait([run.id], 10000, controller.signal);
  controller.abort();
  await assert.rejects(waiting);
  assert.equal(manager.status(run.id).state, "running");
  await assert.rejects(manager.wait(["unknown"]), /Unknown run/);
  gate.resolve({ output: "done" });
  await manager.settled(run.id);
  await manager.close();
});

test("shutdown drains running and queued children, suppresses callbacks, and is idempotent", async () => {
  let completions = 0;
  const { manager, store } = setup(async (_input, signal) => {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    return { output: "stopped" };
  }, { concurrency: 1, onComplete() { completions++; } });
  manager.spawn(input, "running", 10000);
  manager.spawn(input, "queued", 10000);
  const firstClose = manager.close();
  assert.equal(manager.close(), firstClose);
  await firstClose;
  assert.equal(completions, 0);
  assert.equal(store.closed, true);
  assert.ok(manager.list().every((run) => run.state === "cancelled"));
  assert.throws(() => manager.spawn(input, "late", 10000), /shutting down/);
});

test("cumulative run cap includes completed runs and output previews stay bounded", async () => {
  const { manager, store } = setup(async () => ({ output: "漢".repeat(10000) }), { runLimit: 1 });
  const run = manager.spawn(input, "output", 10000);
  const done = await manager.settled(run.id);
  assert.ok(Buffer.byteLength(done.output!) <= 8192);
  assert.equal(done.outputTruncated, true);
  assert.equal(store.outputs.get(run.id), "漢".repeat(10000));
  assert.throws(() => manager.spawn(input, "extra", 10000), /Run limit/);
  await manager.close();
});

test("terminal execution failures preserve partial output and failed notifications stay visible", async () => {
  const { manager } = setup(async () => ({ output: "partial", error: "Provider failed" }), { onComplete() { throw new Error("delivery failed"); } });
  const run = manager.spawn(input, "fail", 10000);
  const done = await manager.settled(run.id);
  assert.equal(done.state, "failed");
  assert.equal(done.output, "partial");
  assert.equal(done.notification, "failed");
  await manager.close();
});
