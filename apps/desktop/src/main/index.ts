import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session as electronSession, shell, Tray, type MenuItemConstructorOptions } from "electron";
import { fork as forkNode, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { AppLanguage, PiHostRequest, PiHostResponse, WindowTheme } from "@pideck/contracts";
import { appMenuCopy, copy } from "@pideck/i18n";
import { assertKnownProjectCwd, assertTrustedIpcSender } from "./ipc-security";
import { windowThemeColors } from "./window-theme";

app.setName("PiDeck");

type RuntimeStatus = "connected" | "starting" | "disconnected";
type ProjectRegistry = {
  cwds: string[];
  hiddenCwds: string[];
};

/**
 * Maps packaged paths out of the asar archive for consumers that cannot read
 * asar, such as the forked system-Node PiHost process and native file APIs.
 * No-op in development where no app.asar segment exists.
 */
function toUnpackedPath(filePath: string): string {
  return filePath.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
}

let host: ChildProcess | undefined;
// When true (default), closing the last window asks for confirmation before
// quitting. The renderer can opt out via `app:set-confirm-close` (e.g. the
// user ticks "don't ask again" in the native confirm dialog).
let confirmCloseBeforeQuit = true;
let hostAlive = false;
let hostStatus: RuntimeStatus = "starting";
let hostWindow: BrowserWindow | undefined;
let currentLanguage: AppLanguage = app.getLocale().toLowerCase().startsWith("zh") ? "zh" : "en";
let currentWindowTheme: WindowTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
const applicationIconPath = toUnpackedPath(path.join(__dirname, "../../assets/pideck-icon.png"));
const dockIconPath = toUnpackedPath(path.join(__dirname, "../../assets/pideck-dock-icon.png"));
const nativeRequire = createRequire(__filename);
type MiniwindowAddon = { installMiniwindowCustomization(handle: Buffer, iconPath: string): boolean };
let miniwindowAddon: MiniwindowAddon | undefined;
let tray: Tray | undefined;
const pending = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}>();

function projectRegistryPath(): string {
  return path.join(app.getPath("userData"), "projects.json");
}

function normalizeProjectCwd(cwd: string): string {
  return path.resolve(cwd);
}

function projectCwdKey(cwd: string): string {
  const normalized = normalizeProjectCwd(cwd);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizeProjectCwds(cwds: string[]): string[] {
  const seen = new Set<string>();
  return cwds.map(normalizeProjectCwd).filter((cwd) => {
    const key = projectCwdKey(cwd);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readProjectRegistry(): ProjectRegistry {
  try {
    const parsed = JSON.parse(readFileSync(projectRegistryPath(), "utf8")) as { cwds?: unknown; hiddenCwds?: unknown };
    const cwds = Array.isArray(parsed.cwds) ? parsed.cwds.filter((cwd): cwd is string => typeof cwd === "string" && cwd.length > 0) : [];
    const hiddenCwds = Array.isArray(parsed.hiddenCwds) ? parsed.hiddenCwds.filter((cwd): cwd is string => typeof cwd === "string" && cwd.length > 0) : [];
    return { cwds: normalizeProjectCwds(cwds), hiddenCwds: normalizeProjectCwds(hiddenCwds) };
  } catch {
    return { cwds: [], hiddenCwds: [] };
  }
}

function writeProjectRegistry(registry: ProjectRegistry): void {
  const registryPath = projectRegistryPath();
  mkdirSync(path.dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, `${JSON.stringify({ cwds: normalizeProjectCwds(registry.cwds), hiddenCwds: normalizeProjectCwds(registry.hiddenCwds) }, null, 2)}\n`, "utf8");
}

function rememberProjectCwd(cwd: string): void {
  const registry = readProjectRegistry();
  const key = projectCwdKey(cwd);
  writeProjectRegistry({
    cwds: [cwd, ...registry.cwds.filter((item) => projectCwdKey(item) !== key)],
    hiddenCwds: registry.hiddenCwds.filter((item) => projectCwdKey(item) !== key),
  });
}

function hideProjectCwd(cwd: string): void {
  const registry = readProjectRegistry();
  const key = projectCwdKey(cwd);
  writeProjectRegistry({
    cwds: registry.cwds.filter((item) => projectCwdKey(item) !== key),
    hiddenCwds: [cwd, ...registry.hiddenCwds.filter((item) => projectCwdKey(item) !== key)],
  });
}

function buildApplicationMenu(language: AppLanguage) {
  const t = appMenuCopy[language];
  const template: MenuItemConstructorOptions[] = [
    {
      label: t.file,
      submenu: [
        { role: "close", label: t.close },
        { type: "separator" },
        { role: "quit", label: t.quit },
      ],
    },
    {
      label: t.edit,
      submenu: [
        { role: "undo", label: t.undo },
        { role: "redo", label: t.redo },
        { type: "separator" },
        { role: "cut", label: t.cut },
        { role: "copy", label: t.copy },
        { role: "paste", label: t.paste },
        { role: "selectAll", label: t.selectAll },
      ],
    },
    {
      label: t.view,
      submenu: [
        // Reload and DevTools are development aids; keep them off the menu in
        // packaged builds where they only invite support requests.
        ...(!app.isPackaged ? ([
          { role: "reload", label: t.reload },
          { role: "forceReload", label: t.forceReload },
          { type: "separator" },
          { role: "toggleDevTools", label: t.toggleDevTools },
          { type: "separator" },
        ] satisfies MenuItemConstructorOptions[]) : []),
        { role: "resetZoom", label: t.resetZoom },
        { role: "zoomIn", label: t.zoomIn },
        { role: "zoomOut", label: t.zoomOut },
        { type: "separator" },
        { role: "togglefullscreen", label: t.toggleFullscreen },
      ],
    },
    {
      label: t.help,
      submenu: [
        {
          label: t.about,
          click: () => { void showAboutDialog(); },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function showAboutDialog() {
  const t = appMenuCopy[currentLanguage];
  let piSdk: string | null = null;
  try {
    const info = await requestHost("app.info") as { version?: string } | string | null;
    piSdk = typeof info === "string" ? info : (info?.version ?? null);
  } catch {
    // PiHost may be unavailable; the dialog still shows the app versions.
  }
  const detail = t.aboutBody(
    app.getVersion(),
    piSdk,
    process.versions.electron ?? "",
    process.versions.node,
  );
  const options: Electron.MessageBoxOptions = {
    type: "info",
    title: t.aboutTitle,
    message: t.aboutTitle,
    detail,
    buttons: [t.close],
    noLink: true,
  };
  void (hostWindow && !hostWindow.isDestroyed()
    ? dialog.showMessageBox(hostWindow, options)
    : dialog.showMessageBox(options));
}

function publishRuntimeStatus(status: RuntimeStatus) {
  hostStatus = status;
  if (hostWindow && !hostWindow.isDestroyed()) {
    void hostWindow.webContents.send("pi:event", { type: "runtime.status", payload: status });
  }
}

function resolveNodeExecutable(): string {
  // Run PiHost on Electron's bundled Node: it satisfies the Pi SDK engine
  // requirement (the historical WebIDL/undici conflict no longer applies) and
  // reads the asar archive transparently, so node_modules can stay packed.
  // A system Node cannot read asar, so it is only used when explicitly
  // requested via PIDECK_NODE_EXECUTABLE.
  if (process.env.PIDECK_NODE_EXECUTABLE) return process.env.PIDECK_NODE_EXECUTABLE;
  return process.execPath;
}

function piHostEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  return {
    ...environment,
    PIDECK_USE_SYSTEM_PROXY: "1",
    PIDECK_HOST_PROCESS: "1",
    ELECTRON_RUN_AS_NODE: "1",
  };
}

async function resolveProxyForHost(sourceHost: ChildProcess, requestId: string, url: string): Promise<void> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported proxy target protocol");
    const rules = await electronSession.defaultSession.resolveProxy(parsed.toString());
    if (host === sourceHost && sourceHost.connected) {
      sourceHost.send?.({ type: "proxy.resolve-result", requestId, rules });
    }
  } catch {
    if (host === sourceHost && sourceHost.connected) {
      sourceHost.send?.({ type: "proxy.resolve-result", requestId, error: "System proxy resolution failed" });
    }
  }
}

function startHost(window: BrowserWindow) {
  hostWindow = window;
  if (host && hostAlive) {
    publishRuntimeStatus(hostStatus);
    return;
  }

  publishRuntimeStatus("starting");
  const hostPath = path.join(__dirname, "../../../../packages/pi-host/dist/index.js");
  const startedHost = forkNode(hostPath, [], {
    execPath: resolveNodeExecutable(),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: piHostEnvironment(),
  });
  host = startedHost;
  hostAlive = true;
  startedHost.stderr?.on("data", (chunk) => {
    if (process.env.PIDECK_DEBUG) console.error(`[PiHost] ${String(chunk).trimEnd()}`);
  });
  startedHost.on("message", (message: PiHostResponse | { type?: string; payload?: unknown; requestId?: string; url?: string }) => {
    // A replaced Host can still flush buffered IPC while it exits. Ignore it:
    // only the current instance may resolve requests or publish runtime state.
    if (host !== startedHost) return;
    if ("type" in message && message.type === "proxy.resolve" && typeof message.requestId === "string" && typeof message.url === "string") {
      void resolveProxyForHost(startedHost, message.requestId, message.url);
      return;
    }
    if (!message || typeof message !== "object" || !("id" in message)) {
      if (message?.type === "runtime.status" && message.payload === "connected") {
        publishRuntimeStatus("connected");
      } else if (message?.type && hostWindow && !hostWindow.isDestroyed()) {
        void hostWindow.webContents.send("pi:event", message);
      }
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error ?? "PiHost request failed"));
  });
  startedHost.on("error", (error) => {
    console.error("PiHost process error", error);
    teardownHost("PiHost process error", startedHost);
  });
  startedHost.on("exit", () => {
    teardownHost("PiHost exited", startedHost);
  });
}

// Reject every pending request and reset the Host so a later restart can
// fork a fresh PiHost. `reason` is only logged here; the runtime status event
// already tells the Renderer the Host is gone.
function teardownHost(reason: string, sourceHost: ChildProcess | undefined = host) {
  if (!sourceHost || host !== sourceHost) return;
  console.warn(`[PiHost] ${reason}`);
  hostAlive = false;
  host = undefined;
  sourceHost.kill();
  publishRuntimeStatus("disconnected");
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error("PiHost disconnected"));
  }
  pending.clear();
}

function requestHost(command: PiHostRequest["command"], payload?: unknown) {
  return new Promise<unknown>((resolve, reject) => {
    if (!host || !hostAlive) {
      reject(new Error("PiHost is not connected"));
      return;
    }
    const id = randomUUID();
    const timeoutMs = command === "providers.login" || command === "sessions.share"
      ? 15 * 60_000
      // agent.prompt is event-driven: an interactive turn can run for many
      // minutes and streams progress via agent events. Its completion is
      // signaled by agent_settled, not by the RPC response, so a fixed timeout
      // would only ever misreport a long-but-healthy run as failed. Leave it
      // unbounded; a crashed PiHost still rejects via the exit handler.
      : command === "agent.prompt"
        ? 0
        : command.startsWith("packages.")
          ? 10 * 60_000
        : 60_000;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      pending.delete(id);
      reject(new Error(`PiHost request timed out: ${command}`));
    }, timeoutMs) : undefined;
    pending.set(id, { resolve, reject, timer });
    host.send?.({ id, command, payload } satisfies PiHostRequest);
  });
}

function focusHostWindow(): void {
  const window = hostWindow;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function applyWindowTheme(theme: WindowTheme): void {
  currentWindowTheme = theme;
  const colors = windowThemeColors(theme);
  if (!hostWindow || hostWindow.isDestroyed()) return;
  hostWindow.setBackgroundColor(colors.background);
  if (process.platform !== "darwin") {
    hostWindow.setTitleBarOverlay({ color: colors.background, symbolColor: colors.symbol, height: 48 });
  }
}

function optionalKnownProjectCwd(cwd: string | undefined): string | undefined {
  return assertKnownProjectCwd(cwd, readProjectRegistry().cwds);
}

function requireKnownProjectCwd(cwd: string | undefined): string {
  const known = optionalKnownProjectCwd(cwd);
  if (!known) throw new Error("A project directory is required");
  return known;
}

function registerTrustedIpcHandler(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event, hostWindow);
    return listener(event, ...args);
  });
}

function registerIpcHandlers() {
  registerTrustedIpcHandler("app:set-language", (_event, language: AppLanguage) => {
    currentLanguage = language === "en" ? "en" : "zh";
    buildApplicationMenu(currentLanguage);
    updateTrayMenu();
    return currentLanguage;
  });
  registerTrustedIpcHandler("app:set-window-theme", (_event, theme: WindowTheme) => {
    applyWindowTheme(theme === "dark" ? "dark" : "light");
  });
  registerTrustedIpcHandler("app:set-confirm-close", (_event, enabled: boolean) => {
    confirmCloseBeforeQuit = Boolean(enabled);
  });
  registerTrustedIpcHandler("app:restart-host", async () => {
    teardownHost("restart requested");
    if (!hostWindow) return;
    startHost(hostWindow);
    // Resolve only after the replacement process completes a real IPC round
    // trip; a fixed delay can report success before startup actually finishes.
    await requestHost("runtime.status");
    publishRuntimeStatus("connected");
  });
  registerTrustedIpcHandler("app:quit", () => { app.quit(); });
  registerTrustedIpcHandler("runtime:status", () => hostStatus);
  registerTrustedIpcHandler("projects:list", async (_event, preferredCwd?: string) => {
    const registry = readProjectRegistry();
    const hiddenProjectKeys = new Set(registry.hiddenCwds.map(projectCwdKey));
    const preferred = preferredCwd
      ? registry.cwds.find((cwd) => projectCwdKey(cwd) === projectCwdKey(preferredCwd))
      : undefined;
    const visibleKnownCwds = registry.cwds.filter((cwd) => !hiddenProjectKeys.has(projectCwdKey(cwd)));
    const knownCwds = preferred
      ? [preferred, ...visibleKnownCwds.filter((cwd) => projectCwdKey(cwd) !== projectCwdKey(preferred))]
      : visibleKnownCwds;
    const projects = await requestHost("projects.list", { knownCwds }) as Array<{ cwd: string }>;
    const visibleProjects = projects.filter((project) => !hiddenProjectKeys.has(projectCwdKey(project.cwd)));
    writeProjectRegistry({
      cwds: visibleProjects.map((project) => project.cwd),
      hiddenCwds: registry.hiddenCwds,
    });
    return visibleProjects;
  });
  registerTrustedIpcHandler("projects:choose-directory", async () => {
    if (!hostWindow) return null;
    const result = await dialog.showOpenDialog(hostWindow, {
      title: appMenuCopy[currentLanguage].chooseProjectFolder,
      properties: ["openDirectory", "createDirectory"],
    });
    const cwd = result.canceled ? undefined : result.filePaths[0];
    if (!cwd) return null;
    const sessions = await requestHost("sessions.list", { cwd }) as unknown[];
    rememberProjectCwd(cwd);
    return { id: cwd, cwd, name: path.basename(cwd) || cwd, taskCount: sessions.length };
  });
  registerTrustedIpcHandler("projects:remove", (_event, cwd: string) => {
    hideProjectCwd(requireKnownProjectCwd(cwd));
    return null;
  });
  registerTrustedIpcHandler("projects:set-trust", (_event, cwd: string, trusted: boolean) => requestHost("projects.setTrust", { cwd: requireKnownProjectCwd(cwd), trusted }));
  registerTrustedIpcHandler("sessions:list", (_event, projectId?: string) => requestHost("sessions.list", { cwd: requireKnownProjectCwd(projectId) }));
  registerTrustedIpcHandler("sessions:create", (_event, input?: { cwd?: string; name?: string }) => requestHost("sessions.create", { ...input, cwd: requireKnownProjectCwd(input?.cwd) }));
  registerTrustedIpcHandler("sessions:delete", (_event, taskId: string, cwd?: string) => requestHost("sessions.delete", { taskId, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("sessions:messages", (_event, taskId: string, cwd?: string) => requestHost("sessions.messages", { taskId, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("sessions:run-metadata", (_event, taskId: string, cwd?: string) => requestHost("sessions.runMetadata", { taskId, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("sessions:change-reviews", (_event, taskId: string, cwd?: string) => requestHost("sessions.changeReviews", { taskId, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("sessions:capabilities", (_event, taskId?: string, cwd?: string) => requestHost("sessions.capabilities", { taskId, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("sessions:compact", (_event, taskId: string, instructions?: string, cwd?: string) => requestHost("sessions.compact", { taskId, instructions, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("sessions:export", (_event, taskId: string, format: "jsonl" | "html", cwd?: string) => requestHost("sessions.export", { taskId, format, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("sessions:import", async (_event, taskId?: string, cwd?: string) => {
    const trustedCwd = requireKnownProjectCwd(cwd);
    if (!hostWindow) return null;
    const result = await dialog.showOpenDialog(hostWindow, {
      title: appMenuCopy[currentLanguage].importSession,
      properties: ["openFile"],
      filters: [{ name: "Pi JSONL", extensions: ["jsonl"] }, { name: "All files", extensions: ["*"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return requestHost("sessions.import", { taskId, inputPath: result.filePaths[0], cwd: trustedCwd });
  });
  registerTrustedIpcHandler("sessions:rename", (_event, taskId: string, name: string, cwd?: string) => requestHost("sessions.rename", { taskId, name, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("sessions:generateTitle", (_event, taskId: string, message: string, cwd?: string, model?: { providerId: string; modelId: string }) => requestHost("sessions.generateTitle", { taskId, message, cwd: requireKnownProjectCwd(cwd), model }));
  registerTrustedIpcHandler("sessions:stats", (_event, taskId: string, cwd?: string) => requestHost("sessions.stats", { taskId, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("sessions:share", (_event, taskId: string, cwd?: string) => requestHost("sessions.share", { taskId, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("sessions:changelog", () => requestHost("app.changelog"));
  registerTrustedIpcHandler("models:list", () => requestHost("models.list"));
  registerTrustedIpcHandler("workspace:snapshot", (_event, cwd: string) => requestHost("workspace.snapshot", { cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("providers:list", () => requestHost("providers.list"));
  registerTrustedIpcHandler("providers:login", async (_event, providerId: string, method: "api-key" | "oauth", secret?: string, authOperationId?: string) => {
    await requestHost("providers.login", { providerId, method, secret, authOperationId });
    if (method === "oauth") focusHostWindow();
  });
  registerTrustedIpcHandler("providers:cancel-login", (_event, authOperationId: string) => requestHost("providers.cancelLogin", { authOperationId }));
  registerTrustedIpcHandler("providers:set-api-key", (_event, providerId: string, apiKey: string) => requestHost("providers.setApiKey", { providerId, apiKey }));
  registerTrustedIpcHandler("providers:logout", (_event, providerId: string) => requestHost("providers.logout", { providerId }));
  registerTrustedIpcHandler("providers:auth-response", (_event, requestId: string, value: string, cancelled?: boolean) => requestHost("providers.auth-response", { requestId, value, cancelled }));
  registerTrustedIpcHandler("providers:open-auth-url", async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http(s) auth URLs can be opened");
    await shell.openExternal(parsed.toString());
  });
  registerTrustedIpcHandler("agent:prompt", (_event, taskId: string, text: string, cwd?: string, images?: Array<{ data: string; mimeType: string }>, delivery?: "steer" | "followUp") => requestHost("agent.prompt", { taskId, text, cwd: requireKnownProjectCwd(cwd), images, delivery }));
  registerTrustedIpcHandler("agent:abort", (_event, taskId: string, cwd?: string) => requestHost("agent.abort", { taskId, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("agent:set-thinking-level", (_event, taskId: string, level: string, cwd?: string) => requestHost("agent.setThinkingLevel", { taskId, level, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("agent:set-model", (_event, taskId: string, providerId: string, modelId: string, cwd?: string) => requestHost("agent.setModel", { taskId, providerId, modelId, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("agent:set-scoped-models", (_event, taskId: string, modelIds: string[] | null, persist?: boolean, cwd?: string) => requestHost("agent.setScopedModels", { taskId, modelIds, persist, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("agent:queue", (_event, taskId: string, cwd?: string) => requestHost("agent.queue", { taskId, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("agent:set-queue-modes", (_event, taskId: string, modes: { steeringMode?: "all" | "one-at-a-time"; followUpMode?: "all" | "one-at-a-time" }, cwd?: string) => requestHost("agent.setQueueModes", { taskId, cwd: requireKnownProjectCwd(cwd), ...modes }));
  registerTrustedIpcHandler("agent:clear-queue", (_event, taskId: string, cwd?: string) => requestHost("agent.clearQueue", { taskId, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("agent:promote-queue", (_event, taskId: string, followUpIndex: number, cwd?: string) => requestHost("agent.promoteQueue", { taskId, followUpIndex, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("agent:edit-queue", (_event, taskId: string, messageId: string, text: string, images?: Array<{ data: string; mimeType: string }>, cwd?: string) => requestHost("agent.editQueue", { taskId, messageId, text, images, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("agent:delete-queue", (_event, taskId: string, messageId: string, cwd?: string) => requestHost("agent.deleteQueue", { taskId, messageId, cwd: requireKnownProjectCwd(cwd) }));
  registerTrustedIpcHandler("extension-ui:resolve", (_event, requestId: string, value: string | boolean | undefined) => requestHost("extension.ui.resolve", { requestId, value }));
  registerTrustedIpcHandler("packages:list", (_event, cwd?: string) => requestHost("packages.list", { cwd: optionalKnownProjectCwd(cwd) ?? process.cwd() }));
  registerTrustedIpcHandler("packages:install", (_event, source: string, local?: boolean, cwd?: string) => requestHost("packages.install", { source, local, cwd: local ? requireKnownProjectCwd(cwd) : (optionalKnownProjectCwd(cwd) ?? process.cwd()) }));
  registerTrustedIpcHandler("packages:remove", (_event, source: string, local?: boolean, cwd?: string) => requestHost("packages.remove", { source, local, cwd: local ? requireKnownProjectCwd(cwd) : (optionalKnownProjectCwd(cwd) ?? process.cwd()) }));
  registerTrustedIpcHandler("packages:update", (_event, source?: string, cwd?: string) => requestHost("packages.update", { source, cwd: optionalKnownProjectCwd(cwd) ?? process.cwd() }));
  registerTrustedIpcHandler("packages:configure", (_event, source: string, enabled: boolean, local?: boolean, cwd?: string) => requestHost("packages.configure", { source, enabled, local, cwd: local ? requireKnownProjectCwd(cwd) : (optionalKnownProjectCwd(cwd) ?? process.cwd()) }));
  registerTrustedIpcHandler("approval:resolve", (_event, requestId: string, decision: "allow-once" | "deny") => requestHost("approval.resolve", { requestId, decision }));
  registerTrustedIpcHandler("permissions:status", () => requestHost("permissions.status"));
  registerTrustedIpcHandler("permissions:set-mode", (_event, mode: "ask" | "allow" | "deny" | "yolo") => requestHost("permissions.setMode", { mode }));
}

function createWindow() {
  const initialWindowColors = windowThemeColors(currentWindowTheme);
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 375,
    minHeight: 520,
    icon: applicationIconPath,
    backgroundColor: initialWindowColors.background,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 17 } }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: { color: initialWindowColors.background, symbolColor: initialWindowColors.symbol, height: 48 },
        }),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.platform !== "darwin") window.setMenuBarVisibility(false);
  hostWindow = window;
  applyWindowTheme(currentWindowTheme);

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") void shell.openExternal(parsed.toString());
    } catch {
      // Ignore malformed links emitted by model content.
    }
    return { action: "deny" };
  });

  // PiDeck has no in-window navigation surface. Model-authored Markdown and
  // extension content may contain links, so reject every page-initiated
  // navigation and leave explicitly validated HTTP(S) links to the system
  // browser handler above.
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../../../../dist-renderer/index.html"));
  }
  startHost(window);
  if (process.platform === "darwin") {
    try {
      miniwindowAddon ??= nativeRequire(toUnpackedPath(path.join(__dirname, "../../assets/pideck-miniwindow.node"))) as MiniwindowAddon;
      miniwindowAddon.installMiniwindowCustomization(window.getNativeWindowHandle(), applicationIconPath);
    } catch (error) {
      console.warn("Could not customize the minimized window Dock tile", error);
    }
  }
  window.on("closed", () => {
    if (hostWindow === window) hostWindow = undefined;
  });
  createTray();
  // Intercept the close request so we can confirm before quitting. Without this
  // guard the window would destroy itself and `before-quit` would tear down the
  // host mid-task. We only act on the last window; on macOS the app stays alive
  // after close, so a confirm there would be wrong.
  window.on("close", (event) => {
    if (!confirmCloseBeforeQuit || process.platform === "darwin") return;
    event.preventDefault();
    const t = copy[currentLanguage];
    // The async variant supports the "don't ask again" checkbox; the sync
    // variant in this Electron version does not. The promise resolves only
    // after the user responds, by which point we decide whether to destroy.
    void dialog.showMessageBox(window, {
      type: "question",
      buttons: [t.confirmCloseCancel, t.confirmCloseMinimize, t.confirmCloseExit],
      defaultId: 2,
      cancelId: 0,
      message: t.confirmCloseTitle,
      detail: t.confirmCloseBody,
      checkboxLabel: t.confirmCloseDontAsk,
      checkboxChecked: false,
      noLink: true,
    }).then(({ response, checkboxChecked }) => {
      if (checkboxChecked) {
        confirmCloseBeforeQuit = false;
        window.webContents.send("app:confirm-close-changed", false);
      }
      if (response === 1) {
        window.hide();
      } else if (response === 2) {
        window.destroy();
        if (BrowserWindow.getAllWindows().length === 0) app.quit();
      }
    });
  });
}

function showMainWindow() {
  const window = hostWindow ?? BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function updateTrayMenu() {
  if (!tray) return;
  const t = copy[currentLanguage];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t.workspace, click: showMainWindow },
    { type: "separator" },
    {
      label: t.confirmCloseExit,
      click: () => {
        // Destroying first skips the close-confirm dialog, then quit tears down
        // the host via `before-quit`.
        hostWindow?.destroy();
        if (BrowserWindow.getAllWindows().length === 0) app.quit();
      },
    },
  ]));
}

function createTray() {
  if (process.platform === "darwin") return;
  if (!tray) {
    tray = new Tray(applicationIconPath);
    tray.setToolTip("PiDeck");
    tray.on("click", showMainWindow);
  }
  updateTrayMenu();
}

app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.setIcon(dockIconPath);
  registerIpcHandlers();
  buildApplicationMenu(currentLanguage);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  hostAlive = false;
  host?.kill();
  host = undefined;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error("PiDeck is shutting down"));
  }
  pending.clear();
});
