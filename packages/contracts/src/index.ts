import type { ProjectSummary, TaskSummary } from "@pideck/domain";

export const IPC_VERSION = 1 as const;

export type AuthMethod = "api-key" | "oauth";

export interface ProviderSummary {
  id: string;
  name: string;
  authState: "configured" | "available" | "expired" | "missing";
  authMethods: AuthMethod[];
  modelCount: number;
}

export interface ModelSummary {
  id: string;
  providerId: string;
  providerName: string;
  name: string;
  reasoning: boolean;
  thinkingLevels: string[];
  authConfigured: boolean;
}

export interface SessionCapabilities {
  model?: ModelSummary;
  thinkingLevel: string;
  thinkingLevels: string[];
  slashCommands: Array<{ name: string; description?: string; argumentHint?: string }>;
  prompts: Array<{ name: string; description?: string }>;
  skills: Array<{ name: string; description?: string }>;
}

export interface WorkspaceFile {
  path: string;
  kind: "file" | "directory";
  size?: number;
}

export interface WorkspaceChange {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface WorkspaceSnapshot {
  cwd: string;
  files: WorkspaceFile[];
  changes: WorkspaceChange[];
  refreshedAt: string;
}

export interface PideckBridge {
  runtime: {
    status(): Promise<"connected" | "starting" | "disconnected">;
  };
  projects: {
    list(): Promise<ProjectSummary[]>;
  };
  sessions: {
    list(projectId?: string): Promise<TaskSummary[]>;
    create(input?: { cwd?: string; name?: string }): Promise<TaskSummary>;
    delete(taskId: string, cwd?: string): Promise<void>;
    remove(taskId: string, cwd?: string): Promise<void>;
    messages(taskId: string, cwd?: string): Promise<unknown[]>;
    capabilities(taskId?: string, cwd?: string): Promise<SessionCapabilities>;
    tree(taskId: string, cwd?: string): Promise<unknown[]>;
    navigate(taskId: string, entryId: string, cwd?: string): Promise<{ cancelled: boolean; editorText?: string }>;
    fork(taskId: string, entryId: string, cwd?: string): Promise<TaskSummary>;
    compact(taskId: string, instructions?: string, cwd?: string): Promise<unknown>;
    export(taskId: string, format: "jsonl" | "html", cwd?: string): Promise<{ path: string }>;
  };
  models: {
    list(): Promise<ModelSummary[]>;
  };
  workspace: {
    snapshot(cwd: string): Promise<WorkspaceSnapshot>;
  };
  terminal: {
    execute(taskId: string, command: string, cwd?: string): Promise<{ output: string; exitCode?: number; isError?: boolean }>;
  };
  providers: {
    list(): Promise<ProviderSummary[]>;
    login(providerId: string, method: AuthMethod, secret?: string): Promise<void>;
    logout(providerId: string): Promise<void>;
    setApiKey(providerId: string, apiKey: string): Promise<void>;
    resolveAuth(requestId: string, value: string): Promise<void>;
    openAuthUrl(url: string): Promise<void>;
  };
  agent: {
    prompt(taskId: string, text: string, cwd?: string): Promise<void>;
    abort(taskId: string): Promise<void>;
    setThinkingLevel(taskId: string, level: string, cwd?: string): Promise<void>;
    setModel(taskId: string, providerId: string, modelId: string, cwd?: string): Promise<void>;
  };
  events: {
    subscribe(listener: (event: PiDeckRuntimeEvent) => void): () => void;
  };
  approvals: {
    resolve(requestId: string, decision: "allow-once" | "deny"): Promise<void>;
  };
}

export interface PiDeckRuntimeEvent {
  type: "agent.event" | "runtime.status" | "auth.event" | "approval.requested";
  taskId?: string;
  requestId?: string;
  event?: unknown;
  payload?: unknown;
}

export type PiHostCommand =
  | "runtime.status"
  | "projects.list"
  | "sessions.list"
  | "sessions.create"
  | "sessions.delete"
  | "sessions.messages"
  | "sessions.capabilities"
  | "sessions.tree"
  | "sessions.navigate"
  | "sessions.fork"
  | "sessions.compact"
  | "sessions.export"
  | "models.list"
  | "workspace.snapshot"
  | "terminal.execute"
  | "providers.list"
  | "providers.login"
  | "providers.setApiKey"
  | "providers.logout"
  | "providers.auth-response"
  | "agent.prompt"
  | "agent.abort"
  | "agent.setThinkingLevel"
  | "agent.setModel"
  | "approval.resolve";

export interface PiHostRequest {
  id: string;
  command: PiHostCommand;
  payload?: unknown;
}

export interface PiHostResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
