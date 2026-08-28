import type { PermissionMode, PermissionStatus } from "@pideck/contracts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface PermissionEngineCallbacks {
  emitApproval(requestId: string, taskId: string, toolName: string, args: unknown): void;
  emitEvent(taskId: string, event: unknown): void;
  emitUiRequest?(requestId: string, taskId: string, request: Record<string, unknown>): void;
}

type BeforeToolCall = (context: any, signal?: AbortSignal) => Promise<unknown> | unknown;

function permissionConfigPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), ".pi", "agent");
  return path.join(agentDir, "extensions", "pi-permission-system", "config.json");
}

function resolvePermissionExtensionPath(): string | undefined {
  const candidates = [
    process.env.PIDECK_PERMISSION_EXTENSION,
    path.resolve(process.cwd(), "node_modules/@gotgenes/pi-permission-system/src/index.ts"),
    path.resolve(process.cwd(), "apps/desktop/node_modules/@gotgenes/pi-permission-system/src/index.ts"),
    path.resolve(__dirname, "../../../node_modules/@gotgenes/pi-permission-system/src/index.ts"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate));
}

function loadPermissionMode(): PermissionMode {
  try {
    const config = JSON.parse(readFileSync(permissionConfigPath(), "utf8")) as { yoloMode?: boolean; permission?: Record<string, unknown> };
    if (config.yoloMode) return "yolo";
    const fallback = config.permission?.["*"];
    if (fallback === "allow" || fallback === "ask" || fallback === "deny") return fallback;
  } catch {
    // Use PiDeck's safe ask default when no plugin config is available.
  }
  return "ask";
}

function persistPermissionMode(mode: PermissionMode): void {
  const configPath = permissionConfigPath();
  let config: Record<string, unknown> = {};
  try { if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>; } catch { config = {}; }
  const policy = mode === "yolo" ? "ask" : mode;
  config.permission = { ...(typeof config.permission === "object" && config.permission ? config.permission : {}), "*": policy };
  config.yoloMode = mode === "yolo";
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function permissionSource(): PermissionStatus["source"] {
  return resolvePermissionExtensionPath() ? "pi-permission-system" : "pideck-fallback";
}

/** Pi permission-system adapter; it owns policy persistence and approval waiters, not tool execution. */
export class PermissionEngine {
  private mode: PermissionMode = loadPermissionMode();
  private revisionValue = 0;
  private readonly approvalWaiters = new Map<string, (allow: boolean) => void>();
  private readonly approvalTaskIds = new Map<string, string>();
  private readonly uiWaiters = new Map<string, (value: string | boolean | undefined) => void>();

  constructor(private readonly callbacks: PermissionEngineCallbacks) {}

  get revision(): number { return this.revisionValue; }

  status(): PermissionStatus {
    return { mode: this.mode, source: permissionSource(), configPath: permissionConfigPath() };
  }

  async setMode(mode: PermissionMode): Promise<PermissionStatus> {
    this.mode = mode;
    this.revisionValue += 1;
    if (mode === "allow" || mode === "yolo" || mode === "deny") {
      const decision = mode === "deny" ? "deny" : "allow-once";
      for (const [requestId, resolve] of this.approvalWaiters.entries()) {
        const taskId = this.approvalTaskIds.get(requestId) ?? requestId;
        resolve(decision === "allow-once");
        this.callbacks.emitEvent(taskId, { type: "approval.resolved", requestId, decision, source: "permission-mode" });
      }
      this.approvalWaiters.clear();
      this.approvalTaskIds.clear();
    }
    persistPermissionMode(mode);
    return this.status();
  }

  async beforeToolCall(taskId: string, context: any, previous: BeforeToolCall | undefined, signal?: AbortSignal, scopeId = taskId): Promise<unknown> {
    const toolName = context.toolCall?.name ?? "unknown";
    if (this.mode === "deny") return { block: true, reason: "Permission mode blocks this tool call." };
    if (this.mode === "allow" || this.mode === "yolo") return undefined;
    const requestId = `${encodeURIComponent(scopeId)}:${context.toolCall?.id ?? Date.now()}`;
    this.callbacks.emitApproval(requestId, taskId, toolName, context.args);
    this.approvalTaskIds.set(requestId, taskId);
    const allowed = await new Promise<boolean>((resolve) => {
      const settled = (allow: boolean) => {
        if (this.approvalWaiters.get(requestId) === settle) this.approvalWaiters.delete(requestId);
        this.approvalTaskIds.delete(requestId);
        resolve(allow);
      };
      const settle = (allow: boolean) => settled(allow);
      this.approvalWaiters.set(requestId, settle);
      if (signal) {
        if (signal.aborted) settle(false);
        else signal.addEventListener("abort", () => settle(false), { once: true });
      }
    });
    if (!allowed) return { block: true, reason: "Permission denied for this tool call." };
    return previous?.(context, signal);
  }

  resolve(requestId: string, decision: "allow-once" | "deny"): void {
    const resolve = this.approvalWaiters.get(requestId);
    if (!resolve) throw new Error(`Unknown approval request: ${requestId}`);
    this.approvalWaiters.delete(requestId);
    this.approvalTaskIds.delete(requestId);
    resolve(decision === "allow-once");
  }

  /** Deny any pending approval/UI waits belonging to a session being torn down so its Promise never hangs. */
  dispose(scopeId: string): void {
    const prefix = `${encodeURIComponent(scopeId)}:`;
    for (const [requestId, resolve] of this.approvalWaiters.entries()) {
      if (requestId.startsWith(prefix)) {
        this.approvalWaiters.delete(requestId);
        this.approvalTaskIds.delete(requestId);
        resolve(false);
      }
    }
    for (const [requestId, resolve] of this.uiWaiters.entries()) {
      if (requestId.startsWith(prefix)) {
        this.uiWaiters.delete(requestId);
        resolve(undefined);
      }
    }
  }

  resolveUi(requestId: string, value: string | boolean | undefined): void {
    const resolve = this.uiWaiters.get(requestId);
    if (!resolve) throw new Error(`Unknown extension UI request: ${requestId}`);
    this.uiWaiters.delete(requestId);
    resolve(value);
  }

  resetUi(taskId: string): void {
    this.callbacks.emitEvent(taskId, { type: "extension.ui.presentation", action: "reset" });
  }

  createUi(taskId: string, scopeId = taskId) {
    const request = <T extends string | boolean | undefined>(kind: "select" | "confirm" | "input" | "editor", payload: Record<string, unknown>) => new Promise<T | undefined>((resolve) => {
      const requestId = `${encodeURIComponent(scopeId)}:extension:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      this.uiWaiters.set(requestId, (value) => resolve(value as T));
      if (this.callbacks.emitUiRequest) this.callbacks.emitUiRequest(requestId, taskId, { kind, ...payload });
      else {
        this.uiWaiters.delete(requestId);
        resolve(undefined);
      }
    });
    let editorText = "";
    const unsupported = new Set<string>();
    const present = (action: string, payload: Record<string, unknown> = {}) => this.callbacks.emitEvent(taskId, { type: "extension.ui.presentation", action, ...payload });
    const warnUnsupported = (capability: string) => {
      if (unsupported.has(capability)) return;
      unsupported.add(capability);
      this.callbacks.emitEvent(taskId, { type: "extension.ui.unsupported", capability });
    };
    return {
      select: (title: string, options: string[]) => request<string>("select", { title, options }),
      confirm: (title: string, message: string) => request<boolean>("confirm", { title, message }),
      input: (title: string, placeholder?: string) => request<string>("input", { title, placeholder }),
      notify: (message: string, type?: string) => this.callbacks.emitEvent(taskId, { type: "extension.ui.notify", message, level: type ?? "info" }),
      onTerminalInput: () => { warnUnsupported("onTerminalInput"); return () => undefined; },
      setStatus: (key: string, text?: string) => present("status", { key, text }),
      setWorkingMessage: (message?: string) => present("working-message", { message }),
      setWorkingVisible: (visible: boolean) => present("working-visible", { visible }),
      setWorkingIndicator: (indicator?: { frames?: string[]; interval?: number }) => present("working-indicator", { indicator }),
      setHiddenThinkingLabel: (label?: string) => present("hidden-thinking-label", { label }),
      setWidget: (key: string, content?: string[] | (() => unknown), options?: Record<string, unknown>) => {
        if (content !== undefined && !Array.isArray(content)) { warnUnsupported("setWidget(component)"); return; }
        present("widget", { key, lines: content, placement: options?.placement });
      },
      setFooter: () => warnUnsupported("setFooter"),
      setHeader: () => warnUnsupported("setHeader"),
      setTitle: (title: string) => present("title", { title }),
      custom: async () => { warnUnsupported("custom"); return undefined; },
      pasteToEditor: (text: string) => { editorText += text; present("editor-text", { text: editorText }); },
      setEditorText: (text: string) => { editorText = text; present("editor-text", { text }); },
      getEditorText: () => { warnUnsupported("getEditorText(live desktop composer)"); return editorText; },
      getEditorComponent: () => { warnUnsupported("getEditorComponent"); return undefined; },
      editor: async (title: string, prefill?: string) => {
        const value = await request<string>("editor", { title, prefill });
        if (typeof value === "string") editorText = value;
        return value;
      },
      addAutocompleteProvider: () => { warnUnsupported("addAutocompleteProvider"); return () => undefined; },
      theme: undefined,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => undefined,
    };
  }

  async beforeToolCallWithExtension(taskId: string, context: any, previous: BeforeToolCall | undefined, extensionLoaded: boolean, signal?: AbortSignal, scopeId = taskId): Promise<unknown> {
    if (extensionLoaded) {
      if (this.mode === "deny") return { block: true, reason: "PiDeck 权限模式已禁止工具调用。" };
      if (this.mode === "allow" || this.mode === "yolo") return undefined;
      return previous?.(context, signal);
    }
    const toolName = context.toolCall?.name ?? "unknown";
    if (this.mode === "ask" && new Set(["read", "grep", "find", "ls"]).has(toolName)) return previous?.(context, signal);
    return this.beforeToolCall(taskId, context, previous, signal, scopeId);
  }
}

export { permissionConfigPath, resolvePermissionExtensionPath };
