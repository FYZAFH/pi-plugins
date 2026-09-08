import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createChildSession, createExecutor, finalReport } from "../src/executor.ts";
import { fixture, message } from "./helpers.ts";

const observer = { activity() {}, event() {} };

test("executor uses real SDK sessions with isolated history and all text blocks", async () => {
  const contexts: string[] = [];
  const { input } = await fixture((model, context) => {
    contexts.push(JSON.stringify(context.messages));
    return message(model, [{ type: "text", text: "Evidence" }, { type: "text", text: "Limitations" }]);
  });
  const run = createExecutor();
  const results = await Promise.all(["FIRST", "SECOND"].map((task) => run({ ...input, task }, new AbortController().signal, observer)));
  assert.deepEqual(results, [{ output: "Evidence\nLimitations" }, { output: "Evidence\nLimitations" }]);
  assert.equal(contexts.length, 2);
  assert.ok(contexts.every((context) => !(context.includes("FIRST") && context.includes("SECOND"))));
});

test("read-only tools reject model-requested writes and resolve reads in child cwd", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "subagent-tools-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "fixture.txt"), "local evidence");
  let turn = 0;
  const { input } = await fixture((model, context) => {
    if (++turn === 1) return message(model, [
      { type: "toolCall", id: "read-1", name: "read", arguments: { path: "fixture.txt" } },
      { type: "toolCall", id: "write-1", name: "write", arguments: { path: "forbidden.txt", content: "no" } },
    ], "toolUse");
    const results = context.messages.filter((msg) => msg.role === "toolResult");
    assert.equal(results[0].isError, false);
    assert.equal(results[1].isError, true);
    assert.match(JSON.stringify(results[0]), /local evidence/);
    return message(model, [{ type: "text", text: "Inspected without mutation." }]);
  });
  const result = await createExecutor()({ ...input, cwd }, new AbortController().signal, observer);
  assert.equal(result.error, undefined);
  await assert.rejects(readFile(join(cwd, "forbidden.txt")), { code: "ENOENT" });
});

test("terminal classifier rejects length, errors, missing and empty reports", async () => {
  const { model } = await fixture();
  assert.ok(finalReport([]).error);
  assert.ok(finalReport([message(model, [])]).error);
  for (const reason of ["length", "error", "aborted", "toolUse"] as const) {
    const result = finalReport([message(model, [{ type: "text", text: "partial" }], reason)]);
    assert.equal(result.output, "partial");
    assert.ok(result.error);
  }
  assert.equal(finalReport([message(model, [], "error"), message(model, [{ type: "text", text: "recovered" }])]).error, undefined);
});

test("provider errors are failures even when SDK prompt resolves", async () => {
  const { input } = await fixture((model) => ({ ...message(model, [], "error"), errorMessage: "Synthetic failure" }));
  const result = await createExecutor()(input, new AbortController().signal, observer);
  assert.match(result.error!, /Synthetic failure/);
});

test("abort before creation never creates a session", async () => {
  const { input } = await fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createExecutor(async () => { throw new Error("must not create"); })(input, controller.signal, observer), { name: "AbortError" });
});

test("abort during creation disposes the created session without prompting", async () => {
  const { input } = await fixture();
  const controller = new AbortController();
  let disposed = false;
  const executor = createExecutor(async (input, signal) => {
    const session = await createChildSession(input, signal);
    const dispose = session.dispose.bind(session);
    session.dispose = () => { disposed = true; dispose(); };
    controller.abort();
    return session;
  });
  await assert.rejects(executor(input, controller.signal, observer), { name: "AbortError" });
  assert.equal(disposed, true);
});

test("abort reaches a running provider and resources settle", { timeout: 5000 }, async () => {
  const started = Promise.withResolvers<void>();
  let aborted = false;
  const { input } = await fixture((model, _context, options) => new Promise((resolve) => {
    const finish = () => { aborted = true; resolve(message(model, [], "aborted")); };
    if (options?.signal?.aborted) finish();
    else options?.signal?.addEventListener("abort", finish, { once: true });
    started.resolve();
  }));
  const controller = new AbortController();
  const running = createExecutor()(input, controller.signal, observer);
  await started.promise;
  controller.abort();
  await running;
  assert.equal(aborted, true);
});

test("auth failure and observer failure still dispose the session", async () => {
  const { input } = await fixture();
  for (const brokenAuth of [true, false]) {
    let disposed = false;
    const run = createExecutor(async (input, signal) => {
      const session = await createChildSession(input, signal);
      const dispose = session.dispose.bind(session);
      session.dispose = () => { disposed = true; dispose(); };
      return session;
    });
    await assert.rejects(run({ ...input, getAuth: brokenAuth ? async () => undefined : input.getAuth }, new AbortController().signal, {
      activity() { if (!brokenAuth) throw new Error("Observer failed"); }, event() {},
    }));
    assert.equal(disposed, true);
  }
});

test("abort during a real shell tool settles without waiting for its sleep", { timeout: 5000 }, async () => {
  let turns = 0;
  const { input } = await fixture((model) => ++turns === 1
    ? message(model, [{ type: "toolCall", id: "sleep-tool", name: "bash", arguments: { command: "sleep 30" } }], "toolUse")
    : message(model, [{ type: "text", text: "Cancelled shell." }]));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await createExecutor()({ ...input, tools: ["bash"] }, controller.signal, {
      activity(text) { if (text === "Tool: bash") timer = setTimeout(() => controller.abort(), 50); },
      event() {},
    });
    assert.equal(controller.signal.aborted, true);
  } finally { clearTimeout(timer); }
});
