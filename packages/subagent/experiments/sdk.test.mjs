import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

// Use an explicit installed SDK or an ordinary local dependency. Never read credentials.
const sdkUrl = process.env.PI_SDK_PACKAGE_DIR
  ? pathToFileURL(join(process.env.PI_SDK_PACKAGE_DIR, "dist/index.js")).href
  : import.meta.resolve("@earendil-works/pi-coding-agent");
const sdk = await import(sdkUrl);
const { createAssistantMessageEventStream } = await import(
  import.meta.resolve("@earendil-works/pi-ai", sdkUrl)
);

const usage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function reply(model, content, stopReason = "stop") {
  return {
    role: "assistant", content, stopReason, usage: structuredClone(usage),
    api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
  };
}

function finish(stream, message) {
  if (["error", "aborted"].includes(message.stopReason)) {
    stream.push({ type: "error", reason: message.stopReason, error: message });
  } else {
    stream.push({ type: "done", reason: message.stopReason, message });
  }
  stream.end();
}

function explicitResources() {
  const extensions = { extensions: [], errors: [], runtime: sdk.createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "Execute only the assigned task. Report evidence and unresolved issues.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources() {},
    async reload() {},
  };
}

function finalAssistant(session) {
  return session.messages.findLast((message) => message.role === "assistant");
}

await test("Pi SDK delegation feasibility (offline)", { timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagent-sdk-"));
  const sessions = new Set();
  t.after(async () => {
    for (const session of sessions) {
      await session.abort();
      session.dispose();
    }
    await rm(root, { recursive: true, force: true });
  });

  const modelRuntime = await sdk.ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: join(root, "models.json"),
    modelsStorePath: join(root, "models-store.json"),
    allowModelNetwork: false,
  });
  const observed = [];
  let respond = (model, context, _options, stream) => {
    finish(stream, reply(model, [{ type: "text", text: context.messages.at(-1).content[0].text }]));
  };
  modelRuntime.registerProvider("subagent-offline-spike", {
    baseUrl: "http://127.0.0.1:1/never-used",
    apiKey: "offline-test-placeholder",
    api: "subagent-offline-spike",
    models: [{
      id: "fixture", name: "Offline fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000, maxTokens: 4096,
    }],
    streamSimple(model, context, options) {
      observed.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) });
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => respond(model, context, options, stream));
      return stream;
    },
  });
  const model = modelRuntime.getModel("subagent-offline-spike", "fixture");
  assert.ok(model);

  async function create(tools = ["read", "grep", "find", "ls"], persistent = false) {
    const { session } = await sdk.createAgentSession({
      cwd: root,
      agentDir: root,
      modelRuntime,
      model,
      thinkingLevel: "off",
      tools,
      resourceLoader: explicitResources(),
      settingsManager: sdk.SettingsManager.inMemory({
        compaction: { enabled: false }, retry: { enabled: false },
      }),
      sessionManager: persistent
        ? sdk.SessionManager.create(root, join(root, "sessions"))
        : sdk.SessionManager.inMemory(root),
    });
    sessions.add(session);
    return session;
  }

  await t.test("fresh sessions do not share messages or discover ambient resources", async () => {
    await mkdir(join(root, ".pi/extensions"), { recursive: true });
    await writeFile(join(root, ".pi/extensions/trap.ts"), "throw new Error('Ambient extension loaded');\n");
    await writeFile(join(root, "AGENTS.md"), "AMBIENT_CONTEXT_SENTINEL\n");
    const first = await create();
    const second = await create();
    assert.notEqual(first.sessionId, second.sessionId);
    await Promise.all([
      first.prompt("FIRST_PRIVATE_TASK", { expandPromptTemplates: false }),
      second.prompt("SECOND_PRIVATE_TASK", { expandPromptTemplates: false }),
    ]);
    assert.equal(finalAssistant(first).content[0].text, "FIRST_PRIVATE_TASK");
    assert.equal(finalAssistant(second).content[0].text, "SECOND_PRIVATE_TASK");
    assert.ok(!JSON.stringify(second.messages).includes("FIRST_PRIVATE_TASK"));
    assert.ok(!observed.at(-1).systemPrompt.includes("AMBIENT_CONTEXT_SENTINEL"));
    assert.deepEqual(second.agent.state.tools.map((tool) => tool.name).sort(), ["find", "grep", "ls", "read"]);
  });

  await t.test("read tool resolves files against the child cwd", async () => {
    await writeFile(join(root, "fixture.txt"), "CHILD_CWD_EVIDENCE\n");
    let calls = 0;
    respond = (model, _context, _options, stream) => {
      finish(stream, ++calls === 1
        ? reply(model, [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "fixture.txt" } }], "toolUse")
        : reply(model, [{ type: "text", text: "Read completed." }]));
    };
    const session = await create();
    await session.prompt("Read fixture.txt.", { expandPromptTemplates: false });
    const result = session.messages.find((message) => message.role === "toolResult");
    assert.equal(result.isError, false);
    assert.ok(result.content[0].text.includes("CHILD_CWD_EVIDENCE"));
  });

  await t.test("unavailable mutation tools cannot execute even if the model requests them", async () => {
    let calls = 0;
    respond = (model, _context, _options, stream) => {
      finish(stream, ++calls === 1
        ? reply(model, [{ type: "toolCall", id: "write-1", name: "write", arguments: { path: "forbidden.txt", content: "unsafe" } }], "toolUse")
        : reply(model, [{ type: "text", text: "Write was unavailable." }]));
    };
    const session = await create();
    await session.prompt("Exercise the tool allowlist.", { expandPromptTemplates: false });
    assert.equal(session.messages.find((message) => message.role === "toolResult").isError, true);
    await assert.rejects(readFile(join(root, "forbidden.txt")), { code: "ENOENT" });
  });

  await t.test("prompt resolution alone does not imply model success", async () => {
    respond = (model, _context, _options, stream) => {
      finish(stream, { ...reply(model, [], "error"), errorMessage: "Synthetic provider failure" });
    };
    const session = await create();
    await session.prompt("Exercise provider failure.", { expandPromptTemplates: false });
    assert.equal(finalAssistant(session).stopReason, "error");
    assert.match(finalAssistant(session).errorMessage, /Synthetic provider failure/);
  });

  await t.test("abort reaches the provider and settles the prompt", async () => {
    const started = Promise.withResolvers();
    respond = (model, _context, options, stream) => {
      assert.ok(options.signal);
      const stop = () => finish(stream, reply(model, [], "aborted"));
      if (options.signal.aborted) stop();
      else options.signal.addEventListener("abort", stop, { once: true });
      started.resolve();
    };
    const session = await create();
    const pending = session.prompt("Wait until cancelled.", { expandPromptTemplates: false });
    await Promise.race([
      started.promise,
      pending.then(() => { throw new Error(`Provider never started: ${JSON.stringify(finalAssistant(session))}`); }),
    ]);
    await session.abort();
    await pending;
    assert.equal(session.isStreaming, false);
    assert.equal(finalAssistant(session).stopReason, "aborted");
  });

  await t.test("persistent sessions retain final results and subscriptions can detach", async () => {
    respond = (model, _context, _options, stream) => finish(stream, reply(model, [
      { type: "text", text: "Evidence." }, { type: "text", text: "Limitations." },
    ]));
    const session = await create([], true);
    let events = 0;
    const unsubscribe = session.subscribe(() => events++);
    unsubscribe();
    await session.prompt("Return a report.", { expandPromptTemplates: false });
    assert.equal(events, 0);
    const output = finalAssistant(session).content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    assert.equal(output, "Evidence.\nLimitations.");
    const restored = sdk.SessionManager.open(session.sessionFile).buildSessionContext();
    assert.equal(restored.messages.at(-1).content.length, 2);
    session.dispose();
    session.dispose();
    sessions.delete(session);
  });
});
