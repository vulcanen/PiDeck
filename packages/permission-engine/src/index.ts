import type { PermissionMode, PermissionStatus } from "@pideck/contracts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

export interface PermissionEngineCallbacks {
  emitApproval(requestId: string, taskId: string, toolName: string, args: unknown): void;
  emitEvent(taskId: string, event: unknown): void;
  emitUiRequest?(requestId: string, taskId: string, request: Record<string, unknown>): void;
}

type BeforeToolCall = (context: any, signal?: AbortSignal) => Promise<unknown> | unknown;
type ExtensionKeybindings = { matches(data: string, keybinding: string): boolean };
type CustomUiComponent = {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate?(): void;
  dispose?(): void;
};

const plainText = (text: string) => text;

// Extension UI contexts are copied with object spread when Pi binds them. Keep
// theme access side-effect free and provide the same structural API as Pi's
// Theme without leaking terminal ANSI styling into the desktop renderer.
const desktopPlainTextTheme = Object.freeze({
  name: "pideck",
  sourcePath: undefined,
  sourceInfo: undefined,
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: plainText,
  italic: plainText,
  underline: plainText,
  inverse: plainText,
  strikethrough: plainText,
  getFgAnsi: (_color: string) => "",
  getBgAnsi: (_color: string) => "",
  getColorMode: () => "truecolor" as const,
  getThinkingBorderColor: (_level: string) => plainText,
  getBashModeBorderColor: () => plainText,
});

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
  private editorTexts = new Map<string, string>();
  private mode: PermissionMode = loadPermissionMode();
  private revisionValue = 0;
  private readonly approvalWaiters = new Map<string, (allow: boolean) => void>();
  private readonly approvalTaskIds = new Map<string, string>();
  private readonly uiWaiters = new Map<string, {
    taskId: string;
    resolve(value: string | boolean | undefined): void;
    timer?: ReturnType<typeof setTimeout>;
    signal?: AbortSignal;
    onAbort?: () => void;
  }>();
  private readonly customUiWaiters = new Map<string, {
    taskId: string;
    component?: CustomUiComponent;
    pendingInputs: string[];
    handleInput(data: string): void;
    dispose(): void;
    resolve(value: unknown): void;
  }>();

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
    this.editorTexts.delete(scopeId);
    const prefix = `${encodeURIComponent(scopeId)}:`;
    for (const [requestId, resolve] of this.approvalWaiters.entries()) {
      if (requestId.startsWith(prefix)) {
        this.approvalWaiters.delete(requestId);
        this.approvalTaskIds.delete(requestId);
        resolve(false);
      }
    }
    for (const [requestId, waiter] of this.uiWaiters.entries()) {
      if (requestId.startsWith(prefix)) {
        this.uiWaiters.delete(requestId);
        if (waiter.timer) clearTimeout(waiter.timer);
        if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
        waiter.resolve(undefined);
      }
    }
    for (const [requestId, waiter] of this.customUiWaiters.entries()) {
      if (!requestId.startsWith(prefix)) continue;
      this.customUiWaiters.delete(requestId);
      waiter.dispose();
      waiter.resolve(undefined);
      this.callbacks.emitEvent(waiter.taskId, { type: "extension.ui.dismiss", requestId, reason: "aborted" });
    }
  }

  resolveUi(requestId: string, value: string | boolean | undefined): void {
    const waiter = this.uiWaiters.get(requestId);
    if (!waiter) throw new Error(`Unknown extension UI request: ${requestId}`);
    this.uiWaiters.delete(requestId);
    if (waiter.timer) clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.resolve(value);
  }

  /** Forward a terminal-style key sequence to a custom extension component. */
  inputUi(requestId: string, data: string): void {
    const waiter = this.customUiWaiters.get(requestId);
    // The renderer can race the final dismiss event. Treat late input as a
    // harmless no-op instead of surfacing an actionable error for a stale key.
    if (!waiter) return;
    waiter.handleInput(data);
  }

  resetUi(taskId: string): void {
    for (const [requestId, waiter] of this.uiWaiters.entries()) {
      if (waiter.taskId !== taskId) continue;
      this.uiWaiters.delete(requestId);
      if (waiter.timer) clearTimeout(waiter.timer);
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.resolve(undefined);
    }
    for (const [requestId, waiter] of this.customUiWaiters.entries()) {
      if (waiter.taskId !== taskId) continue;
      this.customUiWaiters.delete(requestId);
      waiter.dispose();
      waiter.resolve(undefined);
      this.callbacks.emitEvent(taskId, { type: "extension.ui.dismiss", requestId, reason: "aborted" });
    }
    this.callbacks.emitEvent(taskId, { type: "extension.ui.presentation", action: "reset" });
  }

  createUi(taskId: string, scopeId = taskId, themes?: { theme: any; getAllThemes(): any[]; getTheme(name: string): any; setTheme(value: any): { success: boolean; error?: string } }, extensionKeybindings?: ExtensionKeybindings) {
    const request = <T extends string | boolean | undefined>(kind: "select" | "confirm" | "input" | "editor", payload: Record<string, unknown>, opts?: { signal?: AbortSignal; timeout?: number }) => new Promise<T | undefined>((resolve) => {
      const requestId = `${encodeURIComponent(scopeId)}:extension:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const settle = (value: string | boolean | undefined, reason?: "timeout" | "aborted") => {
        const waiter = this.uiWaiters.get(requestId);
        if (!waiter) return;
        this.uiWaiters.delete(requestId);
        if (waiter.timer) clearTimeout(waiter.timer);
        if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
        waiter.resolve(value);
        if (reason) this.callbacks.emitEvent(taskId, { type: "extension.ui.dismiss", requestId, reason });
      };
      const timeoutMs = typeof opts?.timeout === "number" && Number.isFinite(opts.timeout) && opts.timeout > 0
        ? Math.min(opts.timeout, 2_147_483_647)
        : undefined;
      const fallback = kind === "confirm" ? false : undefined;
      const waiter: (typeof this.uiWaiters extends Map<string, infer V> ? V : never) = {
        taskId,
        resolve: (value) => resolve(value as T),
        ...(opts?.signal ? { signal: opts.signal } : {}),
      };
      if (opts?.signal?.aborted) {
        resolve(fallback as T);
        return;
      }
      if (timeoutMs) waiter.timer = setTimeout(() => settle(fallback, "timeout"), timeoutMs);
      if (opts?.signal) {
        waiter.onAbort = () => settle(fallback, "aborted");
        opts.signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.uiWaiters.set(requestId, waiter);
      if (this.callbacks.emitUiRequest) this.callbacks.emitUiRequest(requestId, taskId, { kind, ...payload, ...(timeoutMs ? { timeoutMs } : {}) });
      else {
        settle(fallback);
      }
    });
    let editorText = this.editorTexts.get(scopeId) ?? "";
    let toolsExpanded = false;
    const unsupported = new Set<string>();
    const present = (action: string, payload: Record<string, unknown> = {}) => this.callbacks.emitEvent(taskId, { type: "extension.ui.presentation", action, ...payload });
    const warnUnsupported = (capability: string) => {
      if (unsupported.has(capability)) return;
      unsupported.add(capability);
      this.callbacks.emitEvent(taskId, { type: "extension.ui.unsupported", capability });
    };
    return {
      select: (title: string, options: string[], opts?: { signal?: AbortSignal; timeout?: number }) => request<string>("select", { title, options }, opts),
      confirm: (title: string, message: string, opts?: { signal?: AbortSignal; timeout?: number }) => request<boolean>("confirm", { title, message }, opts),
      input: (title: string, placeholder?: string, opts?: { signal?: AbortSignal; timeout?: number }) => request<string>("input", { title, placeholder }, opts),
      notify: (message: string, type?: string) => this.callbacks.emitEvent(taskId, { type: "extension.ui.notify", message: stripVTControlCharacters(message), level: type ?? "info" }),
      onTerminalInput: () => { warnUnsupported("onTerminalInput"); return () => undefined; },
      setStatus: (key: string, text?: string) => present("status", { key, text: text === undefined ? undefined : stripVTControlCharacters(text) }),
      setWorkingMessage: (message?: string) => present("working-message", { message }),
      setWorkingVisible: (visible: boolean) => present("working-visible", { visible }),
      setWorkingIndicator: (indicator?: { frames?: string[]; intervalMs?: number }) => present("working-indicator", { indicator: indicator ? { frames: indicator.frames, interval: indicator.intervalMs } : undefined }),
      setHiddenThinkingLabel: (label?: string) => present("hidden-thinking-label", { label }),
      setWidget: (key: string, content?: string[] | (() => unknown), options?: Record<string, unknown>) => {
        if (content !== undefined && !Array.isArray(content)) { warnUnsupported("setWidget(component)"); return; }
        present("widget", { key, lines: content?.map(stripVTControlCharacters), placement: options?.placement });
      },
      setFooter: () => warnUnsupported("setFooter"),
      setHeader: () => warnUnsupported("setHeader"),
      setTitle: (title: string) => present("title", { title }),
      custom: <T>(factory: (tui: any, theme: any, keybindings: ExtensionKeybindings, done: (result: T) => void) => CustomUiComponent | Promise<CustomUiComponent>, _options?: Record<string, unknown>) => new Promise<T | undefined>((resolve) => {
        const requestId = `${encodeURIComponent(scopeId)}:extension-custom:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        let component: CustomUiComponent | undefined;
        let settled = false;
        let dirty = false;
        const keybindings = extensionKeybindings ?? {
          matches(data: string, keybinding: string): boolean {
            const keys: Record<string, string[]> = {
              "tui.select.up": ["\x1b[A", "\x1bOA"],
              "tui.select.down": ["\x1b[B", "\x1bOB"],
              "tui.select.confirm": ["\r", "\n"],
              "tui.select.cancel": ["\x1b"],
            };
            return keys[keybinding]?.includes(data) ?? false;
          },
        };
        const render = () => {
          if (settled || !component) { dirty = true; return; }
          try {
            const marker = "\x1b_pi:c\x07";
            const lines = component.render(96).map((line) => stripVTControlCharacters(line.replaceAll(marker, "")));
            this.callbacks.emitUiRequest?.(requestId, taskId, { kind: "custom", title: "Pi Extension", lines });
            dirty = false;
          } catch (error) {
            this.callbacks.emitEvent(taskId, { type: "extension.error", error: error instanceof Error ? error.message : String(error) });
            settle(undefined);
          }
        };
        const settle = (value: T | undefined, reason?: "aborted") => {
          if (settled) return;
          settled = true;
          const waiter = this.customUiWaiters.get(requestId);
          if (waiter) {
            this.customUiWaiters.delete(requestId);
            waiter.dispose();
          } else {
            component?.dispose?.();
          }
          resolve(value);
          this.callbacks.emitEvent(taskId, { type: "extension.ui.dismiss", requestId, ...(reason ? { reason } : {}) });
        };
        const waiter = {
          taskId,
          pendingInputs: [] as string[],
          handleInput: (data: string) => {
            if (settled) return;
            if (!component) { waiter.pendingInputs.push(data); return; }
            try {
              component.handleInput?.(data);
              render();
            } catch (error) {
              this.callbacks.emitEvent(taskId, { type: "extension.error", error: error instanceof Error ? error.message : String(error) });
            }
          },
          dispose: () => { settled = true; component?.dispose?.(); },
          resolve: (value: unknown) => resolve(value as T | undefined),
        };
        this.customUiWaiters.set(requestId, waiter);
        const tui = {
          requestRender: () => { dirty = true; render(); },
          setFocus: () => undefined,
        };
        const done = (value: T) => settle(value);
        let created: CustomUiComponent | Promise<CustomUiComponent>;
        try {
          created = factory(tui, themes?.theme ?? desktopPlainTextTheme, keybindings, done);
        } catch (error) {
          this.customUiWaiters.delete(requestId);
          resolve(undefined);
          this.callbacks.emitEvent(taskId, { type: "extension.error", error: error instanceof Error ? error.message : String(error) });
          return;
        }
        Promise.resolve(created).then((next) => {
          if (settled) { next.dispose?.(); return; }
          component = next;
          for (const input of waiter.pendingInputs.splice(0)) waiter.handleInput(input);
          render();
          if (dirty) render();
        }).catch((error: unknown) => {
          this.customUiWaiters.delete(requestId);
          component?.dispose?.();
          resolve(undefined);
          this.callbacks.emitEvent(taskId, { type: "extension.error", error: error instanceof Error ? error.message : String(error) });
        });
      }),
      pasteToEditor: (text: string) => { editorText = (this.editorTexts.get(scopeId) ?? editorText) + text; this.editorTexts.set(scopeId, editorText); present("editor-text", { text: editorText }); },
      setEditorText: (text: string) => { editorText = text; this.editorTexts.set(scopeId, text); present("editor-text", { text }); },
      getEditorText: () => this.editorTexts.get(scopeId) ?? editorText,
      setEditorComponent: () => warnUnsupported("setEditorComponent"),
      getEditorComponent: () => { warnUnsupported("getEditorComponent"); return undefined; },
      editor: async (title: string, prefill?: string) => {
        const value = await request<string>("editor", { title, prefill });
        if (typeof value === "string") { editorText = value; this.editorTexts.set(scopeId, value); }
        return value;
      },
      addAutocompleteProvider: () => { warnUnsupported("addAutocompleteProvider"); },
      get theme() { return themes?.theme ?? desktopPlainTextTheme; },
      getAllThemes: () => { if (themes) return themes.getAllThemes(); warnUnsupported("getAllThemes"); return []; },
      getTheme: (name: string) => { if (themes) return themes.getTheme(name); warnUnsupported("getTheme"); return undefined; },
      setTheme: (value: any) => { if (themes) return themes.setTheme(value); warnUnsupported("setTheme"); return { success: false, error: "The Pi runtime does not expose desktop theme adaptation" }; },
      getToolsExpanded: () => toolsExpanded,
      setToolsExpanded: (expanded: boolean) => { toolsExpanded = expanded; present("tools-expanded", { expanded }); },
    };
  }

  syncEditorText(scopeId: string, text: string): void {
    this.editorTexts.set(scopeId, text);
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
