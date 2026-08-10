import type { ProjectSummary, TaskSummary } from "@pideck/domain";

export const IPC_VERSION = 1 as const;

export type AuthMethod = "api-key" | "oauth";
export type PermissionMode = "ask" | "allow" | "deny" | "yolo";
export type AppLanguage = "zh" | "en";

export interface PermissionStatus {
  mode: PermissionMode;
  source: "pi-permission-system" | "pideck-fallback";
  configPath?: string;
}

export interface PromptImage {
  data: string;
  mimeType: string;
}

export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface ProviderSummary {
  id: string;
  name: string;
  authState: "configured" | "available" | "expired" | "missing";
  authMethod?: AuthMethod | null;
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
  contextUsage?: ContextUsage;
  scopedModels?: string[];
}

export interface PiSessionStats {
  sessionFile?: string;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: ContextUsage;
}

export interface SessionRunRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export interface ImportedSessionSummary {
  id: string;
  title: string;
  projectId: string;
  state: TaskSummary["state"];
  model: string;
  updatedAt: string;
}

export type QueueDelivery = "steer" | "followUp";
export type QueueMode = "all" | "one-at-a-time";

export interface AgentQueueState {
  steering: string[];
  followUp: string[];
  steeringMode: QueueMode;
  followUpMode: QueueMode;
}

export type ExtensionUiRequestKind = "select" | "confirm" | "input" | "editor";

export interface ExtensionUiRequest {
  requestId: string;
  taskId: string;
  kind: ExtensionUiRequestKind;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
}

export interface PiPackageSummary {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  updateAvailable?: boolean;
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
  app: {
    setLanguage(language: AppLanguage): Promise<void>;
    quit(): Promise<void>;
    setConfirmClose(enabled: boolean): Promise<void>;
    restartHost(): Promise<void>;
    onConfirmCloseChanged(listener: (enabled: boolean) => void): void;
    offConfirmCloseChanged(listener: (enabled: boolean) => void): void;
  };
  runtime: {
    status(): Promise<"connected" | "starting" | "disconnected">;
  };
  projects: {
    list(preferredCwd?: string): Promise<ProjectSummary[]>;
    chooseDirectory(): Promise<ProjectSummary | null>;
    remove(cwd: string): Promise<void>;
    setTrust(cwd: string, trusted: boolean): Promise<void>;
  };
  sessions: {
    list(projectId?: string): Promise<TaskSummary[]>;
    create(input?: { cwd?: string; name?: string }): Promise<TaskSummary>;
    delete(taskId: string, cwd?: string): Promise<void>;
    remove(taskId: string, cwd?: string): Promise<void>;
    messages(taskId: string, cwd?: string): Promise<unknown[]>;
    runMetadata(taskId: string, cwd?: string): Promise<SessionRunRecord[]>;
    capabilities(taskId?: string, cwd?: string): Promise<SessionCapabilities>;
    compact(taskId: string, instructions?: string, cwd?: string): Promise<unknown>;
    export(taskId: string, format: "jsonl" | "html", cwd?: string): Promise<{ path: string }>;
    import(taskId: string | undefined, inputPath?: string, cwd?: string): Promise<ImportedSessionSummary | null>;
    rename(taskId: string, name: string, cwd?: string): Promise<string>;
    generateTitle(taskId: string, message: string, cwd?: string, model?: { providerId: string; modelId: string }): Promise<string | null>;
    stats(taskId: string, cwd?: string): Promise<PiSessionStats>;
    share(taskId: string, cwd?: string): Promise<{ url: string; gistUrl: string }>;
    changelog(): Promise<string>;
  };
  models: {
    list(): Promise<ModelSummary[]>;
  };
  workspace: {
    snapshot(cwd: string): Promise<WorkspaceSnapshot>;
  };
  providers: {
    list(): Promise<ProviderSummary[]>;
    login(providerId: string, method: AuthMethod, secret?: string): Promise<void>;
    logout(providerId: string): Promise<void>;
    setApiKey(providerId: string, apiKey: string): Promise<void>;
    resolveAuth(requestId: string, value: string, cancelled?: boolean): Promise<void>;
    openAuthUrl(url: string): Promise<void>;
  };
  agent: {
    prompt(taskId: string, text: string, cwd?: string, images?: PromptImage[], delivery?: QueueDelivery): Promise<void>;
    abort(taskId: string): Promise<void>;
    setThinkingLevel(taskId: string, level: string, cwd?: string): Promise<void>;
    setModel(taskId: string, providerId: string, modelId: string, cwd?: string): Promise<void>;
    setScopedModels(taskId: string, modelIds: string[] | null, persist?: boolean, cwd?: string): Promise<string[]>;
    queue(taskId: string, cwd?: string): Promise<AgentQueueState>;
    setQueueModes(taskId: string, modes: { steeringMode?: QueueMode; followUpMode?: QueueMode }, cwd?: string): Promise<AgentQueueState>;
    clearQueue(taskId: string, cwd?: string): Promise<AgentQueueState>;
    promoteQueue(taskId: string, followUpIndex: number, cwd?: string): Promise<AgentQueueState>;
  };
  extensions: {
    resolveUi(requestId: string, value: string | boolean | undefined): Promise<void>;
  };
  packages: {
    list(cwd?: string): Promise<PiPackageSummary[]>;
    install(source: string, local?: boolean, cwd?: string): Promise<void>;
    remove(source: string, local?: boolean, cwd?: string): Promise<void>;
    update(source?: string, cwd?: string): Promise<void>;
    configure(source: string, enabled: boolean, local?: boolean, cwd?: string): Promise<void>;
  };
  events: {
    subscribe(listener: (event: PiDeckRuntimeEvent) => void): () => void;
  };
  approvals: {
    resolve(requestId: string, decision: "allow-once" | "deny"): Promise<void>;
  };
  permissions: {
    status(): Promise<PermissionStatus>;
    setMode(mode: PermissionMode): Promise<PermissionStatus>;
  };
}

export interface PiDeckRuntimeEvent {
  type: "agent.event" | "runtime.status" | "auth.event" | "approval.requested" | "approval.resolved" | "extension.ui.request" | "extension.ui.notify";
  taskId?: string;
  requestId?: string;
  event?: unknown;
  payload?: unknown;
}

export type PiHostCommand =
  | "runtime.status"
  | "app.changelog"
  | "app.info"
  | "projects.list"
  | "projects.setTrust"
  | "sessions.list"
  | "sessions.create"
  | "sessions.delete"
  | "sessions.messages"
  | "sessions.runMetadata"
  | "sessions.capabilities"
  | "sessions.compact"
  | "sessions.export"
  | "sessions.import"
  | "sessions.rename"
  | "sessions.generateTitle"
  | "sessions.stats"
  | "sessions.share"
  | "models.list"
  | "workspace.snapshot"
  | "providers.list"
  | "providers.login"
  | "providers.setApiKey"
  | "providers.logout"
  | "providers.auth-response"
  | "agent.prompt"
  | "agent.abort"
  | "agent.setThinkingLevel"
  | "agent.setModel"
  | "agent.setScopedModels"
  | "agent.queue"
  | "agent.setQueueModes"
  | "agent.clearQueue"
  | "agent.promoteQueue"
  | "extension.ui.resolve"
  | "packages.list"
  | "packages.install"
  | "packages.remove"
  | "packages.update"
  | "packages.configure"
  | "approval.resolve"
  | "permissions.status"
  | "permissions.setMode";

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
