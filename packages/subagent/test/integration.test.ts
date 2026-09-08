import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { createAgentSession, createEventBus, DefaultResourceLoader, SessionManager, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSubagent } from "../src/index.ts";
import { CHANGED_EVENT, REQUEST_EVENT, type RunSnapshot } from "../src/protocol.ts";
import type { ExecutionResult, Executor } from "../src/executor.ts";
import { fixture, MemoryStore, message, type Respond } from "./helpers.ts";

async function parent(t: test.TestContext, respond: Respond, options: {
  mode?: "tui" | "print";
  tools?: string[];
  executor?: Executor;
  extra?: (pi: ExtensionAPI) => void;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "subagent-integration-"));
  const { runtime, model } = await fixture(respond);
  const store = new MemoryStore();
  const events = createEventBus();
  const errors: string[] = [];
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({
    cwd: root, agentDir: root, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    eventBus: events,
    systemPrompt: "PARENT_ONLY_SENTINEL. Delegate the requested fixture task.",
    extensionFactories: [(pi) => { registerSubagent(pi, { store: () => store, executor: options.executor }); options.extra?.(pi); }],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: root, agentDir: root, modelRuntime: runtime, model,
    tools: options.tools ?? ["read", "write", "bash", "subagent"],
    resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(root),
  });
  await session.bindExtensions({ mode: options.mode ?? "print", onError: (error) => errors.push(String(error.error)) });
  t.after(async () => {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    await session.abort();
    session.dispose();
    await rm(root, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  return { session, store, events, root };
}

const childTask = "CHILD_TASK";
const request = (arguments_: Record<string, unknown>) => ({ type: "toolCall" as const, id: "delegate-1", name: "subagent", arguments: arguments_ });
function latestUser(context: Parameters<Respond>[1]): string {
  return JSON.stringify(context.messages.findLast((msg) => msg.role === "user")?.content);
}

test("real Pi extension + headless parent + child SDK complete a delegation", async (t) => {
  let childCalled = false;
  const { session, store, events } = await parent(t, (model, context) => {
    if (latestUser(context).includes(childTask)) {
      childCalled = true;
      assert.ok(!context.systemPrompt?.includes("PARENT_ONLY_SENTINEL"));
      assert.deepEqual(context.tools?.map((tool) => tool.name), ["read"]);
      return message(model, [{ type: "text", text: "Child evidence." }]);
    }
    if (!context.messages.some((msg) => msg.role === "toolResult")) {
      return message(model, [request({ action: "spawn", task: childTask, label: "Inspect fixture" })], "toolUse");
    }
    return message(model, [{ type: "text", text: "Parent accepted the evidence." }]);
  });
  const changes: unknown[] = [];
  events.on(CHANGED_EVENT, (event) => changes.push(event));
  await session.prompt("Run the delegation fixture.");
  const tool = session.messages.find((msg) => msg.role === "toolResult");
  assert.ok(tool && tool.role === "toolResult");
  assert.equal(tool.isError, false, JSON.stringify(tool));
  assert.equal(childCalled, true);
  const run = [...store.snapshots.values()][0];
  assert.equal(run.state, "completed");
  assert.equal(store.outputs.get(run.id), "Child evidence.");
  assert.ok(changes.length >= 3);
  let reply: unknown;
  events.emit(REQUEST_EVENT, { version: 1, parentSessionId: session.sessionId, action: "status", id: run.id, reply: (value: unknown) => { reply = value; } });
  assert.equal((reply as { runs: RunSnapshot[] }).runs[0].state, "completed");
  reply = undefined;
  events.emit(REQUEST_EVENT, { version: 1, parentSessionId: "different-parent", action: "cancel", id: run.id, reply: (value: unknown) => { reply = value; } });
  assert.equal(reply, undefined);
});

test("host disabled and overridden tools cannot be escalated through child SDK", async (t) => {
  for (const override of [false, true]) {
    const { session, store } = await parent(t, (model, context) => {
      if (!context.messages.some((msg) => msg.role === "toolResult")) return message(model, [request({ action: "spawn", task: childTask, tools: ["write"] })], "toolUse");
      return message(model, [{ type: "text", text: "Permission denied." }]);
    }, {
      tools: override ? ["read", "write", "subagent"] : ["read", "subagent"],
      extra: override ? (pi) => { pi.registerTool({ name: "write", label: "Restricted write", description: "A host policy wrapper", parameters: Type.Object({}), async execute() { throw new Error("must not bypass"); } }); } : undefined,
    });
    await session.prompt("Attempt a restricted delegation.");
    const tool = session.messages.find((msg) => msg.role === "toolResult");
    assert.ok(tool && tool.role === "toolResult");
    assert.equal(tool.isError, true);
    assert.match(JSON.stringify(tool.content), /unavailable|native host built-in/);
    assert.equal(store.snapshots.size, 0);
  }
});

test("invalid action fields and non-empty task validation produce tool errors", async (t) => {
  for (const args of [{ action: "status", task: "invalid" }, { action: "spawn", task: "  " }, { action: "wait", ids: ["missing"], timeoutMs: 100000 }]) {
    const { session } = await parent(t, (model, context) => context.messages.some((msg) => msg.role === "toolResult")
      ? message(model, [{ type: "text", text: "Request was rejected." }])
      : message(model, [request(args)], "toolUse"));
    await session.prompt("Exercise invalid arguments.");
    const tool = session.messages.find((msg) => msg.role === "toolResult");
    assert.ok(tool && tool.role === "toolResult" && tool.isError);
  }
});

test("TUI completion sends a parent-owned notification and supports optional observers", async (t) => {
  const gate = Promise.withResolvers<ExecutionResult>();
  const { session, store, events } = await parent(t, (model, context) => {
    if (!context.messages.some((msg) => msg.role === "toolResult")) return message(model, [request({ action: "spawn", task: childTask })], "toolUse");
    return message(model, [{ type: "text", text: "Parent response." }]);
  }, { mode: "tui", executor: async () => gate.promise });
  await session.prompt("Start an asynchronous task.");
  const run = [...store.snapshots.values()][0];
  assert.equal(run.state, "running");
  const notified = Promise.withResolvers<void>();
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "custom" && event.message.customType === "pi-subagent-result") notified.resolve();
  });
  // Pi logs observer failures; assert that expected diagnostic without noisy test output.
  const diagnostic = t.mock.method(console, "error", () => {});
  events.on(CHANGED_EVENT, () => { throw new Error("observer failure"); });
  gate.resolve({ output: "Async evidence." });
  await notified.promise;
  unsubscribe();
  assert.equal(store.snapshots.get(run.id)?.state, "completed");
  assert.equal(store.snapshots.get(run.id)?.notification, "accepted");
  assert.ok(diagnostic.mock.calls.some((call) => JSON.stringify(call.arguments).includes("Event handler error")));
});

test("parent mutation barrier blocks writes until the child writer has settled", async (t) => {
  const { session, store } = await parent(t, (model, context) => {
    const results = context.messages.filter((msg) => msg.role === "toolResult");
    if (results.length === 0) return message(model, [request({ action: "spawn", task: childTask, tools: ["write"] })], "toolUse");
    if (results.length === 1) return message(model, [{ type: "toolCall", id: "parent-write", name: "write", arguments: { path: "overlap.txt", content: "no" } }], "toolUse");
    return message(model, [{ type: "text", text: "Writer barrier checked." }]);
  }, { mode: "tui", executor: async (_input, signal) => {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    return { output: "Cancelled." };
  } });
  await session.prompt("Try overlapping parent writes.");
  const results = session.messages.filter((msg) => msg.role === "toolResult");
  assert.equal(results[1].isError, true);
  assert.match(JSON.stringify(results[1].content), /delegated writer/);
  await session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
  assert.equal([...store.snapshots.values()][0].state, "cancelled");
  assert.ok(!session.messages.some((msg) => msg.role === "custom" && msg.customType === "pi-subagent-result"));
});

test("a writer launch cannot race a sibling parent mutation in one preflight batch", async (t) => {
  let launched = false;
  const { session, store } = await parent(t, (model, context) => {
    if (!context.messages.some((msg) => msg.role === "toolResult")) return message(model, [
      request({ action: "spawn", task: childTask, tools: ["write"] }),
      { type: "toolCall", id: "sibling-write", name: "write", arguments: { path: "parent.txt", content: "parent-owned" } },
    ], "toolUse");
    return message(model, [{ type: "text", text: "Writer launch was rejected." }]);
  }, { mode: "tui", executor: async () => { launched = true; return { output: "must not run" }; } });
  await session.prompt("Exercise sibling mutation safety.");
  const results = session.messages.filter((msg) => msg.role === "toolResult");
  assert.equal(results[0].isError, true);
  assert.match(JSON.stringify(results[0].content), /same tool batch/);
  assert.equal(launched, false);
  assert.equal(store.snapshots.size, 0);
});

test("optional list discovery works before any run without creating artifacts", async (t) => {
  const { session, store, events } = await parent(t, (model) => message(model, [{ type: "text", text: "Ready." }]));
  let response: unknown;
  events.emit(REQUEST_EVENT, { version: 1, parentSessionId: session.sessionId, action: "list", reply: (result: unknown) => { response = result; } });
  assert.deepEqual(response, { runs: [] });
  assert.equal(store.snapshots.size, 0);
});

test("failed TUI message delivery preserves the completed result and reports notification failure", async (t) => {
  const gate = Promise.withResolvers<ExecutionResult>();
  const { session, store, events } = await parent(t, (model, context) => context.messages.some((msg) => msg.role === "toolResult")
    ? message(model, [{ type: "text", text: "Task launched." }])
    : message(model, [request({ action: "spawn", task: childTask })], "toolUse"), {
    mode: "tui", executor: async () => gate.promise,
    extra(pi) { pi.sendMessage = () => { throw new Error("Synthetic send failure"); }; },
  });
  await session.prompt("Start a task with a failed delivery transport.");
  const run = [...store.snapshots.values()][0];
  const failed = Promise.withResolvers<void>();
  events.on(CHANGED_EVENT, () => { if (store.snapshots.get(run.id)?.notification === "failed") failed.resolve(); });
  gate.resolve({ output: "Retained evidence." });
  await failed.promise;
  assert.equal(store.snapshots.get(run.id)?.state, "completed");
  assert.equal(store.outputs.get(run.id), "Retained evidence.");
});
