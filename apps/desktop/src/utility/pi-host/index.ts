import type { PermissionMode, PiHostRequest, PiHostResponse } from "@pideck/contracts";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type PiSdk = {
  ModelRuntime: {
    create(options?: { allowModelNetwork?: boolean }): Promise<any>;
  };
  DefaultResourceLoader?: new (options: { cwd: string; agentDir: string; additionalExtensionPaths?: string[] }) => any;
  getAgentDir?: () => string;
  parseSkillBlock?: (text: string) => { name: string; location: string; content: string; userMessage?: string } | null;
  SessionManager: {
    list(cwd: string): Promise<any[]>;
    create(cwd: string): {
      appendSessionInfo(name: string): void;
      getSessionId(): string;
      getSessionFile?: () => string | undefined;
    };
    open(path: string): any;
    inMemory(cwd?: string): any;
  };
  createAgentSession(options: { cwd: string; sessionManager: any; modelRuntime: any; resourceLoader?: any }): Promise<{ session: any }>;
};

let sdkPromise: Promise<PiSdk> | undefined;
let modelRuntimePromise: Promise<any> | undefined;
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
const capabilitySessions = new Map<string, any>();
const authWaiters = new Map<string, (value: string) => void>();
const approvalWaiters = new Map<string, (allow: boolean) => void>();
let permissionMode: PermissionMode = "ask";
let permissionRevision = 0;
const agentSessionRevisions = new Map<string, number>();

function permissionConfigPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), ".pi", "agent");
  return path.join(agentDir, "extensions", "pi-permission-system", "config.json");
}

function loadPermissionMode() {
  try {
    const config = JSON.parse(readFileSync(permissionConfigPath(), "utf8")) as { yoloMode?: boolean; permission?: Record<string, unknown> };
    if (config.yoloMode) return "yolo" as const;
    const fallback = config.permission?.["*"];
    if (fallback === "allow" || fallback === "ask" || fallback === "deny") return fallback;
  } catch {
    // Use PiDeck's safe ask default when no plugin config exists.
  }
  return "ask" as const;
}

function permissionStatus() {
  return {
    mode: permissionMode,
    source: existsSync(path.resolve(process.cwd(), "node_modules/@gotgenes/pi-permission-system/src/index.ts")) ? "pi-permission-system" : "pideck-fallback",
    configPath: permissionConfigPath(),
  } as const;
}

function persistPermissionMode(mode: PermissionMode) {
  const configPath = permissionConfigPath();
  let config: Record<string, unknown> = {};
  try { if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>; } catch { config = {}; }
  const policy = mode === "yolo" ? "ask" : mode;
  config.permission = { ...(typeof config.permission === "object" && config.permission ? config.permission : {}), "*": policy };
  config.yoloMode = mode === "yolo";
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\\n`, "utf8");
}

async function setPermissionMode(mode: PermissionMode) {
  permissionMode = mode;
  permissionRevision += 1;
  // Apply a changed policy to an approval that is already waiting without
  // aborting or disposing the running AgentSession. Idle sessions are lazily
  // rebuilt by ensureAgentSession on the next prompt.
  if (mode === "allow" || mode === "yolo" || mode === "deny") {
    for (const resolve of approvalWaiters.values()) resolve(mode !== "deny");
    approvalWaiters.clear();
  }
  capabilitySessions.clear();
  persistPermissionMode(mode);
  return permissionStatus();
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

function resolvePiModule(): string {
  if (process.env.PIDECK_PI_MODULE && existsSync(process.env.PIDECK_PI_MODULE)) return process.env.PIDECK_PI_MODULE;
  const candidates: string[] = [];
  const addRoot = (root: string) => {
    const normalized = root.trim().replace(/^['\"]|['\"]$/g, "");
    if (!normalized) return;
    candidates.push(path.join(normalized, "@earendil-works", "pi-coding-agent", "dist", "index.js"));
    candidates.push(path.join(normalized, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js"));
  };
  const addExecutable = (executable: string) => {
    const clean = executable.trim();
    if (!clean) return;
    addRoot(path.dirname(clean));
    if (process.platform === "win32" && existsSync(`${clean}.cmd`)) addRoot(path.dirname(`${clean}.cmd`));
    try {
      const shim = readFileSync(existsSync(clean) ? clean : `${clean}.cmd`, "utf8");
      const match = /([A-Za-z]:[^\"\r\n]*@earendil-works[\\/]pi-coding-agent[\\/]dist[\\/]index\.js)/i.exec(shim);
      if (match) candidates.push(match[1].replaceAll("\\\\", path.sep));
    } catch {
      // A shell shim is optional; the prefix candidates are sufficient.
    }
  };
  try {
    const executable = process.platform === "win32"
      ? execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe"), ["pi"], { encoding: "utf8" }).split(/\r?\n/).find(Boolean) ?? ""
      : execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
    addExecutable(executable);
  } catch {
    // Continue with PATH and npm-prefix discovery.
  }
  for (const bin of (process.env.PATH ?? "").split(path.delimiter)) if (bin) addRoot(path.join(bin, "node_modules"));
  for (const prefix of [process.env.PIDECK_PI_GLOBAL_ROOT, process.env.npm_config_prefix, process.env.NPM_CONFIG_PREFIX, process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "", process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "npm") : ""]) if (prefix) addRoot(prefix);
  for (const npmCommand of process.platform === "win32" ? ["npm.cmd", "npm"] : ["npm"]) {
    try { addRoot(execFileSync(npmCommand, ["root", "-g"], { encoding: "utf8" })); } catch { /* npm is optional in packaged builds */ }
  }
  addRoot(path.resolve(process.cwd(), "node_modules"));
  addRoot(path.resolve(__dirname, "../../../node_modules"));
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`Could not locate Pi SDK. Set PIDECK_PI_MODULE to @earendil-works/pi-coding-agent/dist/index.js. Searched ${candidates.length} locations.`);
  }
  return resolved;
}

function loadPiSdk(): Promise<PiSdk> {
  sdkPromise ??= import(pathToFileURL(resolvePiModule()).href).catch((error) => {
    sdkPromise = undefined;
    throw error;
  }) as Promise<PiSdk>;
  return sdkPromise;
}

async function getModelRuntime() {
  modelRuntimePromise ??= loadPiSdk().then((sdk) => sdk.ModelRuntime.create({ allowModelNetwork: false })).catch((error) => {
    modelRuntimePromise = undefined;
    throw error;
  });
  return modelRuntimePromise;
}

permissionMode = loadPermissionMode();

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

function emitApproval(requestId: string, taskId: string, toolName: string, args: unknown) {
  const message = { type: "approval.requested", requestId, taskId, event: { toolName, args: jsonSafe(args) } };
  parentPort?.postMessage(message);
  process.send?.(message);
}

function createPermissionUi(taskId: string) {
  return {
    select: (title: string, options: string[]) => new Promise<string | undefined>((resolve) => {
      const requestId = `${taskId}:permission:${Date.now()}`;
      emitApproval(requestId, taskId, "permission-system", { title, options });
      approvalWaiters.set(requestId, (allowed) => resolve(allowed ? options[0] : options[options.length - 1]));
    }),
    confirm: async () => false,
    input: async () => undefined,
    notify: (message: string) => emit(taskId, { type: "permission.notice", message }),
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
    editor: async () => undefined,
    addAutocompleteProvider: () => undefined,
    setEditorComponent: () => undefined,
    getEditorComponent: () => undefined,
    theme: undefined,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => undefined,
  };
}

function jsonSafe<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return String(value) as T;
  }
}

function modelSummary(provider: any, model: any, authConfigured: boolean) {
  return {
    id: model.id,
    providerId: provider.id,
    providerName: provider.name ?? provider.id,
    name: model.name ?? model.id,
    reasoning: Boolean(model.reasoning),
    thinkingLevels: model.reasoning ? ["off", "minimal", "low", "medium", "high", "xhigh"] : ["off"],
    authConfigured,
  };
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

function normalizeAgentEvent(event: any): unknown {
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
    return { type: event.type, message: jsonSafe(event.message) };
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
  if (event.type === "agent_end" || event.type === "agent_settled" || event.type === "turn_start" || event.type === "turn_end") {
    return { type: event.type, willRetry: event.willRetry, message: jsonSafe(event.message) };
  }
  return jsonSafe(event);
}

function sessionModelLabel(sessionInfo: any, sdk: PiSdk): string {
  try {
    const manager = sdk.SessionManager.open(sessionInfo.path);
    const model = manager.buildSessionContext?.().model;
    if (model?.provider && model?.id) return `${model.provider}/${model.id}`;
  } catch {
    // Older or partially written session files may not have a model entry.
  }
  return "未选择模型";
}

async function ensureAgentSession(taskId: string, cwd: string): Promise<any> {
  const existing = agentSessions.get(taskId);
  if (existing) {
    const sessionRevision = agentSessionRevisions.get(taskId);
    if (sessionRevision === permissionRevision || existing.isStreaming) return existing;
    // Do not interrupt an active turn. Once idle, recreate against the new
    // extension configuration while keeping the same Pi SessionManager/file.
    existing.dispose?.();
    agentSessions.delete(taskId);
    agentSessionRevisions.delete(taskId);
  }
  const pending = agentSessionPromises.get(taskId);
  if (pending) return pending;

  const creationRevision = permissionRevision;
  const creation = (async () => {
    const sdk = await loadPiSdk();
    let manager = sessionManagers.get(taskId);
    if (!manager) {
      const sessionPath = sessionFiles.get(taskId);
      manager = sessionPath ? sdk.SessionManager.open(sessionPath) : sdk.SessionManager.create(cwd);
      sessionManagers.set(taskId, manager);
    }
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
    if (permissionExtensionLoaded) {
      await session.bindExtensions?.({ uiContext: createPermissionUi(taskId) });
    }
    const previousBeforeToolCall = session.agent.beforeToolCall;
    session.agent.beforeToolCall = async (context: any, signal?: AbortSignal) => {
      const toolName = context.toolCall?.name ?? "unknown";
      if (permissionMode === "deny") return { block: true, reason: "PiDeck 权限模式已禁止工具调用。" };
      // Explicit allow/yolo modes override the extension's previously loaded
      // config immediately; do not wait for a session rebuild to allow tools.
      if (permissionMode === "allow" || permissionMode === "yolo") return undefined;
      if (permissionExtensionLoaded) return previousBeforeToolCall?.(context, signal);
      const safeTools = new Set(["read", "grep", "find", "ls"]);
      if (safeTools.has(toolName)) return previousBeforeToolCall?.(context, signal);
      const requestId = `${taskId}:${context.toolCall?.id ?? Date.now()}`;
      emitApproval(requestId, taskId, toolName, context.args);
      const allowed = await new Promise<boolean>((resolve) => approvalWaiters.set(requestId, resolve));
      if (!allowed) return { block: true, reason: "PiDeck 用户拒绝了这次工具调用。" };
      return previousBeforeToolCall?.(context, signal);
    };
    session.subscribe((event: unknown) => emit(taskId, normalizeAgentEvent(event)));
    session.subscribe((event: any) => {
      if (event.type === "message_end" || event.type === "agent_settled") {
        emit(taskId, { type: "message.snapshot", messages: jsonSafe(session.messages) });
      }
    });
    agentSessions.set(taskId, session);
    agentSessionRevisions.set(taskId, creationRevision);
    return session;
  })();
  agentSessionPromises.set(taskId, creation);
  try {
    return await creation;
  } finally {
    agentSessionPromises.delete(taskId);
  }
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
      case "projects.list": {
        const cwd = resolveWorkspaceCwd();
        const sessions = await (await loadPiSdk()).SessionManager.list(cwd);
        send({ id: request.id, ok: true, result: [{ id: cwd, cwd, name: path.basename(cwd), taskCount: sessions.length }] });
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
          result: sessions.map((session: any) => ({
            id: session.id,
            title: session.name ?? session.firstMessage ?? session.id.slice(0, 8),
            projectId: cwd,
            state: "idle",
            model: sessionModelLabel(session, sdk),
            updatedAt: new Date(session.modified ?? Date.now()).toISOString(),
          })),
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
            title: payload?.name ?? "未命名任务",
            projectId: cwd,
            state: "idle",
            model: "未选择模型",
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
        const slash = await listSlashCommands(session);
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
            contextUsage: jsonSafe(session.getContextUsage?.()),
          },
        });
        return;
      }
      case "sessions.tree": {
        const payload = request.payload as { taskId?: string; cwd?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        send({ id: request.id, ok: true, result: jsonSafe(session.sessionManager.getTree()) });
        return;
      }
      case "sessions.navigate": {
        const payload = request.payload as { taskId?: string; entryId?: string; cwd?: string } | undefined;
        if (!payload?.taskId || !payload.entryId) throw new Error("taskId and entryId are required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        const result = await session.navigateTree(payload.entryId);
        emit(payload.taskId, { type: "message.snapshot", messages: jsonSafe(session.messages) });
        send({ id: request.id, ok: true, result: jsonSafe(result) });
        return;
      }
      case "sessions.fork": {
        const payload = request.payload as { taskId?: string; entryId?: string; cwd?: string } | undefined;
        if (!payload?.taskId || !payload.entryId) throw new Error("taskId and entryId are required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        const sessionPath = session.sessionManager.createBranchedSession(payload.entryId);
        if (!sessionPath) throw new Error("Pi did not persist a branched session");
        const sdk = await loadPiSdk();
        const manager = sdk.SessionManager.open(sessionPath);
        const taskId = manager.getSessionId();
        sessionManagers.set(taskId, manager);
        sessionFiles.set(taskId, sessionPath);
        send({
          id: request.id,
          ok: true,
          result: {
            id: taskId,
            title: "分支会话",
            projectId: payload.cwd ?? resolveWorkspaceCwd(),
            state: "idle",
            model: sessionModelLabel({ path: sessionPath }, sdk),
            updatedAt: new Date().toISOString(),
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
      case "agent.prompt": {
        const payload = request.payload as { taskId?: string; text?: string; cwd?: string; images?: Array<{ data: string; mimeType: string }> } | undefined;
        if (!payload?.taskId || (!payload.text && !payload.images?.length)) throw new Error("taskId and text or images are required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        const sdk = await loadPiSdk();
        const sessionName = session.sessionManager?.getSessionName?.();
        if (!titledSessions.has(payload.taskId) && (!sessionName || sessionName === "新建任务" || sessionName === "New task")) {
          const promptText = payload.text ?? "";
          const parsedSkill = sdk.parseSkillBlock?.(promptText);
          const skillCommand = /^\/skill:([^\s]+)/.exec(promptText);
          const titleSource = parsedSkill?.userMessage ?? (parsedSkill ? `Skill: ${parsedSkill.name}` : skillCommand ? `Skill: ${skillCommand[1]}` : promptText);
          const title = titleSource.replace(/\s+/g, " ").trim().slice(0, 80);
          if (title) session.sessionManager?.appendSessionInfo?.(title);
          titledSessions.add(payload.taskId);
        }
        await session.prompt(payload.text ?? "", { source: "interactive", images: payload.images });
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "sessions.delete": {
        const payload = request.payload as { taskId?: string } | undefined;
        if (!payload?.taskId) throw new Error("taskId is required");
        const sessionPath = sessionFiles.get(payload.taskId);
        const session = agentSessions.get(payload.taskId);
        if (session?.isStreaming) await session.abort();
        if (sessionPath && existsSync(sessionPath)) await unlink(sessionPath);
        sessionFiles.delete(payload.taskId);
        titledSessions.delete(payload.taskId);
        sessionManagers.delete(payload.taskId);
        agentSessions.delete(payload.taskId);
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
      case "terminal.execute": {
        const payload = request.payload as { taskId?: string; command?: string; cwd?: string } | undefined;
        if (!payload?.taskId || !payload.command?.trim()) throw new Error("taskId and command are required");
        const session = await ensureAgentSession(payload.taskId, payload.cwd ?? resolveWorkspaceCwd());
        const result = await session.executeBash(payload.command, undefined, { excludeFromContext: true });
        send({ id: request.id, ok: true, result: { output: result.output, exitCode: result.exitCode, isError: result.exitCode !== 0 } });
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
              authMethods: authMethods.length > 0 ? authMethods : ["api-key"],
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
          if (!payload.secret) throw new Error("An API key is required");
          await runtime.login(payload.providerId, "api_key", {
            prompt: async () => payload.secret as string,
            notify: () => undefined,
          });
        } else {
          await runtime.login(payload.providerId, "oauth", {
            prompt: (prompt: unknown) => {
              const requestId = `${request.id}:${Date.now()}`;
              emitAuth(requestId, { type: "prompt", prompt: jsonSafe(prompt) });
              return new Promise<string>((resolve) => authWaiters.set(requestId, resolve));
            },
            notify: (event: unknown) => emitAuth(request.id, { type: "notify", event: jsonSafe(event) }),
          });
        }
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "providers.setApiKey": {
        const payload = request.payload as { providerId?: string; apiKey?: string } | undefined;
        if (!payload?.providerId || !payload.apiKey) throw new Error("providerId and apiKey are required");
        const runtime = await getModelRuntime();
        await runtime.setRuntimeApiKey(payload.providerId, payload.apiKey);
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
        const payload = request.payload as { requestId?: string; value?: string } | undefined;
        if (!payload?.requestId || payload.value === undefined) throw new Error("requestId and value are required");
        const resolve = authWaiters.get(payload.requestId);
        if (!resolve) throw new Error("Auth prompt is no longer active");
        authWaiters.delete(payload.requestId);
        resolve(payload.value);
        send({ id: request.id, ok: true, result: undefined });
        return;
      }
      case "permissions.status":
        send({ id: request.id, ok: true, result: permissionStatus() });
        return;
      case "permissions.setMode": {
        const payload = request.payload as { mode?: PermissionMode } | undefined;
        if (!payload?.mode || !["ask", "allow", "deny", "yolo"].includes(payload.mode)) throw new Error("Invalid permission mode");
        send({ id: request.id, ok: true, result: await setPermissionMode(payload.mode) });
        return;
      }
      case "approval.resolve": {
        const payload = request.payload as { requestId?: string; decision?: "allow-once" | "deny" } | undefined;
        if (!payload?.requestId || !payload.decision) throw new Error("requestId and decision are required");
        const resolve = approvalWaiters.get(payload.requestId);
        if (!resolve) throw new Error("Approval request is no longer active");
        approvalWaiters.delete(payload.requestId);
        resolve(payload.decision === "allow-once");
        send({ id: request.id, ok: true, result: undefined });
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
