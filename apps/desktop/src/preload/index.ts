import { contextBridge, ipcRenderer } from "electron";
import type { AppLanguage, ApplicationMenuRequest, PermissionMode, PiDeckRuntimeEvent, PideckBridge, PiSettingsUpdate, PromptImage, QueueDelivery, QueueMode, WindowTheme } from "@pideck/contracts";

const confirmCloseListeners = new Map<(enabled: boolean) => void, (event: Electron.IpcRendererEvent, enabled: boolean) => void>();

const bridge: PideckBridge = {
  app: {
    popupMenu: (request: ApplicationMenuRequest) => ipcRenderer.invoke("app:popup-menu", request),
    setLanguage: (language: AppLanguage) => ipcRenderer.invoke("app:set-language", language),
    setWindowTheme: (theme: WindowTheme) => ipcRenderer.invoke("app:set-window-theme", theme),
    quit: () => ipcRenderer.invoke("app:quit"),
    setConfirmClose: (enabled: boolean) => ipcRenderer.invoke("app:set-confirm-close", enabled),
    restartHost: () => ipcRenderer.invoke("app:restart-host"),
    onConfirmCloseChanged: (listener: (enabled: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, enabled: boolean) => listener(enabled);
      confirmCloseListeners.set(listener, handler);
      ipcRenderer.on("app:confirm-close-changed", handler);
    },
    offConfirmCloseChanged: (listener: (enabled: boolean) => void) => {
      const handler = confirmCloseListeners.get(listener);
      if (!handler) return;
      confirmCloseListeners.delete(listener);
      ipcRenderer.removeListener("app:confirm-close-changed", handler);
    },
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
    messages: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:messages", taskId, cwd),
    runMetadata: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:run-metadata", taskId, cwd),
    changeReviews: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:change-reviews", taskId, cwd),
    changeReview: (taskId: string, reviewId: string, cwd?: string) => ipcRenderer.invoke("sessions:change-review", taskId, reviewId, cwd),
    capabilities: (taskId?: string, cwd?: string) => ipcRenderer.invoke("sessions:capabilities", taskId, cwd),
    compact: (taskId: string, instructions?: string, cwd?: string) => ipcRenderer.invoke("sessions:compact", taskId, instructions, cwd),
    reload: (taskId: string, cwd?: string) => ipcRenderer.invoke("sessions:reload", taskId, cwd),
    export: (taskId: string, format: "jsonl" | "html", cwd?: string) => ipcRenderer.invoke("sessions:export", taskId, format, cwd),
    import: (taskId: string | undefined, cwd?: string) => ipcRenderer.invoke("sessions:import", taskId, cwd),
    rename: (taskId: string, name: string, cwd?: string) => ipcRenderer.invoke("sessions:rename", taskId, name, cwd),
    generateTitle: (taskId: string, message: string, cwd?: string, model?: { providerId: string; modelId: string }) => ipcRenderer.invoke("sessions:generateTitle", taskId, message, cwd, model),
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
  providers: {
    list: () => ipcRenderer.invoke("providers:list"),
    login: (providerId: string, method: "api-key" | "oauth", secret?: string, authOperationId?: string) => ipcRenderer.invoke("providers:login", providerId, method, secret, authOperationId),
    cancelLogin: (authOperationId: string) => ipcRenderer.invoke("providers:cancel-login", authOperationId),
    logout: (providerId: string) => ipcRenderer.invoke("providers:logout", providerId),
    setApiKey: (providerId: string, apiKey: string) => ipcRenderer.invoke("providers:set-api-key", providerId, apiKey),
    resolveAuth: (requestId: string, value: string, cancelled?: boolean) => ipcRenderer.invoke("providers:auth-response", requestId, value, cancelled),
    openAuthUrl: (url: string) => ipcRenderer.invoke("providers:open-auth-url", url),
  },
  agent: {
    prompt: (taskId: string, text: string, cwd?: string, images?: PromptImage[], delivery?: QueueDelivery) => ipcRenderer.invoke("agent:prompt", taskId, text, cwd, images, delivery),
    executeBash: (taskId: string, command: string, excludeFromContext?: boolean, cwd?: string) => ipcRenderer.invoke("agent:execute-bash", taskId, command, excludeFromContext, cwd),
    abort: (taskId: string, cwd?: string) => ipcRenderer.invoke("agent:abort", taskId, cwd),
    setThinkingLevel: (taskId: string, level: string, cwd?: string) => ipcRenderer.invoke("agent:set-thinking-level", taskId, level, cwd),
    setModel: (taskId: string, providerId: string, modelId: string, cwd?: string) => ipcRenderer.invoke("agent:set-model", taskId, providerId, modelId, cwd),
    setScopedModels: (taskId: string, modelIds: string[] | null, persist?: boolean, cwd?: string) => ipcRenderer.invoke("agent:set-scoped-models", taskId, modelIds, persist, cwd),
    queue: (taskId: string, cwd?: string) => ipcRenderer.invoke("agent:queue", taskId, cwd),
    setQueueModes: (taskId: string, modes: { steeringMode?: QueueMode; followUpMode?: QueueMode }, cwd?: string) => ipcRenderer.invoke("agent:set-queue-modes", taskId, modes, cwd),
    clearQueue: (taskId: string, cwd?: string) => ipcRenderer.invoke("agent:clear-queue", taskId, cwd),
    promoteQueue: (taskId: string, followUpIndex: number, cwd?: string) => ipcRenderer.invoke("agent:promote-queue", taskId, followUpIndex, cwd),
    editQueue: (taskId: string, messageId: string, text: string, images?: PromptImage[], cwd?: string) => ipcRenderer.invoke("agent:edit-queue", taskId, messageId, text, images, cwd),
    deleteQueue: (taskId: string, messageId: string, cwd?: string) => ipcRenderer.invoke("agent:delete-queue", taskId, messageId, cwd),
  },
  settings: {
    get: (cwd?: string) => ipcRenderer.invoke("settings:get", cwd),
    update: (settings: PiSettingsUpdate, cwd?: string) => ipcRenderer.invoke("settings:update", settings, cwd),
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
