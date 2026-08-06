import { contextBridge, ipcRenderer } from "electron";
import type { AppLanguage, PermissionMode, PiDeckRuntimeEvent, PideckBridge, PromptImage, QueueDelivery, QueueMode } from "@pideck/contracts";

const bridge: PideckBridge = {
  app: {
    setLanguage: (language: AppLanguage) => ipcRenderer.invoke("app:set-language", language),
    quit: () => ipcRenderer.invoke("app:quit"),
  },
  runtime: {
    status: () => ipcRenderer.invoke("runtime:status"),
  },
  projects: {
    list: (preferredCwd?: string) => ipcRenderer.invoke("projects:list", preferredCwd),
    chooseDirectory: () => ipcRenderer.invoke("projects:choose-directory"),
    remove: (cwd: string) => ipcRenderer.invoke("projects:remove", cwd),
    setTrust: (cwd: string, trusted: boolean) => ipcRenderer.invoke("projects:set-trust", cwd, trusted),
  },
  sessions: {
    list: (projectId?: string) => ipcRenderer.invoke("sessions:list", projectId),
    create: (input?: { cwd?: string; name?: string }) => ipcRenderer.invoke("sessions:create", input),
    delete: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:delete", taskId, cwd),
    remove: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:delete", taskId, cwd),
    messages: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:messages", taskId, cwd),
    runMetadata: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:run-metadata", taskId, cwd),
    capabilities: (taskId?: string, cwd?: string) => ipcRenderer.invoke("sessions:capabilities", taskId, cwd),
    compact: (taskId: string, instructions?: string, cwd?: string) => ipcRenderer.invoke("sessions:compact", taskId, instructions, cwd),
    export: (taskId: string, format: "jsonl" | "html", cwd?: string) => ipcRenderer.invoke("sessions:export", taskId, format, cwd),
    import: (taskId: string | undefined, inputPath?: string, cwd?: string) => ipcRenderer.invoke("sessions:import", taskId, inputPath, cwd),
    rename: (taskId: string, name: string, cwd?: string) => ipcRenderer.invoke("sessions:rename", taskId, name, cwd),
    stats: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:stats", taskId, cwd),
    share: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:share", taskId, cwd),
    changelog: () => ipcRenderer.invoke("sessions:changelog"),
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
    resolveAuth: (requestId: string, value: string, cancelled?: boolean) => ipcRenderer.invoke("providers:auth-response", requestId, value, cancelled),
    openAuthUrl: (url: string) => ipcRenderer.invoke("providers:open-auth-url", url),
  },
  agent: {
    prompt: (taskId: string, text: string, cwd?: string, images?: PromptImage[], delivery?: QueueDelivery) => ipcRenderer.invoke("agent:prompt", taskId, text, cwd, images, delivery),
    abort: (taskId: string) => ipcRenderer.invoke("agent:abort", taskId),
    setThinkingLevel: (taskId: string, level: string, cwd?: string) => ipcRenderer.invoke("agent:set-thinking-level", taskId, level, cwd),
    setModel: (taskId: string, providerId: string, modelId: string, cwd?: string) => ipcRenderer.invoke("agent:set-model", taskId, providerId, modelId, cwd),
    setScopedModels: (taskId: string, modelIds: string[] | null, persist?: boolean, cwd?: string) => ipcRenderer.invoke("agent:set-scoped-models", taskId, modelIds, persist, cwd),
    queue: (taskId: string, cwd?: string) => ipcRenderer.invoke("agent:queue", taskId, cwd),
    setQueueModes: (taskId: string, modes: { steeringMode?: QueueMode; followUpMode?: QueueMode }, cwd?: string) => ipcRenderer.invoke("agent:set-queue-modes", taskId, modes, cwd),
    clearQueue: (taskId: string, cwd?: string) => ipcRenderer.invoke("agent:clear-queue", taskId, cwd),
    promoteQueue: (taskId: string, followUpIndex: number, cwd?: string) => ipcRenderer.invoke("agent:promote-queue", taskId, followUpIndex, cwd),
  },
  extensions: {
    resolveUi: (requestId: string, value: string | boolean | undefined) => ipcRenderer.invoke("extension-ui:resolve", requestId, value),
  },
  packages: {
    list: (cwd?: string) => ipcRenderer.invoke("packages:list", cwd),
    install: (source: string, local?: boolean, cwd?: string) => ipcRenderer.invoke("packages:install", source, local, cwd),
    remove: (source: string, local?: boolean, cwd?: string) => ipcRenderer.invoke("packages:remove", source, local, cwd),
    update: (source?: string, cwd?: string) => ipcRenderer.invoke("packages:update", source, cwd),
    configure: (source: string, enabled: boolean, local?: boolean, cwd?: string) => ipcRenderer.invoke("packages:configure", source, enabled, local, cwd),
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
