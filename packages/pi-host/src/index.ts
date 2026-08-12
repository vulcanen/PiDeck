import type { PermissionMode, PiHostRequest, PiHostResponse, SessionRunRecord } from "@pideck/contracts";
import { deriveSessionTitle, isCommandDerivedSessionTitle, isDefaultSessionTitle } from "@pideck/domain";
import { getModelRuntime, loadPiSdk, modelSummary, resolvePiModule, sessionModelLabel } from "@pideck/pi-adapter";
import { PermissionEngine, resolvePermissionExtensionPath } from "@pideck/permission-engine";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const parentPort = (process as typeof process & {
  parentPort?: {
    on(event: "message", listener: (event: { data: unknown }) => void): void;
    postMessage(message: unknown): void;
  };
}).parentPort;
const sessionManagers = new Map<string, any>();
const sessionFiles = new Map<string, string>();
const titledSessions = new Set<string>();
const agentSessions = new Map<string, any>();
const agentSessionPromises = new Map<string, Promise<any>>();
const agentSessionPackageRevisions = new Map<string, number>();
const executionGroupStarts = new Map<string, number>();
const SESSION_RUN_METADATA_TYPE = "pideck.execution-run";
// `session.isStreaming` is updated by Pi asynchronously. Reserve a task as
// soon as a direct prompt is accepted so a second prompt arriving in that
// small window is queued instead of starting a competing run.
const agentRunReservations = new Set<string>();
// System prompt for LLM session-title generation. Matches the user's language,
// asks for a 3–8 word summary of intent (not a copy of the text), and demands
// the title alone with no quoting or markdown so extraction is trivial.
const SESSION_TITLE_SYSTEM_PROMPT = [
  "你是一个 AI 编程助手的会话标题生成器。根据用户的第一条消息，生成一个简洁、描述性的会话标题。",
  "规则：",
  "- 3 到 8 个词。",
  "- 概括用户意图，不要直接照搬原文。",
  "- 只输出标题本身，不要引号、不要结尾标点、不要 markdown、不要任何解释。",
  "- 使用与用户相同的语言。",
  "",
  "You are a session-title generator for an AI coding assistant. Given the user's first message, produce a concise, descriptive title.",
  "Rules:",
  "- 3 to 8 words.",
  "- Summarize the user's intent; do not just copy the text.",
  "- Output ONLY the title. No quotes, no trailing punctuation, no markdown, no explanation.",
  "- Match the user's language.",
].join("\n");
const capabilitySessions = new Map<string, any>();
let packageConfigRevision = 0;
type AuthWaiter = {
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
};
const authWaiters = new Map<string, AuthWaiter>();
const agentSessionRevisions = new Map<string, number>();
function normalizePackageInstallSource(source: string): string {
  const trimmed = source.trim();
  // Pi's package manager distinguishes npm packages with the `npm:` prefix.
  // Keep explicit paths and Git/URL sources untouched; a bare package name is
  // the common input users expect in the desktop package panel.
  if (/^(?:npm:|https?:\/\/|git\+|git@|ssh:\/\/|file:|~[\\/]|\.{0,2}[\\/]|[A-Za-z]:[\\/]|[\\/])/.test(trimmed)) return trimmed;
  if (/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+(?:@[^\s]+)?$/.test(trimmed)) return `npm:${trimmed}`;
  return trimmed;
}

function resolveWorkspaceCwd(): string {
  if (process.env.PIDECK_WORKSPACE_CWD) return process.env.PIDECK_WORKSPACE_CWD;
  let current = process.cwd();
  while (true) {
    const packagePath = path.join(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { workspaces?: unknown };
        if (packageJson.workspaces || existsSync(path.join(current, ".git"))) return current;
      } catch {
        // Continue walking up when a package manifest is not readable.
      }
    }
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

function send(response: PiHostResponse) {
  parentPort?.postMessage(response);
  process.send?.(response);
}

function emit(taskId: string, event: unknown) {
  parentPort?.postMessage({ type: "agent.event", taskId, event });
  process.send?.({ type: "agent.event", taskId, event });
}

function emitAuth(requestId: string, event: unknown) {
  parentPort?.postMessage({ type: "auth.event", requestId, event });
  process.send?.({ type: "auth.event", requestId, event });
}

/**
 * Adapt Pi's AuthInteraction to the renderer bridge. API-key login can supply
 * the value already entered in the settings form for the first prompt; any
 * additional provider-specific fields still use the normal interactive prompt.
 */
function createAuthInteraction(requestId: string, initialSecret?: string) {
  let initialSecretAvailable = Boolean(initialSecret);
  let promptSequence = 0;
  return {
    prompt: (prompt: any) => {
      if (initialSecretAvailable && prompt?.type !== "select") {
        initialSecretAvailable = false;
        return Promise.resolve(initialSecret as string);
      }
      const promptId = `${requestId}:${++promptSequence}`;
      emitAuth(promptId, { type: "prompt", prompt: jsonSafe(prompt) });
      return new Promise<string>((resolve, reject) => authWaiters.set(promptId, { resolve, reject }));
    },
    notify: (event: unknown) => emitAuth(requestId, { type: "notify", event: jsonSafe(event) }),
  };
}

async function persistProviderApiKey(runtime: any, providerId: string, apiKey: string, requestId: string): Promise<void> {
  const provider = runtime.getProvider?.(providerId);
  if (!provider?.auth?.apiKey?.login) throw new Error(`${provider?.name ?? providerId} does not support API-key login`);
  // ModelRuntime.login persists the returned credential through Pi's
  // credential store. setRuntimeApiKey is intentionally runtime-only.
  await runtime.login(providerId, "api-key", createAuthInteraction(requestId, apiKey));
}

function emitApproval(requestId: string, taskId: string, toolName: string, args: unknown) {
  const message = { type: "approval.requested", requestId, taskId, event: { toolName, args: jsonSafe(args) } };
  parentPort?.postMessage(message);
  process.send?.(message);
}

function emitExtensionUiRequest(requestId: string, taskId: string, request: Record<string, unknown>) {
  const message = { type: "extension.ui.request", requestId, taskId, event: { requestId, taskId, ...jsonSafe(request) } };
  parentPort?.postMessage(message);
  process.send?.(message);
}

const permissionEngine = new PermissionEngine({ emitApproval, emitEvent: emit, emitUiRequest: emitExtensionUiRequest });
function jsonSafe<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return String(value) as T;
  }
}

function persistSessionRun(session: any, taskId: string, startedAt: number, endedAt: number): void {
  const appendEntry = session.sessionManager?.appendCustomEntry;
  if (typeof appendEntry !== "function") return;
  const record: SessionRunRecord = {
    id: `${taskId}:${startedAt}`,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
  };
  try {
    appendEntry.call(session.sessionManager, SESSION_RUN_METADATA_TYPE, record);
  } catch {
    // A non-persistent/in-memory Pi session should not prevent the runtime
    // event from reaching the renderer.
  }
}

function finishExecutionGroup(session: any, taskId: string, endedAt: number): void {
  const startedAt = executionGroupStarts.get(taskId);
  executionGroupStarts.delete(taskId);
  if (startedAt !== undefined) persistSessionRun(session, taskId, startedAt, endedAt);
}

function sessionRunMetadata(session: any): SessionRunRecord[] {
  const entries = session.sessionManager?.getBranch?.() ?? session.sessionManager?.getEntries?.() ?? [];
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry: any) => entry?.type === "custom" && entry.customType === SESSION_RUN_METADATA_TYPE)
    .map((entry: any) => entry.data)
    .filter((record: any): record is SessionRunRecord => Boolean(
      record
      && typeof record.id === "string"
      && Number.isFinite(record.startedAt)
      && Number.isFinite(record.endedAt)
      && Number.isFinite(record.durationMs),
    ));
}

type NormalizedPromptImage = { type: "image"; data: string; mimeType: string };

function normalizePromptImages(images: unknown): NormalizedPromptImage[] | undefined {
  if (!Array.isArray(images)) return undefined;

  const normalized = images
    .map((image) => {
      if (!image || typeof image !== "object") return undefined;
      const record = image as Record<string, unknown>;
      const data = typeof record.data === "string" ? record.data : undefined;
      const mimeType = typeof record.mimeType === "string" ? record.mimeType : undefined;
      if (!data || !mimeType) return undefined;
      return { type: "image", data, mimeType } as const;
    })
    .filter((image): image is NormalizedPromptImage => image !== undefined);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSessionImages(sessionManager: any): boolean {
  const entries = sessionManager.getEntries?.();
  if (!Array.isArray(entries)) return false;

  let changed = false;
  for (const entry of entries) {
    if (!entry || entry.type !== "message") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if (record.type == null && typeof record.data === "string" && typeof record.mimeType === "string") {
        record.type = "image";
        changed = true;
      }
    }
  }

  if (!changed) return false;

  const sessionFile = sessionManager.getSessionFile?.();
  const header = sessionManager.getHeader?.();
  if (sessionFile && header) {
    const lines = [JSON.stringify(header), ...entries.map((entry: unknown) => JSON.stringify(entry))];
    writeFileSync(sessionFile, `${lines.join("\n")}\n`, "utf8");
  }

  return true;
}

function queueState(session: any) {
  return {
    steering: [...(session.getSteeringMessages?.() ?? [])],
    followUp: [...(session.getFollowUpMessages?.() ?? [])],
    steeringMode: session.steeringMode ?? "one-at-a-time",
    followUpMode: session.followUpMode ?? "one-at-a-time",
  };
}

type QueuedPromptImage = { text: string; images: NormalizedPromptImage[] };
type QueuedPromptImageState = { steering: QueuedPromptImage[]; followUp: QueuedPromptImage[] };
type QueueDeliveryHint = { text: string; delivery: "steer" | "followUp" };

// AgentSession exposes queue text for display, while its internal queue also
// carries images. Keep the image sidecar here so promoteQueue can rebuild a
// queue without silently dropping attachments.
const queuedPromptImages = new Map<string, QueuedPromptImageState>();
const queueDeliveryHints = new Map<string, QueueDeliveryHint[]>();
const queueMutationLocks = new Map<string, Promise<void>>();
const queueRebuilds = new Set<string>();

function emptyQueuedPromptImageState(): QueuedPromptImageState {
  return { steering: [], followUp: [] };
}

function queuedPromptImageState(taskId: string): QueuedPromptImageState {
  return queuedPromptImages.get(taskId) ?? emptyQueuedPromptImageState();
}

function reconcileQueuedPromptImages(taskId: string, steering: string[], followUp: string[]) {
  const previous = queuedPromptImageState(taskId);
  const reconcile = (texts: string[], entries: QueuedPromptImage[]) => {
    const remaining = [...entries];
    return texts.map((text) => {
      const index = remaining.findIndex((entry) => entry.text === text);
      if (index < 0) return { text, images: [] };
      const [entry] = remaining.splice(index, 1);
      return entry;
    });
  };
  queuedPromptImages.set(taskId, {
    steering: reconcile(steering, previous.steering),
    followUp: reconcile(followUp, previous.followUp),
  });
}

function setQueuedPromptImages(taskId: string, steering: QueuedPromptImage[], followUp: QueuedPromptImage[]) {
  queuedPromptImages.set(taskId, {
    steering: steering.map((entry) => ({ text: entry.text, images: [...entry.images] })),
    followUp: followUp.map((entry) => ({ text: entry.text, images: [...entry.images] })),
  });
}

function queuedPromptImagesForTexts(texts: string[], candidates: QueuedPromptImage[]): QueuedPromptImage[] {
  const remaining = [...candidates];
  return texts.map((text) => {
    const index = remaining.findIndex((entry) => entry.text === text);
    if (index < 0) return { text, images: [] };
    const [entry] = remaining.splice(index, 1);
    return entry;
  });
}

function queueMessageText(message: any): string {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content.map((part: any) => part?.type === "text" ? part.text : "").filter(Boolean).join("\n");
}

function recordQueueDeliveryHints(taskId: string, steering: string[], followUp: string[]) {
  if (queueRebuilds.has(taskId)) return;
  const previous = queuedPromptImageState(taskId);
  const pending = queueDeliveryHints.get(taskId) ?? [];
  const recordRemoved = (previousEntries: QueuedPromptImage[], currentTexts: string[], delivery: "steer" | "followUp") => {
    const remaining = [...currentTexts];
    for (const entry of previousEntries) {
      const index = remaining.indexOf(entry.text);
      if (index >= 0) remaining.splice(index, 1);
      else pending.push({ text: entry.text, delivery });
    }
  };
  recordRemoved(previous.steering, steering, "steer");
  recordRemoved(previous.followUp, followUp, "followUp");
  if (pending.length > 0) queueDeliveryHints.set(taskId, pending);
}

function consumeQueueDeliveryHint(taskId: string, text: string): "steer" | "followUp" | undefined {
  const pending = queueDeliveryHints.get(taskId);
  if (!pending?.length) return undefined;
  const index = pending.findIndex((hint) => hint.text === text);
  if (index < 0) return undefined;
  const [hint] = pending.splice(index, 1);
  if (pending.length > 0) queueDeliveryHints.set(taskId, pending);
  else queueDeliveryHints.delete(taskId);
  return hint.delivery;
}

function trackQueuedPrompt(taskId: string, delivery: "steer" | "followUp", text: string, images?: NormalizedPromptImage[]) {
  const state = queuedPromptImageState(taskId);
  const bucket = delivery === "steer" ? state.steering : state.followUp;
  bucket.push({ text, images: images ? [...images] : [] });
  queuedPromptImages.set(taskId, state);
}

async function withQueueMutationLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
  const previous = queueMutationLocks.get(taskId);
  let release!: () => void;
  const lock = new Promise<void>((resolve) => { release = resolve; });
  queueMutationLocks.set(taskId, lock);
  try {
    // Queue mutations are serialized rather than rejected, so rapid user
    // prompts remain ordered while promote/clear cannot interleave with them.
    await previous?.catch(() => undefined);
    return await operation();
  } finally {
    release();
    if (queueMutationLocks.get(taskId) === lock) queueMutationLocks.delete(taskId);
  }
}

async function createPackageManagerContext(cwd: string): Promise<{ manager: any; settingsManager: any }> {
  const sdk = await loadPiSdk();
  if (!sdk.DefaultPackageManager || !sdk.SettingsManager) throw new Error("Pi PackageManager is not available in this Pi runtime");
  const agentDir = sdk.getAgentDir?.() ?? path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), ".pi", "agent");
  const settingsManager = sdk.SettingsManager.create(cwd, agentDir);
  return { manager: new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager }), settingsManager };
}

async function createPackageManager(cwd: string): Promise<any> {
  return (await createPackageManagerContext(cwd)).manager;
}

function packageSourceString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "source" in value && typeof value.source === "string") return value.source;
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter keeps the scope decision explicit at every callsite
function packageSettingsKey(local: boolean): "packages" {
  // Kept as a named helper so the scope decision stays explicit at every
  // callsite; Pi exposes separate getters/setters for the two scopes.
  return "packages";
}

function configurePackageSource(settingsManager: any, source: string, enabled: boolean, local: boolean): boolean {
  const settings = local ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();
  const packages = [...(settings[packageSettingsKey(local)] ?? [])];
  const index = packages.findIndex((entry) => packageSourceString(entry) === source);
  const current = index >= 0 ? packages[index] : undefined;

  if (enabled) {
    // Remove only the package-level autoload override. Keep resource filters
    // intact; Pi's config TUI uses the same object-to-string cleanup rule.
    if (typeof current === "string") return false;
    if (index >= 0 && current && typeof current === "object") {
      if (current.autoload !== false) return false;
      const next = { ...current };
      delete next.autoload;
      const hasFilters = ["extensions", "skills", "prompts", "themes"].some((key) => next[key] !== undefined);
      packages[index] = hasFilters ? next : next.source;
    }
    else packages.push(source);
  } else {
    // Disabling is an autoload override, not removal. Preserve any existing
    // resource filters while forcing the package itself to stay unloaded.
    if (index < 0) packages.push({ source, autoload: false });
    else if (typeof current === "string") packages[index] = { source: current, autoload: false };
    else if (current && typeof current === "object" && current.autoload !== false) packages[index] = { ...current, autoload: false };
    else return false;
  }

  if (local) settingsManager.setProjectPackages(packages);
  else settingsManager.setPackages(packages);
  return true;
}

async function listWorkspaceFiles(cwd: string): Promise<Array<{ path: string; kind: "file" | "directory"; size?: number }>> {
  const files: Array<{ path: string; kind: "file" | "directory"; size?: number }> = [];
  const ignored = new Set([".git", "node_modules", "dist", "dist-renderer", ".cache"]);
  async function walk(directory: string, relative = "", depth = 0): Promise<void> {
    if (depth > 4) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name)) continue;
      const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push({ path: entryRelative.replaceAll("\\", "/"), kind: "directory" });
        await walk(entryPath, entryRelative, depth + 1);
      } else if (entry.isFile()) {
        try {
          files.push({ path: entryRelative.replaceAll("\\", "/"), kind: "file", size: (await stat(entryPath)).size });
        } catch {
          files.push({ path: entryRelative.replaceAll("\\", "/"), kind: "file" });
        }
      }
    }
  }
  await walk(cwd);
  return files;
}

function gitChanges(cwd: string): Array<{ path: string; status: string; additions: number; deletions: number }> {
  try {
    const statusOutput = execFileSync("git", ["-C", cwd, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
    const statOutput = execFileSync("git", ["-C", cwd, "diff", "--numstat", "HEAD"], { encoding: "utf8" });
    const numstat = new Map<string, { additions: number; deletions: number }>();
    for (const line of statOutput.split(/\r?\n/)) {
      const match = /^(\d+|-)\s+(\d+|-)\s+(.+)$/.exec(line.trim());
      if (match) numstat.set(match[3].replaceAll("\\", "/"), { additions: Number(match[1] === "-" ? 0 : match[1]), deletions: Number(match[2] === "-" ? 0 : match[2]) });
    }
    return statusOutput.split(/\r?\n/).filter(Boolean).map((line) => {
      const status = line.slice(0, 2).trim() || "?";
      const rawPath = line.slice(3).replace(/^".* -> /, "").replace(/^"|"$/g, "");
      return { path: rawPath.replaceAll("\\", "/"), status, ...(numstat.get(rawPath) ?? { additions: 0, deletions: 0 }) };
    });
  } catch {
    return [];
  }
}

async function listSlashCommands(session: any) {
  const builtins = (await import(pathToFileURL(path.join(path.dirname(resolvePiModule()), "core", "slash-commands.js")).href)).BUILTIN_SLASH_COMMANDS as Array<{ name: string; description?: string; argumentHint?: string }>;
  const prompts = session.resourceLoader?.getPrompts?.().prompts?.map((prompt: any) => ({ name: prompt.name, description: prompt.description })) ?? [];
  const skills = session.resourceLoader?.getSkills?.().skills?.map((skill: any) => ({ name: `skill:${skill.name}`, description: skill.description })) ?? [];
  const extensionCommands = session.extensionRunner?.getRegisteredCommands?.().map((command: any) => ({
    name: command.invocationName ?? command.name,
    description: command.description,
  })) ?? [];
  return { builtins: jsonSafe([...builtins, ...extensionCommands]), prompts: jsonSafe(prompts), skills: jsonSafe(skills) };
}

function firstUserText(manager: any): string {
  for (const entry of manager.getEntries?.() ?? []) {
    if (entry?.type === "message" && entry.message?.role === "user") {
      const content = entry.message.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) return content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("\n");
    }
  }
  return "";
}

function changelogPath(): string {
  const moduleDir = path.dirname(resolvePiModule());
  const candidates = [path.join(moduleDir, "CHANGELOG.md"), path.join(moduleDir, "..", "CHANGELOG.md")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function sdkVersion(): string | null {
  try {
    const moduleDir = path.dirname(resolvePiModule());
    const packageJson = JSON.parse(readFileSync(path.join(moduleDir, "..", "package.json"), "utf8")) as { version?: string };
    return packageJson.version ?? null;
  } catch {
    return null;
  }
}

function normalizeAgentEvent(event: any, queueDelivery?: "steer" | "followUp"): unknown {
  if (event.type === "message_update") {
    const streamEvent = event.assistantMessageEvent ?? {};
    return {
      type: event.type,
      stream: {
        type: streamEvent.type,
        delta: streamEvent.delta,
        content: streamEvent.content,
        reason: streamEvent.reason,
      },
    };
  }
  if (event.type === "message_start" || event.type === "message_end") {
    return { type: event.type, message: jsonSafe(event.message), ...(queueDelivery ? { queueDelivery } : {}) };
  }
  if (event.type === "tool_execution_start" || event.type === "tool_execution_update" || event.type === "tool_execution_end") {
    return {
      type: event.type,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: jsonSafe(event.args),
      partialResult: jsonSafe(event.partialResult),
      result: jsonSafe(event.result),
      isError: event.isError,
    };
  }
  if (event.type === "compaction_start") {
    return { type: event.type, reason: event.reason };
  }
  if (event.type === "compaction_end") {
    return {
      type: event.type,
      reason: event.reason,
      result: jsonSafe(event.result),
      aborted: event.aborted,
      willRetry: event.willRetry,
      errorMessage: event.errorMessage,
    };
  }
  if (event.type === "agent_end") {
    return { type: event.type, willRetry: event.willRetry, messages: jsonSafe(event.messages) };
  }
  if (event.type === "agent_settled" || event.type === "turn_start" || event.type === "turn_end") {
    return { type: event.type, willRetry: event.willRetry };
  }
  return jsonSafe(event);
}

async function ensureAgentSession(taskId: string, cwd: string): Promise<any> {
  const existing = agentSessions.get(taskId);
  if (existing) {
    const sessionRevision = agentSessionRevisions.get(taskId);
    const sessionPackageRevision = agentSessionPackageRevisions.get(taskId);
    if ((sessionRevision === permissionEngine.revision && sessionPackageRevision === packageConfigRevision) || existing.isStreaming || agentRunReservations.has(taskId)) {
      if (!existing.isStreaming) normalizeSessionImages(existing.sessionManager);
      return existing;
    }
    // Do not interrupt an active turn. Once idle, recreate against the new
    // extension configuration while keeping the same Pi SessionManager/file.
    existing.dispose?.();
    agentSessions.delete(taskId);
    agentSessionRevisions.delete(taskId);
    agentSessionPackageRevisions.delete(taskId);
    // Queue contents live only on AgentSession. Drop renderer-side queue
    // sidecars and delivery hints when the idle session is recreated.
    queuedPromptImages.delete(taskId);
    queueDeliveryHints.delete(taskId);
    queueRebuilds.delete(taskId);
    agentRunReservations.delete(taskId);
  }
  const pending = agentSessionPromises.get(taskId);
  if (pending) return pending;

  const creationRevision = permissionEngine.revision;
  const creation = (async () => {
    const sdk = await loadPiSdk();
    let manager = sessionManagers.get(taskId);
    if (!manager) {
      const sessionPath = sessionFiles.get(taskId);
      manager = sessionPath ? sdk.SessionManager.open(sessionPath) : sdk.SessionManager.create(cwd);
      sessionManagers.set(taskId, manager);
    }
    normalizeSessionImages(manager);
    const permissionExtensionPath = resolvePermissionExtensionPath();
    const resourceLoader = sdk.DefaultResourceLoader && permissionExtensionPath
      ? new sdk.DefaultResourceLoader({ cwd, agentDir: sdk.getAgentDir?.() ?? path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), ".pi", "agent"), additionalExtensionPaths: [permissionExtensionPath] })
      : undefined;
    await resourceLoader?.reload?.();
    const { session } = await sdk.createAgentSession({
      cwd,
      sessionManager: manager,
      modelRuntime: await getModelRuntime(),
      resourceLoader,
    });
    const permissionExtensionLoaded = Boolean(permissionExtensionPath && session.extensionRunner?.getRegisteredCommands?.().some((command: any) => (command.invocationName ?? command.name) === "permission-system"));
    // Give every loaded Pi extension the desktop UI bridge. The permission
    // extension uses the same select/input/confirm primitives as other
    // extensions, so it no longer needs a separate TUI-only implementation.
    await session.bindExtensions?.({ uiContext: permissionEngine.createUi(taskId) });
    const previousBeforeToolCall = session.agent.beforeToolCall;
    session.agent.beforeToolCall = (context: any, signal?: AbortSignal) => permissionEngine.beforeToolCallWithExtension(
      taskId,
      context,
      previousBeforeToolCall,
      permissionExtensionLoaded,
      signal,
    );
    session.subscribe((event: any) => {
      try {
        if (event.type === "queue_update" && !queueRebuilds.has(taskId)) {
          recordQueueDeliveryHints(taskId, Array.isArray(event.steering) ? event.steering : [], Array.isArray(event.followUp) ? event.followUp : []);
          reconcileQueuedPromptImages(taskId, Array.isArray(event.steering) ? event.steering : [], Array.isArray(event.followUp) ? event.followUp : []);
        }
        // A delivery hint is only meaningful until the current agent run is
        // settled. If Pi aborts or drops a queued message without emitting its
        // message_start event, discard the hint so a later identical prompt
        // cannot inherit the wrong steering/follow-up classification.
        if (event.type === "agent_settled") queueDeliveryHints.delete(taskId);
        if (event.type === "agent_start") executionGroupStarts.set(taskId, Date.now());
        if (event.type === "agent_settled") {
          finishExecutionGroup(session, taskId, Date.now());
        }
        if (event.type === "message_start" && event.message?.role === "user") {
          const queueDelivery = consumeQueueDeliveryHint(taskId, queueMessageText(event.message));
          if (queueDelivery === "followUp") {
            const boundary = Date.now();
            finishExecutionGroup(session, taskId, boundary);
            executionGroupStarts.set(taskId, boundary);
          } else if (!executionGroupStarts.has(taskId)) {
            executionGroupStarts.set(taskId, Date.now());
          }
          emit(taskId, normalizeAgentEvent(event, queueDelivery));
          return;
        }
        emit(taskId, normalizeAgentEvent(event));
      } catch (error) {
        console.error(`PiHost agent event handler failed for ${taskId}`, error);
      }
    });
    session.subscribe((event: any) => {
      try {
        if (event.type === "message_end") {
          // AgentSession persists the message immediately after notifying its
          // subscribers. Defer the snapshot one tick so the renderer receives
          // the completed assistant reply before the next queued message starts.
          setTimeout(() => emit(taskId, { type: "message.snapshot", messages: jsonSafe(session.messages) }), 0);
        } else if (event.type === "agent_settled") {
          emit(taskId, { type: "message.snapshot", messages: jsonSafe(session.messages) });
        } else if (event.type === "compaction_end") {
          // Compaction rewrites agent.state.messages in place (older entries
          // fold into a compactionSummary message). Push the rewritten list
          // with a replace marker so the renderer swaps its whole timeline
          // instead of merging: the folded-away messages are gone from Pi and
          // must not linger, and merge-based retention of "unmatched previous"
          // would keep pre-compaction turns after the compaction summary.
          emit(taskId, { type: "message.snapshot", replace: true, messages: jsonSafe(session.messages) });
        }
      } catch (error) {
        console.error(`PiHost message snapshot handler failed for ${taskId}`, error);
      }
    });
    agentSessions.set(taskId, session);
    agentSessionRevisions.set(taskId, creationRevision);
    agentSessionPackageRevisions.set(taskId, packageConfigRevision);
    return session;
  })();
  agentSessionPromises.set(taskId, creation);
  try {
    return await creation;
  } finally {
    agentSessionPromises.delete(taskId);
  }
}

function invalidatePackageSessions(): void {
  packageConfigRevision += 1;
  capabilitySessions.clear();
}

async function ensureCapabilitySession(cwd: string): Promise<any> {
  const existing = capabilitySessions.get(cwd);
  if (existing) return existing;
  const sdk = await loadPiSdk();
  const { session } = await sdk.createAgentSession({
    cwd,
    sessionManager: sdk.SessionManager.inMemory(cwd),
    modelRuntime: await getModelRuntime(),
  });
  capabilitySessions.set(cwd, session);
  return session;
}

async function handle(request: PiHostRequest): Promise<void> {
  try {
    switch (request.command) {
      case "runtime.status":
        send({ id: request.id, ok: true, result: "connected" });
        return;
      case "app.changelog": {
        send({ id: request.id, ok: true, result: existsSync(changelogPath()) ? readFileSync(changelogPath(), "utf8") : "" });
        return;
      }
      case "app.info": {
        send({ id: request.id, ok: true, result: { version: sdkVersion() } });
        return;
      }
      case "projects.list": {
        const currentCwd = path.resolve(resolveWorkspaceCwd());
        const knownCwds = typeof request.payload === "object" && request.payload && "knownCwds" in request.payload && Array.isArray(request.payload.knownCwds)
          ? request.payload.knownCwds.filter((cwd): cwd is string => typeof cwd === "string" && existsSync(cwd)).map((cwd) => path.resolve(cwd))
          : [];
        const sessions = await (await loadPiSdk()).SessionManager.listAll();
        const projects = new Map<string, { id: string; cwd: string; name: string; taskCount: number; updatedAt: number }>();
        for (const session of sessions) {
          if (typeof session?.cwd !== "string" || !session.cwd || !existsSync(session.cwd)) continue;
          const cwd = path.resolve(session.cwd);
          const key = process.platform === "win32" ? cwd.toLowerCase() : cwd;
          const existing = projects.get(key);
          const modified = new Date(session.modified ?? 0).getTime();
          if (existing) {
            existing.taskCount += 1;
            existing.updatedAt = Math.max(existing.updatedAt, modified);
          } else {
            projects.set(key, {
              id: cwd,
              cwd,
              name: path.basename(cwd) || cwd,
              taskCount: 1,
              updatedAt: modified,
            });
          }
        }
        const currentKey = process.platform === "win32" ? currentCwd.toLowerCase() : currentCwd;
        if (!projects.has(currentKey)) {
          projects.set(currentKey, {
            id: currentCwd,
            cwd: currentCwd,
            name: path.basename(currentCwd) || currentCwd,
            taskCount: 0,
            updatedAt: Date.now(),
          });
        }
        for (const [index, cwd] of knownCwds.entries()) {
          const key = process.platform === "win32" ? cwd.toLowerCase() : cwd;
          const existing = projects.get(key);
          const updatedAt = Date.now() + knownCwds.length - index;
          if (existing) existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
          else projects.set(key, {
            id: cwd,
            cwd,
            name: path.basename(cwd) || cwd,
            taskCount: 0,
            updatedAt,
          });
        }
        send({
          id: request.id,
          ok: true,
          result: [...projects.values()]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map(({ updatedAt: _updatedAt, ...project }) => project),
        });
        return;
      }
      case "projects.setTrust": {
        const payload = request.payload as { cwd?: string; trusted?: boolean } | undefined;
        if (!payload?.cwd || typeof payload.trusted !== "boolean") throw new Error("cwd and trusted are required");
        const sdk = await loadPiSdk();
        const agentDir = sdk.getAgentDir?.() ?? path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), ".pi", "agent");
        if (!sdk.ProjectTrustStore) throw new Error("Pi project trust is not available in this runtime");
        new sdk.ProjectTrustStore(agentDir).set(payload.cwd, payload.trusted);
        send({ id: request.id, ok: true, result: { cwd: payload.cwd, trusted: payload.trusted } });
        return;
      }
      case "sessions.list": {
        const cwd = typeof request.payload === "object" && request.payload && "cwd" in request.payload && typeof request.payload.cwd === "string"
          ? request.payload.cwd
          : resolveWorkspaceCwd();
        const sdk = await loadPiSdk();
        const sessions = await sdk.SessionManager.list(cwd);
        for (const session of sessions) sessionFiles.set(session.id, session.path);
        send({
          id: request.id,
          ok: true,
          result: sessions.map((session: any) => {
            const storedName = typeof session.name === "string" ? session.name : "";
            const firstMessage = typeof session.firstMessage === "string" ? session.firstMessage : "";
            const titleSource = isDefaultSessionTitle(storedName) || isCommandDerivedSessionTitle(storedName)
              ? firstMessage
              : storedName || firstMessage;
            return {
              id: session.id,
              title: deriveSessionTitle(titleSource) || storedName || session.id.slice(0, 8),
              projectId: cwd,
              state: "idle",
              model: sessionModelLabel(session, sdk),
              updatedAt: new Date(session.modified ?? Date.now()).toISOString(),
            };
          }),
        });
        return;
      }
      case "models.list": {
        const runtime = await getModelRuntime();
        const providers = runtime.getProviders();
        const models = providers.flatMap((provider: any) => {
          const auth = runtime.getProviderAuthStatus(provider.id);
          return runtime.getModels(provider.id).map((model: any) => modelSummary(provider, model, Boolean(auth.configured)));
        });
        send({ id: request.id, ok: true, result: jsonSafe(models) });
        return;
      }
      case "workspace.snapshot": {
        const payload = request.payload as { cwd?: string } | undefined;
        const cwd = payload?.cwd ?? resolveWorkspaceCwd();
        send({
          id: request.id,
          ok: true,
          result: {
            cwd,
            files: await listWorkspaceFiles(cwd),
            changes: gitChanges(cwd),
            refreshedAt: new Date().toISOString(),
          },
        });
        return;
      }
      case "sessions.create": {
        const payload = request.payload as { cwd?: string; name?: string } | undefined;
        const cwd = payload?.cwd ?? resolveWorkspaceCwd();
        const sessionManager = (await loadPiSdk()).SessionManager.create(cwd);
        if (payload?.name) sessionManager.appendSessionInfo(payload.name);
        const sessionId = sessionManager.getSessionId();
        sessionManagers.set(sessionId, sessionManager);
        const sessionFile = sessionManager.getSessionFile?.();
        if (sessionFile) sessionFiles.set(sessionId, sessionFile);
        send({
          id: request.id,
          ok: true,
          result: {
            id: sessionId,
            title: payload?.name ?? "Untitled task",
            projectId: cwd,
            state: "idle",
            model: "No model selected",
            updatedAt: new Date().toISOString(),
          },
        });
        return;
      }
      case "sessions.messages": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const manager = sessionManagers.get(payload.taskId);
        const session = agentSessions.get(payload.taskId) ?? await ensureAgentSession(
          payload.taskId,
          payload.cwd ?? manager?.getCwd?.() ?? resolveWorkspaceCwd(),
        );
        if (session) {
          send({ id: request.id, ok: true, result: jsonSafe(session.messages) });
          return;
        }
        send({ id: request.id, ok: true, result: jsonSafe(manager?.getEntries?.() ?? []) });
        return;
      }
      case "sessions.runMetadata": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        send({ id: request.id, ok: true, result: jsonSafe(sessionRunMetadata(session)) });
        return;
      }
      case "sessions.capabilities": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        const cwd = payload?.cwd ?? resolveWorkspaceCwd();
        const session = payload?.taskId
          ? await ensureAgentSession(payload.taskId, cwd)
          : await ensureCapabilitySession(cwd);
        const runtime = await getModelRuntime();
        const activeModel = session.model;
        const provider = activeModel ? runtime.getProvider(activeModel.provider) : undefined;
        const auth = provider ? runtime.getProviderAuthStatus(provider.id) : undefined;
        // If a package changed while the task was streaming, keep the active
        // AgentSession intact but read command/prompt/skill metadata from a
        // fresh capability session so disabled package commands disappear
        // immediately from the desktop suggestions.
        const commandSession = payload?.taskId && agentSessionPackageRevisions.get(payload.taskId) !== packageConfigRevision
          ? await ensureCapabilitySession(cwd)
          : session;
        const slash = await listSlashCommands(commandSession);
        send({
          id: request.id,
          ok: true,
          result: {
            model: activeModel && provider ? modelSummary(provider, activeModel, Boolean(auth?.configured)) : undefined,
            thinkingLevel: session.thinkingLevel,
            thinkingLevels: session.getAvailableThinkingLevels(),
            slashCommands: slash.builtins,
            prompts: slash.prompts,
            skills: slash.skills,
            scopedModels: Array.isArray(session.scopedModels) ? session.scopedModels.map((item: any) => `${item.model?.provider}/${item.model?.id}`).filter((value: string) => !value.includes("undefined")) : [],
            contextUsage: jsonSafe(session.getContextUsage?.()),
          },
        });
        return;
      }
      case "sessions.compact": {
        const payload = request.payload as { taskId?: string; instructions?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        const result = await session.compact(payload.instructions);
        emit(payload.taskId, { type: "message.snapshot", messages: jsonSafe(session.messages) });
        send({ id: request.id, ok: true, result: jsonSafe(result) });
        return;
      }
      case "sessions.export": {
        const payload = request.payload as { taskId?: string; format?: "jsonl" | "html"; cwd?: string } | undefined;
        if (!payload?.taskId || !payload.format) throw new Error("taskId and format are required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        const outputPath = payload.format === "html" ? await session.exportToHtml() : session.exportToJsonl();
        send({ id: request.id, ok: true, result: { path: outputPath } });
        return;
      }
      case "sessions.import": {
        const payload = request.payload as { taskId?: string; inputPath?: string; cwd?: string } | undefined;
        if (!payload?.inputPath?.trim()) throw new Error("inputPath is required");
        const inputPath = path.resolve(payload.inputPath.trim());
        if (!existsSync(inputPath)) throw new Error(`Session file not found: ${inputPath}`);
        const cwd = payload.cwd ?? resolveWorkspaceCwd();
        const sdk = await loadPiSdk();
        const currentPath = payload.taskId ? sessionFiles.get(payload.taskId) : undefined;
        const currentManager = payload.taskId ? sessionManagers.get(payload.taskId) : undefined;
        const scratchManager = sdk.SessionManager.create(cwd);
        const targetDir = currentManager?.getSessionDir?.() ?? (currentPath ? path.dirname(currentPath) : undefined) ?? scratchManager.getSessionDir?.() ?? path.join(cwd, ".pi", "sessions");
        mkdirSync(targetDir, { recursive: true });
        const destination = path.join(targetDir, `import-${Date.now()}-${path.basename(inputPath)}`);
        copyFileSync(inputPath, destination);
        const manager = sdk.SessionManager.open(destination, targetDir, cwd);
        normalizeSessionImages(manager);
        const sessionId = manager.getSessionId();
        sessionManagers.set(sessionId, manager);
        sessionFiles.set(sessionId, destination);
        const titleSource = manager.getSessionName?.() || firstUserText(manager);
        send({
          id: request.id,
          ok: true,
          result: {
            id: sessionId,
            title: deriveSessionTitle(titleSource) || manager.getSessionName?.() || sessionId.slice(0, 8),
            projectId: cwd,
            state: "idle",
            model: sessionModelLabel({ path: destination }, sdk),
            updatedAt: new Date().toISOString(),
          },
        });
        return;
      }
      case "sessions.rename": {
        const payload = request.payload as { taskId?: string; name?: string; cwd?: string } | undefined;
        if (!payload?.taskId || !payload.name?.trim()) throw new Error("taskId and name are required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        session.setSessionName(payload.name.trim());
        const name = session.sessionManager?.getSessionName?.() ?? payload.name.trim();
        emit(payload.taskId, { type: "session_info_changed", name });
        send({ id: request.id, ok: true, result: name });
        return;
      }
      case "sessions.generateTitle": {
        const payload = request.payload as { taskId?: string; message?: string; cwd?: string; model?: { providerId: string; modelId: string } } | undefined;
        // Missing input yields no title; the renderer keeps its truncated fallback.
        if (!payload?.taskId || !payload.message?.trim()) {
          send({ id: request.id, ok: true, result: null });
          return;
        }
        try {
          const runtime = await getModelRuntime();
          const model = payload.model?.providerId && payload.model?.modelId
            ? runtime.getModel(payload.model.providerId, payload.model.modelId)
            : undefined;
          if (!model) {
            send({ id: request.id, ok: true, result: null });
            return;
          }
          const result = await runtime.complete(model, {
            systemPrompt: SESSION_TITLE_SYSTEM_PROMPT,
            messages: [{ role: "user", content: payload.message }],
          }, {});
          const raw = Array.isArray(result?.content)
            ? result.content
                .filter((block: any) => block?.type === "text" && typeof block.text === "string")
                .map((block: any) => block.text)
                .join("")
            : "";
          const cleaned = raw.trim().replace(/^["'「『]+|["'」』]+$/g, "").replace(/\s+/g, " ").trim();
          // Cap length and reject garbage so a bad reply falls back to truncation.
          send({ id: request.id, ok: true, result: cleaned.length > 0 && cleaned.length <= 60 ? cleaned : null });
        } catch {
          // Auth or network failure: let the renderer keep its truncated fallback.
          send({ id: request.id, ok: true, result: null });
        }
        return;
      }
      case "sessions.stats": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        send({ id: request.id, ok: true, result: jsonSafe(session.getSessionStats()) });
        return;
      }
      case "sessions.share": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        execFileSync("gh", ["auth", "status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        const tempPath = path.join(os.tmpdir(), `pideck-session-${Date.now()}.html`);
        try {
          await session.exportToHtml(tempPath);
          const gistUrl = execFileSync("gh", ["gist", "create", "--public=false", tempPath], { encoding: "utf8" }).trim();
          const gistId = gistUrl.split("/").filter(Boolean).pop();
          if (!gistId) throw new Error("Could not parse the gist URL returned by gh");
          const viewerBase = process.env.PI_SHARE_VIEWER_URL ?? "https://pi.dev/session/";
          send({ id: request.id, ok: true, result: { url: `${viewerBase}#${gistId}`, gistUrl } });
        } finally {
          try { unlinkSync(tempPath); } catch { /* Best effort cleanup. */ }
        }
        return;
      }
      case "agent.prompt": {
        const payload = request.payload as { taskId?: string; text?: string; cwd?: string; images?: Array<{ data: string; mimeType: string }>; delivery?: "steer" | "followUp" } | undefined;
        const images = normalizePromptImages(payload?.images);
        if (!payload?.taskId || (!payload.text && !images?.length)) throw new Error("taskId and text or images are required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        const sessionName = session.sessionManager?.getSessionName?.();
        if (!titledSessions.has(payload.taskId) && (isDefaultSessionTitle(sessionName) || isCommandDerivedSessionTitle(sessionName))) {
          const title = deriveSessionTitle(payload.text ?? "");
          if (title) {
            if (typeof session.setSessionName === "function") session.setSessionName(title);
            else session.sessionManager?.appendSessionInfo?.(title);
            titledSessions.add(payload.taskId);
          }
        }
        const wasStreaming = Boolean(session.isStreaming || agentRunReservations.has(payload.taskId));
        const queuedDelivery = wasStreaming ? payload.delivery ?? "followUp" as const : undefined;
        if (!queuedDelivery) agentRunReservations.add(payload.taskId);
        const runPrompt = async () => {
          if (queuedDelivery) trackQueuedPrompt(payload.taskId!, queuedDelivery, payload.text ?? "", images);
          await session.prompt(payload.text ?? "", {
            source: "interactive",
            images,
            ...(queuedDelivery ? { streamingBehavior: queuedDelivery } : {}),
          });
          if (queuedDelivery) {
            const current = queueState(session);
            reconcileQueuedPromptImages(payload.taskId!, current.steering, current.followUp);
          }
        };
        try {
          if (queuedDelivery) await withQueueMutationLock(payload.taskId, runPrompt);
          else await runPrompt();
        } catch (error) {
          if (queuedDelivery) {
            const current = queueState(session);
            reconcileQueuedPromptImages(payload.taskId!, current.steering, current.followUp);
          }
          // A failed prompt must not leave Pi's AgentSession streaming. Aborting
          // here lets the next user prompt start a fresh execution group.
          if (session.isStreaming) {
            try { await session.abort(); } catch { /* Preserve the original prompt error. */ }
          }
          throw error;
        } finally {
          if (!queuedDelivery) agentRunReservations.delete(payload.taskId!);
        }
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "sessions.delete": {
        const payload = request.payload as { taskId?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const sessionPath = sessionFiles.get(payload.taskId);
        const session = agentSessions.get(payload.taskId);
        if (session?.isStreaming) await session.abort();
        await session?.dispose?.();
        if (sessionPath && existsSync(sessionPath)) await unlink(sessionPath);
        sessionFiles.delete(payload.taskId);
        titledSessions.delete(payload.taskId);
        sessionManagers.delete(payload.taskId);
        agentSessions.delete(payload.taskId);
        agentSessionPackageRevisions.delete(payload.taskId);
        agentSessionRevisions.delete(payload.taskId);
        queuedPromptImages.delete(payload.taskId);
        queueDeliveryHints.delete(payload.taskId);
        queueMutationLocks.delete(payload.taskId);
        queueRebuilds.delete(payload.taskId);
        agentRunReservations.delete(payload.taskId);
        executionGroupStarts.delete(payload.taskId);
        permissionEngine.dispose(payload.taskId);
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "agent.abort": {
        const payload = request.payload as { taskId?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const session = agentSessions.get(payload.taskId);
        if (session) await session.abort();
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "agent.setThinkingLevel": {
        const payload = request.payload as { taskId?: string; level?: string; cwd?: string } | undefined;
        if (!payload?.taskId || !payload.level) throw new Error("taskId and level are required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        session.setThinkingLevel(payload.level);
        send({ id: request.id, ok: true, result: session.thinkingLevel });
        return;
      }
      case "agent.setModel": {
        const payload = request.payload as { taskId?: string; providerId?: string; modelId?: string; cwd?: string } | undefined;
        if (!payload?.taskId || !payload.providerId || !payload.modelId) throw new Error("taskId, providerId and modelId are required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        const runtime = await getModelRuntime();
        const model = runtime.getModel(payload.providerId, payload.modelId);
        if (!model) throw new Error(`Unknown model: ${payload.providerId}/${payload.modelId}`);
        await session.setModel(model);
        send({ id: request.id, ok: true, result: { providerId: model.provider, modelId: model.id, name: model.name } });
        return;
      }
      case "agent.setScopedModels": {
        const payload = request.payload as { taskId?: string; modelIds?: string[] | null; persist?: boolean; cwd?: string } | undefined;
        if (!payload?.taskId || !Array.isArray(payload.modelIds) && payload.modelIds !== null) throw new Error("taskId and modelIds are required");
        const cwd = payload.cwd ?? resolveWorkspaceCwd();
        const session = await ensureAgentSession(payload.taskId, cwd);
        const runtime = await getModelRuntime();
        const ids = payload.modelIds ?? [];
        const scoped = [];
        for (const reference of ids) {
          const separator = reference.indexOf("/");
          if (separator <= 0 || separator === reference.length - 1) throw new Error(`Invalid model reference: ${reference}`);
          const model = runtime.getModel(reference.slice(0, separator), reference.slice(separator + 1));
          if (!model) throw new Error(`Unknown model: ${reference}`);
          scoped.push({ model });
        }
        session.setScopedModels(scoped);
        if (payload.persist) {
          const sdk = await loadPiSdk();
          if (!sdk.SettingsManager) throw new Error("Pi settings are not available in this runtime");
          const agentDir = sdk.getAgentDir?.() ?? path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), ".pi", "agent");
          const settings = sdk.SettingsManager.create(cwd, agentDir);
          settings.setEnabledModels(ids.length > 0 ? [...ids] : undefined);
        }
        send({ id: request.id, ok: true, result: ids });
        return;
      }
      case "agent.queue": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        const current = queueState(session);
        reconcileQueuedPromptImages(payload.taskId, current.steering, current.followUp);
        send({ id: request.id, ok: true, result: current });
        return;
      }
      case "agent.setQueueModes": {
        const payload = request.payload as { taskId?: string; cwd?: string; steeringMode?: "all" | "one-at-a-time"; followUpMode?: "all" | "one-at-a-time" } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        if (payload.steeringMode) session.setSteeringMode(payload.steeringMode);
        if (payload.followUpMode) session.setFollowUpMode(payload.followUpMode);
        send({ id: request.id, ok: true, result: queueState(session) });
        return;
      }
      case "agent.clearQueue": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        await withQueueMutationLock(payload.taskId, async () => {
          queueRebuilds.add(payload.taskId!);
          try {
            session.clearQueue();
            setQueuedPromptImages(payload.taskId!, [], []);
            queueDeliveryHints.delete(payload.taskId!);
            send({ id: request.id, ok: true, result: queueState(session) });
          } finally {
            queueRebuilds.delete(payload.taskId!);
          }
        });
        return;
      }
      case "agent.promoteQueue": {
        const payload = request.payload as { taskId?: string; cwd?: string; followUpIndex?: number } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        if (!Number.isInteger(payload.followUpIndex) || (payload.followUpIndex ?? -1) < 0) throw new Error("followUpIndex is required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        const taskId = payload.taskId;
        await withQueueMutationLock(taskId, async () => {
          // Validate against the live queue before clearing it. A stale UI
          // index must never cause a different message to be promoted.
          const liveQueue = queueState(session);
          const followUpIndex = payload.followUpIndex!;
          if (typeof liveQueue.followUp[followUpIndex] !== "string") throw new Error("Queued message is no longer available");

          const imageState = queuedPromptImageState(taskId);
          const queued = {
            steering: liveQueue.steering.map((text, index) => imageState.steering[index] ?? { text, images: [] }),
            followUp: liveQueue.followUp.map((text, index) => imageState.followUp[index] ?? { text, images: [] }),
          };
          const selected = queued.followUp[followUpIndex];
          if (!selected) throw new Error("Queued message is no longer available");
          queueRebuilds.add(taskId);
          try {
            session.clearQueue();
            try {
              // Promote means the selected follow-up is first in the steering
              // queue, ahead of any older steering messages.
              await session.steer(selected.text, selected.images);
              for (const message of queued.steering) await session.steer(message.text, message.images);
              for (const [index, message] of queued.followUp.entries()) {
                if (index !== followUpIndex) await session.followUp(message.text, message.images);
              }
            } catch (error) {
              // Rebuild the original queue if any requeue operation fails. Keep
              // the operation failure visible while making the queue recoverable.
              try {
                session.clearQueue();
                for (const message of queued.steering) await session.steer(message.text, message.images);
                for (const message of queued.followUp) await session.followUp(message.text, message.images);
                const restored = queueState(session);
                setQueuedPromptImages(
                  taskId,
                  queuedPromptImagesForTexts(restored.steering, queued.steering),
                  queuedPromptImagesForTexts(restored.followUp, queued.followUp),
                );
              } catch (restoreError) {
                // Both failures are concatenated into the message so the UI shows the
                // original error and the restore failure without relying on error.cause.
                // eslint-disable-next-line preserve-caught-error
                throw new Error(`${error instanceof Error ? error.message : String(error)}; queue restore failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
              }
              throw error;
            }
            const next = queueState(session);
            setQueuedPromptImages(
              taskId,
              queuedPromptImagesForTexts(next.steering, [selected, ...queued.steering]),
              queuedPromptImagesForTexts(next.followUp, queued.followUp.filter((_message, index) => index !== followUpIndex)),
            );
            send({ id: request.id, ok: true, result: next });
          } finally {
            queueRebuilds.delete(taskId);
          }
        });
        return;
      }
      case "extension.ui.resolve": {
        const payload = request.payload as { requestId?: string; value?: string | boolean } | undefined;
        if (!payload?.requestId) throw new Error("requestId is required");
        permissionEngine.resolveUi(payload.requestId, payload.value);
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "packages.list": {
        const payload = request.payload as { cwd?: string } | undefined;
        const manager = await createPackageManager(payload?.cwd ?? resolveWorkspaceCwd());
        const packages = manager.listConfiguredPackages?.() ?? [];
        send({ id: request.id, ok: true, result: jsonSafe(packages.map((item: any) => ({
          source: item.source,
          scope: item.scope,
          filtered: Boolean(item.filtered),
          // Pi represents an autoload-disabled package as a filtered package.
          // Keep the renderer-facing name explicit while preserving compatibility
          // with a future SDK that may expose a dedicated disabled field.
          disabled: item.disabled === true || item.filtered === true,
          installedPath: item.installedPath,
        }))) });
        return;
      }
      case "packages.install": {
        const payload = request.payload as { source?: string; local?: boolean; cwd?: string } | undefined;
        if (!payload?.source?.trim()) throw new Error("source is required");
        const manager = await createPackageManager(payload.cwd ?? resolveWorkspaceCwd());
        const source = normalizePackageInstallSource(payload.source);
        await manager.installAndPersist(source, { local: Boolean(payload.local) });
        invalidatePackageSessions();
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "packages.remove": {
        const payload = request.payload as { source?: string; local?: boolean; cwd?: string } | undefined;
        if (!payload?.source?.trim()) throw new Error("source is required");
        const manager = await createPackageManager(payload.cwd ?? resolveWorkspaceCwd());
        await manager.removeAndPersist(payload.source.trim(), { local: Boolean(payload.local) });
        invalidatePackageSessions();
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "packages.update": {
        const payload = request.payload as { source?: string; cwd?: string } | undefined;
        const manager = await createPackageManager(payload?.cwd ?? resolveWorkspaceCwd());
        await manager.update(payload?.source?.trim() || undefined);
        invalidatePackageSessions();
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "packages.configure": {
        const payload = request.payload as { source?: string; enabled?: boolean; local?: boolean; cwd?: string } | undefined;
        if (!payload?.source?.trim()) throw new Error("source is required");
        const { settingsManager } = await createPackageManagerContext(payload.cwd ?? resolveWorkspaceCwd());
        const changed = configurePackageSource(settingsManager, payload.source.trim(), Boolean(payload.enabled), Boolean(payload.local));
        if (changed) invalidatePackageSessions();
        send({ id: request.id, ok: true, result: { changed } });
        return;
      }
      case "providers.list": {
        const runtime = await getModelRuntime();
        const credentials = await runtime.listCredentials();
        const credentialByProvider = new Map<string, any>(credentials.map((credential: any) => [credential.providerId, credential] as [string, any]));
        send({
          id: request.id,
          ok: true,
          result: runtime.getProviders().map((provider: any) => {
            const auth = runtime.getProviderAuthStatus(provider.id);
            const credential = credentialByProvider.get(provider.id);
            const authMethods = [
              provider.auth?.apiKey ? "api-key" : undefined,
              provider.auth?.oauth ? "oauth" : undefined,
            ].filter((method): method is "api-key" | "oauth" => Boolean(method));
            return {
              id: provider.id,
              name: provider.name ?? provider.id,
              authState: auth.configured ? "configured" : credential?.type === "oauth" ? "expired" : "missing",
              authMethod: credential?.type === "oauth" ? "oauth" : credential?.type === "api_key" ? "api-key" : null,
              authMethods,
              modelCount: runtime.getModels(provider.id).length,
            };
          }),
        });
        return;
      }
      case "providers.login": {
        const payload = request.payload as { providerId?: string; method?: "api-key" | "oauth"; secret?: string } | undefined;
        if (!payload?.providerId || !payload.method) throw new Error("providerId and method are required");
        const runtime = await getModelRuntime();
        if (payload.method === "api-key") {
          const apiKey = payload.secret?.trim();
          if (!apiKey) throw new Error("An API key is required");
          await persistProviderApiKey(runtime, payload.providerId, apiKey, request.id);
        } else {
          await runtime.login(payload.providerId, "oauth", createAuthInteraction(request.id));
        }
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "providers.setApiKey": {
        const payload = request.payload as { providerId?: string; apiKey?: string } | undefined;
        if (!payload?.providerId || !payload.apiKey) throw new Error("providerId and apiKey are required");
        const runtime = await getModelRuntime();
        const apiKey = payload.apiKey.trim();
        if (!apiKey) throw new Error("An API key is required");
        await persistProviderApiKey(runtime, payload.providerId, apiKey, request.id);
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "providers.logout": {
        const payload = request.payload as { providerId?: string } | undefined;
        if (!payload?.providerId) throw new Error("providerId is required");
        const runtime = await getModelRuntime();
        await runtime.logout(payload.providerId);
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "providers.auth-response": {
        const payload = request.payload as { requestId?: string; value?: string; cancelled?: boolean } | undefined;
        if (!payload?.requestId || (!payload.cancelled && payload.value === undefined)) throw new Error("requestId and value are required");
        const waiter = authWaiters.get(payload.requestId);
        if (!waiter) throw new Error("Auth prompt is no longer active");
        authWaiters.delete(payload.requestId);
        if (payload.cancelled) waiter.reject(new Error("Authentication cancelled"));
        else waiter.resolve(payload.value as string);
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "permissions.status":
        send({ id: request.id, ok: true, result: permissionEngine.status() });
        return;
      case "permissions.setMode": {
        const payload = request.payload as { mode?: PermissionMode } | undefined;
        if (!payload?.mode || !["ask", "allow", "deny", "yolo"].includes(payload.mode)) throw new Error("Invalid permission mode");
        capabilitySessions.clear();
        send({ id: request.id, ok: true, result: await permissionEngine.setMode(payload.mode) });
        return;
      }
      case "approval.resolve": {
        const payload = request.payload as { requestId?: string; decision?: "allow-once" | "deny" } | undefined;
        if (!payload?.requestId || !payload.decision) throw new Error("requestId and decision are required");
        // A permission-level switch may have already resolved this request.
        // Treat a late UI click as an idempotent no-op.
        try { permissionEngine.resolve(payload.requestId, payload.decision); } catch { /* Already resolved. */ }
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      default: {
        // An unknown command must fail fast. Without this the renderer would
        // wait for the request timeout instead of seeing an actionable error.
        send({ id: request.id, ok: false, error: `Unknown PiHost command: ${String((request as { command?: unknown }).command ?? "")}` });
        return;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = process.env.PIDECK_DEBUG ? (error instanceof Error ? `\n${error.stack ?? ""}` : "") : "";
    send({ id: request.id, ok: false, error: `${message}${detail}` });
  }
}

parentPort?.on("message", (event: { data: unknown }) => void handle(event.data as PiHostRequest));
process.on("message", (request: PiHostRequest) => void handle(request));
parentPort?.postMessage({ type: "runtime.status", payload: "connected" });
process.send?.({ type: "runtime.status", payload: "connected" });

// Observe fatal errors without changing Node's default crash semantics. Main
// owns the exit path: it rejects pending calls, publishes "disconnected", and
// can fork a clean PiHost on restart. Continuing after an uncaught exception
// would leave SDK/session state in an undefined condition.
process.on("uncaughtExceptionMonitor", (error) => {
  console.error("PiHost uncaught exception", error);
});
