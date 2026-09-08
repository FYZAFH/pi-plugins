import { InMemoryCredentialStore, InMemoryModelsStore, createAssistantMessageEventStream, type Api, type AssistantMessage, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ExecutionInput } from "../src/executor.ts";
import type { RunStore } from "../src/store.ts";
import type { RunSnapshot } from "../src/protocol.ts";

export function message(model: Model<Api>, content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return {
    role: "assistant", content, stopReason, api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    timestamp: Date.now(),
  };
}
export type Respond = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => Promise<AssistantMessage> | AssistantMessage;
export async function fixture(respond: Respond = (model) => message(model, [{ type: "text", text: "Verified fixture result." }])) {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
  });
  runtime.registerProvider("subagent-test", {
    api: "subagent-test", apiKey: "offline-placeholder", baseUrl: "http://127.0.0.1:1/unused",
    models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      void Promise.resolve().then(() => respond(model, context, options)).then((output) => {
        if (output.stopReason === "error" || output.stopReason === "aborted") stream.push({ type: "error", reason: output.stopReason, error: output });
        else if (output.stopReason !== "pending") stream.push({ type: "done", reason: output.stopReason, message: output });
        else throw new Error("Fixture cannot finish pending");
        stream.end();
      }).catch((error: unknown) => {
        stream.push({ type: "error", reason: "error", error: { ...message(model, [], "error"), errorMessage: String(error) } });
        stream.end();
      });
      return stream;
    },
  });
  const model = runtime.getModel("subagent-test", "fixture")!;
  const provider = runtime.getProvider("subagent-test")!;
  const input: ExecutionInput = {
    task: "Perform the fixture task.", cwd: process.cwd(), tools: ["read"],
    model, thinkingLevel: "off", provider,
    getAuth: () => runtime.getAuth("subagent-test"),
  };
  return { runtime, model, provider, input };
}

export class MemoryStore implements RunStore {
  snapshots = new Map<string, RunSnapshot>();
  outputs = new Map<string, string>();
  events: unknown[] = [];
  closed = false;
  create(id: string): string { return `/artifacts/${id}`; }
  save(snapshot: RunSnapshot): void { this.snapshots.set(snapshot.id, structuredClone(snapshot)); }
  output(id: string, text: string) { this.outputs.set(id, text); return { truncated: false }; }
  log(_id: string, event: unknown): void { this.events.push(event); }
  close(): void { this.closed = true; }
}
