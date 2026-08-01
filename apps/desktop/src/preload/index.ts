import { contextBridge, ipcRenderer } from "electron";
import type { PermissionMode, PiDeckRuntimeEvent, PideckBridge, PromptImage } from "@pideck/contracts";

const bridge: PideckBridge = {
  runtime: {
    status: () => ipcRenderer.invoke("runtime:status"),
  },
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
  },
  sessions: {
    list: (projectId?: string) => ipcRenderer.invoke("sessions:list", projectId),
    create: (input?: { cwd?: string; name?: string }) => ipcRenderer.invoke("sessions:create", input),
    delete: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:delete", taskId, cwd),
    remove: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:delete", taskId, cwd),
    messages: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:messages", taskId, cwd),
    capabilities: (taskId?: string, cwd?: string) => ipcRenderer.invoke("sessions:capabilities", taskId, cwd),
    tree: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:tree", taskId, cwd),
    navigate: (taskId: string, entryId: string, cwd?: string) => ipcRenderer.invoke("sessions:navigate", taskId, entryId, cwd),
    fork: (taskId: string, entryId: string, cwd?: string) => ipcRenderer.invoke("sessions:fork", taskId, entryId, cwd),
    compact: (taskId: string, instructions?: string, cwd?: string) => ipcRenderer.invoke("sessions:compact", taskId, instructions, cwd),
    export: (taskId: string, format: "jsonl" | "html", cwd?: string) => ipcRenderer.invoke("sessions:export", taskId, format, cwd),
  },
  models: {
    list: () => ipcRenderer.invoke("models:list"),
  },
  workspace: {
    snapshot: (cwd: string) => ipcRenderer.invoke("workspace:snapshot", cwd),
  },
  terminal: {
    execute: (taskId: string, command: string, cwd?: string) => ipcRenderer.invoke("terminal:execute", taskId, command, cwd),
  },
  providers: {
    list: () => ipcRenderer.invoke("providers:list"),
    login: (providerId: string, method: "api-key" | "oauth", secret?: string) => ipcRenderer.invoke("providers:login", providerId, method, secret),
    logout: (providerId: string) => ipcRenderer.invoke("providers:logout", providerId),
    setApiKey: (providerId: string, apiKey: string) => ipcRenderer.invoke("providers:set-api-key", providerId, apiKey),
    resolveAuth: (requestId: string, value: string) => ipcRenderer.invoke("providers:auth-response", requestId, value),
    openAuthUrl: (url: string) => ipcRenderer.invoke("providers:open-auth-url", url),
  },
  agent: {
    prompt: (taskId: string, text: string, cwd?: string, images?: PromptImage[]) => ipcRenderer.invoke("agent:prompt", taskId, text, cwd, images),
    abort: (taskId: string) => ipcRenderer.invoke("agent:abort", taskId),
    setThinkingLevel: (taskId: string, level: string, cwd?: string) => ipcRenderer.invoke("agent:set-thinking-level", taskId, level, cwd),
    setModel: (taskId: string, providerId: string, modelId: string, cwd?: string) => ipcRenderer.invoke("agent:set-model", taskId, providerId, modelId, cwd),
  },
  events: {
    subscribe: (listener: (event: PiDeckRuntimeEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: PiDeckRuntimeEvent) => listener(payload);
      ipcRenderer.on("pi:event", handler);
      return () => ipcRenderer.removeListener("pi:event", handler);
    },
  },
  approvals: {
    resolve: (requestId: string, decision: "allow-once" | "deny") => ipcRenderer.invoke("approval:resolve", requestId, decision),
  },
  permissions: {
    status: () => ipcRenderer.invoke("permissions:status"),
    setMode: (mode: PermissionMode) => ipcRenderer.invoke("permissions:set-mode", mode),
  },
};

contextBridge.exposeInMainWorld("pideck", bridge);
