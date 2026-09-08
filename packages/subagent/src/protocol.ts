// Optional integration contract. Importing this module does not load the extension.
export const PROTOCOL_VERSION = 1;
export const CHANGED_EVENT = "pi-plugins:subagent:changed";
export const REQUEST_EVENT = "pi-plugins:subagent:request";

export type RunState = "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled" | "timed_out" | "interrupted";
export type ToolName = "read" | "grep" | "find" | "ls" | "edit" | "write" | "bash";
export interface RunSnapshot {
  version: 1;
  id: string;
  parentSessionId: string;
  revision: number;
  label: string;
  cwd: string;
  workspace: string;
  tools: ToolName[];
  model: string;
  state: RunState;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  activity?: string;
  output?: string;
  error?: string;
  cancelReason?: "user" | "timeout" | "shutdown";
  artifactDir: string;
  outputTruncated?: boolean;
  notification?: "accepted" | "failed";
}
export type RunSummary = Omit<RunSnapshot, "output">;
export interface RunChanged {
  version: 1;
  parentSessionId: string;
  runId: string;
  revision: number;
  state: RunState;
}
export interface ControlRequest {
  version: 1;
  parentSessionId: string;
  action: "list" | "status" | "cancel";
  id?: string;
  reply: (result: { runs?: RunSnapshot[]; error?: string }) => void;
}
export function isTerminal(state: RunState): boolean {
  return !["queued", "running", "cancelling"].includes(state);
}
