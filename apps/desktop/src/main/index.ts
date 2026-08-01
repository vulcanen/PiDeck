import { app, BrowserWindow, ipcMain, shell } from "electron";
import { execFileSync, fork as forkNode, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { PiHostRequest, PiHostResponse } from "@pideck/contracts";

type RuntimeStatus = "connected" | "starting" | "disconnected";

let host: ChildProcess | undefined;
let hostAlive = false;
let hostStatus: RuntimeStatus = "starting";
let hostWindow: BrowserWindow | undefined;
const pending = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

function publishRuntimeStatus(status: RuntimeStatus) {
  hostStatus = status;
  if (hostWindow && !hostWindow.isDestroyed()) {
    void hostWindow.webContents.send("pi:event", { type: "runtime.status", payload: status });
  }
}

function resolveNodeExecutable(): string {
  if (process.env.PIDECK_NODE_EXECUTABLE) return process.env.PIDECK_NODE_EXECUTABLE;
  try {
    const executable = execFileSync("where.exe", ["node"], { encoding: "utf8" })
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(Boolean);
    if (executable) return executable;
  } catch {
    // Fall back to Electron's executable only when no system Node is available.
  }
  return process.execPath;
}

function startHost(window: BrowserWindow) {
  hostWindow = window;
  if (host && hostAlive) {
    publishRuntimeStatus(hostStatus);
    return;
  }

  publishRuntimeStatus("starting");
  const hostPath = path.join(__dirname, "../utility/pi-host/index.js");
  host = forkNode(hostPath, [], {
    execPath: resolveNodeExecutable(),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env, PIDECK_HOST_PROCESS: "1" },
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
    const timeoutMs = command === "providers.login"
      ? 15 * 60_000
      : command === "agent.prompt"
        ? 10 * 60_000
        : 60_000;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`PiHost request timed out: ${command}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    host.send?.({ id, command, payload } satisfies PiHostRequest);
  });
}

function registerIpcHandlers() {
  ipcMain.handle("runtime:status", () => hostStatus);
  ipcMain.handle("projects:list", () => requestHost("projects.list"));
  ipcMain.handle("sessions:list", (_event, projectId?: string) => requestHost("sessions.list", { cwd: projectId }));
  ipcMain.handle("sessions:create", (_event, input?: { cwd?: string; name?: string }) => requestHost("sessions.create", input));
  ipcMain.handle("sessions:delete", (_event, taskId: string, cwd?: string) => requestHost("sessions.delete", { taskId, cwd }));
  ipcMain.handle("sessions:messages", (_event, taskId: string, cwd?: string) => requestHost("sessions.messages", { taskId, cwd }));
  ipcMain.handle("sessions:capabilities", (_event, taskId?: string, cwd?: string) => requestHost("sessions.capabilities", { taskId, cwd }));
  ipcMain.handle("sessions:tree", (_event, taskId: string, cwd?: string) => requestHost("sessions.tree", { taskId, cwd }));
  ipcMain.handle("sessions:navigate", (_event, taskId: string, entryId: string, cwd?: string) => requestHost("sessions.navigate", { taskId, entryId, cwd }));
  ipcMain.handle("sessions:fork", (_event, taskId: string, entryId: string, cwd?: string) => requestHost("sessions.fork", { taskId, entryId, cwd }));
  ipcMain.handle("sessions:compact", (_event, taskId: string, instructions?: string, cwd?: string) => requestHost("sessions.compact", { taskId, instructions, cwd }));
  ipcMain.handle("sessions:export", (_event, taskId: string, format: "jsonl" | "html", cwd?: string) => requestHost("sessions.export", { taskId, format, cwd }));
  ipcMain.handle("models:list", () => requestHost("models.list"));
  ipcMain.handle("workspace:snapshot", (_event, cwd: string) => requestHost("workspace.snapshot", { cwd }));
  ipcMain.handle("terminal:execute", (_event, taskId: string, command: string, cwd?: string) => requestHost("terminal.execute", { taskId, command, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("providers:list", () => requestHost("providers.list"));
  ipcMain.handle("providers:login", (_event, providerId: string, method: "api-key" | "oauth", secret?: string) => requestHost("providers.login", { providerId, method, secret }));
  ipcMain.handle("providers:set-api-key", (_event, providerId: string, apiKey: string) => requestHost("providers.setApiKey", { providerId, apiKey }));
  ipcMain.handle("providers:logout", (_event, providerId: string) => requestHost("providers.logout", { providerId }));
  ipcMain.handle("providers:auth-response", (_event, requestId: string, value: string) => requestHost("providers.auth-response", { requestId, value }));
  ipcMain.handle("providers:open-auth-url", async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http(s) auth URLs can be opened");
    await shell.openExternal(parsed.toString());
  });
  ipcMain.handle("agent:prompt", (_event, taskId: string, text: string, cwd?: string, images?: Array<{ data: string; mimeType: string }>) => requestHost("agent.prompt", { taskId, text, cwd: cwd ?? process.cwd(), images }));
  ipcMain.handle("agent:abort", (_event, taskId: string) => requestHost("agent.abort", { taskId }));
  ipcMain.handle("agent:set-thinking-level", (_event, taskId: string, level: string, cwd?: string) => requestHost("agent.setThinkingLevel", { taskId, level, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("agent:set-model", (_event, taskId: string, providerId: string, modelId: string, cwd?: string) => requestHost("agent.setModel", { taskId, providerId, modelId, cwd: cwd ?? process.cwd() }));
  ipcMain.handle("approval:resolve", (_event, requestId: string, decision: "allow-once" | "deny") => requestHost("approval.resolve", { requestId, decision }));
  ipcMain.handle("permissions:status", () => requestHost("permissions.status"));
  ipcMain.handle("permissions:set-mode", (_event, mode: "ask" | "allow" | "deny" | "yolo") => requestHost("permissions.setMode", { mode }));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f7f6f1",
    titleBarStyle: "hiddenInset",
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
    void window.loadFile(path.join(__dirname, "../../../dist-renderer/index.html"));
  }
  startHost(window);
  window.on("closed", () => {
    if (hostWindow === window) hostWindow = undefined;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
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
