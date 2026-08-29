import type { ProjectSummary, TaskSummary } from "@pideck/domain";

export const IPC_VERSION = 1 as const;

export type AuthMethod = "api-key" | "oauth";
export type PermissionMode = "ask" | "allow" | "deny" | "yolo";
export type AppLanguage = "zh" | "en";
export type WindowTheme = "light" | "dark";

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

export type SessionChangeFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface SessionChangeFile {
  path: string;
  previousPath?: string;
  status: SessionChangeFileStatus;
  additions: number;
  deletions: number;
  patch?: string;
  patchAvailable: boolean;
  binary: boolean;
  truncated: boolean;
  oldMode?: string;
  newMode?: string;
}

export interface SessionChangeReview {
  schemaVersion: 2;
  id: string;
  state: "running" | "completed";
  outcome?: "succeeded" | "failed" | "aborted";
  startedAt: number;
  endedAt: number;
  files: SessionChangeFile[];
  additions: number;
  deletions: number;
  truncated: boolean;
  fileCountTruncated: boolean;
  omittedFiles?: number;
}

export type SessionChangeReviewAvailability = "available" | "not-git" | "error";
export type SessionChangeReviewUnavailableReason =
  | "git-not-found"
  | "git-timeout"
  | "git-inspection-failed"
  | "diff-api-unavailable"
  | "review-data-invalid"
  | "review-storage-failed";

export interface SessionChangeReviewCollection {
  availability: SessionChangeReviewAvailability;
  reason?: SessionChangeReviewUnavailableReason;
  reviews: SessionChangeReview[];
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

export interface AgentPromptResult {
  disposition: "completed" | "queued" | "extension-command";
}
export type QueueMode = "all" | "one-at-a-time";

export interface AgentQueuedMessage {
  id: string;
  text: string;
  images: PromptImage[];
}

export interface AgentQueueState {
  steering: AgentQueuedMessage[];
  followUp: AgentQueuedMessage[];
  steeringMode: QueueMode;
  followUpMode: QueueMode;
}

export interface PiSettingsSummary {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel: string;
  transport: "auto" | "sse" | "websocket";
  compactionEnabled: boolean;
  steeringMode: QueueMode;
  followUpMode: QueueMode;
}

export type PiSettingsUpdate = Partial<PiSettingsSummary>;

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
    setWindowTheme(theme: WindowTheme): Promise<void>;
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
    changeReviews(taskId: string, cwd?: string): Promise<SessionChangeReviewCollection>;
    changeReview(taskId: string, reviewId: string, cwd?: string): Promise<SessionChangeReview | null>;
    capabilities(taskId?: string, cwd?: string): Promise<SessionCapabilities>;
    compact(taskId: string, instructions?: string, cwd?: string): Promise<unknown>;
    reload(taskId: string, cwd?: string): Promise<SessionCapabilities>;
    export(taskId: string, format: "jsonl" | "html", cwd?: string): Promise<{ path: string; reviewPath?: string }>;
    import(taskId: string | undefined, cwd?: string): Promise<ImportedSessionSummary | null>;
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
    login(providerId: string, method: AuthMethod, secret?: string, authOperationId?: string): Promise<void>;
    cancelLogin(authOperationId: string): Promise<void>;
    logout(providerId: string): Promise<void>;
    setApiKey(providerId: string, apiKey: string): Promise<void>;
    resolveAuth(requestId: string, value: string, cancelled?: boolean): Promise<void>;
    openAuthUrl(url: string): Promise<void>;
  };
  agent: {
    prompt(taskId: string, text: string, cwd?: string, images?: PromptImage[], delivery?: QueueDelivery): Promise<AgentPromptResult>;
    executeBash(taskId: string, command: string, excludeFromContext?: boolean, cwd?: string): Promise<{ output: string; exitCode: number | null; cancelled: boolean }>;
    abort(taskId: string, cwd?: string): Promise<void>;
    setThinkingLevel(taskId: string, level: string, cwd?: string): Promise<void>;
    setModel(taskId: string, providerId: string, modelId: string, cwd?: string): Promise<void>;
    setScopedModels(taskId: string, modelIds: string[] | null, persist?: boolean, cwd?: string): Promise<string[]>;
    queue(taskId: string, cwd?: string): Promise<AgentQueueState>;
    setQueueModes(taskId: string, modes: { steeringMode?: QueueMode; followUpMode?: QueueMode }, cwd?: string): Promise<AgentQueueState>;
    clearQueue(taskId: string, cwd?: string): Promise<AgentQueueState>;
    promoteQueue(taskId: string, followUpIndex: number, cwd?: string): Promise<AgentQueueState>;
    editQueue(taskId: string, messageId: string, text: string, images?: PromptImage[], cwd?: string): Promise<AgentQueueState>;
    deleteQueue(taskId: string, messageId: string, cwd?: string): Promise<AgentQueueState>;
  };
  settings: {
    get(cwd?: string): Promise<PiSettingsSummary>;
    update(settings: PiSettingsUpdate, cwd?: string): Promise<PiSettingsSummary>;
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
  type: "agent.event" | "runtime.status" | "runtime.error" | "auth.event" | "approval.requested" | "approval.resolved" | "extension.ui.request" | "extension.ui.notify";
  taskId?: string;
  requestId?: string;
  event?: unknown;
  payload?: unknown;
}

export type PiHostCommand =
  | "runtime.status"
  | "runtime.shutdown"
  | "app.changelog"
  | "app.info"
  | "projects.list"
  | "projects.setTrust"
  | "sessions.list"
  | "sessions.create"
  | "sessions.delete"
  | "sessions.messages"
  | "sessions.runMetadata"
  | "sessions.changeReviews"
  | "sessions.changeReview"
  | "sessions.capabilities"
  | "sessions.compact"
  | "sessions.reload"
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
  | "providers.cancelLogin"
  | "providers.setApiKey"
  | "providers.logout"
  | "providers.auth-response"
  | "agent.prompt"
  | "agent.executeBash"
  | "agent.abort"
  | "agent.setThinkingLevel"
  | "agent.setModel"
  | "agent.setScopedModels"
  | "agent.queue"
  | "agent.setQueueModes"
  | "agent.clearQueue"
  | "agent.promoteQueue"
  | "agent.editQueue"
  | "agent.deleteQueue"
  | "settings.get"
  | "settings.update"
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

type PiHostPayloadField =
  | "string"
  | "boolean"
  | "number"
  | "string[]"
  | "string[]|null"
  | "images"
  | "object"
  | "model"
  | "ui-value"
  | `enum:${string}`;

type PiHostPayloadSpec = {
  fields: Record<string, PiHostPayloadField>;
  required?: readonly string[];
  allowUndefined?: boolean;
};

const piHostPayloadSpecs: Partial<Record<PiHostCommand, PiHostPayloadSpec>> = {
  "runtime.status": { fields: {}, allowUndefined: true },
  "runtime.shutdown": { fields: {}, allowUndefined: true },
  "app.changelog": { fields: {}, allowUndefined: true },
  "app.info": { fields: {}, allowUndefined: true },
  "projects.list": { fields: { knownCwds: "string[]" } },
  "projects.setTrust": { fields: { cwd: "string", trusted: "boolean" }, required: ["cwd", "trusted"] },
  "sessions.list": { fields: { cwd: "string" } },
  "sessions.create": { fields: { cwd: "string", name: "string" } },
  "sessions.delete": { fields: { taskId: "string", cwd: "string" }, required: ["taskId"] },
  "sessions.messages": { fields: { taskId: "string", cwd: "string" }, required: ["taskId"] },
  "sessions.runMetadata": { fields: { taskId: "string", cwd: "string" }, required: ["taskId"] },
  "sessions.changeReviews": { fields: { taskId: "string", cwd: "string" }, required: ["taskId"] },
  "sessions.changeReview": { fields: { taskId: "string", reviewId: "string", cwd: "string" }, required: ["taskId", "reviewId"] },
  "sessions.capabilities": { fields: { taskId: "string", cwd: "string" } },
  "sessions.compact": { fields: { taskId: "string", instructions: "string", cwd: "string" }, required: ["taskId"] },
  "sessions.reload": { fields: { taskId: "string", cwd: "string" }, required: ["taskId"] },
  "sessions.export": { fields: { taskId: "string", format: "enum:jsonl|html", cwd: "string" }, required: ["taskId", "format"] },
  "sessions.import": { fields: { taskId: "string", inputPath: "string", cwd: "string" }, required: ["inputPath"] },
  "sessions.rename": { fields: { taskId: "string", name: "string", cwd: "string" }, required: ["taskId", "name"] },
  "sessions.generateTitle": { fields: { taskId: "string", message: "string", cwd: "string", model: "model" }, required: ["taskId", "message"] },
  "sessions.stats": { fields: { taskId: "string", cwd: "string" }, required: ["taskId"] },
  "sessions.share": { fields: { taskId: "string", cwd: "string" }, required: ["taskId"] },
  "models.list": { fields: {}, allowUndefined: true },
  "workspace.snapshot": { fields: { cwd: "string" }, required: ["cwd"] },
  "providers.list": { fields: {}, allowUndefined: true },
  "providers.login": { fields: { providerId: "string", method: "enum:api-key|oauth", secret: "string", authOperationId: "string" }, required: ["providerId", "method"] },
  "providers.cancelLogin": { fields: { authOperationId: "string" }, required: ["authOperationId"] },
  "providers.setApiKey": { fields: { providerId: "string", secret: "string" }, required: ["providerId", "secret"] },
  "providers.logout": { fields: { providerId: "string" }, required: ["providerId"] },
  "providers.auth-response": { fields: { requestId: "string", value: "string", cancelled: "boolean" }, required: ["requestId", "value"] },
  "agent.prompt": { fields: { taskId: "string", text: "string", cwd: "string", images: "images", delivery: "enum:steer|followUp" }, required: ["taskId"] },
  "agent.executeBash": { fields: { taskId: "string", command: "string", excludeFromContext: "boolean", cwd: "string" }, required: ["taskId", "command"] },
  "agent.abort": { fields: { taskId: "string", cwd: "string" }, required: ["taskId"] },
  "agent.setThinkingLevel": { fields: { taskId: "string", level: "string", cwd: "string" }, required: ["taskId", "level"] },
  "agent.setModel": { fields: { taskId: "string", providerId: "string", modelId: "string", cwd: "string" }, required: ["taskId", "providerId", "modelId"] },
  "agent.setScopedModels": { fields: { taskId: "string", modelIds: "string[]|null", persist: "boolean", cwd: "string" }, required: ["taskId", "modelIds"] },
  "agent.queue": { fields: { taskId: "string", cwd: "string" }, required: ["taskId"] },
  "agent.setQueueModes": { fields: { taskId: "string", steeringMode: "enum:all|one-at-a-time", followUpMode: "enum:all|one-at-a-time", cwd: "string" }, required: ["taskId"] },
  "agent.clearQueue": { fields: { taskId: "string", cwd: "string" }, required: ["taskId"] },
  "agent.promoteQueue": { fields: { taskId: "string", followUpIndex: "number", cwd: "string" }, required: ["taskId", "followUpIndex"] },
  "agent.editQueue": { fields: { taskId: "string", messageId: "string", text: "string", images: "images", cwd: "string" }, required: ["taskId", "messageId", "text"] },
  "agent.deleteQueue": { fields: { taskId: "string", messageId: "string", cwd: "string" }, required: ["taskId", "messageId"] },
  "settings.get": { fields: { cwd: "string" } },
  "settings.update": { fields: { cwd: "string", defaultProvider: "string", defaultModel: "string", defaultThinkingLevel: "string", transport: "enum:auto|sse|websocket", compactionEnabled: "boolean", steeringMode: "enum:all|one-at-a-time", followUpMode: "enum:all|one-at-a-time" } },
  "extension.ui.resolve": { fields: { requestId: "string", value: "ui-value" }, required: ["requestId"] },
  "packages.list": { fields: { cwd: "string" } },
  "packages.install": { fields: { source: "string", local: "boolean", cwd: "string" }, required: ["source"] },
  "packages.remove": { fields: { source: "string", local: "boolean", cwd: "string" }, required: ["source"] },
  "packages.update": { fields: { source: "string", cwd: "string" } },
  "packages.configure": { fields: { source: "string", enabled: "boolean", local: "boolean", cwd: "string" }, required: ["source", "enabled"] },
  "permissions.status": { fields: {}, allowUndefined: true },
  "permissions.setMode": { fields: { mode: "enum:ask|allow|deny|yolo" }, required: ["mode"] },
  "approval.resolve": { fields: { requestId: "string", decision: "enum:allow-once|deny" }, required: ["requestId", "decision"] },
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertPiHostField(value: unknown, field: string, kind: PiHostPayloadField): void {
  if (kind === "string") {
    if (typeof value !== "string") throw new Error(`${field} must be a string`);
    return;
  }
  if (kind === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
    return;
  }
  if (kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
    return;
  }
  if (kind === "string[]") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${field} must be an array of strings`);
    return;
  }
  if (kind === "string[]|null") {
    if (value !== null && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) throw new Error(`${field} must be an array of strings or null`);
    return;
  }
  if (kind === "images") {
    if (!Array.isArray(value) || value.some((item) => !isPlainRecord(item) || typeof item.data !== "string" || typeof item.mimeType !== "string")) {
      throw new Error(`${field} must be an array of image DTOs`);
    }
    return;
  }
  if (kind === "object") {
    if (!isPlainRecord(value) && typeof value !== "string" && typeof value !== "boolean" && value !== undefined) throw new Error(`${field} must be serializable`);
    return;
  }
  if (kind === "model") {
    if (!isPlainRecord(value) || typeof value.providerId !== "string" || typeof value.modelId !== "string") throw new Error(`${field} must be a model DTO`);
    return;
  }
  if (kind === "ui-value") {
    if (value !== undefined && typeof value !== "string" && typeof value !== "boolean") throw new Error(`${field} must be a string, boolean, or undefined`);
    return;
  }
  const allowed = kind.slice("enum:".length).split("|");
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${field} has an unsupported value`);
}

/**
 * Runtime validation for the structured-clone boundary. TypeScript protects
 * PiDeck's own callers, but this boundary also receives JavaScript values from
 * Electron IPC and must reject coercible or unknown shapes explicitly.
 */
export function validatePiHostPayload(command: PiHostCommand, payload: unknown): unknown {
  const spec = piHostPayloadSpecs[command];
  if (!spec) throw new Error(`Unsupported PiHost command: ${command}`);
  if (payload === undefined) {
    if (spec.allowUndefined || Object.keys(spec.fields).length === 0) return undefined;
    throw new Error(`${command} payload is required`);
  }
  if (!isPlainRecord(payload)) throw new Error(`${command} payload must be an object`);
  for (const key of Object.keys(payload)) {
    if (!(key in spec.fields)) throw new Error(`${command} payload contains unknown field: ${key}`);
    if (payload[key] === undefined) continue;
    assertPiHostField(payload[key], key, spec.fields[key]);
  }
  for (const required of spec.required ?? []) {
    if (!(required in payload) || payload[required] === undefined) throw new Error(`${command} requires ${required}`);
  }
  return payload;
}
