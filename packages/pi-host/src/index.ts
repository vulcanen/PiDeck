import type { PermissionMode, PiHostRequest, PiHostResponse, SessionChangeReview, SessionRunRecord } from "@pideck/contracts";
import { deriveSessionTitle, isCommandDerivedSessionTitle, isDefaultSessionTitle } from "@pideck/domain";
import { configurePiHttpNetworking, getModelRuntime, loadPiSdk, modelSummary, resolvePiModule, sessionModelLabel } from "@pideck/pi-adapter";
import { PermissionEngine, resolvePermissionExtensionPath } from "@pideck/permission-engine";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { buildSessionChangeReview, captureWorkspaceChangeState, type WorkspaceChangeState } from "./session-change-review.js";
import { sessionTranscriptMessages } from "./session-transcript.js";

function execFileText(file: string, args: string[], options: { cwd?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      ...options,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

const parentPort = (process as typeof process & {
  parentPort?: {
    on(event: "message", listener: (event: { data: unknown }) => void): void;
    postMessage(message: unknown): void;
  };
}).parentPort;
const proxyResolveWaiters = new Map<string, {
  resolve: (rules: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

function resolveSystemProxy(url: string): Promise<string> {
  if (!process.send) return Promise.reject(new Error("PiDeck system proxy bridge is unavailable"));
  const requestId = randomUUID();
  return new Promise<string>((resolve, reject) => {
    const hostname = new URL(url).hostname;
    const timer = setTimeout(() => {
      proxyResolveWaiters.delete(requestId);
      reject(new Error(`System proxy resolution timed out for ${hostname}`));
    }, 10_000);
    proxyResolveWaiters.set(requestId, { resolve, reject, timer });
    process.send?.({ type: "proxy.resolve", requestId, url });
  });
}

function handleProxyResolveResult(message: { requestId: string; rules?: string; error?: string }): void {
  const waiter = proxyResolveWaiters.get(message.requestId);
  if (!waiter) return;
  proxyResolveWaiters.delete(message.requestId);
  clearTimeout(waiter.timer);
  if (typeof message.rules === "string") waiter.resolve(message.rules);
  else waiter.reject(new Error(message.error || "System proxy resolution failed"));
}

function publicRuntimeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/([a-z][a-z\d+.-]*:\/\/)[^/@\s]+@/gi, "$1***@");
}

const httpNetworkingReady = configurePiHttpNetworking({ resolveSystemProxy });
const sessionManagers = new Map<string, any>();
const sessionFiles = new Map<string, string>();
const titledSessions = new Set<string>();
const agentSessions = new Map<string, any>();
const agentSessionPromises = new Map<string, Promise<any>>();
const agentSessionPackageRevisions = new Map<string, number>();
const executionGroupStarts = new Map<string, number>();
const SESSION_RUN_METADATA_TYPE = "pideck.execution-run";
const SESSION_CHANGE_REVIEW_METADATA_TYPE = "pideck.change-review";
const MAX_SESSION_CHANGE_REVIEW_HISTORY = 20;
type ActiveChangeReviewSegment = { startedAt: number; baseline: Promise<WorkspaceChangeState | null> };
type ActiveChangeReviewTracker = { current: ActiveChangeReviewSegment; persistence: Promise<void>; previewRevision: number };
const activeChangeReviews = new Map<string, ActiveChangeReviewTracker>();
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
  beforeResolve?: (value: string) => Promise<void>;
};
const authWaiters = new Map<string, AuthWaiter>();
type ActiveProviderLogin = {
  operationId: string;
  providerId: string;
  controller: AbortController;
};
const activeProviderLogins = new Map<string, ActiveProviderLogin>();
const activeProviderLoginByProvider = new Map<string, ActiveProviderLogin>();
const agentSessionRevisions = new Map<string, number>();

/**
 * Pi session IDs are normally UUIDs, but imported JSONL files can preserve an
 * ID that already exists in another project. Keep every in-memory resource
 * scoped to its project so an operation in one workspace can never address a
 * same-ID session in another workspace.
 */
function sessionStateKey(taskId: string, cwd: string): string {
  const resolvedCwd = path.resolve(cwd);
  const normalizedCwd = process.platform === "win32" ? resolvedCwd.toLowerCase() : resolvedCwd;
  return JSON.stringify([normalizedCwd, taskId]);
}
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
const OPENAI_CODEX_FIXED_LOOPBACK_SDK_VERSIONS = new Set(["0.84.2", "0.84.3"]);
const OPENAI_CODEX_LOOPBACK_PORT = 1455;

function isOpenAICodexBrowserMethodPrompt(providerId: string, prompt: any): boolean {
  const version = sdkVersion();
  if (providerId !== "openai-codex" || !version || !OPENAI_CODEX_FIXED_LOOPBACK_SDK_VERSIONS.has(version) || prompt?.type !== "select") return false;
  const optionIds = Array.isArray(prompt.options) ? prompt.options.map((option: any) => option?.id) : [];
  return optionIds.includes("browser") && optionIds.includes("device_code");
}

/**
 * Pi 0.84.2 and 0.84.3's OpenAI Codex browser flow silently falls back to manual URL
 * entry when its fixed loopback listener cannot bind. Probe the same endpoint
 * immediately before Pi starts it so the UI can keep the method picker open
 * and offer device-code login instead of presenting a mysterious stale form.
 */
async function assertOpenAICodexLoopbackAvailable(): Promise<void> {
  const host = process.env.PI_OAUTH_CALLBACK_HOST?.trim() || "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(new Error(`PIDECK_OAUTH_CALLBACK_UNAVAILABLE:${error.code ?? "UNKNOWN"}`));
    });
    server.listen({ host, port: OPENAI_CODEX_LOOPBACK_PORT, exclusive: true }, () => {
      server.close((error) => {
        if (error) reject(new Error("PIDECK_OAUTH_CALLBACK_UNAVAILABLE:CLOSE_FAILED"));
        else resolve();
      });
    });
  });
}

function createAuthInteraction(requestId: string, providerId: string, initialSecret?: string, operationSignal?: AbortSignal) {
  let initialSecretAvailable = Boolean(initialSecret);
  let promptSequence = 0;
  return {
    signal: operationSignal,
    prompt: (prompt: any) => {
      if (operationSignal?.aborted) return Promise.reject(operationSignal.reason ?? new Error("Authentication cancelled"));
      if (initialSecretAvailable && prompt?.type !== "select") {
        initialSecretAvailable = false;
        return Promise.resolve(initialSecret as string);
      }
      const promptId = `${requestId}:${++promptSequence}`;
      emitAuth(promptId, { type: "prompt", prompt: jsonSafe(prompt) });
      const beforeResolve = isOpenAICodexBrowserMethodPrompt(providerId, prompt)
        ? async (value: string) => { if (value === "browser") await assertOpenAICodexLoopbackAvailable(); }
        : undefined;
      return new Promise<string>((resolve, reject) => {
        const promptSignal = prompt?.signal as AbortSignal | undefined;
        const signal = operationSignal && promptSignal
          ? AbortSignal.any([operationSignal, promptSignal])
          : operationSignal ?? promptSignal;
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        const waiter: AuthWaiter = {
          beforeResolve,
          resolve: (value) => { cleanup(); resolve(value); },
          reject: (reason) => { cleanup(); reject(reason); },
        };
        const onAbort = () => {
          if (authWaiters.get(promptId) !== waiter) return;
          authWaiters.delete(promptId);
          waiter.reject(signal?.reason ?? new Error("Authentication prompt cancelled"));
        };
        authWaiters.set(promptId, waiter);
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
    notify: (event: unknown) => {
      if (!operationSignal?.aborted) emitAuth(requestId, { type: "notify", event: jsonSafe(event) });
    },
  };
}

async function persistProviderApiKey(runtime: any, providerId: string, apiKey: string, requestId: string): Promise<void> {
  const provider = runtime.getProvider?.(providerId);
  if (!provider?.auth?.apiKey?.login) throw new Error(`${provider?.name ?? providerId} does not support API-key login`);
  // ModelRuntime.login persists the returned credential through Pi's
  // credential store. setRuntimeApiKey is intentionally runtime-only.
  await runtime.login(providerId, "api-key", createAuthInteraction(requestId, providerId, apiKey));
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

function finishExecutionGroup(session: any, stateKey: string, taskId: string, endedAt: number): void {
  const startedAt = executionGroupStarts.get(stateKey);
  executionGroupStarts.delete(stateKey);
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

function sessionChangeReviews(session: any): SessionChangeReview[] {
  const entries = session.sessionManager?.getBranch?.() ?? session.sessionManager?.getEntries?.() ?? [];
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry: any) => entry?.type === "custom" && entry.customType === SESSION_CHANGE_REVIEW_METADATA_TYPE)
    .map((entry: any) => entry.data)
    .filter((record: any): record is SessionChangeReview => Boolean(
      record
      && typeof record.id === "string"
      && record.state === "completed"
      && Number.isFinite(record.startedAt)
      && Number.isFinite(record.endedAt)
      && Array.isArray(record.files)
      && Number.isFinite(record.additions)
      && Number.isFinite(record.deletions),
    ))
    .slice(-MAX_SESSION_CHANGE_REVIEW_HISTORY);
}

function persistSessionChangeReview(session: any, review: SessionChangeReview): void {
  const appendEntry = session.sessionManager?.appendCustomEntry;
  if (typeof appendEntry !== "function") return;
  try {
    appendEntry.call(session.sessionManager, SESSION_CHANGE_REVIEW_METADATA_TYPE, review);
  } catch {
    // Review metadata is auxiliary. An in-memory/read-only Session must still
    // be allowed to complete and deliver its canonical Pi messages.
  }
}

function emptyRunningChangeReview(taskId: string, startedAt: number): SessionChangeReview {
  return { id: `${taskId}:${startedAt}`, state: "running", startedAt, endedAt: startedAt, files: [], additions: 0, deletions: 0, truncated: false };
}

function startChangeReview(stateKey: string, taskId: string, cwd: string, startedAt: number): void {
  const segment = { startedAt, baseline: captureWorkspaceChangeState(cwd) };
  const tracker: ActiveChangeReviewTracker = { current: segment, persistence: Promise.resolve(), previewRevision: 0 };
  activeChangeReviews.set(stateKey, tracker);
  void segment.baseline.then((baseline) => {
    if (baseline && activeChangeReviews.get(stateKey) === tracker && tracker.current === segment) {
      emit(taskId, { type: "change-review.updated", review: emptyRunningChangeReview(taskId, startedAt) });
    }
  });
}

function finalizeChangeReviewSegment(
  session: any,
  stateKey: string,
  taskId: string,
  segment: ActiveChangeReviewSegment,
  finalState: Promise<WorkspaceChangeState | null>,
  endedAt: number,
  generateUnifiedPatch: NonNullable<Awaited<ReturnType<typeof loadPiSdk>>["generateUnifiedPatch"]> | undefined,
): Promise<void> {
  if (!generateUnifiedPatch) return Promise.resolve();
  return Promise.all([segment.baseline, finalState])
    .then(async ([before, after]) => {
      const review = await buildSessionChangeReview(taskId, segment.startedAt, endedAt, before, after, generateUnifiedPatch);
      if (!review || sessionManagers.get(stateKey) !== session.sessionManager) return;
      persistSessionChangeReview(session, review);
      emit(taskId, { type: "change-review.updated", review: jsonSafe(review) });
    })
    .catch((error) => console.error(`PiHost change review failed for ${taskId}`, error));
}

function rotateChangeReview(
  session: any,
  stateKey: string,
  taskId: string,
  cwd: string,
  boundary: number,
  generateUnifiedPatch: NonNullable<Awaited<ReturnType<typeof loadPiSdk>>["generateUnifiedPatch"]> | undefined,
): void {
  const tracker = activeChangeReviews.get(stateKey);
  if (!tracker) {
    startChangeReview(stateKey, taskId, cwd, boundary);
    return;
  }
  const previous = tracker.current;
  const boundaryState = captureWorkspaceChangeState(cwd);
  const current = { startedAt: boundary, baseline: boundaryState };
  tracker.current = current;
  tracker.previewRevision += 1;
  void boundaryState.then((baseline) => {
    if (baseline && activeChangeReviews.get(stateKey) === tracker && tracker.current === current) {
      emit(taskId, { type: "change-review.updated", review: emptyRunningChangeReview(taskId, boundary) });
    }
  });
  tracker.persistence = tracker.persistence.then(() => finalizeChangeReviewSegment(session, stateKey, taskId, previous, boundaryState, boundary, generateUnifiedPatch));
}

function finishChangeReview(
  session: any,
  stateKey: string,
  taskId: string,
  cwd: string,
  endedAt: number,
  generateUnifiedPatch: NonNullable<Awaited<ReturnType<typeof loadPiSdk>>["generateUnifiedPatch"]> | undefined,
): void {
  const tracker = activeChangeReviews.get(stateKey);
  if (!tracker) return;
  activeChangeReviews.delete(stateKey);
  const finalState = captureWorkspaceChangeState(cwd);
  tracker.persistence = tracker.persistence.then(() => finalizeChangeReviewSegment(session, stateKey, taskId, tracker.current, finalState, endedAt, generateUnifiedPatch));
}

function previewChangeReview(
  stateKey: string,
  taskId: string,
  cwd: string,
  generateUnifiedPatch: NonNullable<Awaited<ReturnType<typeof loadPiSdk>>["generateUnifiedPatch"]> | undefined,
): void {
  const tracker = activeChangeReviews.get(stateKey);
  if (!tracker || !generateUnifiedPatch) return;
  const segment = tracker.current;
  const revision = ++tracker.previewRevision;
  const previewState = captureWorkspaceChangeState(cwd);
  void Promise.all([segment.baseline, previewState])
    .then(async ([before, after]) => {
      const review = await buildSessionChangeReview(taskId, segment.startedAt, Date.now(), before, after, generateUnifiedPatch, "running");
      const current = activeChangeReviews.get(stateKey);
      if (!review || current !== tracker || current.current !== segment || current.previewRevision !== revision) return;
      emit(taskId, { type: "change-review.updated", review: jsonSafe(review) });
    })
    .catch((error) => console.error(`PiHost live change review failed for ${taskId}`, error));
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

type QueuedPromptImage = { id: string; text: string; images: NormalizedPromptImage[] };
type QueuedPromptImageState = { steering: QueuedPromptImage[]; followUp: QueuedPromptImage[] };
type QueueDeliveryHint = { text: string; delivery: "steer" | "followUp" };

// AgentSession exposes queue text for display, while its internal queue also
// carries images. Keep stable IDs and image attachments in this PiHost sidecar
// so thumbnails, promotion, and editing can rebuild the real Pi queue without
// silently dropping attachments.
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
    // Pi consumes queues from the front. When the queue shrinks, align from
    // the end so duplicate text keeps the newest remaining entry's stable ID;
    // appends are already tracked before Pi emits queue_update and align from
    // the front in normal order.
    if (entries.length > texts.length) {
      const result = new Array<QueuedPromptImage>(texts.length);
      for (let textIndex = texts.length - 1; textIndex >= 0; textIndex -= 1) {
        const text = texts[textIndex]!;
        let entryIndex = -1;
        for (let index = remaining.length - 1; index >= 0; index -= 1) {
          if (remaining[index]?.text === text) { entryIndex = index; break; }
        }
        const [entry] = remaining.splice(entryIndex >= 0 ? entryIndex : Math.max(0, remaining.length - 1), 1);
        result[textIndex] = entry ? { ...entry, text } : { id: randomUUID(), text, images: [] };
      }
      return result;
    }
    return texts.map((text) => {
      const index = remaining.findIndex((entry) => entry.text === text);
      const [entry] = remaining.splice(index >= 0 ? index : 0, 1);
      return entry ? { ...entry, text } : { id: randomUUID(), text, images: [] };
    });
  };
  queuedPromptImages.set(taskId, {
    steering: reconcile(steering, previous.steering),
    followUp: reconcile(followUp, previous.followUp),
  });
}

function setQueuedPromptImages(taskId: string, steering: QueuedPromptImage[], followUp: QueuedPromptImage[]) {
  queuedPromptImages.set(taskId, {
    steering: steering.map((entry) => ({ id: entry.id, text: entry.text, images: [...entry.images] })),
    followUp: followUp.map((entry) => ({ id: entry.id, text: entry.text, images: [...entry.images] })),
  });
}

function queuedPromptImagesForTexts(texts: string[], candidates: QueuedPromptImage[]): QueuedPromptImage[] {
  const remaining = [...candidates];
  return texts.map((text) => {
    const index = remaining.findIndex((entry) => entry.text === text);
    const [entry] = remaining.splice(index >= 0 ? index : 0, 1);
    return entry ? { ...entry, text } : { id: randomUUID(), text, images: [] };
  });
}

function queueStateWithDetails(session: any, taskId: string) {
  const current = queueState(session);
  reconcileQueuedPromptImages(taskId, current.steering, current.followUp);
  const details = queuedPromptImageState(taskId);
  const messages = (texts: string[], entries: QueuedPromptImage[]) => texts.map((text, index) => ({
    id: entries[index]?.id ?? randomUUID(),
    text,
    images: (entries[index]?.images ?? []).map((image) => ({ data: image.data, mimeType: image.mimeType })),
  }));
  return {
    steering: messages(current.steering, details.steering),
    followUp: messages(current.followUp, details.followUp),
    steeringMode: current.steeringMode,
    followUpMode: current.followUpMode,
  };
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
  bucket.push({ id: randomUUID(), text, images: images ? [...images] : [] });
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

async function gitChanges(cwd: string): Promise<Array<{ path: string; status: string; additions: number; deletions: number }>> {
  try {
    const [statusOutput, statOutput] = await Promise.all([
      execFileText("git", ["-C", cwd, "status", "--porcelain", "--untracked-files=all"], { timeout: 10_000 }),
      execFileText("git", ["-C", cwd, "diff", "--numstat", "HEAD"], { timeout: 10_000 }),
    ]);
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
  const stateKey = sessionStateKey(taskId, cwd);
  const existing = agentSessions.get(stateKey);
  if (existing) {
    const sessionRevision = agentSessionRevisions.get(stateKey);
    const sessionPackageRevision = agentSessionPackageRevisions.get(stateKey);
    if ((sessionRevision === permissionEngine.revision && sessionPackageRevision === packageConfigRevision) || existing.isStreaming || agentRunReservations.has(stateKey)) {
      if (!existing.isStreaming) normalizeSessionImages(existing.sessionManager);
      return existing;
    }
    // Do not interrupt an active turn. Once idle, recreate against the new
    // extension configuration while keeping the same Pi SessionManager/file.
    existing.dispose?.();
    agentSessions.delete(stateKey);
    agentSessionRevisions.delete(stateKey);
    agentSessionPackageRevisions.delete(stateKey);
    // Queue contents live only on AgentSession. Drop renderer-side queue
    // sidecars and delivery hints when the idle session is recreated.
    queuedPromptImages.delete(stateKey);
    queueDeliveryHints.delete(stateKey);
    queueRebuilds.delete(stateKey);
    agentRunReservations.delete(stateKey);
  }
  const pending = agentSessionPromises.get(stateKey);
  if (pending) return pending;

  const creationRevision = permissionEngine.revision;
  const creation = (async () => {
    const sdk = await loadPiSdk();
    let manager = sessionManagers.get(stateKey);
    if (!manager) {
      const sessionPath = sessionFiles.get(stateKey);
      manager = sessionPath ? sdk.SessionManager.open(sessionPath) : sdk.SessionManager.create(cwd);
      sessionManagers.set(stateKey, manager);
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
    await session.bindExtensions?.({ uiContext: permissionEngine.createUi(taskId, stateKey) });
    const previousBeforeToolCall = session.agent.beforeToolCall;
    session.agent.beforeToolCall = (context: any, signal?: AbortSignal) => permissionEngine.beforeToolCallWithExtension(
      taskId,
      context,
      previousBeforeToolCall,
      permissionExtensionLoaded,
      signal,
      stateKey,
    );
    session.subscribe((event: any) => {
      try {
        if (event.type === "queue_update") {
          // A clear-and-rebuild mutation is exposed atomically through its IPC
          // response; suppress Pi's intermediate empty/partial queue events so
          // the Renderer cannot edit or promote a transient row.
          if (queueRebuilds.has(stateKey)) return;
          const steering = Array.isArray(event.steering) ? event.steering : [];
          const followUp = Array.isArray(event.followUp) ? event.followUp : [];
          recordQueueDeliveryHints(stateKey, steering, followUp);
          reconcileQueuedPromptImages(stateKey, steering, followUp);
          emit(taskId, { type: "queue_update", ...queueStateWithDetails(session, stateKey) });
          return;
        }
        // A delivery hint is only meaningful until the current agent run is
        // settled. If Pi aborts or drops a queued message without emitting its
        // message_start event, discard the hint so a later identical prompt
        // cannot inherit the wrong steering/follow-up classification.
        if (event.type === "agent_settled") queueDeliveryHints.delete(stateKey);
        if (event.type === "agent_start") {
          const startedAt = Date.now();
          executionGroupStarts.set(stateKey, startedAt);
          startChangeReview(stateKey, taskId, cwd, startedAt);
        }
        if (event.type === "agent_settled") {
          const endedAt = Date.now();
          finishExecutionGroup(session, stateKey, taskId, endedAt);
          finishChangeReview(session, stateKey, taskId, cwd, endedAt, sdk.generateUnifiedPatch);
        }
        if (event.type === "message_start" && event.message?.role === "user") {
          const queueDelivery = consumeQueueDeliveryHint(stateKey, queueMessageText(event.message));
          if (queueDelivery === "followUp") {
            const boundary = Date.now();
            finishExecutionGroup(session, stateKey, taskId, boundary);
            executionGroupStarts.set(stateKey, boundary);
            rotateChangeReview(session, stateKey, taskId, cwd, boundary, sdk.generateUnifiedPatch);
          } else if (!executionGroupStarts.has(stateKey)) {
            const startedAt = Date.now();
            executionGroupStarts.set(stateKey, startedAt);
            startChangeReview(stateKey, taskId, cwd, startedAt);
          }
          emit(taskId, normalizeAgentEvent(event, queueDelivery));
          return;
        }
        if (event.type === "tool_execution_end" && /^(?:edit|write|bash|powershell)$/i.test(event.toolName ?? "")) {
          previewChangeReview(stateKey, taskId, cwd, sdk.generateUnifiedPatch);
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
          setTimeout(() => emit(taskId, { type: "message.snapshot", messages: jsonSafe(sessionTranscriptMessages(session, sdk.sessionEntryToContextMessages)) }), 0);
        } else if (event.type === "agent_settled") {
          emit(taskId, { type: "message.snapshot", messages: jsonSafe(sessionTranscriptMessages(session, sdk.sessionEntryToContextMessages)) });
        } else if (event.type === "compaction_end") {
          // AgentSession.messages now contains only the compacted model context,
          // but the display transcript still comes from every persisted entry
          // on the active Session branch. Replace the Renderer snapshot so a
          // branch/compaction boundary is applied authoritatively without
          // hiding the summarized prefix after a later restart.
          emit(taskId, { type: "message.snapshot", replace: true, messages: jsonSafe(sessionTranscriptMessages(session, sdk.sessionEntryToContextMessages)) });
        }
      } catch (error) {
        console.error(`PiHost message snapshot handler failed for ${taskId}`, error);
      }
    });
    agentSessions.set(stateKey, session);
    agentSessionRevisions.set(stateKey, creationRevision);
    agentSessionPackageRevisions.set(stateKey, packageConfigRevision);
    return session;
  })();
  agentSessionPromises.set(stateKey, creation);
  try {
    return await creation;
  } finally {
    agentSessionPromises.delete(stateKey);
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
    await httpNetworkingReady;
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
        for (const session of sessions) sessionFiles.set(sessionStateKey(session.id, cwd), session.path);
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
            changes: await gitChanges(cwd),
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
        const stateKey = sessionStateKey(sessionId, cwd);
        sessionManagers.set(stateKey, sessionManager);
        const sessionFile = sessionManager.getSessionFile?.();
        if (sessionFile) sessionFiles.set(stateKey, sessionFile);
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
        const cwd = payload.cwd ?? resolveWorkspaceCwd();
        const stateKey = sessionStateKey(payload.taskId, cwd);
        const sdk = await loadPiSdk();
        const session = agentSessions.get(stateKey) ?? await ensureAgentSession(
          payload.taskId,
          cwd,
        );
        send({ id: request.id, ok: true, result: jsonSafe(sessionTranscriptMessages(session, sdk.sessionEntryToContextMessages)) });
        return;
      }
      case "sessions.runMetadata": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        send({ id: request.id, ok: true, result: jsonSafe(sessionRunMetadata(session)) });
        return;
      }
      case "sessions.changeReviews": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        send({ id: request.id, ok: true, result: jsonSafe(sessionChangeReviews(session)) });
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
        const commandSession = payload?.taskId && agentSessionPackageRevisions.get(sessionStateKey(payload.taskId, cwd)) !== packageConfigRevision
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
        const sdk = await loadPiSdk();
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        const result = await session.compact(payload.instructions);
        emit(payload.taskId, { type: "message.snapshot", replace: true, messages: jsonSafe(sessionTranscriptMessages(session, sdk.sessionEntryToContextMessages)) });
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
        const currentStateKey = payload.taskId ? sessionStateKey(payload.taskId, cwd) : undefined;
        const currentPath = currentStateKey ? sessionFiles.get(currentStateKey) : undefined;
        const currentManager = currentStateKey ? sessionManagers.get(currentStateKey) : undefined;
        const scratchManager = sdk.SessionManager.create(cwd);
        const targetDir = currentManager?.getSessionDir?.() ?? (currentPath ? path.dirname(currentPath) : undefined) ?? scratchManager.getSessionDir?.() ?? path.join(cwd, ".pi", "sessions");
        mkdirSync(targetDir, { recursive: true });
        const destination = path.join(targetDir, `import-${Date.now()}-${path.basename(inputPath)}`);
        copyFileSync(inputPath, destination);
        const manager = sdk.SessionManager.open(destination, targetDir, cwd);
        normalizeSessionImages(manager);
        const sessionId = manager.getSessionId();
        const stateKey = sessionStateKey(sessionId, cwd);
        sessionManagers.set(stateKey, manager);
        sessionFiles.set(stateKey, destination);
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
        await execFileText("gh", ["auth", "status"], { timeout: 30_000 });
        const tempPath = path.join(os.tmpdir(), `pideck-session-${Date.now()}.html`);
        try {
          await session.exportToHtml(tempPath);
          const gistUrl = (await execFileText("gh", ["gist", "create", "--public=false", tempPath], { timeout: 10 * 60_000 })).trim();
          const gistId = gistUrl.split("/").filter(Boolean).pop();
          if (!gistId) throw new Error("Could not parse the gist URL returned by gh");
          const viewerBase = process.env.PI_SHARE_VIEWER_URL ?? "https://pi.dev/session/";
          send({ id: request.id, ok: true, result: { url: `${viewerBase}#${gistId}`, gistUrl } });
        } finally {
          try { await unlink(tempPath); } catch { /* Best effort cleanup. */ }
        }
        return;
      }
      case "agent.prompt": {
        const payload = request.payload as { taskId?: string; text?: string; cwd?: string; images?: Array<{ data: string; mimeType: string }>; delivery?: "steer" | "followUp" } | undefined;
        const images = normalizePromptImages(payload?.images);
        if (!payload?.taskId || (!payload.text && !images?.length)) throw new Error("taskId and text or images are required");
        const cwd = payload.cwd ?? resolveWorkspaceCwd();
        const stateKey = sessionStateKey(payload.taskId, cwd);
        const session = await ensureAgentSession(payload.taskId, cwd);
        const sessionName = session.sessionManager?.getSessionName?.();
        if (!titledSessions.has(stateKey) && (isDefaultSessionTitle(sessionName) || isCommandDerivedSessionTitle(sessionName))) {
          const title = deriveSessionTitle(payload.text ?? "");
          if (title) {
            if (typeof session.setSessionName === "function") session.setSessionName(title);
            else session.sessionManager?.appendSessionInfo?.(title);
            titledSessions.add(stateKey);
          }
        }
        const wasStreaming = Boolean(session.isStreaming || agentRunReservations.has(stateKey));
        const queuedDelivery = wasStreaming ? payload.delivery ?? "followUp" as const : undefined;
        if (!queuedDelivery) agentRunReservations.add(stateKey);
        const runPrompt = async () => {
          if (queuedDelivery) trackQueuedPrompt(stateKey, queuedDelivery, payload.text ?? "", images);
          await session.prompt(payload.text ?? "", {
            source: "interactive",
            images,
            ...(queuedDelivery ? { streamingBehavior: queuedDelivery } : {}),
          });
          if (queuedDelivery) {
            const current = queueState(session);
            reconcileQueuedPromptImages(stateKey, current.steering, current.followUp);
          }
        };
        try {
          if (queuedDelivery) await withQueueMutationLock(stateKey, runPrompt);
          else await runPrompt();
        } catch (error) {
          if (queuedDelivery) {
            const current = queueState(session);
            reconcileQueuedPromptImages(stateKey, current.steering, current.followUp);
          }
          // A failed prompt must not leave Pi's AgentSession streaming. Aborting
          // here lets the next user prompt start a fresh execution group.
          if (session.isStreaming) {
            try { await session.abort(); } catch { /* Preserve the original prompt error. */ }
          }
          throw error;
        } finally {
          if (!queuedDelivery) agentRunReservations.delete(stateKey);
        }
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "sessions.delete": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const cwd = payload.cwd ?? resolveWorkspaceCwd();
        const stateKey = sessionStateKey(payload.taskId, cwd);
        const sessionPath = sessionFiles.get(stateKey);
        const session = agentSessions.get(stateKey);
        if (session?.isStreaming) await session.abort();
        await session?.dispose?.();
        if (sessionPath && existsSync(sessionPath)) await unlink(sessionPath);
        sessionFiles.delete(stateKey);
        titledSessions.delete(stateKey);
        sessionManagers.delete(stateKey);
        agentSessions.delete(stateKey);
        agentSessionPackageRevisions.delete(stateKey);
        agentSessionRevisions.delete(stateKey);
        queuedPromptImages.delete(stateKey);
        queueDeliveryHints.delete(stateKey);
        queueMutationLocks.delete(stateKey);
        queueRebuilds.delete(stateKey);
        agentRunReservations.delete(stateKey);
        executionGroupStarts.delete(stateKey);
        activeChangeReviews.delete(stateKey);
        permissionEngine.dispose(stateKey);
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "agent.abort": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const stateKey = sessionStateKey(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        const session = agentSessions.get(stateKey);
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
        const cwd = payload.cwd ?? resolveWorkspaceCwd();
        const stateKey = sessionStateKey(payload.taskId, cwd);
        const session = await ensureAgentSession(payload.taskId, cwd);
        const current = queueState(session);
        reconcileQueuedPromptImages(stateKey, current.steering, current.followUp);
        send({ id: request.id, ok: true, result: queueStateWithDetails(session, stateKey) });
        return;
      }
      case "agent.setQueueModes": {
        const payload = request.payload as { taskId?: string; cwd?: string; steeringMode?: "all" | "one-at-a-time"; followUpMode?: "all" | "one-at-a-time" } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const cwd = payload.cwd ?? resolveWorkspaceCwd();
        const stateKey = sessionStateKey(payload.taskId, cwd);
        const session = await ensureAgentSession(payload.taskId, cwd);
        if (payload.steeringMode) session.setSteeringMode(payload.steeringMode);
        if (payload.followUpMode) session.setFollowUpMode(payload.followUpMode);
        send({ id: request.id, ok: true, result: queueStateWithDetails(session, stateKey) });
        return;
      }
      case "agent.clearQueue": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const cwd = payload.cwd ?? resolveWorkspaceCwd();
        const stateKey = sessionStateKey(payload.taskId, cwd);
        const session = await ensureAgentSession(payload.taskId, cwd);
        await withQueueMutationLock(stateKey, async () => {
          queueRebuilds.add(stateKey);
          try {
            session.clearQueue();
            setQueuedPromptImages(stateKey, [], []);
            queueDeliveryHints.delete(stateKey);
            send({ id: request.id, ok: true, result: queueStateWithDetails(session, stateKey) });
          } finally {
            queueRebuilds.delete(stateKey);
          }
        });
        return;
      }
      case "agent.promoteQueue": {
        const payload = request.payload as { taskId?: string; cwd?: string; followUpIndex?: number } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        if (!Number.isInteger(payload.followUpIndex) || (payload.followUpIndex ?? -1) < 0) throw new Error("followUpIndex is required");
        const cwd = payload.cwd ?? resolveWorkspaceCwd();
        const session = await ensureAgentSession(payload.taskId, cwd);
        const stateKey = sessionStateKey(payload.taskId, cwd);
        await withQueueMutationLock(stateKey, async () => {
          // Validate against the live queue before clearing it. A stale UI
          // index must never cause a different message to be promoted.
          const liveQueue = queueState(session);
          const followUpIndex = payload.followUpIndex!;
          if (typeof liveQueue.followUp[followUpIndex] !== "string") throw new Error("Queued message is no longer available");

          const imageState = queuedPromptImageState(stateKey);
          const queued = {
            steering: liveQueue.steering.map((text, index) => imageState.steering[index] ?? { id: randomUUID(), text, images: [] }),
            followUp: liveQueue.followUp.map((text, index) => imageState.followUp[index] ?? { id: randomUUID(), text, images: [] }),
          };
          const selected = queued.followUp[followUpIndex];
          if (!selected) throw new Error("Queued message is no longer available");
          queueRebuilds.add(stateKey);
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
                  stateKey,
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
              stateKey,
              queuedPromptImagesForTexts(next.steering, [selected, ...queued.steering]),
              queuedPromptImagesForTexts(next.followUp, queued.followUp.filter((_message, index) => index !== followUpIndex)),
            );
            send({ id: request.id, ok: true, result: queueStateWithDetails(session, stateKey) });
          } finally {
            queueRebuilds.delete(stateKey);
          }
        });
        return;
      }
      case "agent.editQueue": {
        const payload = request.payload as { taskId?: string; cwd?: string; messageId?: string; text?: string; images?: Array<{ data: string; mimeType: string }> } | undefined;
        const images = normalizePromptImages(payload?.images) ?? [];
        if (!payload?.taskId || !payload.messageId || (!payload.text?.trim() && images.length === 0)) throw new Error("taskId, messageId, and text or images are required");
        const cwd = payload.cwd ?? resolveWorkspaceCwd();
        const stateKey = sessionStateKey(payload.taskId, cwd);
        const session = await ensureAgentSession(payload.taskId, cwd);
        await withQueueMutationLock(stateKey, async () => {
          const liveQueue = queueState(session);
          reconcileQueuedPromptImages(stateKey, liveQueue.steering, liveQueue.followUp);
          const imageState = queuedPromptImageState(stateKey);
          const original = {
            steering: liveQueue.steering.map((text, index) => imageState.steering[index] ?? { id: randomUUID(), text, images: [] }),
            followUp: liveQueue.followUp.map((text, index) => imageState.followUp[index] ?? { id: randomUUID(), text, images: [] }),
          };
          const steeringIndex = original.steering.findIndex((message) => message.id === payload.messageId);
          const followUpIndex = original.followUp.findIndex((message) => message.id === payload.messageId);
          if (steeringIndex < 0 && followUpIndex < 0) throw new Error("Queued message is no longer available");

          const edited = { id: payload.messageId!, text: payload.text?.trim() ?? "", images };
          const updated = {
            steering: original.steering.map((message, index) => index === steeringIndex ? edited : message),
            followUp: original.followUp.map((message, index) => index === followUpIndex ? edited : message),
          };
          queueRebuilds.add(stateKey);
          try {
            session.clearQueue();
            try {
              for (const message of updated.steering) await session.steer(message.text, message.images);
              for (const message of updated.followUp) await session.followUp(message.text, message.images);
            } catch (error) {
              try {
                session.clearQueue();
                for (const message of original.steering) await session.steer(message.text, message.images);
                for (const message of original.followUp) await session.followUp(message.text, message.images);
                setQueuedPromptImages(stateKey, original.steering, original.followUp);
              } catch (restoreError) {
                // eslint-disable-next-line preserve-caught-error
                throw new Error(`${error instanceof Error ? error.message : String(error)}; queue restore failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
              }
              throw error;
            }
            const next = queueState(session);
            setQueuedPromptImages(
              stateKey,
              queuedPromptImagesForTexts(next.steering, updated.steering),
              queuedPromptImagesForTexts(next.followUp, updated.followUp),
            );
            send({ id: request.id, ok: true, result: queueStateWithDetails(session, stateKey) });
          } finally {
            queueRebuilds.delete(stateKey);
          }
        });
        return;
      }
      case "agent.deleteQueue": {
        const payload = request.payload as { taskId?: string; cwd?: string; messageId?: string } | undefined;
        if (!payload?.taskId || !payload.messageId) throw new Error("taskId and messageId are required");
        const cwd = payload.cwd ?? resolveWorkspaceCwd();
        const stateKey = sessionStateKey(payload.taskId, cwd);
        const session = await ensureAgentSession(payload.taskId, cwd);
        await withQueueMutationLock(stateKey, async () => {
          // Pi exposes clearQueue(), steer(), and followUp(), but no arbitrary
          // row deletion API. Validate the stable Renderer ID against the live
          // queue, then atomically rebuild the remaining real Pi queue.
          const liveQueue = queueState(session);
          reconcileQueuedPromptImages(stateKey, liveQueue.steering, liveQueue.followUp);
          const imageState = queuedPromptImageState(stateKey);
          const original = {
            steering: liveQueue.steering.map((text, index) => imageState.steering[index] ?? { id: randomUUID(), text, images: [] }),
            followUp: liveQueue.followUp.map((text, index) => imageState.followUp[index] ?? { id: randomUUID(), text, images: [] }),
          };
          const messageId = payload.messageId!;
          if (!original.steering.some((message) => message.id === messageId) && !original.followUp.some((message) => message.id === messageId)) {
            throw new Error("Queued message is no longer available");
          }
          const updated = {
            steering: original.steering.filter((message) => message.id !== messageId),
            followUp: original.followUp.filter((message) => message.id !== messageId),
          };

          queueRebuilds.add(stateKey);
          try {
            session.clearQueue();
            try {
              for (const message of updated.steering) await session.steer(message.text, message.images);
              for (const message of updated.followUp) await session.followUp(message.text, message.images);
            } catch (error) {
              try {
                session.clearQueue();
                for (const message of original.steering) await session.steer(message.text, message.images);
                for (const message of original.followUp) await session.followUp(message.text, message.images);
                setQueuedPromptImages(stateKey, original.steering, original.followUp);
              } catch (restoreError) {
                // eslint-disable-next-line preserve-caught-error
                throw new Error(`${error instanceof Error ? error.message : String(error)}; queue restore failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
              }
              throw error;
            }
            const next = queueState(session);
            setQueuedPromptImages(
              stateKey,
              queuedPromptImagesForTexts(next.steering, updated.steering),
              queuedPromptImagesForTexts(next.followUp, updated.followUp),
            );
            send({ id: request.id, ok: true, result: queueStateWithDetails(session, stateKey) });
          } finally {
            queueRebuilds.delete(stateKey);
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
        const payload = request.payload as { providerId?: string; method?: "api-key" | "oauth"; secret?: string; authOperationId?: string } | undefined;
        if (!payload?.providerId || !payload.method) throw new Error("providerId and method are required");
        if (payload.authOperationId !== undefined && (!payload.authOperationId.trim() || payload.authOperationId.length > 200)) throw new Error("Invalid auth operation ID");
        if (payload.method === "api-key") {
          const runtime = await getModelRuntime();
          const apiKey = payload.secret?.trim();
          if (!apiKey) throw new Error("An API key is required");
          await persistProviderApiKey(runtime, payload.providerId, apiKey, request.id);
        } else {
          const operationId = payload.authOperationId?.trim() || request.id;
          const previousOperation = activeProviderLoginByProvider.get(payload.providerId);
          previousOperation?.controller.abort(new Error("Authentication superseded by a new login attempt"));
          const duplicateOperation = activeProviderLogins.get(operationId);
          if (duplicateOperation !== previousOperation) duplicateOperation?.controller.abort(new Error("Authentication superseded by a new login attempt"));
          const operation: ActiveProviderLogin = { operationId, providerId: payload.providerId, controller: new AbortController() };
          activeProviderLogins.set(operationId, operation);
          activeProviderLoginByProvider.set(payload.providerId, operation);
          try {
            const runtime = await getModelRuntime();
            await runtime.login(payload.providerId, "oauth", createAuthInteraction(operationId, payload.providerId, undefined, operation.controller.signal));
          } finally {
            if (activeProviderLogins.get(operationId) === operation) activeProviderLogins.delete(operationId);
            if (activeProviderLoginByProvider.get(payload.providerId) === operation) activeProviderLoginByProvider.delete(payload.providerId);
          }
        }
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "providers.cancelLogin": {
        const payload = request.payload as { authOperationId?: string } | undefined;
        if (!payload?.authOperationId) throw new Error("authOperationId is required");
        activeProviderLogins.get(payload.authOperationId)?.controller.abort(new Error("Authentication cancelled"));
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
        if (payload.cancelled) {
          authWaiters.delete(payload.requestId);
          waiter.reject(new Error("Authentication cancelled"));
        } else {
          // Validation failures deliberately leave the Pi prompt pending. The
          // Renderer can display the actionable error and the user can select
          // device-code login without restarting the whole auth operation.
          await waiter.beforeResolve?.(payload.value as string);
          authWaiters.delete(payload.requestId);
          waiter.resolve(payload.value as string);
        }
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
process.on("message", (message: PiHostRequest | { type?: string; requestId?: string; rules?: string; error?: string }) => {
  if ("type" in message && message.type === "proxy.resolve-result" && typeof message.requestId === "string") {
    handleProxyResolveResult({ requestId: message.requestId, rules: message.rules, error: message.error });
    return;
  }
  void handle(message as PiHostRequest);
});
process.on("disconnect", () => {
  for (const waiter of proxyResolveWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("PiDeck system proxy bridge disconnected"));
  }
  proxyResolveWaiters.clear();
});
void httpNetworkingReady.then(() => {
  parentPort?.postMessage({ type: "runtime.status", payload: "connected" });
  process.send?.({ type: "runtime.status", payload: "connected" });
}).catch((error) => {
  const message = { type: "runtime.error", payload: { message: publicRuntimeError(error) } };
  parentPort?.postMessage(message);
  process.send?.(message);
  console.error(`PiHost HTTP networking initialization failed: ${publicRuntimeError(error)}`);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100);
});

// Observe fatal errors without changing Node's default crash semantics. Main
// owns the exit path: it rejects pending calls, publishes "disconnected", and
// can fork a clean PiHost on restart. Continuing after an uncaught exception
// would leave SDK/session state in an undefined condition.
process.on("uncaughtExceptionMonitor", (error) => {
  console.error("PiHost uncaught exception", error);
});
