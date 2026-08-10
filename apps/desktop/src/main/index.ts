import { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray, type MenuItemConstructorOptions } from "electron";
import { fork as forkNode, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { AppLanguage, PiHostRequest, PiHostResponse } from "@pideck/contracts";
import { appMenuCopy, copy } from "@pideck/i18n";

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
        { role: "reload", label: t.reload },
        { role: "forceReload", label: t.forceReload },
        { type: "separator" },
        { role: "toggleDevTools", label: t.toggleDevTools },
        { type: "separator" },
        { role: "resetZoom", label: t.resetZoom },
        { role: "zoomIn", label: t.zoomIn },
        { role: "zoomOut", label: t.zoomOut },
        { type: "separator" },
        { role: "togglefullscreen", label: t.toggleFullscreen },
      ],
    },
    {
      label: t.window,
      submenu: [
        { role: "minimize", label: t.minimize },
        { role: "close", label: t.close },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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

function startHost(window: BrowserWindow) {
  hostWindow = window;
  if (host && hostAlive) {
    publishRuntimeStatus(hostStatus);
    return;
  }

  publishRuntimeStatus("starting");
  const hostPath = path.join(__dirname, "../../../../packages/pi-host/dist/index.js");
  host = forkNode(hostPath, [], {
    execPath: resolveNodeExecutable(),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env, PIDECK_HOST_PROCESS: "1", ELECTRON_RUN_AS_NODE: "1" },
  });
  hostAlive = true;
  host.stderr?.on("data", (chunk) => {
    if (process.env.PIDECK_DEBUG) console.error(`[PiHost] ${String(chunk).trimEnd()}`);
  });
  host.on("message", (message: PiHostResponse | { type?: string; payload?: unknown }) => {
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
  host.on("exit", () => {
    hostAlive = false;
    host = undefined;
    publishRuntimeStatus("disconnected");
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("PiHost disconnected"));
    }
    pending.clear();
  });
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

function registerIpcHandlers() {
  ipcMain.handle("app:set-language", (_event, language: AppLanguage) => {
    currentLanguage = language === "en" ? "en" : "zh";
    buildApplicationMenu(currentLanguage);
    return currentLanguage;
  });
  ipcMain.handle("app:set-confirm-close", (_event, enabled: boolean) => {
    confirmCloseBeforeQuit = Boolean(enabled);
  });
  ipcMain.handle("app:quit", () => { app.quit(); });
  ipcMain.handle("runtime:status", () => hostStatus);
  ipcMain.handle("projects:list", async (_event, preferredCwd?: string) => {
    const registry = readProjectRegistry();
    const hiddenProjectKeys = new Set(registry.hiddenCwds.map(projectCwdKey));
    const knownCwds = registry.cwds.filter((cwd) => !hiddenProjectKeys.has(projectCwdKey(cwd)));
    if (preferredCwd && !hiddenProjectKeys.has(projectCwdKey(preferredCwd))) knownCwds.push(preferredCwd);
    const projects = await requestHost("projects.list", { knownCwds }) as Array<{ cwd: string }>;
    const visibleProjects = projects.filter((project) => !hiddenProjectKeys.has(projectCwdKey(project.cwd)));
    writeProjectRegistry({
      cwds: visibleProjects.map((project) => project.cwd),
      hiddenCwds: registry.hiddenCwds,
    });
    return visibleProjects;
  });
  ipcMain.handle("projects:choose-directory", async () => {
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
  ipcMain.handle("projects:remove", (_event, cwd: string) => {
    if (typeof cwd !== "string" || !cwd.trim()) return null;
    hideProjectCwd(cwd);
    return null;
  });
  ipcMain.handle("projects:set-trust", (_event, cwd: string, trusted: boolean) => requestHost("projects.setTrust", { cwd, trusted }));
  ipcMain.handle("sessions:list", (_event, projectId?: string) => requestHost("sessions.list", { cwd: projectId }));
  ipcMain.handle("sessions:create", (_event, input?: { cwd?: string; name?: string }) => requestHost("sessions.create", input));
  ipcMain.handle("sessions:delete", (_event, taskId: string, cwd?: string) => requestHost("sessions.delete", { taskId, cwd }));
  ipcMain.handle("sessions:messages", (_event, taskId: string, cwd?: string) => requestHost("sessions.messages", { taskId, cwd }));
  ipcMain.handle("sessions:run-metadata", (_event, taskId: string, cwd?: string) => requestHost("sessions.runMetadata", { taskId, cwd }));
  ipcMain.handle("sessions:capabilities", (_event, taskId?: string, cwd?: string) => requestHost("sessions.capabilities", { taskId, cwd }));
  ipcMain.handle("sessions:compact", (_event, taskId: string, instructions?: string, cwd?: string) => requestHost("sessions.compact", { taskId, instructions, cwd }));
  ipcMain.handle("sessions:export", (_event, taskId: string, format: "jsonl" | "html", cwd?: string) => requestHost("sessions.export", { taskId, format, cwd }));
  ipcMain.handle("sessions:import", async (_event, taskId?: string, inputPath?: string, cwd?: string) => {
    let selectedPath = inputPath?.trim();
    if (!selectedPath) {
      if (!hostWindow) return null;
      const result = await dialog.showOpenDialog(hostWindow, {
        title: appMenuCopy[currentLanguage].importSession,
        properties: ["openFile"],
        filters: [{ name: "Pi JSONL", extensions: ["jsonl"] }, { name: "All files", extensions: ["*"] }],
      });
      if (result.canceled) return null;
      selectedPath = result.filePaths[0];
    }
    return requestHost("sessions.import", { taskId, inputPath: selectedPath, cwd });
  });
  ipcMain.handle("sessions:rename", (_event, taskId: string, name: string, cwd?: string) => requestHost("sessions.rename", { taskId, name, cwd }));
  ipcMain.handle("sessions:generateTitle", (_event, taskId: string, message: string, cwd?: string, model?: { providerId: string; modelId: string }) => requestHost("sessions.generateTitle", { taskId, message, cwd, model }));
  ipcMain.handle("sessions:stats", (_event, taskId: string, cwd?: string) => requestHost("sessions.stats", { taskId, cwd }));
  ipcMain.handle("sessions:share", (_event, taskId: string, cwd?: string) => requestHost("sessions.share", { taskId, cwd }));
  ipcMain.handle("sessions:changelog", () => requestHost("app.changelog"));
  ipcMain.handle("models:list", () => requestHost("models.list"));
  ipcMain.handle("workspace:snapshot", (_event, cwd: string) => requestHost("workspace.snapshot", { cwd }));
  ipcMain.handle("providers:list", () => requestHost("providers.list"));
  ipcMain.handle("providers:login", (_event, providerId: string, method: "api-key" | "oauth", secret?: string) => requestHost("providers.login", { providerId, method, secret }));
  ipcMain.handle("providers:set-api-key", (_event, providerId: string, apiKey: string) => requestHost("providers.setApiKey", { providerId, apiKey }));
  ipcMain.handle("providers:logout", (_event, providerId: string) => requestHost("providers.logout", { providerId }));
  ipcMain.handle("providers:auth-response", (_event, requestId: string, value: string, cancelled?: boolean) => requestHost("providers.auth-response", { requestId, value, cancelled }));
  ipcMain.handle("providers:open-auth-url", async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http(s) auth URLs can be opened");
    await shell.openExternal(parsed.toString());
  });
  ipcMain.handle("agent:prompt", (_event, taskId: string, text: string, cwd?: string, images?: Array<{ data: string; mimeType: string }>, delivery?: "steer" | "followUp") => requestHost("agent.prompt", { taskId, text, cwd: cwd ?? process.cwd(), images, delivery }));
  ipcMain.handle("agent:abort", (_event, taskId: string) => requestHost("agent.abort", { taskId }));
  ipcMain.handle("agent:set-thinking-level", (_event, taskId: string, level: string, cwd?: string) => requestHost("agent.setThinkingLevel", { taskId, level, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("agent:set-model", (_event, taskId: string, providerId: string, modelId: string, cwd?: string) => requestHost("agent.setModel", { taskId, providerId, modelId, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("agent:set-scoped-models", (_event, taskId: string, modelIds: string[] | null, persist?: boolean, cwd?: string) => requestHost("agent.setScopedModels", { taskId, modelIds, persist, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("agent:queue", (_event, taskId: string, cwd?: string) => requestHost("agent.queue", { taskId, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("agent:set-queue-modes", (_event, taskId: string, modes: { steeringMode?: "all" | "one-at-a-time"; followUpMode?: "all" | "one-at-a-time" }, cwd?: string) => requestHost("agent.setQueueModes", { taskId, cwd: cwd ?? process.cwd(), ...modes }));
  ipcMain.handle("agent:clear-queue", (_event, taskId: string, cwd?: string) => requestHost("agent.clearQueue", { taskId, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("agent:promote-queue", (_event, taskId: string, followUpIndex: number, cwd?: string) => requestHost("agent.promoteQueue", { taskId, followUpIndex, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("extension-ui:resolve", (_event, requestId: string, value: string | boolean | undefined) => requestHost("extension.ui.resolve", { requestId, value }));
  ipcMain.handle("packages:list", (_event, cwd?: string) => requestHost("packages.list", { cwd: cwd ?? process.cwd() }));
  ipcMain.handle("packages:install", (_event, source: string, local?: boolean, cwd?: string) => requestHost("packages.install", { source, local, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("packages:remove", (_event, source: string, local?: boolean, cwd?: string) => requestHost("packages.remove", { source, local, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("packages:update", (_event, source?: string, cwd?: string) => requestHost("packages.update", { source, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("packages:configure", (_event, source: string, enabled: boolean, local?: boolean, cwd?: string) => requestHost("packages.configure", { source, enabled, local, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("approval:resolve", (_event, requestId: string, decision: "allow-once" | "deny") => requestHost("approval.resolve", { requestId, decision }));
  ipcMain.handle("permissions:status", () => requestHost("permissions.status"));
  ipcMain.handle("permissions:set-mode", (_event, mode: "ask" | "allow" | "deny" | "yolo") => requestHost("permissions.setMode", { mode }));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 375,
    minHeight: 520,
    icon: applicationIconPath,
    backgroundColor: "#f7f6f1",
    titleBarStyle: "hiddenInset",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 14, y: 17 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") void shell.openExternal(parsed.toString());
    } catch {
      // Ignore malformed links emitted by model content.
    }
    return { action: "deny" };
  });

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

function createTray() {
  if (process.platform === "darwin") return;
  tray ??= new Tray(applicationIconPath);
  tray.setToolTip("PiDeck");
  const showWindow = () => {
    const window = hostWindow ?? BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  tray.on("click", showWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: copy[currentLanguage].workspace, click: showWindow },
    { type: "separator" },
    {
      label: copy[currentLanguage].confirmCloseExit,
      click: () => {
        // Destroying first skips the close-confirm dialog, then quit tears down
        // the host via `before-quit`.
        hostWindow?.destroy();
        if (BrowserWindow.getAllWindows().length === 0) app.quit();
      },
    },
  ]));
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
