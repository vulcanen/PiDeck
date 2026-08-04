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
        resolve(decision === "allow-once");
        const separator = requestId.indexOf(":");
        const taskId = separator > 0 ? requestId.slice(0, separator) : requestId;
        this.callbacks.emitEvent(taskId, { type: "approval.resolved", requestId, decision, source: "permission-mode" });
      }
      this.approvalWaiters.clear();
    }
    persistPermissionMode(mode);
    return this.status();
  }

  async beforeToolCall(taskId: string, context: any, previous: BeforeToolCall | undefined, signal?: AbortSignal): Promise<unknown> {
    const toolName = context.toolCall?.name ?? "unknown";
    if (this.mode === "deny") return { block: true, reason: "PiDeck 权限模式已禁止工具调用。" };
    if (this.mode === "allow" || this.mode === "yolo") return undefined;
    const requestId = `${taskId}:${context.toolCall?.id ?? Date.now()}`;
    this.callbacks.emitApproval(requestId, taskId, toolName, context.args);
    const allowed = await new Promise<boolean>((resolve) => this.approvalWaiters.set(requestId, resolve));
    if (!allowed) return { block: true, reason: "PiDeck 用户拒绝了这次工具调用。" };
    return previous?.(context, signal);
  }

  resolve(requestId: string, decision: "allow-once" | "deny"): void {
    const resolve = this.approvalWaiters.get(requestId);
    if (!resolve) throw new Error(`Unknown approval request: ${requestId}`);
    this.approvalWaiters.delete(requestId);
    resolve(decision === "allow-once");
  }

  resolveUi(requestId: string, value: string | boolean | undefined): void {
    const resolve = this.uiWaiters.get(requestId);
    if (!resolve) throw new Error(`Unknown extension UI request: ${requestId}`);
    this.uiWaiters.delete(requestId);
    resolve(value);
  }

  createUi(taskId: string) {
    const request = <T extends string | boolean | undefined>(kind: "select" | "confirm" | "input" | "editor", payload: Record<string, unknown>) => new Promise<T | undefined>((resolve) => {
      const requestId = `${taskId}:extension:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      this.uiWaiters.set(requestId, (value) => resolve(value as T));
      if (this.callbacks.emitUiRequest) this.callbacks.emitUiRequest(requestId, taskId, { kind, ...payload });
      else {
        this.uiWaiters.delete(requestId);
        resolve(undefined);
      }
    });
    return {
      select: (title: string, options: string[]) => request<string>("select", { title, options }),
      confirm: (title: string, message: string) => request<boolean>("confirm", { title, message }),
      input: (title: string, placeholder?: string) => request<string>("input", { title, placeholder }),
      notify: (message: string, type?: string) => this.callbacks.emitEvent(taskId, { type: "extension.ui.notify", message, level: type ?? "info" }),
      onTerminalInput: () => () => undefined,
      setStatus: () => undefined,
      setWorkingMessage: () => undefined,
      setWorkingVisible: () => undefined,
      setWorkingIndicator: () => undefined,
      setHiddenThinkingLabel: () => undefined,
      setWidget: () => undefined,
      setFooter: () => undefined,
      setHeader: () => undefined,
      setTitle: () => undefined,
      custom: async () => undefined,
      pasteToEditor: () => undefined,
      setEditorText: () => undefined,
      getEditorText: () => "",
      getEditorComponent: () => undefined,
      editor: (title: string, prefill?: string) => request<string>("editor", { title, prefill }),
      addAutocompleteProvider: () => undefined,
      theme: undefined,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => undefined,
    };
  }

  async beforeToolCallWithExtension(taskId: string, context: any, previous: BeforeToolCall | undefined, extensionLoaded: boolean, signal?: AbortSignal): Promise<unknown> {
    if (extensionLoaded) {
      if (this.mode === "deny") return { block: true, reason: "PiDeck 权限模式已禁止工具调用。" };
      if (this.mode === "allow" || this.mode === "yolo") return undefined;
      return previous?.(context, signal);
    }
    const toolName = context.toolCall?.name ?? "unknown";
    if (this.mode === "ask" && new Set(["read", "grep", "find", "ls"]).has(toolName)) return previous?.(context, signal);
    return this.beforeToolCall(taskId, context, previous, signal);
  }
}

export { permissionConfigPath, resolvePermissionExtensionPath };
