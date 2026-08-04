import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentQueueState, ContextUsage, ExtensionUiRequest, ModelSummary, PermissionMode, PermissionStatus, QueueDelivery, QueueMode, ProviderSummary, SessionCapabilities, WorkspaceSnapshot } from "@pideck/contracts";
import { deriveSessionTitle, type ProjectSummary, type TaskSummary } from "@pideck/domain";
import { copy, localizeCommandDescription, type Language } from "@pideck/i18n";
import { fallbackSlashCommands } from "./pi-capabilities";
import { Icon, useDialogFocus } from "@pideck/ui-system";
import type { ActivityStep, ImageAttachment, ImageContextMenuState, MessageLoad, PreviewImage, SentImageMessage, SuggestionMode, TaskUiState, Theme, WorkingPhase } from "./types";
import { createDefaultTaskUiState, mergeMessageSnapshot, messageIdentity, sortTasksByUpdatedAt, textFromMessage } from "./message-utils";
import { ApprovalCard, CommandPalette, CommandPaletteBoundary, Composer, ConfirmDialog, ConversationSkeleton, ExecutionSummary, ExtensionUiDialog, handleRovingMenuKeyDown, ImageContextMenu, ImagePreview, MarkdownContent, MemoMessageTimeline, PackageSettings, PermissionLevelControl, ProjectRemoveDialog, ProviderSettings, SidebarSkeleton, TaskRow, TerminalPanel, WorkingIndicator, copyImageToClipboard } from "./ui-components";


function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function App() {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("pideck.language") === "en" ? "en" : "zh");
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("pideck.theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [projectCwd, setProjectCwd] = useState(() => localStorage.getItem("pideck.project-cwd") ?? "");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [expandedProjectCwds, setExpandedProjectCwds] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("pideck.expanded-project-cwds") ?? "[]");
      if (Array.isArray(stored)) return stored.filter((cwd): cwd is string => typeof cwd === "string" && cwd.length > 0);
    } catch { /* Fall through to the legacy single-project preference. */ }
    const legacy = localStorage.getItem("pideck.expanded-project-cwd");
    return legacy ? [legacy] : [];
  });
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [projectTasksByCwd, setProjectTasksByCwd] = useState<Record<string, TaskSummary[]>>({});
  const [projectTaskLoads, setProjectTaskLoads] = useState<Record<string, MessageLoad>>({});
  const [activeTask, setActiveTask] = useState<TaskSummary | null>(null);
  const [messagesByTask, setMessagesByTask] = useState<Record<string, any[]>>({});
  const [steeringMessageKeysByTask, setSteeringMessageKeysByTask] = useState<Record<string, string[]>>({});
  const [sentImagesByTask, setSentImagesByTask] = useState<Record<string, SentImageMessage[]>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("pideck.sent-images.v1") ?? "null");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
      return Object.fromEntries(Object.entries(stored).filter(([, value]) => Array.isArray(value))) as Record<string, SentImageMessage[]>;
    } catch { return {}; }
  });
  const [messageLoads, setMessageLoads] = useState<Record<string, MessageLoad>>({});
  const [messageReload, setMessageReload] = useState(0);
  const [taskUi, setTaskUi] = useState<Record<string, TaskUiState>>({});
  const [composer, setComposer] = useState("");
  const [composerImages, setComposerImages] = useState<ImageAttachment[]>([]);
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerFocus, setProviderFocus] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [capabilities, setCapabilities] = useState<SessionCapabilities | null>(null);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [activeModel, setActiveModel] = useState<ModelSummary | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | undefined>(undefined);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null);
  const [queueState, setQueueState] = useState<AgentQueueState | null>(null);
  const [queueMutationBusy, setQueueMutationBusy] = useState(false);
  const [queueDelivery, setQueueDelivery] = useState<QueueDelivery>("followUp");
  const [extensionUiRequest, setExtensionUiRequest] = useState<ExtensionUiRequest | null>(null);
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState("off");
  const [thinkingLevels, setThinkingLevels] = useState<string[]>(["off"]);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [suggestionMode, setSuggestionMode] = useState<SuggestionMode>(null);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [runtimeStatus, setRuntimeStatus] = useState<"connected" | "starting" | "disconnected">("starting");
  const [contextMenu, setContextMenu] = useState<{ task: TaskSummary; x: number; y: number } | null>(null);
  const [projectContextMenu, setProjectContextMenu] = useState<{ project: ProjectSummary; x: number; y: number } | null>(null);
  const [imageContextMenu, setImageContextMenu] = useState<ImageContextMenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TaskSummary | null>(null);
  const [pendingProjectRemove, setPendingProjectRemove] = useState<ProjectSummary | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [removingProjectCwd, setRemovingProjectCwd] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const followConversationRef = useRef(true);
  const noticeTimerRef = useRef<number | null>(null);
  const streamDeltasRef = useRef<Record<string, string>>({});
  const streamFrameRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const optimisticTaskIdsRef = useRef<Record<string, Set<string>>>({});
  const initialLoadStartedRef = useRef(false);
  const t = copy[language];
  useDialogFocus(sidebarRef, () => setMobileSidebarOpen(false), mobileSidebarOpen && window.matchMedia("(max-width: 560px)").matches);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcut = (key: string) => `${isMac ? "⌘" : "Ctrl+"}${key}`;
  const activeTaskUi = activeTask ? taskUi[activeTask.id] : undefined;
  const isSending = Boolean(activeTaskUi?.isSending);
  const isCompacting = Boolean(activeTaskUi?.isCompacting);
  const isWorking = isSending || isCompacting;
  const streamText = activeTaskUi?.streamText ?? "";
  const workingPhase = activeTaskUi?.workingPhase ?? null;
  const liveApproval = activeTaskUi?.approval;
  const rawMessages = activeTask ? messagesByTask[activeTask.id] ?? [] : [];
  const messages = useMemo(() => {
    if (!activeTask) return rawMessages;
    const pendingImages = [...(sentImagesByTask[activeTask.id] ?? [])];
    if (!pendingImages.length) return rawMessages;
    return rawMessages.map((message) => {
      if (message?.role !== "user" || (Array.isArray(message.content) && message.content.some((part: any) => part?.type === "image"))) return message;
      const matchIndex = pendingImages.findIndex((sent) => textFromMessage(message).trim() === sent.text);
      if (matchIndex < 0) return message;
      const sent = pendingImages.splice(matchIndex, 1)[0];
      return { ...message, content: [{ type: "text", text: sent.text }, ...sent.images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }))] };
    });
  }, [activeTask, rawMessages, sentImagesByTask]);
  const messageLoad = activeTask ? messageLoads[activeTask.id] ?? { status: "idle" as const } : { status: "idle" as const };
  const activeProject = projects.find((project) => project.cwd === projectCwd) ?? null;

  function mergeLiveTaskState(task: TaskSummary): TaskSummary {
    const ui = taskUi[task.id];
    if (ui?.approval) return { ...task, state: "waiting-approval" };
    if (ui?.isSending || ui?.isCompacting) return { ...task, state: "running" };
    return task;
  }

  function updateTaskLists(update: (tasks: TaskSummary[]) => TaskSummary[]) {
    setTasks(update);
    setProjectTasksByCwd((current) => Object.fromEntries(Object.entries(current).map(([cwd, projectTasks]) => [cwd, update(projectTasks)])));
  }

  function patchTaskUi(taskId: string, patch: Partial<TaskUiState>) {
    setTaskUi((current) => {
      const previous = current[taskId] ?? createDefaultTaskUiState();
      return { ...current, [taskId]: { ...previous, ...patch } };
    });
  }

  function updateActivity(taskId: string, update: (steps: ActivityStep[]) => ActivityStep[]) {
    setTaskUi((current) => {
      const previous = current[taskId] ?? { ...createDefaultTaskUiState(), isSending: true, workingPhase: "thinking" as const };
      return { ...current, [taskId]: { ...previous, activity: update(previous.activity) } };
    });
  }

  function queueStreamDelta(taskId: string, delta: string) {
    streamDeltasRef.current[taskId] = `${streamDeltasRef.current[taskId] ?? ""}${delta}`;
    if (streamFrameRef.current !== null) return;
    // Markdown rendering is comparatively expensive. Cap live updates so a
    // fast provider cannot force the whole desktop shell to render per token.
    streamFrameRef.current = window.setTimeout(() => {
      streamFrameRef.current = null;
      const pending = streamDeltasRef.current;
      streamDeltasRef.current = {};
      setTaskUi((current) => {
        const next = { ...current };
        for (const [pendingTaskId, text] of Object.entries(pending)) {
          const previous = next[pendingTaskId] ?? { ...createDefaultTaskUiState(), isSending: true, workingPhase: "responding" as const };
          next[pendingTaskId] = { ...previous, isSending: true, isCompacting: false, workingPhase: "responding", streamText: previous.streamText + text, toolName: undefined };
        }
        return next;
      });
    });
  }

  function openProviderSettings(providerId?: string) {
    setPaletteOpen(false);
    setPreviewImage(null);
    setProviderFocus(providerId ?? null);
    setSettingsOpen(true);
  }

  function openCommandPalette() {
    setSettingsOpen(false);
    setProviderFocus(null);
    setPreviewImage(null);
    setPaletteOpen(true);
  }

  function handlePermissionStatus(status: PermissionStatus) {
    setPermissionStatus(status);
    if (status.mode === "ask") return;
    setTaskUi((current) => Object.fromEntries(Object.entries(current).map(([taskId, state]) => [taskId, state.approval ? { ...state, approval: undefined, workingPhase: state.isSending ? "thinking" as const : state.workingPhase } : state])));
    updateTaskLists((current) => current.map((task) => task.state === "waiting-approval" ? { ...task, state: "running" } : task));
  }

  function showNotice(message: string) {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => { setNotice(null); noticeTimerRef.current = null; }, 3600);
  }

  function clearProjectState() {
    setActiveTask(null);
    setTasks([]);
    setWorkspace(null);
    setCapabilities(null);
    setContextUsage(undefined);
    setComposer("");
    setComposerImages([]);
    setActiveModel(null);
    setThinkingLevel("off");
    setThinkingLevels(["off"]);
    setMessageLoads({});
  }

  async function refreshWorkspace() {
    if (!projectCwd) return;
    try { setWorkspace(await window.pideck.workspace.snapshot(projectCwd)); }
    catch (error) { showNotice(`${t.workspaceRefreshFailed}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  async function refreshModels(providerId?: string) {
    try {
      const maxAttempts = providerId ? 8 : 1;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const [providersResult, modelsResult] = await Promise.allSettled([
          providerId ? window.pideck.providers.list() : Promise.resolve([] as ProviderSummary[]),
          window.pideck.models.list(),
        ]);
        if (modelsResult.status === "fulfilled") setModels(modelsResult.value);
        else throw modelsResult.reason;
        if (!providerId) return;
        if (providersResult.status === "fulfilled" && providersResult.value.some((provider) => provider.id === providerId && provider.authState === "configured")) return;
        await new Promise((resolve) => window.setTimeout(resolve, attempt < 2 ? 150 : 300));
      }
    } catch (error) { showNotice(`Pi models.list: ${error instanceof Error ? error.message : String(error)}`); }
  }

  async function loadProjectData(cwd: string, preferredTaskId?: string, selectDefaultTask = true, fallbackTask?: TaskSummary) {
    setInitialLoading(true);
    setLoadError(null);
    try {
      setProjectCwd(cwd);
      localStorage.setItem("pideck.project-cwd", cwd);
      const [tasksResult, modelsResult, snapshotResult, capabilitiesResult] = await Promise.allSettled([
        window.pideck.sessions.list(cwd),
        window.pideck.models.list(),
        window.pideck.workspace.snapshot(cwd),
        window.pideck.sessions.capabilities(undefined, cwd),
      ]);
      const listedTasks = tasksResult.status === "fulfilled" ? tasksResult.value.map(mergeLiveTaskState) : [];
      // A newly-created empty session can briefly be missing from Pi's
      // persisted SessionManager list while its session file is flushed. Keep
      // the task supplied by the sidebar visible/selectable during that gap.
      const previousTasks = [...(projectTasksByCwd[cwd] ?? []), ...(fallbackTask ? [fallbackTask] : [])];
      const remoteTasks = mergeProjectTasks(cwd, listedTasks, previousTasks);
      if (tasksResult.status === "fulfilled") {
        setTasks(remoteTasks);
        setProjectTasksByCwd((current) => ({ ...current, [cwd]: remoteTasks }));
        setProjectTaskLoads((current) => ({ ...current, [cwd]: { status: "ready" } }));
      } else setLoadError(`${t.initialLoadFailed}: ${tasksResult.reason instanceof Error ? tasksResult.reason.message : String(tasksResult.reason)}`);
      if (modelsResult.status === "fulfilled") setModels(modelsResult.value);
      else showNotice(`Pi models.list: ${modelsResult.reason instanceof Error ? modelsResult.reason.message : String(modelsResult.reason)}`);
      if (snapshotResult.status === "fulfilled") setWorkspace(snapshotResult.value);
      else showNotice(`${t.workspaceRefreshFailed}: ${snapshotResult.reason instanceof Error ? snapshotResult.reason.message : String(snapshotResult.reason)}`);
      if (capabilitiesResult.status === "fulfilled") {
        setCapabilities(capabilitiesResult.value);
        setThinkingLevel(capabilitiesResult.value.thinkingLevel);
        setThinkingLevels(capabilitiesResult.value.thinkingLevels);
        setContextUsage(capabilitiesResult.value.contextUsage);
        setActiveModel(capabilitiesResult.value.model?.authConfigured ? capabilitiesResult.value.model : modelsResult.status === "fulfilled" ? modelsResult.value.find((model) => model.authConfigured) ?? null : null);
      } else showNotice(`Pi capabilities: ${capabilitiesResult.reason instanceof Error ? capabilitiesResult.reason.message : String(capabilitiesResult.reason)}`);
      const preferredTask = preferredTaskId ? remoteTasks.find((task) => task.id === preferredTaskId) ?? fallbackTask ?? null : null;
      setActiveTask(selectDefaultTask ? preferredTask ?? remoteTasks[0] ?? null : preferredTask);
    } catch (error) {
      setLoadError(`${t.initialLoadFailed}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInitialLoading(false);
    }
  }

  async function loadInitialData() {
    setInitialLoading(true);
    setLoadError(null);
    try {
      const discoveredProjects = await window.pideck.projects.list(projectCwd || undefined);
      setProjects(discoveredProjects);
      const selectedProject = discoveredProjects.find((project) => project.cwd === projectCwd) ?? discoveredProjects[0];
      if (!selectedProject) {
        clearProjectState();
        setProjectCwd("");
        localStorage.removeItem("pideck.project-cwd");
        setExpandedProjectCwds([]);
        setInitialLoading(false);
        return;
      }
      setExpandedProjectCwds((current) => current.includes(selectedProject.cwd) ? current : [...current, selectedProject.cwd]);
      await loadProjectData(selectedProject.cwd, activeTask?.projectId === selectedProject.id ? activeTask.id : undefined);
    } catch (error) {
      setLoadError(`${t.initialLoadFailed}: ${error instanceof Error ? error.message : String(error)}`);
      setInitialLoading(false);
    }
  }

  async function loadProjectSessions(project: ProjectSummary) {
    setProjectTaskLoads((current) => ({ ...current, [project.cwd]: { status: "loading" } }));
    try {
      const listedTasks = (await window.pideck.sessions.list(project.cwd)).map(mergeLiveTaskState);
      setProjectTasksByCwd((current) => ({
        ...current,
        [project.cwd]: mergeProjectTasks(project.cwd, listedTasks, current[project.cwd] ?? []),
      }));
      setProjectTaskLoads((current) => ({ ...current, [project.cwd]: { status: "ready" } }));
    } catch (error) {
      setProjectTaskLoads((current) => ({ ...current, [project.cwd]: { status: "error", error: error instanceof Error ? error.message : String(error) } }));
    }
  }

  async function selectProject(project: ProjectSummary) {
    if (initialLoading) return;
    if (expandedProjectCwds.includes(project.cwd)) {
      setExpandedProjectCwds((current) => current.filter((cwd) => cwd !== project.cwd));
      return;
    }
    setExpandedProjectCwds((current) => [...current, project.cwd]);
    if (project.cwd !== projectCwd) await loadProjectSessions(project);
  }

  async function selectTask(project: ProjectSummary, task: TaskSummary) {
    if (initialLoading) return;
    setMobileSidebarOpen(false);
    setExpandedProjectCwds((current) => current.includes(project.cwd) ? current : [...current, project.cwd]);
    if (project.cwd === projectCwd) {
      setActiveTask(task);
      updateTaskLists((current) => current.map((item) => item.id === task.id ? { ...item, unread: false } : item));
      return;
    }
    clearProjectState();
    await loadProjectData(project.cwd, task.id, false, task);
  }

  async function createTaskForProject(project: ProjectSummary) {
    if (initialLoading) return null;
    try {
      const task = await window.pideck.sessions.create({ cwd: project.cwd, name: t.newTaskName });
      rememberOptimisticTask(task);
      setProjectTasksByCwd((current) => ({ ...current, [project.cwd]: sortTasksByUpdatedAt([task, ...(current[project.cwd] ?? []).filter((item) => item.id !== task.id)]) }));
      setProjects((current) => current.map((item) => item.cwd === project.cwd ? { ...item, taskCount: item.taskCount + 1 } : item));
      setExpandedProjectCwds((current) => current.includes(project.cwd) ? current : [...current, project.cwd]);
      setMobileSidebarOpen(false);
      clearProjectState();
      setProjectCwd(project.cwd);
      localStorage.setItem("pideck.project-cwd", project.cwd);
      setTasks([task]);
      setMessagesByTask((current) => ({ ...current, [task.id]: [] }));
      setMessageLoads((current) => ({ ...current, [task.id]: { status: "ready" } }));
      setActiveTask(task);
      await loadProjectData(project.cwd, task.id, false, task);
      // SessionManager.list may not expose a just-created session until its
      // session file is flushed. Keep the optimistic task selected instead of
      // letting the reload return to the empty-project state.
      setTasks((current) => sortTasksByUpdatedAt([task, ...current.filter((item) => item.id !== task.id)]));
      setProjectTasksByCwd((current) => ({ ...current, [project.cwd]: sortTasksByUpdatedAt([task, ...(current[project.cwd] ?? []).filter((item) => item.id !== task.id)]) }));
      setActiveTask((current) => current?.id === task.id ? current : task);
      showNotice(t.sessionCreated);
      return task;
    } catch (error) {
      showNotice(`${t.sessionCreateFailed}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async function chooseProjectDirectory() {
    try {
      const chooseDirectory = window.pideck.projects.chooseDirectory;
      if (typeof chooseDirectory !== "function") throw new Error(t.projectBridgeError);
      const project = await chooseDirectory();
      if (!project) return;
      setProjects((current) => [project, ...current.filter((item) => item.cwd !== project.cwd)]);
      await selectProject(project);
    } catch (error) {
      showNotice(`${t.projectOpenFailed}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function removeProject(project: ProjectSummary) {
    if (removingProjectCwd) return;
    try {
      const removeProjectBridge = window.pideck.projects.remove;
      if (typeof removeProjectBridge !== "function") throw new Error(t.projectRemoveBridgeError);
      setRemovingProjectCwd(project.cwd);
      await removeProjectBridge(project.cwd);
      setProjects((current) => current.filter((item) => item.cwd !== project.cwd));
      setProjectTasksByCwd((current) => { const next = { ...current }; delete next[project.cwd]; return next; });
      setProjectTaskLoads((current) => { const next = { ...current }; delete next[project.cwd]; return next; });
      setExpandedProjectCwds((current) => current.filter((cwd) => cwd !== project.cwd));
      if (projectCwd === project.cwd) {
        clearProjectState();
        setProjectCwd("");
        localStorage.removeItem("pideck.project-cwd");
      }
      setPendingProjectRemove(null);
    } catch (error) {
      showNotice(`${t.projectRemoveFailed}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRemovingProjectCwd(null);
    }
  }

  useEffect(() => { localStorage.setItem("pideck.language", language); document.documentElement.lang = language === "zh" ? "zh-CN" : "en"; }, [language]);
  useEffect(() => { localStorage.setItem("pideck.theme", theme); document.documentElement.style.colorScheme = theme; }, [theme]);
  useEffect(() => {
    localStorage.setItem("pideck.expanded-project-cwds", JSON.stringify(expandedProjectCwds));
    localStorage.removeItem("pideck.expanded-project-cwd");
  }, [expandedProjectCwds]);
  useEffect(() => { void window.pideck.app.setLanguage(language).catch(() => undefined); }, [language]);
  useEffect(() => {
    try { localStorage.setItem("pideck.sent-images.v1", JSON.stringify(sentImagesByTask)); }
    catch { /* Image history is a UI fallback; Pi remains the authoritative session store. */ }
  }, [sentImagesByTask]);
  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    if (streamFrameRef.current !== null) window.clearTimeout(streamFrameRef.current);
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);
  useEffect(() => {
    if (initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    void loadInitialData();
  }, []);
  useEffect(() => { followConversationRef.current = true; setShowJumpToLatest(false); }, [activeTask?.id]);
  useEffect(() => {
    setQueueState(null);
    if (activeTask && projectCwd) void refreshQueue(activeTask);
  }, [activeTask?.id, projectCwd]);

  useEffect(() => {
    const element = conversationRef.current;
    if (!element) return;
    if (!followConversationRef.current) {
      if (streamText || isSending) setShowJumpToLatest(true);
      return;
    }
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const current = conversationRef.current;
      if (current) current.scrollTop = current.scrollHeight;
    });
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [messages, streamText, isSending]);

  useLayoutEffect(() => {
    const element = conversationRef.current;
    if (!element) return;
    const root = document.documentElement;
    const updateScrollbarWidth = () => {
      const scrollbarWidth = Math.max(0, element.offsetWidth - element.clientWidth);
      root.style.setProperty("--conversation-scrollbar-width", `${scrollbarWidth}px`);
    };
    updateScrollbarWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScrollbarWidth);
      return () => {
        window.removeEventListener("resize", updateScrollbarWidth);
        root.style.removeProperty("--conversation-scrollbar-width");
      };
    }
    const observer = new ResizeObserver(updateScrollbarWidth);
    observer.observe(element);
    window.addEventListener("resize", updateScrollbarWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScrollbarWidth);
      root.style.removeProperty("--conversation-scrollbar-width");
    };
  }, []);

  function handleConversationScroll() {
    const element = conversationRef.current;
    if (!element) return;
    const follows = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
    followConversationRef.current = follows;
    if (follows) setShowJumpToLatest(false);
  }

  function jumpToLatest() {
    const element = conversationRef.current;
    if (!element) return;
    followConversationRef.current = true;
    setShowJumpToLatest(false);
    element.scrollTo({ top: element.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  const modelOptions = useMemo(() => [...models].filter((model) => model.authConfigured).sort((a, b) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name)), [models]);
  const hiddenSlashCommandNames = useMemo(() => new Set(["fork", "tree"]), []);
  const suggestions = useMemo(() => {
    if (suggestionMode === "mention") return (workspace?.files ?? []).filter((file) => file.kind === "file" && file.path.toLowerCase().includes(suggestionQuery.toLowerCase())).slice(0, 12);
    const slashCommands = Array.isArray(capabilities?.slashCommands) && capabilities.slashCommands.length ? capabilities.slashCommands : fallbackSlashCommands;
    const prompts = Array.isArray(capabilities?.prompts) ? capabilities.prompts : [];
    const skills = Array.isArray(capabilities?.skills) ? capabilities.skills : [];
    const visibleSlashCommands = slashCommands.filter((item) => !hiddenSlashCommandNames.has(item.name.toLowerCase()));
    const slashItems = [
      ...visibleSlashCommands.map((item) => ({ ...item, description: localizeCommandDescription(item.name, item.description, language) })),
      ...prompts.map((item) => ({ name: item.name, description: localizeCommandDescription(item.name, item.description, language) })),
      ...skills.map((item) => ({ name: item.name, description: localizeCommandDescription(item.name, item.description, language) })),
    ];
    return slashItems.filter((item) => item.name.toLowerCase().includes(suggestionQuery.toLowerCase())).slice(0, 12);
  }, [capabilities, language, suggestionMode, suggestionQuery, workspace]);
  const paletteCommands = useMemo(() => {
    const slashCommands = Array.isArray(capabilities?.slashCommands) && capabilities.slashCommands.length ? capabilities.slashCommands : fallbackSlashCommands;
    const prompts = Array.isArray(capabilities?.prompts) ? capabilities.prompts : [];
    const skills = Array.isArray(capabilities?.skills) ? capabilities.skills : [];
    const visibleSlashCommands = slashCommands.filter((item) => !hiddenSlashCommandNames.has(item.name.toLowerCase()));
    const commands = [
      ...visibleSlashCommands.map((item) => ({ ...item, description: localizeCommandDescription(item.name, item.description, language) })),
      ...prompts.map((item) => ({ name: item.name, description: localizeCommandDescription(item.name, item.description, language), source: "prompt" })),
      ...skills.map((item) => ({ name: item.name, description: localizeCommandDescription(item.name, item.description, language), source: "skill" })),
    ];
    return Array.from(new Map(commands.map((command) => [command.name, command])).values());
  }, [capabilities, hiddenSlashCommandNames, language]);

  useEffect(() => {
    let cancelled = false;
    const taskId = activeTask?.id;
    if (!projectCwd) return () => { cancelled = true; };
    if (!taskId) {
      void window.pideck.sessions.capabilities(undefined, projectCwd).then((next) => {
        if (cancelled) return;
        setCapabilities(next);
        setActiveModel(next.model?.authConfigured ? next.model : models.find((model) => model.authConfigured) ?? null);
        setThinkingLevel(next.thinkingLevel);
        setThinkingLevels(next.thinkingLevels);
        setContextUsage(next.contextUsage);
      }).catch((error) => !cancelled && showNotice(error instanceof Error ? error.message : String(error)));
      return () => { cancelled = true; };
    }
    setMessageLoads((current) => ({ ...current, [taskId]: { status: "loading" } }));
    setActiveModel(null);
    void Promise.allSettled([
      window.pideck.sessions.messages(taskId, projectCwd),
      window.pideck.sessions.capabilities(taskId, projectCwd),
    ]).then(([messagesResult, capabilitiesResult]) => {
      if (cancelled) return;
      if (messagesResult.status === "fulfilled") {
        setMessagesByTask((current) => ({ ...current, [taskId]: messagesResult.value as any[] }));
        setMessageLoads((current) => ({ ...current, [taskId]: { status: "ready" } }));
      } else {
        setMessageLoads((current) => ({ ...current, [taskId]: { status: "error", error: messagesResult.reason instanceof Error ? messagesResult.reason.message : String(messagesResult.reason) } }));
      }
      if (capabilitiesResult.status === "fulfilled") {
        const next = capabilitiesResult.value;
        setCapabilities(next);
        setActiveModel(next.model?.authConfigured ? next.model : models.find((model) => model.authConfigured) ?? null);
        setThinkingLevel(next.thinkingLevel);
        setThinkingLevels(next.thinkingLevels);
        setContextUsage(next.contextUsage);
      } else {
        const fallback = models.find((model) => model.authConfigured) ?? null;
        setActiveModel(fallback);
        setThinkingLevels(fallback?.thinkingLevels ?? ["off"]);
        setThinkingLevel(fallback?.thinkingLevels[0] ?? "off");
        showNotice(`Pi capabilities: ${capabilitiesResult.reason instanceof Error ? capabilitiesResult.reason.message : String(capabilitiesResult.reason)}`);
      }
    });
    return () => { cancelled = true; };
  }, [activeTask?.id, projectCwd, models, messageReload]);

  useEffect(() => window.pideck.events.subscribe((runtimeEvent) => {
    if (runtimeEvent.type === "runtime.status") {
      const status = runtimeEvent.payload;
      if (status === "connected" || status === "starting" || status === "disconnected") setRuntimeStatus(status);
      return;
    }
    if (runtimeEvent.type === "extension.ui.request" && runtimeEvent.event && typeof runtimeEvent.event === "object") {
      setExtensionUiRequest(runtimeEvent.event as ExtensionUiRequest);
      return;
    }
    if (runtimeEvent.type === "extension.ui.notify") {
      const event = runtimeEvent.event as { message?: string } | undefined;
      if (event?.message) showNotice(event.message);
      return;
    }
    if (runtimeEvent.type === "agent.event" && (runtimeEvent.event as any)?.type === "extension.ui.notify") {
      const event = runtimeEvent.event as { message?: string } | undefined;
      if (event?.message) showNotice(event.message);
      return;
    }
    const taskId = runtimeEvent.taskId;
    if (!taskId) return;
    if (runtimeEvent.type === "approval.requested" && runtimeEvent.requestId) {
      const event = runtimeEvent.event as { toolName?: string; args?: unknown } | undefined;
      patchTaskUi(taskId, { approval: { requestId: runtimeEvent.requestId, toolName: event?.toolName ?? copy[language].toolResult, args: event?.args }, workingPhase: null });
      updateTaskLists((current) => current.map((task) => task.id === taskId ? { ...task, state: "waiting-approval" } : task));
      return;
    }
    if (runtimeEvent.type === "approval.resolved" && runtimeEvent.requestId) {
      const event = runtimeEvent.event as { decision?: "allow-once" | "deny" } | undefined;
      patchTaskUi(taskId, { approval: undefined, workingPhase: event?.decision === "allow-once" ? "thinking" : null });
      updateTaskLists((current) => current.map((task) => task.id === taskId ? { ...task, state: event?.decision === "allow-once" ? "running" : task.state } : task));
      return;
    }
    if (runtimeEvent.type !== "agent.event") return;
    const event = runtimeEvent.event as any;
    if (event?.type === "queue_update") {
      if (taskId === activeTask?.id) setQueueState({
        steering: Array.isArray(event.steering) ? [...event.steering] : [],
        followUp: Array.isArray(event.followUp) ? [...event.followUp] : [],
        steeringMode: queueState?.steeringMode ?? "one-at-a-time",
        followUpMode: queueState?.followUpMode ?? "one-at-a-time",
      });
      return;
    }
    if (event?.type === "agent_start") {
      setTaskUi((current) => {
        const previous = current[taskId] ?? createDefaultTaskUiState();
        const startedAt = Date.now();
        const activity = previous.activity.length > 0
          ? previous.activity
          : [{ id: `${taskId}:thinking:${startedAt}`, kind: "thinking" as const, label: copy[language].executionThinking, startedAt }];
        return { ...current, [taskId]: { ...previous, isSending: true, isCompacting: false, workingPhase: "thinking", streamText: "", toolName: undefined, activity } };
      });
      const updatedAt = new Date().toISOString();
      updateTaskLists((current) => sortTasksByUpdatedAt(current.map((task) => task.id === taskId ? { ...task, state: "running", updatedAt } : task)));
      void window.pideck.sessions.capabilities(taskId, projectCwd).then((next) => setContextUsage(next.contextUsage)).catch(() => undefined);
    } else if (event?.type === "message_start" && event.message?.role === "user") {
      // Pi keeps one outer agent run alive while it drains follow-up messages.
      // A queued user message is the real boundary for the next timer. Add it
      // to the visible timeline immediately so the previous turn can render
      // its reply and completed duration before the new live summary.
      const queueDelivery = event.queueDelivery === "steer" ? "steer" : "followUp";
      const steeringMessageKey = queueDelivery === "steer" ? messageIdentity(event.message) : undefined;
      if (steeringMessageKey) setSteeringMessageKeysByTask((current) => ({ ...current, [taskId]: [...new Set([...(current[taskId] ?? []), steeringMessageKey])] }));
      setMessagesByTask((current) => ({ ...current, [taskId]: mergeMessageSnapshot(current[taskId] ?? [], [event.message]) }));
      setTaskUi((current) => {
        const previous = current[taskId] ?? { ...createDefaultTaskUiState(), isSending: true };
        const isSteeringMessage = queueDelivery === "steer";
        const hasCompletedWork = previous.activity.some((step) => step.endedAt || step.kind === "tool" || Boolean(step.detail));
        const startedAt = Date.now();
        return { ...current, [taskId]: {
          ...previous,
          isSending: true,
          isCompacting: false,
          workingPhase: "thinking",
          streamText: "",
          toolName: undefined,
          activity: isSteeringMessage && previous.activity.length > 0
            ? previous.activity
            : [{ id: `${taskId}:thinking:${startedAt}`, kind: "thinking", label: copy[language].executionThinking, startedAt }],
          completedActivity: !isSteeringMessage && hasCompletedWork ? [...previous.completedActivity, previous.activity] : previous.completedActivity,
        } };
      });
    } else if (event?.type === "turn_start") patchTaskUi(taskId, { workingPhase: "thinking", toolName: undefined });
    else if (event?.type === "compaction_start") patchTaskUi(taskId, { isCompacting: true, workingPhase: "compacting", toolName: undefined });
    else if (event?.type === "compaction_end") {
      patchTaskUi(taskId, { isCompacting: false, workingPhase: "thinking" });
      void window.pideck.sessions.capabilities(taskId, projectCwd).then((next) => setContextUsage(next.contextUsage)).catch(() => undefined);
    }
    else if (event?.type === "message_start" || event?.type === "message_end") {
      void window.pideck.sessions.capabilities(taskId, projectCwd).then((next) => setContextUsage(next.contextUsage)).catch(() => undefined);
    }
    else if (event?.type === "message_update" && event.stream?.type === "thinking_delta" && event.stream.delta) {
      updateActivity(taskId, (steps) => {
        const last = steps[steps.length - 1];
        if (last?.kind === "thinking" && !last.endedAt) return [...steps.slice(0, -1), { ...last, detail: `${last.detail ?? ""}${event.stream.delta}` }];
        return [...steps, { id: `${taskId}:thinking:${Date.now()}`, kind: "thinking", label: copy[language].executionThinking, detail: event.stream.delta, startedAt: Date.now() }];
      });
      patchTaskUi(taskId, { workingPhase: "thinking" });
    } else if (event?.type === "message_update" && event.stream?.type === "text_delta" && event.stream.delta) {
      updateActivity(taskId, (steps) => steps.map((step) => step.kind === "thinking" && !step.endedAt ? { ...step, endedAt: Date.now() } : step));
      queueStreamDelta(taskId, event.stream.delta);
    } else if (event?.type === "tool_execution_start") {
      const startedAt = Date.now();
      updateActivity(taskId, (steps) => [...steps.map((step) => step.kind === "thinking" && !step.endedAt ? { ...step, endedAt: startedAt } : step), { id: event.toolCallId ?? `${taskId}:tool:${startedAt}`, kind: "tool", label: event.toolName ?? copy[language].toolResult, args: event.args, startedAt }]);
      patchTaskUi(taskId, { workingPhase: "tool", toolName: event.toolName });
    } else if (event?.type === "tool_execution_update") {
      updateActivity(taskId, (steps) => steps.map((step) => step.id === event.toolCallId ? { ...step, result: event.partialResult } : step));
    } else if (event?.type === "tool_execution_end") {
      updateActivity(taskId, (steps) => steps.map((step) => step.id === event.toolCallId ? { ...step, endedAt: Date.now(), result: event.result, isError: Boolean(event.isError) } : step));
      patchTaskUi(taskId, { workingPhase: "thinking", toolName: undefined });
      void window.pideck.sessions.capabilities(taskId, projectCwd).then((next) => setContextUsage(next.contextUsage)).catch(() => undefined);
    }
    else if (event?.type === "session_info_changed" && typeof event.name === "string" && event.name.trim()) {
      const title = event.name.trim();
      updateTaskLists((current) => current.map((task) => task.id === taskId ? { ...task, title } : task));
      setActiveTask((current) => current?.id === taskId ? { ...current, title } : current);
    }
    else if (event?.type === "message.snapshot") {
      setMessagesByTask((current) => ({ ...current, [taskId]: mergeMessageSnapshot(current[taskId] ?? [], Array.isArray(event.messages) ? event.messages : [], true) }));
      setMessageLoads((current) => ({ ...current, [taskId]: { status: "ready" } }));
      patchTaskUi(taskId, { streamText: "" });
    } else if (event?.type === "agent_end") {
      // agent_end marks the end of one model turn. Pi may still have queued
      // follow-up/steering messages, so do not stop the execution timer here.
      updateActivity(taskId, (steps) => steps.map((step) => step.endedAt ? step : { ...step, endedAt: Date.now() }));
      patchTaskUi(taskId, { workingPhase: "thinking", streamText: "", toolName: undefined });
    } else if (event?.type === "agent_settled") {
      const endedAt = Date.now();
      updateActivity(taskId, (steps) => steps.map((step) => step.endedAt ? step : { ...step, endedAt }));
      setTaskUi((current) => {
        const previous = current[taskId] ?? createDefaultTaskUiState();
        const completedActivity = previous.activity.length > 0
          ? [...previous.completedActivity, previous.activity.map((step) => step.endedAt ? step : { ...step, endedAt })]
          : previous.completedActivity;
        return { ...current, [taskId]: { ...previous, isSending: false, isCompacting: false, workingPhase: null, streamText: "", toolName: undefined, activity: [], completedActivity } };
      });
      void window.pideck.sessions.messages(taskId, projectCwd).then((next) => {
        setMessagesByTask((current) => ({ ...current, [taskId]: mergeMessageSnapshot(current[taskId] ?? [], next as any[], true) }));
        setMessageLoads((current) => ({ ...current, [taskId]: { status: "ready" } }));
      }).catch((error) => setMessageLoads((current) => ({ ...current, [taskId]: { status: "error", error: error instanceof Error ? error.message : String(error) } })));
      void window.pideck.sessions.capabilities(taskId, projectCwd).then((next) => setContextUsage(next.contextUsage)).catch(() => undefined);
      void refreshWorkspace();
      updateTaskLists((current) => sortTasksByUpdatedAt(current.map((task) => task.id === taskId ? { ...task, state: "idle", updatedAt: new Date().toISOString() } : task)));
    }
  }), [projectCwd, language, activeTask?.id, queueState?.steeringMode, queueState?.followUpMode]);

  useEffect(() => { void window.pideck.runtime.status().then(setRuntimeStatus).catch(() => setRuntimeStatus("disconnected")); void window.pideck.permissions.status().then(setPermissionStatus).catch(() => undefined); }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const modalOpen = paletteOpen || settingsOpen || Boolean(pendingDelete) || Boolean(pendingProjectRemove) || Boolean(previewImage);
      if (modalOpen) return;
      if (modifier && event.key.toLowerCase() === "k") { event.preventDefault(); openCommandPalette(); return; }
      if (modifier && event.key.toLowerCase() === "j") { event.preventDefault(); setTerminalOpen((current) => !current); return; }
      if (modifier && event.key.toLowerCase() === "n") { event.preventDefault(); void createTask(); return; }
      if (modifier && event.key === ",") { event.preventDefault(); openProviderSettings(); return; }
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
      if (event.key === "/" && !typing) { event.preventDefault(); searchInputRef.current?.focus(); return; }
      if (event.key === "Escape") {
        if (thinkingMenuOpen || modelMenuOpen || suggestionMode || contextMenu || projectContextMenu || imageContextMenu) {
          setThinkingMenuOpen(false); setModelMenuOpen(false); setSuggestionMode(null); setContextMenu(null); setProjectContextMenu(null); setImageContextMenu(null); return;
        }
        if (terminalOpen) setTerminalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, settingsOpen, pendingDelete, pendingProjectRemove, previewImage, thinkingMenuOpen, modelMenuOpen, suggestionMode, contextMenu, projectContextMenu, imageContextMenu, terminalOpen, projectCwd, language]);

  useEffect(() => {
    const close = () => { setContextMenu(null); setProjectContextMenu(null); setImageContextMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); };
  }, []);

  useEffect(() => {
    if (!thinkingMenuOpen && !modelMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".menu-anchor")) return;
      setThinkingMenuOpen(false); setModelMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [thinkingMenuOpen, modelMenuOpen]);

  async function createTask() {
    if (!projectCwd) {
      showNotice(t.selectProjectFirst);
      return null;
    }
    try {
      const task = await window.pideck.sessions.create({ cwd: projectCwd, name: t.newTaskName });
      rememberOptimisticTask(task);
      updateTaskLists((current) => sortTasksByUpdatedAt([task, ...current.filter((item) => item.id !== task.id)]));
      setProjectTasksByCwd((current) => ({ ...current, [projectCwd]: sortTasksByUpdatedAt([task, ...(current[projectCwd] ?? []).filter((item) => item.id !== task.id)]) }));
      setProjects((current) => current.map((project) => project.cwd === projectCwd ? { ...project, taskCount: project.taskCount + 1 } : project));
      setMessagesByTask((current) => ({ ...current, [task.id]: [] }));
      setMessageLoads((current) => ({ ...current, [task.id]: { status: "ready" } }));
      setExpandedProjectCwds((current) => current.includes(projectCwd) ? current : [...current, projectCwd]);
      setActiveTask(task);
      showNotice(t.sessionCreated);
      return task;
    } catch (error) {
      showNotice(`${t.sessionCreateFailed}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async function deleteTask(task: TaskSummary) {
    const taskCwd = task.projectId || projectCwd;
    setDeletingTaskId(task.id);
    try {
      const removeSession = window.pideck.sessions.remove ?? window.pideck.sessions.delete;
      if (typeof removeSession !== "function") throw new Error(t.sessionBridgeError);
      await removeSession(task.id, taskCwd);
      const optimisticIds = optimisticTaskIdsRef.current[taskCwd];
      optimisticIds?.delete(task.id);
      if (optimisticIds && optimisticIds.size === 0) delete optimisticTaskIdsRef.current[taskCwd];
      if (taskCwd === projectCwd) setTasks((current) => current.filter((item) => item.id !== task.id));
      setProjectTasksByCwd((current) => ({ ...current, [taskCwd]: (current[taskCwd] ?? []).filter((item) => item.id !== task.id) }));
      setProjects((current) => current.map((project) => project.cwd === taskCwd ? { ...project, taskCount: Math.max(0, project.taskCount - 1) } : project));
      setMessagesByTask((current) => { const next = { ...current }; delete next[task.id]; return next; });
      setSentImagesByTask((current) => { const next = { ...current }; delete next[task.id]; return next; });
      setSteeringMessageKeysByTask((current) => { const next = { ...current }; delete next[task.id]; return next; });
      setTaskUi((current) => { const next = { ...current }; delete next[task.id]; return next; });
      setPendingDelete(null);
      if (activeTask?.id === task.id) setActiveTask(null);
      showNotice(t.sessionDeleted);
    } catch (error) {
      showNotice(`${t.sessionDeleteFailed}: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setDeletingTaskId(null); }
  }

  async function handleBuiltinCommand(text: string): Promise<boolean> {
    const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
    if (!match) return false;
    const command = match[1].toLowerCase();
    const argument = match[2]?.trim() ?? "";
    if (command === "login" || command === "logout") { openProviderSettings(argument || undefined); return true; }
    if (command === "settings") { openProviderSettings(); return true; }
    if (command === "model") { setModelMenuOpen(true); setThinkingMenuOpen(false); return true; }
    if (command === "compact") { await compactSession(argument || undefined); return true; }
    if (command === "export") { await exportSession(argument.toLowerCase() === "html" ? "html" : "jsonl"); return true; }
    if (command === "new") { await createTask(); return true; }
    if (command === "reload") { await loadInitialData(); return true; }
    const knownUiCommands = new Set(["import", "share", "copy", "name", "session", "changelog", "hotkeys", "fork", "clone", "tree", "trust", "resume", "quit", "scoped-models"]);
    if (knownUiCommands.has(command)) { showNotice(t.commandUnavailable(`/${command}`)); return true; }
    return false;
  }

  async function sendPrompt() {
    const text = composer.trim();
    if (!text && !composerImages.length) return;
    if (suggestionMode && suggestions.length > 0) { applySuggestion(suggestions[suggestionIndex] as any); return; }
    if (await handleBuiltinCommand(text)) { setComposer(""); setSuggestionMode(null); return; }
    if (!activeModel?.authConfigured && !modelOptions.some((model) => model.authConfigured)) { showNotice(t.noModelAvailable); return; }
    const creating = !activeTask;
    const desiredModel = activeModel;
    const desiredThinking = thinkingLevel;
    const images = composerImages;
    // Sending a new prompt is an explicit request to follow the new turn,
    // even if the user had previously scrolled up to inspect older history.
    followConversationRef.current = true;
    setShowJumpToLatest(false);
    const task = activeTask ?? await createTask();
    if (!task) return;
    const optimisticId = `local-${Date.now()}`;
    const continuingExecution = Boolean(activeTaskUi?.isSending);
    setComposer(""); setComposerImages([]); setSuggestionMode(null);
    if (images.length) setSentImagesByTask((current) => ({ ...current, [task.id]: [...(current[task.id] ?? []), { text, images }] }));
    if (!continuingExecution) setMessagesByTask((current) => ({ ...current, [task.id]: [...(current[task.id] ?? []), { id: optimisticId, role: "user", content: images.length ? [{ type: "text", text }, ...images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }))] : text, timestamp: new Date().toISOString() }] }));
    setMessageLoads((current) => ({ ...current, [task.id]: { status: "ready" } }));
    patchTaskUi(task.id, { isSending: true, isCompacting: false, workingPhase: "thinking", streamText: "", activity: continuingExecution ? activeTaskUi?.activity ?? [] : [], completedActivity: activeTaskUi?.completedActivity ?? [] });
    const taskTitle = deriveSessionTitle(text);
    const shouldNameTask = !task.title || task.title === copy.zh.newTaskName || task.title === copy.en.newTaskName;
    const updatedAt = new Date().toISOString();
    updateTaskLists((current) => sortTasksByUpdatedAt(current.map((item) => item.id === task.id ? { ...item, title: shouldNameTask ? taskTitle || item.title : item.title, state: "running", updatedAt } : item)));
    setActiveTask((current) => current?.id === task.id ? { ...current, title: shouldNameTask ? taskTitle || current.title : current.title, state: "running", updatedAt } : current);
    try {
      if (creating && desiredModel) await window.pideck.agent.setModel(task.id, desiredModel.providerId, desiredModel.id, projectCwd);
      if (creating && desiredThinking !== "off") await window.pideck.agent.setThinkingLevel(task.id, desiredThinking, projectCwd);
      await window.pideck.agent.prompt(task.id, text, projectCwd, images.map(({ data, mimeType }) => ({ data, mimeType })), queueDelivery);
    } catch (error) {
      patchTaskUi(task.id, { isSending: false, isCompacting: false, workingPhase: null, activity: [] });
      setMessagesByTask((current) => ({ ...current, [task.id]: (current[task.id] ?? []).filter((message) => message.id !== optimisticId) }));
      if (images.length) setSentImagesByTask((current) => ({ ...current, [task.id]: (current[task.id] ?? []).filter((sent) => sent.images[0]?.id !== images[0]?.id) }));
      updateTaskLists((current) => current.map((item) => item.id === task.id ? { ...item, state: "failed" } : item));
      showNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function abortActive() {
    if (!activeTask) return;
    try { await window.pideck.agent.abort(activeTask.id); patchTaskUi(activeTask.id, { isSending: false, isCompacting: false, workingPhase: null, streamText: "" }); }
    catch (error) { showNotice(error instanceof Error ? error.message : String(error)); }
  }

  function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageItems = Array.from(event.clipboardData.items).filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    event.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const match = /^data:([^;]+);base64,(.+)$/.exec(result);
        if (!match) return;
        setComposerImages((current) => [...current, { id: `${Date.now()}-${Math.random()}`, data: match[2], mimeType: match[1], name: file.name || "pasted-image" }]);
      };
      reader.readAsDataURL(file);
    }
  }

  function updateComposer(value: string) {
    setComposer(value);
    const mentionMatch = /(?:^|\s)@([^\s]*)$/.exec(value);
    if (mentionMatch) {
      setSuggestionMode("mention"); setSuggestionQuery(mentionMatch[1]); setSuggestionIndex(0); return;
    }
    const slashMatch = /^\/([^\s/]*)$/.exec(value);
    const slashQuery = slashMatch?.[1].toLowerCase() ?? "";
    const knownPrefix = slashMatch && (slashQuery === "" || paletteCommands.some((command) => command.name.replace(/^\//, "").toLowerCase().startsWith(slashQuery)));
    if (!slashMatch || !knownPrefix) { setSuggestionMode(null); setSuggestionQuery(""); return; }
    setSuggestionMode("slash"); setSuggestionQuery(slashMatch[1]); setSuggestionIndex(0);
  }

  function applySuggestion(item: any) {
    const prefix = suggestionMode === "mention" ? "@" : "/";
    const replacement = `${prefix}${suggestionMode === "mention" ? item.path : item.name} `;
    setComposer((current) => suggestionMode === "mention"
      ? current.replace(/(?:^|\s)@[^\s]*$/, (token) => `${/^\s/.test(token) ? token[0] : ""}${replacement}`)
      : current.replace(/^\/[^\s/]*$/, replacement));
    setSuggestionMode(null);
  }

  async function chooseThinking(level: string) {
    setThinkingMenuOpen(false);
    if (!activeTask) { setThinkingLevel(level); return; }
    try { await window.pideck.agent.setThinkingLevel(activeTask.id, level, projectCwd); setThinkingLevel(level); }
    catch (error) { showNotice(error instanceof Error ? error.message : String(error)); }
  }

  async function chooseModel(model: ModelSummary) {
    setModelMenuOpen(false);
    if (!activeTask) {
      setActiveModel(model); setThinkingLevels(model.thinkingLevels); setThinkingLevel(model.thinkingLevels.includes(thinkingLevel) ? thinkingLevel : model.thinkingLevels[0] ?? "off"); return;
    }
    try {
      await window.pideck.agent.setModel(activeTask.id, model.providerId, model.id, projectCwd);
      setActiveModel(model); setThinkingLevels(model.thinkingLevels); setThinkingLevel(model.thinkingLevels.includes(thinkingLevel) ? thinkingLevel : model.thinkingLevels[0] ?? "off");
    } catch (error) { showNotice(error instanceof Error ? error.message : String(error)); }
  }

  function rememberOptimisticTask(task: TaskSummary) {
    const ids = optimisticTaskIdsRef.current[task.projectId] ?? new Set<string>();
    ids.add(task.id);
    optimisticTaskIdsRef.current[task.projectId] = ids;
  }

  function mergeProjectTasks(cwd: string, listedTasks: TaskSummary[], previousTasks: TaskSummary[] = []): TaskSummary[] {
    const listedById = new Map<string, TaskSummary>();
    for (const task of listedTasks) listedById.set(task.id, task);
    const optimisticIds = optimisticTaskIdsRef.current[cwd] ?? new Set<string>();
    const optimisticById = new Map<string, TaskSummary>();
    for (const task of previousTasks) {
      if (!optimisticIds.has(task.id) || listedById.has(task.id) || optimisticById.has(task.id)) continue;
      optimisticById.set(task.id, task);
    }
    for (const task of listedTasks) optimisticIds.delete(task.id);
    if (optimisticIds.size === 0) delete optimisticTaskIdsRef.current[cwd];
    return sortTasksByUpdatedAt([...listedById.values(), ...optimisticById.values()]);
  }

  async function refreshQueue(task = activeTask) {
    if (!task) { setQueueState(null); return; }
    try {
      const next = await window.pideck.agent.queue(task.id, projectCwd);
      setQueueState(next);
      setQueueDelivery(next.steering.length > 0 ? "steer" : queueDelivery);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function setQueueModes(modes: { steeringMode?: QueueMode; followUpMode?: QueueMode }) {
    if (!activeTask) return;
    try { setQueueState(await window.pideck.agent.setQueueModes(activeTask.id, modes, projectCwd)); }
    catch (error) { showNotice(error instanceof Error ? error.message : String(error)); }
  }

  async function clearQueue() {
    if (!activeTask) return;
    try { setQueueState(await window.pideck.agent.clearQueue(activeTask.id, projectCwd)); }
    catch (error) { showNotice(error instanceof Error ? error.message : String(error)); }
  }

  async function promoteQueuedMessage(followUpIndex: number) {
    if (!activeTask || queueMutationBusy) return;
    setQueueMutationBusy(true);
    try {
      const next = await window.pideck.agent.promoteQueue(activeTask.id, followUpIndex, projectCwd);
      setQueueState(next);
      if (next.steering.length > 0) setQueueDelivery("steer");
    }
    catch (error) { showNotice(error instanceof Error ? error.message : String(error)); }
    finally { setQueueMutationBusy(false); }
  }

  async function executeTerminal() {
    const command = terminalCommand.trim();
    if (!command) return;
    const task = activeTask ?? await createTask();
    if (!task) return;
    setTerminalCommand(""); setTerminalRunning(true); setTerminalOutput((current) => [...current, `$ ${command}`]);
    try {
      const result = await window.pideck.terminal.execute(task.id, command, projectCwd);
      setTerminalOutput((current) => [...current, result.output || "", ...(result.isError ? [`(exit ${result.exitCode ?? 1})`] : [])]);
      await refreshWorkspace();
    } catch (error) { setTerminalOutput((current) => [...current, error instanceof Error ? error.message : String(error)]); }
    finally { setTerminalRunning(false); }
  }

  async function compactSession(instructions?: string) {
    if (!activeTask) return showNotice(t.noSessions);
    try {
      await window.pideck.sessions.compact(activeTask.id, instructions, projectCwd);
      const next = await window.pideck.sessions.messages(activeTask.id, projectCwd);
      setMessagesByTask((current) => ({ ...current, [activeTask.id]: next as any[] }));
      showNotice(t.contextCompacted);
    } catch (error) { showNotice(error instanceof Error ? error.message : String(error)); }
  }

  async function exportSession(format: "jsonl" | "html") {
    if (!activeTask) return showNotice(t.noSessions);
    try { const result = await window.pideck.sessions.export(activeTask.id, format, projectCwd); showNotice(`${t.exportedTo} ${result.path}`); }
    catch (error) { showNotice(error instanceof Error ? error.message : String(error)); }
  }

  function openContextMenu(task: TaskSummary, x: number, y: number) {
    setProjectContextMenu(null);
    setContextMenu({ task, x: Math.max(8, Math.min(x, window.innerWidth - 174)), y: Math.max(8, Math.min(y, window.innerHeight - 58)) });
  }

  function openProjectContextMenu(project: ProjectSummary, x: number, y: number) {
    setContextMenu(null);
    setProjectContextMenu({ project, x: Math.max(8, Math.min(x, window.innerWidth - 174)), y: Math.max(8, Math.min(y, window.innerHeight - 58)) });
  }

  function openImageContextMenu(event: React.MouseEvent, image: PreviewImage) {
    event.preventDefault();
    setContextMenu(null);
    setProjectContextMenu(null);
    setImageContextMenu({ image, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 174)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 58)) });
  }

  return <div className={`app-shell ${theme}${isMac ? " platform-macos" : ""}`}>
    <a className="skip-link" href="#main-content">{t.skipToContent}</a>
    <header className="titlebar">
      <div className="brand-lockup"><img className="brand-mark" src="./pideck-icon.png" alt="" aria-hidden="true" draggable={false} /><span className="brand-name">PiDeck</span><span className="brand-divider" /><span className="eyebrow">{t.workspace}</span></div>
      <div className="window-drag" />
      <div className="titlebar-actions">
        <button className="icon-button mobile-nav-trigger" type="button" title={mobileSidebarOpen ? t.closeNavigation : t.openNavigation} aria-label={mobileSidebarOpen ? t.closeNavigation : t.openNavigation} aria-expanded={mobileSidebarOpen} aria-controls="workspace-sidebar" onClick={() => setMobileSidebarOpen((current) => !current)}><Icon name="folder" /></button>
        <button className="quiet-button" onClick={openCommandPalette}><Icon name="command" />{t.command}<kbd>{shortcut("K")}</kbd></button>
        <button className="icon-button" title={theme === "light" ? t.themeToDark : t.themeToLight} aria-label={theme === "light" ? t.themeToDark : t.themeToLight} onClick={() => setTheme(theme === "light" ? "dark" : "light")}><Icon name={theme === "light" ? "moon" : "sun"} /></button>
        <button className="lang-button" aria-label={t.switchLanguage} title={t.switchLanguage} onClick={() => setLanguage(language === "zh" ? "en" : "zh")}>{language === "zh" ? "中" : "EN"}</button>
        <button className="icon-button" title={t.providerSettings} aria-label={t.providerSettings} onClick={() => openProviderSettings()}><Icon name="settings" /></button>
      </div>
    </header>

    <div className="workspace-grid">
      <aside ref={sidebarRef} id="workspace-sidebar" className={`sidebar ${mobileSidebarOpen ? "mobile-open" : ""}`} aria-label={t.openNavigation}>
        <div className="sidebar-mobile-header"><strong>{t.projects}</strong><button className="icon-button" type="button" title={t.closeNavigation} aria-label={t.closeNavigation} onClick={() => setMobileSidebarOpen(false)}><Icon name="x" /></button></div>
        <button className="new-task" disabled={!projectCwd || initialLoading} onClick={() => { setMobileSidebarOpen(false); void createTask(); }}><span className="new-task-icon"><Icon name="plus" /></span><span>{t.newTask}</span><kbd>{shortcut("N")}</kbd></button>
        <label className="search-box"><Icon name="search" size={15} /><input ref={searchInputRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t.search} aria-label={t.search} /><kbd>/</kbd></label>
        <div className="sidebar-scroll">
          <div className="section-label"><span>{t.projects}</span><button className="project-add" type="button" title={t.openProject} aria-label={t.openProject} disabled={initialLoading} onClick={() => void chooseProjectDirectory()}><Icon name="plus" size={13} /></button></div>
          <div className="project-list">
            {initialLoading && projects.length === 0 && <SidebarSkeleton />}
            {!initialLoading && projects.length === 0 && <div className="empty-sidebar"><strong>{t.noProjects}</strong><button className="button primary" type="button" onClick={() => void chooseProjectDirectory()}><Icon name="plus" size={14} />{t.openProject}</button></div>}
            {projects.map((project) => {
              const selected = project.cwd === projectCwd;
              const expanded = expandedProjectCwds.includes(project.cwd);
              const projectTasks = selected ? tasks : projectTasksByCwd[project.cwd] ?? [];
              const filteredProjectTasks = projectTasks.filter((task) => task.title.toLowerCase().includes(searchQuery.toLowerCase()));
              const projectTaskLoad = selected ? { status: initialLoading ? "loading" as const : "ready" as const } : projectTaskLoads[project.cwd] ?? { status: "idle" as const };
              return <section className={`project-group ${selected ? "selected" : ""} ${expanded ? "expanded" : ""}`} key={project.id}>
                <button className="project-row" type="button" disabled={initialLoading} aria-expanded={expanded} title={project.cwd} onClick={() => void selectProject(project)} onContextMenu={(event) => { event.preventDefault(); openProjectContextMenu(project, event.clientX, event.clientY); }} onKeyDown={(event) => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); openProjectContextMenu(project, rect.left + 24, rect.bottom - 4); } }}>
                  <Icon name={expanded ? "folderOpen" : "folder"} size={17} />
                  <span className="project-row-copy"><strong>{project.name}</strong></span>
                  <Icon name="chevron" size={14} />
                </button>
                {expanded && <div className="project-sessions">
                  <div className="task-list">
                    {projectTaskLoad.status === "loading" && projectTasks.length === 0 ? <SidebarSkeleton /> : filteredProjectTasks.map((task) => <TaskRow key={task.id} task={task} active={selected && activeTask?.id === task.id} language={language} onClick={() => void selectTask(project, task)} onContextMenu={(event) => { event.preventDefault(); openContextMenu(task, event.clientX, event.clientY); }} onMenu={(rect) => openContextMenu(task, rect.right - 160, rect.bottom + 4)} />)}
                    {projectTaskLoad.status === "error" && <div className="empty-sidebar" role="alert"><strong>{t.projectSessionsLoadFailed}</strong><span>{projectTaskLoad.error}</span><button className="button ghost" type="button" onClick={() => void loadProjectSessions(project)}>{t.retry}</button></div>}
                    {projectTaskLoad.status === "ready" && filteredProjectTasks.length === 0 && <div className="empty-sidebar"><strong>{searchQuery ? t.noSessionMatches : t.noSessions}</strong><span>{searchQuery ? t.tryAnotherSearch : t.createFirst}</span>{!searchQuery && <button className="button primary" type="button" onClick={() => void createTaskForProject(project)}><Icon name="plus" size={14} />{t.newTask}</button>}</div>}
                  </div>
                </div>}
              </section>;
            })}
          </div>
        </div>
        <div className="sidebar-footer">
          <button className="sidebar-command" type="button" onClick={() => { setMobileSidebarOpen(false); openCommandPalette(); }}><Icon name="command" /><span>{t.command}</span><kbd>{shortcut("K")}</kbd></button>
          <div className={`runtime-status ${runtimeStatus}`}><span className="status-dot" /><span>{runtimeStatus === "connected" ? t.connected : runtimeStatus === "starting" ? t.runtimeStarting : t.runtimeDisconnected}</span>{runtimeStatus === "disconnected" && <button onClick={() => void loadInitialData()}>{t.retry}</button>}</div>
        </div>
      </aside>
      {mobileSidebarOpen && <button className="sidebar-backdrop" type="button" tabIndex={-1} title={t.closeNavigation} aria-label={t.closeNavigation} onClick={() => setMobileSidebarOpen(false)} />}

      <main className="main-column" id="main-content" tabIndex={-1}>
        {activeTask && <div className="conversation-header">
          <div className="conversation-title"><div className="breadcrumb"><span>{activeProject?.name ?? "PiDeck"}</span><span>/</span><span>{activeTask?.title ?? t.conversation}</span></div><h1>{activeTask?.title ?? t.conversation}</h1></div>
        </div>}
        <div ref={conversationRef} className="conversation-scroll" onScroll={handleConversationScroll}>
          {loadError && <div className="runtime-error" role="alert"><strong>{loadError}</strong><button onClick={() => void loadInitialData()}>{t.retry}</button></div>}
          {initialLoading && !activeTask && <ConversationSkeleton label={t.loading} />}
          {!initialLoading && !loadError && !projectCwd && <div className="empty-conversation"><span className="empty-glyph">P</span><h2>{t.noProjects}</h2><button className="button primary" onClick={() => void chooseProjectDirectory()}><Icon name="plus" size={14} />{t.openProject}</button></div>}
          {!initialLoading && !loadError && projectCwd && !activeTask && tasks.length > 0 && <div className="empty-conversation"><span className="empty-glyph">P</span><h2>{t.selectSessionTitle}</h2><p>{t.selectSessionBody}</p><button className="button primary" onClick={() => void createTask()}><Icon name="plus" size={14} />{t.newTask}</button></div>}
          {!initialLoading && !loadError && projectCwd && !activeTask && tasks.length === 0 && <div className="empty-conversation"><span className="empty-glyph">P</span><h2>{t.noSessions}</h2><p>{t.createFirst}</p><button className="button primary" onClick={() => void createTask()}><Icon name="plus" size={14} />{t.newTask}</button></div>}
          {activeTask && messageLoad.status === "loading" && messages.length === 0 && <ConversationSkeleton label={t.loadingConversation} />}
          {activeTask && messageLoad.status === "error" && <div className="conversation-error" role="alert"><span><Icon name="alert" /> <strong>{t.conversationLoadFailed}</strong><small>{messageLoad.error}</small></span><button className="button ghost" onClick={() => setMessageReload((current) => current + 1)}>{t.retry}</button></div>}
          {activeTask && messageLoad.status === "ready" && messages.length === 0 && !isWorking && <div className="empty-conversation"><span className="empty-glyph">P</span><h2>{t.noMessages}</h2><p>{t.typeToStart}</p></div>}
          <MemoMessageTimeline messages={messages} language={language} running={isWorking} completedActivity={activeTaskUi?.completedActivity ?? []} steeringMessageKeys={activeTask ? steeringMessageKeysByTask[activeTask.id] ?? [] : []} onPreviewImage={(image) => setPreviewImage(image)} onContextMenuImage={openImageContextMenu} />
          {isWorking && <ExecutionSummary steps={activeTaskUi?.activity ?? []} language={language} running />}
          {streamText && <article className="message assistant-message live-message"><div className="live-message-status"><span className="live-pill"><span className="live-dot" />{t.working}</span></div><div className="message-content"><MarkdownContent text={streamText} language={language} /></div></article>}
          {isWorking && !streamText && <WorkingIndicator language={language} phase={workingPhase} toolName={activeTaskUi?.toolName} />}
          {liveApproval && <ApprovalCard approval={liveApproval} language={language} onResolve={async (decision) => {
            try { await window.pideck.approvals.resolve(liveApproval.requestId, decision); if (activeTask) { patchTaskUi(activeTask.id, { approval: undefined, workingPhase: decision === "allow-once" ? "thinking" : null }); updateTaskLists((current) => current.map((task) => task.id === activeTask.id ? { ...task, state: decision === "allow-once" ? "running" : task.state } : task)); } }
            catch (error) { showNotice(error instanceof Error ? error.message : String(error)); throw error; }
          }} />}
        </div>
        {showJumpToLatest && <button className="jump-latest" onClick={jumpToLatest}><Icon name="down" size={13} />{t.jumpToLatest}</button>}
        <Composer value={composer} onChange={updateComposer} onKeyDown={(event) => {
          if (suggestionMode && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setSuggestionIndex((current) => Math.max(0, Math.min(suggestions.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))); return; }
          if (event.key === "Escape") { setSuggestionMode(null); return; }
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendPrompt(); }
        }} onSend={() => void sendPrompt()} onStop={() => void abortActive()} isSending={isSending} language={language} activeModel={activeModel} modelOptions={modelOptions} thinkingLevel={thinkingLevel} thinkingLevels={thinkingLevels} thinkingMenuOpen={thinkingMenuOpen} modelMenuOpen={modelMenuOpen} suggestionMode={suggestionMode} suggestions={suggestions} suggestionIndex={suggestionIndex} onThinkingMenu={() => { setThinkingMenuOpen((current) => !current); setModelMenuOpen(false); }} onModelMenu={() => { setModelMenuOpen((current) => !current); setThinkingMenuOpen(false); }} onThinking={chooseThinking} onModel={chooseModel} onSuggestion={applySuggestion} onTerminal={() => setTerminalOpen((current) => !current)} contextUsage={contextUsage} commandNames={paletteCommands.map((command) => command.name)} attachments={composerImages} onPaste={handleComposerPaste} onRemoveAttachment={(id) => setComposerImages((current) => current.filter((image) => image.id !== id))} onPreviewImage={(image) => setPreviewImage(image)} onContextMenuImage={openImageContextMenu} queueDelivery={queueDelivery} queueState={queueState} queueMutationBusy={queueMutationBusy} onQueueDelivery={setQueueDelivery} onQueueModes={setQueueModes} onClearQueue={clearQueue} onPromoteQueue={(index) => void promoteQueuedMessage(index)} />
        <PermissionLevelControl language={language} status={permissionStatus} onStatus={handlePermissionStatus} />
      </main>

    </div>

    {terminalOpen && <TerminalPanel language={language} cwd={projectCwd} output={terminalOutput} command={terminalCommand} running={terminalRunning} onCommand={setTerminalCommand} onExecute={() => void executeTerminal()} onClose={() => setTerminalOpen(false)} />}
    {paletteOpen && <CommandPaletteBoundary language={language} onClose={() => setPaletteOpen(false)}><CommandPalette language={language} commands={paletteCommands} shortcut={shortcut} onCommand={(command) => { updateComposer(`${composer}${composer && !composer.endsWith(" ") ? " " : ""}/${command.name} `); setPaletteOpen(false); }} onClose={() => setPaletteOpen(false)} onNewTask={() => { setPaletteOpen(false); void createTask(); }} onTerminal={() => { setPaletteOpen(false); setTerminalOpen(true); }} onSettings={() => { setPaletteOpen(false); openProviderSettings(); }} onPackages={() => { setPaletteOpen(false); setPackagesOpen(true); }} onCompact={activeTask ? () => { setPaletteOpen(false); void compactSession(); } : undefined} onExport={activeTask ? (format) => { setPaletteOpen(false); void exportSession(format); } : undefined} /></CommandPaletteBoundary>}
    {notice && <div className={`toast ${terminalOpen ? "with-terminal" : ""}`} role="status" aria-live="polite">{notice}</div>}
    {contextMenu && <div className="task-context-menu" role="menu" aria-label={t.moreActions} style={{ left: contextMenu.x, top: contextMenu.y }} onKeyDown={handleRovingMenuKeyDown} onClick={(event) => event.stopPropagation()}><button role="menuitem" autoFocus onClick={() => { setPendingDelete(contextMenu.task); setContextMenu(null); }}>{t.deleteSession}</button></div>}
    {projectContextMenu && <div className="task-context-menu" role="menu" aria-label={t.moreActions} style={{ left: projectContextMenu.x, top: projectContextMenu.y }} onKeyDown={handleRovingMenuKeyDown} onClick={(event) => event.stopPropagation()}><button role="menuitem" autoFocus disabled={removingProjectCwd !== null} onClick={() => { setPendingProjectRemove(projectContextMenu.project); setProjectContextMenu(null); }}>{t.removeProject}</button></div>}
    {pendingDelete && <ConfirmDialog language={language} task={pendingDelete} busy={deletingTaskId === pendingDelete.id} onCancel={() => setPendingDelete(null)} onConfirm={() => void deleteTask(pendingDelete)} />}
    {pendingProjectRemove && <ProjectRemoveDialog language={language} project={pendingProjectRemove} busy={removingProjectCwd === pendingProjectRemove.cwd} onCancel={() => setPendingProjectRemove(null)} onConfirm={() => void removeProject(pendingProjectRemove)} />}
    {extensionUiRequest && <ExtensionUiDialog request={extensionUiRequest} language={language} onResolve={(value) => { void window.pideck.extensions.resolveUi(extensionUiRequest.requestId, value).then(() => setExtensionUiRequest(null)).catch((error) => showNotice(error instanceof Error ? error.message : String(error))); }} />}
    {packagesOpen && <PackageSettings language={language} cwd={projectCwd} onClose={() => setPackagesOpen(false)} onNotice={showNotice} />}
    {settingsOpen && <ProviderSettings language={language} focusProviderId={providerFocus} onClose={() => { setSettingsOpen(false); setProviderFocus(null); }} onModelsRefresh={refreshModels} />}
    {previewImage && <ImagePreview image={previewImage} language={language} onClose={() => setPreviewImage(null)} onContextMenuImage={openImageContextMenu} />}
    {imageContextMenu && <ImageContextMenu language={language} x={imageContextMenu.x} y={imageContextMenu.y} onCopy={async () => { const copied = await copyImageToClipboard(imageContextMenu.image.src); setImageContextMenu(null); showNotice(copied ? t.copiedImage : t.copyImageFailed); }} />}
  </div>;
}
