import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import type {
  AuthMethod,
  ContextUsage,
  ModelSummary,
  PermissionMode,
  PermissionStatus,
  ProviderSummary,
  SessionCapabilities,
  WorkspaceChange,
  WorkspaceFile,
  WorkspaceSnapshot,
} from "@pideck/contracts";
import type { TaskSummary } from "@pideck/domain";
import { copy, type Language } from "./i18n";
import { fallbackSlashCommands } from "./pi-capabilities";
import { copyText, Icon, useDialogFocus } from "./ui";

type Theme = "light" | "dark";
type SuggestionMode = "slash" | "mention" | null;
type WorkingPhase = "thinking" | "responding" | "tool" | null;
type MessageLoad = { status: "idle" | "loading" | "ready" | "error"; error?: string };
type ActivityStep = {
  id: string;
  kind: "thinking" | "tool";
  label: string;
  detail?: string;
  args?: unknown;
  result?: unknown;
  startedAt: number;
  endedAt?: number;
  isError?: boolean;
};
type TaskUiState = {
  isSending: boolean;
  streamText: string;
  workingPhase: WorkingPhase;
  activity: ActivityStep[];
  toolName?: string;
  approval?: { requestId: string; toolName: string; args?: unknown };
};
type AuthPromptState = { requestId: string; message: string; placeholder: string; value: string };
type ImageAttachment = { id: string; data: string; mimeType: string; name: string };
type SentImageMessage = { text: string; images: ImageAttachment[] };
type PreviewImage = { src: string; alt: string };

function textFromMessage(message: any): string {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content.map((part: any) => part?.type === "text" ? part.text : "").filter(Boolean).join("\n");
}

function formatTime(value?: string | number) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMessageTime(value: string | number | undefined, language: Language) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function reactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeText).join("");
  if (node && typeof node === "object" && "props" in node) return reactNodeText((node as { props?: { children?: ReactNode } }).props?.children);
  return "";
}

function CodeBlock({ children, language }: { children: ReactNode; language: Language }) {
  const [copied, setCopied] = useState(false);
  const t = copy[language];
  async function copyCode() {
    try {
      if (!await copyText(reactNodeText(children).replace(/\n$/, ""))) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }
  return <div className="code-block"><button type="button" onClick={() => void copyCode()}><Icon name="copy" size={13} />{copied ? t.copiedCode : t.copyCode}</button><pre>{children}</pre></div>;
}

const MarkdownRenderer = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([import("react-markdown"), import("remark-gfm")]);
  return { default: function LoadedMarkdown({ text, language }: { text: string; language: Language }) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      pre: ({ children }) => <CodeBlock language={language}>{children}</CodeBlock>,
      a: ({ children, href, ...props }) => <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>,
    }}>{text}</ReactMarkdown>;
  } };
});

function MarkdownContent({ text, language }: { text: string; language: Language }) {
  return <div className="markdown-content"><Suspense fallback={<p>{text}</p>}><MarkdownRenderer text={text} language={language} /></Suspense></div>;
}

export function App() {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("pideck.language") === "en" ? "en" : "zh");
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("pideck.theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [projectCwd, setProjectCwd] = useState("D:\\projects\\PiDeck");
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [activeTask, setActiveTask] = useState<TaskSummary | null>(null);
  const [messagesByTask, setMessagesByTask] = useState<Record<string, any[]>>({});
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
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [rightPanel, setRightPanel] = useState<"changes" | "files">("changes");
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [capabilities, setCapabilities] = useState<SessionCapabilities | null>(null);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [activeModel, setActiveModel] = useState<ModelSummary | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | undefined>(undefined);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState("off");
  const [thinkingLevels, setThinkingLevels] = useState<string[]>(["off"]);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [suggestionMode, setSuggestionMode] = useState<SuggestionMode>(null);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [runtimeStatus, setRuntimeStatus] = useState<"connected" | "starting" | "disconnected">("starting");
  const [contextMenu, setContextMenu] = useState<{ task: TaskSummary; x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TaskSummary | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const followConversationRef = useRef(true);
  const noticeTimerRef = useRef<number | null>(null);
  const initialLoadStartedRef = useRef(false);
  const t = copy[language];
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcut = (key: string) => `${isMac ? "⌘" : "Ctrl+"}${key}`;
  const activeTaskUi = activeTask ? taskUi[activeTask.id] : undefined;
  const isSending = Boolean(activeTaskUi?.isSending);
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

  function patchTaskUi(taskId: string, patch: Partial<TaskUiState>) {
    setTaskUi((current) => {
      const previous = current[taskId] ?? { isSending: false, streamText: "", workingPhase: null, activity: [] };
      return { ...current, [taskId]: { ...previous, ...patch } };
    });
  }

  function updateActivity(taskId: string, update: (steps: ActivityStep[]) => ActivityStep[]) {
    setTaskUi((current) => {
      const previous = current[taskId] ?? { isSending: true, streamText: "", workingPhase: "thinking" as const, activity: [] };
      return { ...current, [taskId]: { ...previous, activity: update(previous.activity) } };
    });
  }

  function openProviderSettings(providerId?: string) {
    setProviderFocus(providerId ?? null);
    setSettingsOpen(true);
  }

  function showNotice(message: string) {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => { setNotice(null); noticeTimerRef.current = null; }, 3600);
  }

  async function refreshWorkspace() {
    try { setWorkspace(await window.pideck.workspace.snapshot(projectCwd)); }
    catch (error) { showNotice(`${t.workspaceRefreshFailed}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  async function loadInitialData() {
    setInitialLoading(true);
    setLoadError(null);
    try {
      const projects = await window.pideck.projects.list();
      const cwd = projects[0]?.cwd ?? projectCwd;
      setProjectCwd(cwd);
      const [tasksResult, modelsResult, snapshotResult, capabilitiesResult] = await Promise.allSettled([
        window.pideck.sessions.list(cwd),
        window.pideck.models.list(),
        window.pideck.workspace.snapshot(cwd),
        window.pideck.sessions.capabilities(undefined, cwd),
      ]);
      const remoteTasks = tasksResult.status === "fulfilled" ? tasksResult.value : [];
      if (tasksResult.status === "fulfilled") setTasks(remoteTasks);
      else setLoadError(`${t.initialLoadFailed}: ${tasksResult.reason instanceof Error ? tasksResult.reason.message : String(tasksResult.reason)}`);
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
      setActiveTask((current) => current ?? remoteTasks[0] ?? null);
    } catch (error) {
      setLoadError(`${t.initialLoadFailed}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setInitialLoading(false);
    }
  }

  useEffect(() => { localStorage.setItem("pideck.language", language); document.documentElement.lang = language === "zh" ? "zh-CN" : "en"; }, [language]);
  useEffect(() => { localStorage.setItem("pideck.theme", theme); document.documentElement.style.colorScheme = theme; }, [theme]);
  useEffect(() => {
    try { localStorage.setItem("pideck.sent-images.v1", JSON.stringify(sentImagesByTask)); }
    catch { /* Image history is a UI fallback; Pi remains the authoritative session store. */ }
  }, [sentImagesByTask]);
  useEffect(() => () => { if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current); }, []);
  useEffect(() => {
    if (initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    void loadInitialData();
  }, []);
  useEffect(() => { followConversationRef.current = true; setShowJumpToLatest(false); }, [activeTask?.id]);

  useEffect(() => {
    const element = conversationRef.current;
    if (!element) return;
    if (followConversationRef.current) element.scrollTop = element.scrollHeight;
    else if (streamText || isSending) setShowJumpToLatest(true);
  }, [messages, streamText, isSending]);

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
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }

  const filteredTasks = useMemo(() => tasks.filter((task) => task.title.toLowerCase().includes(searchQuery.toLowerCase())), [tasks, searchQuery]);
  const modelOptions = useMemo(() => [...models].filter((model) => model.authConfigured).sort((a, b) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name)), [models]);
  const suggestions = useMemo(() => {
    if (suggestionMode === "mention") return (workspace?.files ?? []).filter((file) => file.kind === "file" && file.path.toLowerCase().includes(suggestionQuery.toLowerCase())).slice(0, 12);
    const slashCommands = Array.isArray(capabilities?.slashCommands) && capabilities.slashCommands.length ? capabilities.slashCommands : fallbackSlashCommands;
    const prompts = Array.isArray(capabilities?.prompts) ? capabilities.prompts : [];
    const skills = Array.isArray(capabilities?.skills) ? capabilities.skills : [];
    const slashItems = [
      ...slashCommands,
      ...prompts.map((item) => ({ name: item.name, description: item.description })),
      ...skills.map((item) => ({ name: item.name, description: item.description })),
    ];
    return slashItems.filter((item) => item.name.toLowerCase().includes(suggestionQuery.toLowerCase())).slice(0, 12);
  }, [capabilities, suggestionMode, suggestionQuery, workspace]);
  const paletteCommands = useMemo(() => {
    const slashCommands = Array.isArray(capabilities?.slashCommands) && capabilities.slashCommands.length ? capabilities.slashCommands : fallbackSlashCommands;
    const prompts = Array.isArray(capabilities?.prompts) ? capabilities.prompts : [];
    const skills = Array.isArray(capabilities?.skills) ? capabilities.skills : [];
    const commands = [
      ...slashCommands,
      ...prompts.map((item) => ({ name: item.name, description: item.description, source: "prompt" })),
      ...skills.map((item) => ({ name: item.name, description: item.description, source: "skill" })),
    ];
    return Array.from(new Map(commands.map((command) => [command.name, command])).values());
  }, [capabilities]);

  useEffect(() => {
    let cancelled = false;
    const taskId = activeTask?.id;
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
    const taskId = runtimeEvent.taskId;
    if (!taskId) return;
    if (runtimeEvent.type === "approval.requested" && runtimeEvent.requestId) {
      const event = runtimeEvent.event as { toolName?: string; args?: unknown } | undefined;
      patchTaskUi(taskId, { approval: { requestId: runtimeEvent.requestId, toolName: event?.toolName ?? copy[language].toolResult, args: event?.args }, workingPhase: null });
      setTasks((current) => current.map((task) => task.id === taskId ? { ...task, state: "waiting-approval" } : task));
      return;
    }
    if (runtimeEvent.type !== "agent.event") return;
    const event = runtimeEvent.event as any;
    if (event?.type === "agent_start") {
      patchTaskUi(taskId, { isSending: true, workingPhase: "thinking", streamText: "", toolName: undefined, activity: [] });
      setTasks((current) => current.map((task) => task.id === taskId ? { ...task, state: "running" } : task));
    } else if (event?.type === "turn_start") patchTaskUi(taskId, { workingPhase: "thinking", toolName: undefined });
    else if (event?.type === "message_update" && event.stream?.type === "thinking_delta" && event.stream.delta) {
      updateActivity(taskId, (steps) => {
        const last = steps[steps.length - 1];
        if (last?.kind === "thinking" && !last.endedAt) return [...steps.slice(0, -1), { ...last, detail: `${last.detail ?? ""}${event.stream.delta}` }];
        return [...steps, { id: `${taskId}:thinking:${Date.now()}`, kind: "thinking", label: copy[language].executionThinking, detail: event.stream.delta, startedAt: Date.now() }];
      });
      patchTaskUi(taskId, { workingPhase: "thinking" });
    } else if (event?.type === "message_update" && event.stream?.type === "text_delta" && event.stream.delta) {
      updateActivity(taskId, (steps) => steps.map((step) => step.kind === "thinking" && !step.endedAt ? { ...step, endedAt: Date.now() } : step));
      setTaskUi((current) => {
        const previous = current[taskId] ?? { isSending: true, streamText: "", workingPhase: "responding" as const, activity: [] };
        return { ...current, [taskId]: { ...previous, isSending: true, workingPhase: "responding", streamText: previous.streamText + event.stream.delta, toolName: undefined } };
      });
    } else if (event?.type === "tool_execution_start") {
      const startedAt = Date.now();
      updateActivity(taskId, (steps) => [...steps.map((step) => step.kind === "thinking" && !step.endedAt ? { ...step, endedAt: startedAt } : step), { id: event.toolCallId ?? `${taskId}:tool:${startedAt}`, kind: "tool", label: event.toolName ?? copy[language].toolResult, args: event.args, startedAt }]);
      patchTaskUi(taskId, { workingPhase: "tool", toolName: event.toolName });
    } else if (event?.type === "tool_execution_update") {
      updateActivity(taskId, (steps) => steps.map((step) => step.id === event.toolCallId ? { ...step, result: event.partialResult } : step));
    } else if (event?.type === "tool_execution_end") {
      updateActivity(taskId, (steps) => steps.map((step) => step.id === event.toolCallId ? { ...step, endedAt: Date.now(), result: event.result, isError: Boolean(event.isError) } : step));
      patchTaskUi(taskId, { workingPhase: "thinking", toolName: undefined });
    }
    else if (event?.type === "message.snapshot") {
      setMessagesByTask((current) => ({ ...current, [taskId]: (event.messages ?? []) as any[] }));
      setMessageLoads((current) => ({ ...current, [taskId]: { status: "ready" } }));
      patchTaskUi(taskId, { streamText: "" });
    } else if (event?.type === "agent_settled" || event?.type === "agent_end") {
      const endedAt = Date.now();
      updateActivity(taskId, (steps) => steps.map((step) => step.endedAt ? step : { ...step, endedAt }));
      patchTaskUi(taskId, { isSending: false, workingPhase: null, streamText: "", toolName: undefined });
      void window.pideck.sessions.messages(taskId, projectCwd).then((next) => {
        setMessagesByTask((current) => ({ ...current, [taskId]: next as any[] }));
        setMessageLoads((current) => ({ ...current, [taskId]: { status: "ready" } }));
      }).catch((error) => setMessageLoads((current) => ({ ...current, [taskId]: { status: "error", error: error instanceof Error ? error.message : String(error) } })));
      void window.pideck.sessions.capabilities(taskId, projectCwd).then((next) => setContextUsage(next.contextUsage)).catch(() => undefined);
      void refreshWorkspace();
      setTasks((current) => current.map((task) => task.id === taskId ? { ...task, state: "idle", updatedAt: new Date().toISOString() } : task));
    }
  }), [projectCwd, language]);

  useEffect(() => { void window.pideck.runtime.status().then(setRuntimeStatus).catch(() => setRuntimeStatus("disconnected")); void window.pideck.permissions.status().then(setPermissionStatus).catch(() => undefined); }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(true); return; }
      if (modifier && event.key.toLowerCase() === "j") { event.preventDefault(); setTerminalOpen((current) => !current); return; }
      if (modifier && event.key.toLowerCase() === "n") { event.preventDefault(); void createTask(); return; }
      if (modifier && event.key === ",") { event.preventDefault(); openProviderSettings(); return; }
      if (paletteOpen || settingsOpen || pendingDelete) return;
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
      if (event.key === "/" && !typing && !paletteOpen && !settingsOpen && !pendingDelete) { event.preventDefault(); searchInputRef.current?.focus(); return; }
      if (event.key === "Escape") {
        if (paletteOpen || settingsOpen || pendingDelete) return;
        if (thinkingMenuOpen || modelMenuOpen || suggestionMode || contextMenu) {
          setThinkingMenuOpen(false); setModelMenuOpen(false); setSuggestionMode(null); setContextMenu(null); return;
        }
        if (terminalOpen) setTerminalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, settingsOpen, pendingDelete, thinkingMenuOpen, modelMenuOpen, suggestionMode, contextMenu, terminalOpen, projectCwd, language]);

  useEffect(() => {
    const close = () => setContextMenu(null);
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
    try {
      const task = await window.pideck.sessions.create({ cwd: projectCwd, name: t.newTaskName });
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setMessagesByTask((current) => ({ ...current, [task.id]: [] }));
      setMessageLoads((current) => ({ ...current, [task.id]: { status: "ready" } }));
      setActiveTask(task);
      showNotice(t.sessionCreated);
      return task;
    } catch (error) {
      showNotice(`${t.sessionCreateFailed}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async function deleteTask(task: TaskSummary) {
    setDeletingTaskId(task.id);
    try {
      const removeSession = window.pideck.sessions.remove ?? window.pideck.sessions.delete;
      if (typeof removeSession !== "function") throw new Error(t.sessionBridgeError);
      await removeSession(task.id, projectCwd);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setMessagesByTask((current) => { const next = { ...current }; delete next[task.id]; return next; });
      setSentImagesByTask((current) => { const next = { ...current }; delete next[task.id]; return next; });
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
    const task = activeTask ?? await createTask();
    if (!task || taskUi[task.id]?.isSending) return;
    const optimisticId = `local-${Date.now()}`;
    setComposer(""); setComposerImages([]); setSuggestionMode(null);
    if (images.length) setSentImagesByTask((current) => ({ ...current, [task.id]: [...(current[task.id] ?? []), { text, images }] }));
    setMessagesByTask((current) => ({ ...current, [task.id]: [...(current[task.id] ?? []), { id: optimisticId, role: "user", content: images.length ? [{ type: "text", text }, ...images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }))] : text, timestamp: new Date().toISOString() }] }));
    setMessageLoads((current) => ({ ...current, [task.id]: { status: "ready" } }));
    patchTaskUi(task.id, { isSending: true, workingPhase: "thinking", streamText: "" });
    const taskTitle = text.replace(/\s+/g, " ").trim().slice(0, 80);
    const shouldNameTask = !task.title || task.title === copy.zh.newTaskName || task.title === copy.en.newTaskName;
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, title: shouldNameTask ? taskTitle || item.title : item.title, state: "running" } : item));
    setActiveTask((current) => current?.id === task.id ? { ...current, title: shouldNameTask ? taskTitle || current.title : current.title, state: "running" } : current);
    try {
      if (creating && desiredModel) await window.pideck.agent.setModel(task.id, desiredModel.providerId, desiredModel.id, projectCwd);
      if (creating && desiredThinking !== "off") await window.pideck.agent.setThinkingLevel(task.id, desiredThinking, projectCwd);
      await window.pideck.agent.prompt(task.id, text, projectCwd, images.map(({ data, mimeType }) => ({ data, mimeType })));
    } catch (error) {
      patchTaskUi(task.id, { isSending: false, workingPhase: null });
      setMessagesByTask((current) => ({ ...current, [task.id]: (current[task.id] ?? []).filter((message) => message.id !== optimisticId) }));
      if (images.length) setSentImagesByTask((current) => ({ ...current, [task.id]: (current[task.id] ?? []).filter((sent) => sent.images[0]?.id !== images[0]?.id) }));
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, state: "failed" } : item));
      showNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function abortActive() {
    if (!activeTask) return;
    try { await window.pideck.agent.abort(activeTask.id); patchTaskUi(activeTask.id, { isSending: false, workingPhase: null, streamText: "" }); }
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
    const match = /(?:^|\s)([/@])([^\s]*)$/.exec(value);
    if (!match) { setSuggestionMode(null); setSuggestionQuery(""); return; }
    setSuggestionMode(match[1] === "/" ? "slash" : "mention");
    setSuggestionQuery(match[2]); setSuggestionIndex(0);
  }

  function applySuggestion(item: any) {
    const prefix = suggestionMode === "mention" ? "@" : "/";
    const replacement = `${prefix}${suggestionMode === "mention" ? item.path : item.name} `;
    setComposer((current) => current.replace(/(?:^|\s)[/@][^\s]*$/, (token) => `${token.startsWith(" ") ? " " : ""}${replacement}`));
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
    setContextMenu({ task, x: Math.max(8, Math.min(x, window.innerWidth - 174)), y: Math.max(8, Math.min(y, window.innerHeight - 58)) });
  }

  return <div className={`app-shell ${theme}`}>
    <a className="skip-link" href="#main-content">{t.skipToContent}</a>
    <header className="titlebar">
      <div className="brand-lockup"><span className="brand-mark">P</span><span className="brand-name">PiDeck</span><span className="brand-divider" /><span className="eyebrow">{t.workspace}</span></div>
      <div className="window-drag" />
      <div className="titlebar-actions">
        <button className="quiet-button" onClick={() => setPaletteOpen(true)}><Icon name="command" />{t.command}<kbd>{shortcut("K")}</kbd></button>
        <button className="icon-button" title={theme === "light" ? t.themeToDark : t.themeToLight} aria-label={theme === "light" ? t.themeToDark : t.themeToLight} onClick={() => setTheme(theme === "light" ? "dark" : "light")}><Icon name={theme === "light" ? "moon" : "sun"} /></button>
        <button className="lang-button" aria-label={t.switchLanguage} title={t.switchLanguage} onClick={() => setLanguage(language === "zh" ? "en" : "zh")}>{language === "zh" ? "中" : "EN"}</button>
        <button className="icon-button" title={t.providerSettings} aria-label={t.providerSettings} onClick={() => openProviderSettings()}><Icon name="key" /></button>
        <button className="permission-button" title={t.permissionSettings} aria-label={t.permissionSettings} onClick={() => openProviderSettings()}><Icon name="shield" /><span>{t.permissionSettings}</span></button>
      </div>
    </header>

    <div className={`workspace-grid ${inspectorOpen ? "" : "inspector-collapsed"}`}>
      <aside className="sidebar">
        <button className="new-task" onClick={() => void createTask()}><span className="new-task-icon"><Icon name="plus" /></span><span>{t.newTask}</span><kbd>{shortcut("N")}</kbd></button>
        <label className="search-box"><Icon name="search" size={15} /><input ref={searchInputRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t.search} /><kbd>/</kbd></label>
        <div className="sidebar-scroll">
          <div className="section-label"><span>{t.sessions}</span><span className="count">{filteredTasks.length}</span></div>
          <div className="task-list">
            {initialLoading && tasks.length === 0 ? <SidebarSkeleton /> : filteredTasks.map((task) => <TaskRow key={task.id} task={task} active={activeTask?.id === task.id} language={language} onClick={() => { setActiveTask(task); setTasks((current) => current.map((item) => item.id === task.id ? { ...item, unread: false } : item)); }} onContextMenu={(event) => { event.preventDefault(); openContextMenu(task, event.clientX, event.clientY); }} onMenu={(rect) => openContextMenu(task, rect.right - 160, rect.bottom + 4)} />)}
            {!initialLoading && filteredTasks.length === 0 && <div className="empty-sidebar"><strong>{t.noSessions}</strong><span>{t.createFirst}</span></div>}
          </div>
        </div>
        <div className="sidebar-footer">
          <div className="project-summary"><span className="project-avatar">P</span><span><strong>PiDeck</strong><small>{projectCwd}</small></span></div>
          <div className={`runtime-status ${runtimeStatus}`}><span className="status-dot" /><span>{runtimeStatus === "connected" ? t.connected : runtimeStatus === "starting" ? t.runtimeStarting : t.runtimeDisconnected}</span>{runtimeStatus === "disconnected" && <button onClick={() => void loadInitialData()}>{t.retry}</button>}</div>
        </div>
      </aside>

      <main className="main-column" id="main-content" tabIndex={-1}>
        <div className="conversation-header">
          <div className="conversation-title"><div className="breadcrumb"><span>PiDeck</span><span>/</span><span>{activeTask?.title ?? t.conversation}</span></div><h1>{activeTask?.title ?? t.conversation}</h1></div>
          <div className="conversation-actions">
            <button className="icon-button" title={t.showFiles} aria-label={t.showFiles} onClick={() => { setRightPanel("files"); setInspectorOpen(true); void refreshWorkspace(); }}><Icon name="file" /></button>
            <button className="icon-button" title={t.toggleInspector} aria-label={t.toggleInspector} aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((current) => !current)}><Icon name="panel" /></button>
          </div>
        </div>
        <div ref={conversationRef} className="conversation-scroll" onScroll={handleConversationScroll}>
          {loadError && <div className="runtime-error" role="alert"><strong>{loadError}</strong><button onClick={() => void loadInitialData()}>{t.retry}</button></div>}
          {initialLoading && !activeTask && <ConversationSkeleton label={t.loading} />}
          {!initialLoading && !loadError && !activeTask && <div className="empty-conversation"><span className="empty-glyph">P</span><h2>{t.noSessions}</h2><p>{t.createFirst}</p><button className="button primary" onClick={() => void createTask()}><Icon name="plus" size={14} />{t.newTask}</button></div>}
          {activeTask && messageLoad.status === "loading" && messages.length === 0 && <ConversationSkeleton label={t.loadingConversation} />}
          {activeTask && messageLoad.status === "error" && <div className="conversation-error" role="alert"><span><Icon name="alert" /> <strong>{t.conversationLoadFailed}</strong><small>{messageLoad.error}</small></span><button className="button ghost" onClick={() => setMessageReload((current) => current + 1)}>{t.retry}</button></div>}
          {activeTask && messageLoad.status === "ready" && messages.length === 0 && !isSending && <div className="empty-conversation"><span className="empty-glyph">P</span><h2>{t.noMessages}</h2><p>{t.typeToStart}</p></div>}
          {isSending && <ExecutionSummary steps={activeTaskUi?.activity ?? []} language={language} running />}
          <MessageTimeline messages={messages} language={language} onPreviewImage={(image) => setPreviewImage(image)} />
          {streamText && <article className="message assistant-message live-message"><div className="live-message-status"><span className="live-pill"><span className="live-dot" />{t.working}</span></div><div className="message-content"><MarkdownContent text={streamText} language={language} /></div></article>}
          {isSending && !streamText && <WorkingIndicator language={language} phase={workingPhase} toolName={activeTaskUi?.toolName} />}
          {liveApproval && <ApprovalCard approval={liveApproval} language={language} onResolve={async (decision) => {
            try { await window.pideck.approvals.resolve(liveApproval.requestId, decision); if (activeTask) { patchTaskUi(activeTask.id, { approval: undefined, workingPhase: decision === "allow-once" ? "thinking" : null }); setTasks((current) => current.map((task) => task.id === activeTask.id ? { ...task, state: decision === "allow-once" ? "running" : task.state } : task)); } }
            catch (error) { showNotice(error instanceof Error ? error.message : String(error)); throw error; }
          }} />}
        </div>
        {showJumpToLatest && <button className="jump-latest" onClick={jumpToLatest}><Icon name="down" size={13} />{t.jumpToLatest}</button>}
        <Composer value={composer} onChange={updateComposer} onKeyDown={(event) => {
          if (suggestionMode && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setSuggestionIndex((current) => Math.max(0, Math.min(suggestions.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))); return; }
          if (event.key === "Escape") { setSuggestionMode(null); return; }
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendPrompt(); }
        }} onSend={() => void (isSending ? abortActive() : sendPrompt())} isSending={isSending} language={language} activeModel={activeModel} modelOptions={modelOptions} thinkingLevel={thinkingLevel} thinkingLevels={thinkingLevels} thinkingMenuOpen={thinkingMenuOpen} modelMenuOpen={modelMenuOpen} suggestionMode={suggestionMode} suggestions={suggestions} suggestionIndex={suggestionIndex} onThinkingMenu={() => { setThinkingMenuOpen((current) => !current); setModelMenuOpen(false); }} onModelMenu={() => { setModelMenuOpen((current) => !current); setThinkingMenuOpen(false); }} onThinking={chooseThinking} onModel={chooseModel} onSuggestion={applySuggestion} onTerminal={() => setTerminalOpen((current) => !current)} contextUsage={contextUsage} commandNames={paletteCommands.map((command) => command.name)} attachments={composerImages} onPaste={handleComposerPaste} onRemoveAttachment={(id) => setComposerImages((current) => current.filter((image) => image.id !== id))} onPreviewImage={(image) => setPreviewImage(image)} />
      </main>

      {inspectorOpen && <button className="inspector-backdrop" aria-label={t.closeInspector} onClick={() => setInspectorOpen(false)} />}
      {inspectorOpen && <aside className="inspector">
        <div className="inspector-tabs" role="tablist"><button role="tab" aria-selected={rightPanel === "changes"} className={rightPanel === "changes" ? "active" : ""} onClick={() => setRightPanel("changes")}>{t.changes}<span className="tab-count">{workspace?.changes.length ?? 0}</span></button><button role="tab" aria-selected={rightPanel === "files"} className={rightPanel === "files" ? "active" : ""} onClick={() => setRightPanel("files")}>{t.files}</button><button className="icon-button" onClick={() => setInspectorOpen(false)} aria-label={t.closeInspector}><Icon name="x" size={15} /></button></div>
        {rightPanel === "changes" ? <ChangesPanel changes={workspace?.changes ?? []} language={language} /> : <FilesPanel files={workspace?.files ?? []} language={language} />}
      </aside>}
    </div>

    {terminalOpen && <TerminalPanel language={language} cwd={projectCwd} output={terminalOutput} command={terminalCommand} running={terminalRunning} inspectorOpen={inspectorOpen} onCommand={setTerminalCommand} onExecute={() => void executeTerminal()} onClose={() => setTerminalOpen(false)} />}
    {paletteOpen && <CommandPaletteBoundary language={language} onClose={() => setPaletteOpen(false)}><CommandPalette language={language} commands={paletteCommands} shortcut={shortcut} onCommand={(command) => { updateComposer(`${composer}${composer && !composer.endsWith(" ") ? " " : ""}/${command.name} `); setPaletteOpen(false); }} onClose={() => setPaletteOpen(false)} onNewTask={() => { setPaletteOpen(false); void createTask(); }} onTerminal={() => { setPaletteOpen(false); setTerminalOpen(true); }} onSettings={() => { setPaletteOpen(false); openProviderSettings(); }} onCompact={activeTask ? () => { setPaletteOpen(false); void compactSession(); } : undefined} onExport={activeTask ? (format) => { setPaletteOpen(false); void exportSession(format); } : undefined} /></CommandPaletteBoundary>}
    {notice && <div className="toast" role="status" aria-live="polite">{notice}</div>}
    {contextMenu && <div className="task-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}><button role="menuitem" onClick={() => { setPendingDelete(contextMenu.task); setContextMenu(null); }}>{t.deleteSession}</button></div>}
    {pendingDelete && <ConfirmDialog language={language} task={pendingDelete} busy={deletingTaskId === pendingDelete.id} onCancel={() => setPendingDelete(null)} onConfirm={() => void deleteTask(pendingDelete)} />}
    {settingsOpen && <ProviderSettings language={language} focusProviderId={providerFocus} permissionStatus={permissionStatus} onPermissionStatus={setPermissionStatus} onClose={() => { setSettingsOpen(false); setProviderFocus(null); }} />}
    {previewImage && <ImagePreview image={previewImage} language={language} onClose={() => setPreviewImage(null)} />}
  </div>;
}

function SidebarSkeleton() {
  return <div className="sidebar-skeleton" aria-hidden="true">{[0, 1, 2, 3].map((item) => <span key={item} />)}</div>;
}

function ConversationSkeleton({ label }: { label: string }) {
  return <div className="conversation-skeleton" role="status"><span>{label}</span><i /><i /><i /></div>;
}

function StateMark({ state, language }: { state: TaskSummary["state"]; language: Language }) {
  const labels = copy[language].sessionState;
  if (state === "running") return <span className="state-mark running" role="img" aria-label={labels.running} />;
  if (state === "waiting-approval") return <span className="state-mark approval" role="img" aria-label={labels.approval}>!</span>;
  if (state === "completed") return <span className="state-mark completed" role="img" aria-label={labels.completed}><Icon name="check" size={12} /></span>;
  if (state === "failed") return <span className="state-mark failed" role="img" aria-label={labels.failed}>×</span>;
  return <span className="state-mark idle" role="img" aria-label={labels.idle} />;
}

function TaskRow({ task, active, language, onClick, onContextMenu, onMenu }: { task: TaskSummary; active: boolean; language: Language; onClick: () => void; onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void; onMenu: (rect: DOMRect) => void }) {
  const t = copy[language];
  return <div className={`task-row ${active ? "active" : ""}`} onContextMenu={onContextMenu}><button className="task-main" onClick={onClick} aria-current={active ? "page" : undefined}><span className="task-copy"><strong>{task.title}</strong><small>{formatTime(task.updatedAt)}</small></span>{task.state === "running" && <span className="task-working-spinner" role="img" aria-label={t.sessionState.running} title={t.sessionState.running} />}{task.state === "waiting-approval" && <span className="task-approval-mark" role="img" aria-label={t.sessionState.approval} title={t.sessionState.approval}>!</span>}{task.unread && <span className="unread-dot" title={t.unread} />}</button><button className="task-more" aria-label={t.moreActions} title={t.moreActions} onClick={(event) => { event.stopPropagation(); onMenu(event.currentTarget.getBoundingClientRect()); }}><Icon name="more" size={14} /></button></div>;
}

function MessageView({ message, language, onPreviewImage }: { message: any; language: Language; onPreviewImage: (image: PreviewImage) => void }) {
  const text = textFromMessage(message);
  const images = Array.isArray(message?.content) ? message.content.filter((part: any) => part?.type === "image" && part.data && part.mimeType) : [];
  if (!text && !images.length && message?.role !== "toolResult") return null;
  const t = copy[language];
  const role = message?.role === "user" ? "user" : message?.role === "toolResult" ? "tool" : "assistant";
  if (role === "tool") {
    const toolName = message?.toolName ?? message?.name ?? t.toolResult;
    const failed = Boolean(message?.isError);
    return <div className={`tool-message ${failed ? "failed" : ""}`}><div className="tool-message-heading"><span className="tool-icon"><Icon name={failed ? "alert" : "terminal"} size={14} /></span><strong>{toolName}</strong><span>{failed ? t.sessionState.failed : t.sessionState.completed}</span></div><pre>{text || t.toolResult}</pre></div>;
  }
  const messageTime = formatMessageTime(message.timestamp, language);
  return <article className={`message ${role === "user" ? "user-message" : "assistant-message"}`} tabIndex={0}><div className="message-bubble"><div className="message-content">{images.length > 0 && <div className="message-images">{images.map((image: any, index: number) => <button type="button" className="image-preview-trigger" key={`${message.id ?? "image"}-${index}`} aria-label={t.imagePreview} onClick={() => onPreviewImage({ src: `data:${image.mimeType};base64,${image.data}`, alt: t.imageAttached })}><img src={`data:${image.mimeType};base64,${image.data}`} alt={t.imageAttached} /></button>)}</div>}{text && <MarkdownContent text={text} language={language} />}</div></div>{messageTime && <div className="message-hover-meta"><time dateTime={new Date(message.timestamp).toISOString()}>{messageTime}</time></div>}</article>;
}

function activityValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function activityFromMessages(messages: any[], language: Language): ActivityStep[] {
  const steps: ActivityStep[] = [];
  const toolSteps = new Map<string, ActivityStep>();
  for (const message of messages) {
    const timestamp = typeof message?.timestamp === "number" ? message.timestamp : Date.parse(message?.timestamp ?? "") || Date.now();
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part?.type === "thinking" && part.thinking) steps.push({ id: `${message.id ?? timestamp}:thinking:${steps.length}`, kind: "thinking", label: copy[language].executionThinking, detail: part.thinking, startedAt: timestamp, endedAt: timestamp });
        if (part?.type === "toolCall" || part?.type === "tool_call") {
          const step = { id: part.id ?? part.toolCallId ?? `${message.id ?? timestamp}:tool:${steps.length}`, kind: "tool" as const, label: part.name ?? part.toolName ?? copy[language].toolResult, args: part.arguments ?? part.args ?? {}, startedAt: timestamp };
          steps.push(step);
          toolSteps.set(step.id, step);
        }
      }
    }
    if (message?.role === "toolResult") {
      const toolId = message.toolCallId ?? message.tool_call_id;
      const step = toolSteps.get(toolId);
      if (step) {
        step.result = textFromMessage(message);
        step.endedAt = timestamp;
        step.isError = Boolean(message.isError);
      }
    }
  }
  return steps;
}

function ExecutionSummary({ steps, language, running }: { steps: ActivityStep[]; language: Language; running: boolean }) {
  if (!steps.length) return null;
  const t = copy[language];
  const thinkingCount = steps.filter((step) => step.kind === "thinking").length;
  const toolCount = steps.filter((step) => step.kind === "tool").length;
  const startedAt = Math.min(...steps.map((step) => step.startedAt));
  const endedAt = running ? Date.now() : Math.max(...steps.map((step) => step.endedAt ?? step.startedAt));
  const seconds = Math.max(0, (endedAt - startedAt) / 1000);
  return <details className="execution-summary" open={false}>
    <summary><Icon name="spark" size={13} /><span>{t.executionSummary(thinkingCount, toolCount, seconds)}</span><Icon name="chevron" size={12} /></summary>
    <div className="execution-details">
      {steps.map((step) => <div className={`execution-step ${step.isError ? "failed" : ""}`} key={step.id}>
        <div className="execution-step-heading"><span className="execution-step-icon"><Icon name={step.kind === "thinking" ? "spark" : step.isError ? "alert" : "terminal"} size={13} /></span><strong>{step.kind === "thinking" ? t.executionThinking : step.label}</strong><small>{step.endedAt ? `${((step.endedAt - step.startedAt) / 1000).toFixed(1)}s` : t.working}</small></div>
        {step.kind === "thinking" && step.detail && <pre>{step.detail}</pre>}
        {step.kind === "tool" && step.args !== undefined && <div className="execution-value"><span>{t.executionArguments}</span><pre>{activityValue(step.args)}</pre></div>}
        {step.kind === "tool" && step.result !== undefined && <div className="execution-value"><span>{t.executionResult}</span><pre>{activityValue(step.result)}</pre></div>}
      </div>)}
    </div>
  </details>;
}

function MessageTimeline({ messages, language, onPreviewImage }: { messages: any[]; language: Language; onPreviewImage: (image: PreviewImage) => void }) {
  const items: Array<{ type: "message"; message: any; index: number } | { type: "execution"; steps: ActivityStep[]; index: number }> = [];
  let turn: any[] = [];
  const flushTurn = () => {
    if (!turn.length) return;
    const steps = activityFromMessages(turn, language);
    if (!steps.length) {
      for (const [index, message] of turn.entries()) if (message?.role !== "toolResult") items.push({ type: "message", message, index: items.length + index });
      turn = [];
      return;
    }
    const userMessage = turn.find((message) => message?.role === "user");
    if (userMessage) items.push({ type: "message", message: userMessage, index: items.length });
    items.push({ type: "execution", steps, index: items.length });
    for (const message of turn) if (message?.role === "assistant" && textFromMessage(message)) items.push({ type: "message", message, index: items.length });
    turn = [];
  };
  for (const message of messages) {
    if (message?.role === "user" && turn.length) flushTurn();
    turn.push(message);
  }
  flushTurn();
  return <>{items.map((item) => item.type === "execution" ? <ExecutionSummary key={`execution-${item.index}`} steps={item.steps} language={language} running={false} /> : <MessageView key={item.message.id ?? `${item.message.role}-${item.index}`} message={item.message} language={language} onPreviewImage={onPreviewImage} />)}</>;
}

function formatTokenCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function ContextRing({ usage, language }: { usage?: ContextUsage; language: Language }) {
  const t = copy[language];
  const percent = usage?.percent === null || usage?.percent === undefined ? 0 : Math.max(0, Math.min(100, usage.percent));
  const circumference = 2 * Math.PI * 8;
  const dash = circumference * percent / 100;
  return <span className="context-ring-wrap" tabIndex={0} aria-label={t.contextUsage}>
    <span className="context-ring"><svg viewBox="0 0 20 20" aria-hidden="true"><circle className="context-ring-track" cx="10" cy="10" r="8" /><circle className="context-ring-progress" cx="10" cy="10" r="8" strokeDasharray={`${dash} ${circumference - dash}`} /></svg><span>{usage?.percent === null || usage?.percent === undefined ? "—" : `${Math.round(percent)}%`}</span></span>
    <span className="context-tooltip" role="tooltip"><strong>{t.contextUsage}</strong><span className="context-total">{formatTokenCount(usage?.tokens)} / {formatTokenCount(usage?.contextWindow)} {t.tokenUnit}</span><span>{t.contextUsed}: {formatTokenCount(usage?.tokens)} {t.tokenUnit}</span><span>{t.contextWindow}: {formatTokenCount(usage?.contextWindow)} {t.tokenUnit}</span></span>
  </span>;
}

function PermissionSettings({ language, status, onStatus }: { language: Language; status: PermissionStatus | null; onStatus: (status: PermissionStatus) => void }) {
  const t = copy[language];
  const modes: Array<{ id: PermissionMode; label: string; description: string }> = [
    { id: "ask", label: t.permissionModeAsk, description: t.permissionModeAskDescription },
    { id: "allow", label: t.permissionModeAllow, description: t.permissionModeAllowDescription },
    { id: "deny", label: t.permissionModeDeny, description: t.permissionModeDenyDescription },
    { id: "yolo", label: t.permissionModeYolo, description: t.permissionModeYoloDescription },
  ];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function changeMode(mode: PermissionMode) {
    setBusy(true); setError(null);
    try { onStatus(await window.pideck.permissions.setMode(mode)); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(false); }
  }
  return <section className="permission-settings" aria-labelledby="permission-title"><div className="permission-heading"><div><h3 id="permission-title">{t.permissionSettings}</h3><p>{t.permissionSettingsDescription}</p></div>{status && <small>{t.permissionSource(status.source)}</small>}</div><div className="permission-modes" role="radiogroup" aria-label={t.permissionSettings}>{modes.map((mode) => <button key={mode.id} type="button" role="radio" aria-checked={status?.mode === mode.id} disabled={busy} className={status?.mode === mode.id ? "selected" : ""} onClick={() => void changeMode(mode.id)}><span className={`permission-mode-dot ${mode.id}`} /><span><strong>{mode.label}</strong><small>{mode.description}</small></span><Icon name="check" size={13} /></button>)}</div>{error && <div className="field-error" role="alert">{error}</div>}</section>;
}

function WorkingIndicator({ language, phase, toolName }: { language: Language; phase: WorkingPhase; toolName?: string }) {
  const t = copy[language];
  const label = phase === "tool" ? toolName ? t.toolRunning(toolName) : t.toolStatus : phase === "responding" ? t.respondingStatus : t.thinkingStatus;
  return <div className="working-indicator" role="status" aria-live="polite"><span>{label}</span><span className="working-dots"><span /><span /><span /></span></div>;
}

function ApprovalCard({ approval, language, onResolve }: { approval: { toolName: string; args?: unknown }; language: Language; onResolve: (decision: "allow-once" | "deny") => Promise<void> }) {
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = copy[language];
  async function resolve(decision: "allow-once" | "deny") {
    setResolving(true); setError(null);
    try { await onResolve(decision); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); setResolving(false); }
  }
  return <div className="approval-card" role="alert"><div className="approval-top"><div className="approval-title"><span className="approval-icon"><Icon name="terminal" size={15} /></span><div><strong>{t.approval}</strong><small>{t.approvalRequest(approval.toolName)}</small></div></div><span className="risk-label">{approval.toolName.toUpperCase()}</span></div><div className="command-preview"><span className="prompt-symbol">$</span><code>{JSON.stringify(approval.args ?? {}, null, 2)}</code></div>{error && <div className="inline-error" role="alert">{error}</div>}<div className="approval-actions"><button className="button primary" disabled={resolving} onClick={() => void resolve("allow-once")}><Icon name="check" size={14} />{t.approve}</button><button className="button ghost" disabled={resolving} onClick={() => void resolve("deny")}><Icon name="x" size={14} />{t.reject}</button><span className="approval-scope">{resolving ? t.loading : t.approvalScope}</span></div></div>;
}

function highlightComposerText(value: string, commandNames: string[]): ReactNode[] {
  const commands = new Set(commandNames.map((name) => name.replace(/^\//, "").toLowerCase()));
  const result: ReactNode[] = [];
  const pattern = /(^|\s)(\/(?:skill:)?[A-Za-z][\w:-]*|@[\w./\\-]+)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    const prefix = match[1] ?? "";
    const token = match[2] ?? "";
    const isCommand = token.startsWith("/skill:") || commands.has(token.slice(1).toLowerCase());
    if (!isCommand && token.startsWith("/")) continue;
    if (start > cursor) result.push(<span key={`text-${cursor}`}>{value.slice(cursor, start)}</span>);
    if (prefix) result.push(<span key={`space-${start}`}>{prefix}</span>);
    result.push(<mark className={`composer-token ${token.startsWith("/") ? "command-token" : "mention-token"}`} key={`token-${start}`}>{token}</mark>);
    cursor = start + match[0].length;
  }
  if (cursor < value.length) result.push(<span key={`text-${cursor}`}>{value.slice(cursor)}</span>);
  return result;
}

function Composer(props: { value: string; onChange: (value: string) => void; onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void; onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void; onSend: () => void; isSending: boolean; language: Language; activeModel: ModelSummary | null; modelOptions: ModelSummary[]; thinkingLevel: string; thinkingLevels: string[]; thinkingMenuOpen: boolean; modelMenuOpen: boolean; suggestionMode: SuggestionMode; suggestions: any[]; suggestionIndex: number; contextUsage?: ContextUsage; commandNames: string[]; attachments: ImageAttachment[]; onRemoveAttachment: (id: string) => void; onPreviewImage: (image: PreviewImage) => void; onThinkingMenu: () => void; onModelMenu: () => void; onThinking: (level: string) => void; onModel: (model: ModelSummary) => void; onSuggestion: (item: any) => void; onTerminal: () => void }) {
  const t = copy[props.language];
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [modelQuery, setModelQuery] = useState("");
  const filteredModels = props.modelOptions.filter((model) => `${model.providerName} ${model.name}`.toLowerCase().includes(modelQuery.toLowerCase()));
  useEffect(() => { suggestionRefs.current[props.suggestionIndex]?.scrollIntoView({ block: "nearest" }); }, [props.suggestionIndex, props.suggestions.length, props.suggestionMode]);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 168)}px`;
  }, [props.value]);
  useEffect(() => { if (!props.modelMenuOpen) setModelQuery(""); }, [props.modelMenuOpen]);
  return <div className="composer-wrap"><div className="composer-shell">
    {props.suggestionMode && props.suggestions.length > 0 && <div className="suggestion-popover" role="listbox" id="composer-suggestions" aria-label={props.suggestionMode === "mention" ? t.files : t.command}>{props.suggestions.map((item, index) => <button ref={(element) => { suggestionRefs.current[index] = element; }} key={item.name ?? item.path} type="button" role="option" aria-selected={index === props.suggestionIndex} className={index === props.suggestionIndex ? "selected" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => props.onSuggestion(item)}><span className="suggestion-symbol">{props.suggestionMode === "mention" ? "@" : "/"}</span><span><strong>{item.name ?? item.path}</strong><small>{item.description ?? item.path}</small></span></button>)}</div>}
    <div className="composer">{props.attachments.length > 0 && <div className="composer-attachments">{props.attachments.map((image) => <div className="composer-attachment" key={image.id}><button type="button" className="composer-image-preview" aria-label={t.imagePreview} onClick={() => props.onPreviewImage({ src: `data:${image.mimeType};base64,${image.data}`, alt: image.name || t.imageAttached })}><img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name || t.imageAttached} /></button><button type="button" className="composer-remove-image" aria-label={t.removeImage} title={t.removeImage} onClick={() => props.onRemoveAttachment(image.id)}><Icon name="x" size={11} /></button></div>)}</div>}<div className="composer-editor"><div ref={highlightRef} className="composer-highlight" aria-hidden="true">{props.value ? highlightComposerText(props.value, props.commandNames) : <span className="composer-placeholder">{t.ask}</span>}</div><textarea ref={textareaRef} autoFocus value={props.value} onChange={(event) => props.onChange(event.target.value)} onPaste={props.onPaste} onScroll={(event) => { if (highlightRef.current) highlightRef.current.scrollTop = event.currentTarget.scrollTop; }} onKeyDown={props.onKeyDown} placeholder="" rows={2} aria-label={t.ask} aria-controls="composer-suggestions" aria-expanded={Boolean(props.suggestionMode && props.suggestions.length)} /></div><div className="composer-footer"><div className="composer-tools">
      <div className="menu-anchor"><button className="chip" aria-haspopup="menu" aria-expanded={props.thinkingMenuOpen} onClick={props.onThinkingMenu}><Icon name="spark" size={14} /><span>{props.thinkingLevel}</span><Icon name="chevron" size={13} /></button>{props.thinkingMenuOpen && <div className="inline-menu" role="menu" aria-label={t.chooseThinking}><strong>{t.chooseThinking}</strong>{props.thinkingLevels.map((level) => <button role="menuitemradio" aria-checked={level === props.thinkingLevel} key={level} className={level === props.thinkingLevel ? "active" : ""} onClick={() => props.onThinking(level)}>{level}</button>)}</div>}</div>
      <div className="menu-anchor"><button className="model-chip" aria-haspopup="menu" aria-expanded={props.modelMenuOpen} onClick={props.onModelMenu}><Icon name="model" size={14} /><span className="model-provider">{props.activeModel?.providerName ?? t.provider}</span><span>{props.activeModel?.name ?? (props.modelOptions.length ? t.chooseModel : t.models)}</span><ContextRing usage={props.contextUsage} language={props.language} /><Icon name="chevron" size={13} /></button>{props.modelMenuOpen && <div className="inline-menu model-menu" role="menu" aria-label={t.models}><label className="model-search"><Icon name="search" size={13} /><input autoFocus value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder={t.searchModels} /></label>{filteredModels.length === 0 ? <span className="menu-empty">{props.modelOptions.length ? t.noMatchingCommands : t.configureProvider}</span> : filteredModels.map((model) => <button role="menuitemradio" aria-checked={model.id === props.activeModel?.id && model.providerId === props.activeModel?.providerId} key={`${model.providerId}/${model.id}`} className={model.id === props.activeModel?.id && model.providerId === props.activeModel?.providerId ? "active" : ""} onClick={() => props.onModel(model)}><span><strong>{model.name}</strong><small>{model.providerName}</small></span><Icon name="check" size={12} /></button>)}</div>}</div>
      <button className="chip subtle" aria-label={t.mentionLabel} title={t.mentionLabel} onClick={() => props.onChange(`${props.value}${props.value ? " " : ""}@`)}><Icon name="plus" size={14} />@</button>
      <button className="chip subtle terminal-trigger" onClick={props.onTerminal}><Icon name="terminal" size={13} />{t.terminal}</button>
    </div><span className="composer-hint">{t.shiftEnter}</span><button className="send-button" disabled={!props.isSending && !props.value.trim() && props.attachments.length === 0} aria-label={props.isSending ? t.stop : t.send} onClick={props.onSend}><Icon name={props.isSending ? "stop" : "send"} size={16} /></button></div></div>
  </div></div>;
}

function ChangesPanel({ changes, language }: { changes: WorkspaceChange[]; language: Language }) {
  const t = copy[language];
  const [selectedPath, setSelectedPath] = useState<string | null>(changes[0]?.path ?? null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!selectedPath || !changes.some((change) => change.path === selectedPath)) setSelectedPath(changes[0]?.path ?? null); }, [changes, selectedPath]);
  async function copyPath() { if (!selectedPath || !await copyText(selectedPath)) return; setCopied(true); window.setTimeout(() => setCopied(false), 1400); }
  return <div className="inspector-content" role="tabpanel"><div className="change-summary"><div><strong>{t.fileCount(changes.length)}</strong><span>{t.additions(changes.reduce((sum, item) => sum + item.additions, 0))}</span></div></div>{changes.length === 0 ? <div className="inspector-empty">{t.noChanges}</div> : <><div className="file-change-list">{changes.map((change) => <button key={change.path} aria-pressed={selectedPath === change.path} className={`file-change ${selectedPath === change.path ? "selected" : ""}`} onClick={() => setSelectedPath(change.path)}><span className="file-tone" /><span className="file-change-copy"><strong>{change.path.split("/").pop()}</strong><small>{change.path}</small></span><span className="diff-count"><em>+{change.additions}</em><i>−{change.deletions}</i></span></button>)}</div><div className="diff-preview"><div className="diff-header"><span>{selectedPath}</span><span className="diff-lines">{changes.find((change) => change.path === selectedPath)?.status}</span></div><div className="diff-empty">{t.workspaceSummaryOnly}<button className="button ghost" onClick={() => void copyPath()}><Icon name="copy" size={13} />{copied ? t.copied : t.copyPath}</button></div></div></>}</div>;
}

function FilesPanel({ files, language }: { files: WorkspaceFile[]; language: Language }) {
  const t = copy[language];
  return <div className="inspector-content" role="tabpanel"><div className="file-tree-root"><Icon name="folder" size={14} /><strong>PiDeck</strong><span>{t.itemCount(files.length)}</span></div>{files.length === 0 ? <div className="inspector-empty">{t.noFiles}</div> : <div className="file-tree" role="tree">{files.map((file) => { const depth = file.path.split("/").length - 1; return <div key={`${file.kind}:${file.path}`} role="treeitem" aria-level={depth + 1} className={file.kind === "directory" ? "directory-row" : "file-row"} style={{ paddingLeft: `${6 + depth * 14}px` }}><Icon name={file.kind === "directory" ? "folder" : "file"} size={14} /><span>{file.path.split("/").pop()}</span>{file.size !== undefined && <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>}</div>; })}</div>}</div>;
}

function TerminalPanel({ language, cwd, output, command, running, inspectorOpen, onCommand, onExecute, onClose }: { language: Language; cwd: string; output: string[]; command: string; running: boolean; inspectorOpen: boolean; onCommand: (value: string) => void; onExecute: () => void; onClose: () => void }) {
  const t = copy[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (followRef.current && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [output]);
  return <section className={`terminal-float ${inspectorOpen ? "with-inspector" : ""}`} role="dialog" aria-modal="false" aria-label={t.terminal}><div className="terminal-float-header"><span><Icon name="terminal" size={14} />{t.terminal}</span><small>{cwd} · {t.terminalRuntime}</small><button className="icon-button" onClick={onClose} aria-label={t.closeTerminal}><Icon name="x" size={14} /></button></div><div ref={outputRef} className="terminal-output" role="log" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40; }}>{output.length === 0 ? <div className="terminal-muted">{t.terminalEmpty}</div> : output.map((line, index) => <pre className="terminal-line" key={`${index}-${line.slice(0, 20)}`}>{line}</pre>)}</div><form className="terminal-input-row" onSubmit={(event) => { event.preventDefault(); onExecute(); }}><span className="terminal-green">›</span><input ref={inputRef} value={command} onChange={(event) => onCommand(event.target.value)} placeholder={t.terminalPlaceholder} aria-label={t.terminalPlaceholder} disabled={running} /><span className="terminal-running">{running ? "…" : ""}</span></form></section>;
}

class CommandPaletteBoundary extends Component<{ children: ReactNode; language: Language; onClose: () => void }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : String(error) }; }
  componentDidCatch(error: unknown, info: ErrorInfo) { console.error("Command palette render failed", error, info.componentStack); }
  render() {
    if (this.state.error) { const t = copy[this.props.language]; return <div className="palette-backdrop"><div className="command-palette palette-error" role="alert"><strong>{t.commandPanelError}</strong><button className="button ghost" onClick={this.props.onClose}>{t.retry}</button></div></div>; }
    return this.props.children;
  }
}

function CommandPalette({ language, commands, shortcut, onCommand, onClose, onNewTask, onTerminal, onSettings, onCompact, onExport }: { language: Language; commands: Array<{ name: string; description?: string; source?: string }>; shortcut: (key: string) => string; onCommand: (command: { name: string }) => void; onClose: () => void; onNewTask: () => void; onTerminal: () => void; onSettings: () => void; onCompact?: () => void; onExport?: (format: "jsonl" | "html") => void }) {
  const t = copy[language];
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useDialogFocus(dialogRef, onClose);
  const quickItems = [
    { id: "new-task", label: t.newTask, description: shortcut("N"), action: onNewTask, icon: "plus" },
    { id: "terminal", label: t.terminal, description: shortcut("J"), action: onTerminal, icon: "terminal" },
    { id: "provider", label: t.provider, description: shortcut(","), action: onSettings, icon: "key" },
    ...(onCompact ? [{ id: "compact", label: t.compactContext, description: "", action: onCompact, icon: "spark" }] : []),
    ...(onExport ? [{ id: "export-jsonl", label: t.exportJsonl, description: "", action: () => onExport("jsonl"), icon: "file" }, { id: "export-html", label: t.exportHtml, description: "", action: () => onExport("html"), icon: "file" }] : []),
  ];
  const safeCommands = (Array.isArray(commands) ? commands : []).filter((command) => command && typeof command.name === "string").map((command) => ({ ...command, description: typeof command.description === "string" ? command.description : "" }));
  const filteredCommands = safeCommands.filter((command) => `${command.name} ${command.description}`.toLowerCase().includes(query.toLowerCase()));
  const filteredQuick = quickItems.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
  const items = [...filteredQuick, ...filteredCommands.map((command) => ({ id: `command:${command.name}`, label: `/${command.name}`, description: command.description ?? t.piCommand, action: () => onCommand(command), icon: "command" }))];
  useEffect(() => setSelectedIndex(0), [query]);
  useEffect(() => { const item = itemRefs.current[selectedIndex]; item?.scrollIntoView?.({ block: "nearest" }); }, [selectedIndex]);
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex((current) => Math.min(items.length - 1, current + 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex((current) => Math.max(0, current - 1)); }
    if (event.key === "Enter") { event.preventDefault(); items[selectedIndex]?.action(); }
  }
  return <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label={t.command}><div className="palette-search"><Icon name="search" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKeyDown} placeholder={t.searchCommands} aria-label={t.searchCommands} /><kbd>ESC</kbd></div><div className="palette-group"><span>{query ? t.results : t.quickActions}</span>{items.length === 0 ? <div className="palette-empty">{t.noMatchingCommands}</div> : items.map((item, index) => <button ref={(element) => { itemRefs.current[index] = element; }} key={item.id} className={index === selectedIndex ? "selected" : ""} onMouseEnter={() => setSelectedIndex(index)} onClick={item.action}><Icon name={item.icon} /><span>{item.label}</span><small>{item.description}</small></button>)}</div></div></div>;
}

function ImagePreview({ image, language, onClose }: { image: PreviewImage; language: Language; onClose: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  return <div className="image-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="image-preview-dialog" role="dialog" aria-modal="true" aria-label={t.imagePreview}><button type="button" className="icon-button image-preview-close" onClick={onClose} aria-label={t.closeImagePreview} title={t.closeImagePreview}><Icon name="x" /></button><img src={image.src} alt={image.alt} /></div></div>;
}

function ConfirmDialog({ language, task, busy, onCancel, onConfirm }: { language: Language; task: TaskSummary; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, () => { if (!busy) onCancel(); });
  return <div className="dialog-backdrop"><div ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description"><span className="confirm-icon"><Icon name="alert" /></span><h2 id="delete-title">{t.deleteSessionTitle}</h2><p id="delete-description">{t.deleteSessionBody(task.title)}</p><div><button className="button ghost" disabled={busy} onClick={onCancel}>{t.cancel}</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? t.deleting : t.deleteSession}</button></div></div></div>;
}

function ProviderSettings({ language, focusProviderId, permissionStatus, onPermissionStatus, onClose }: { language: Language; focusProviderId: string | null; permissionStatus: PermissionStatus | null; onPermissionStatus: (status: PermissionStatus) => void; onClose: () => void }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [providerStates, setProviderStates] = useState<Record<string, ProviderSummary["authState"]>>({});
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [apiKeyProvider, setApiKeyProvider] = useState<string | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [authPrompt, setAuthPrompt] = useState<AuthPromptState | null>(null);
  const [loading, setLoading] = useState(true);
  const dialogRef = useRef<HTMLElement>(null);
  const t = copy[language];

  function closeApiKeyForm() { setApiKeyProvider(null); setApiKeyValue(""); }
  async function resolvePrompt(value: string) {
    if (!authPrompt) return;
    const requestId = authPrompt.requestId;
    setAuthPrompt(null);
    try { await window.pideck.providers.resolveAuth(requestId, value); }
    catch (error) { setAuthError(error instanceof Error ? error.message : String(error)); }
  }
  useDialogFocus(dialogRef, () => {
    if (authPrompt) { void resolvePrompt(""); return; }
    if (apiKeyProvider) { closeApiKeyForm(); return; }
    onClose();
  });

  async function loadProviders() {
    setLoading(true); setListError(null);
    try {
      const next = await window.pideck.providers.list();
      setProviders([...next].sort((a, b) => Number(b.authState === "configured") - Number(a.authState === "configured") || a.name.localeCompare(b.name)));
      setProviderStates(Object.fromEntries(next.map((provider) => [provider.id, provider.authState])));
    } catch (error) { setListError(`${t.providerLoadFailed}: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadProviders(); }, []);
  useEffect(() => {
    if (!focusProviderId || !providers.length) return;
    document.querySelector<HTMLElement>(`[data-provider-id="${CSS.escape(focusProviderId)}"]`)?.scrollIntoView({ block: "center" });
  }, [focusProviderId, providers]);
  useEffect(() => window.pideck.events.subscribe((runtimeEvent) => {
    if (runtimeEvent.type !== "auth.event" || !runtimeEvent.requestId) return;
    const event = runtimeEvent.event as any;
    if (event?.type === "prompt") setAuthPrompt({ requestId: runtimeEvent.requestId, message: event.prompt?.message ?? t.authPromptFallback, placeholder: event.prompt?.placeholder ?? "", value: "" });
    else if (event?.type === "notify" && event.event?.type === "auth_url") {
      setAuthUrl(event.event.url ?? null); setAuthNotice(event.event.instructions ?? t.authBrowserInstruction);
      if (event.event.url) void window.pideck.providers.openAuthUrl(event.event.url).catch((error) => setAuthError(String(error)));
    } else if (event?.type === "notify" && event.event?.type === "device_code") {
      setAuthUrl(event.event.verificationUri ?? null); setAuthNotice(t.authDeviceCode(event.event.userCode ?? ""));
      if (event.event.verificationUri) void window.pideck.providers.openAuthUrl(event.event.verificationUri).catch((error) => setAuthError(String(error)));
    }
  }), [language]);

  async function auth(providerId: string, method: AuthMethod, secret?: string) {
    if (method === "api-key" && !secret?.trim()) { setFieldErrors((current) => ({ ...current, [providerId]: t.apiKeyRequired })); return; }
    setBusyProvider(providerId); setAuthError(null); setAuthNotice(method === "oauth" ? t.oauthWaiting : null); setAuthUrl(null); setFieldErrors((current) => ({ ...current, [providerId]: undefined }));
    try {
      await window.pideck.providers.login(providerId, method, secret?.trim());
      closeApiKeyForm(); setAuthNotice(null); await loadProviders();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (method === "api-key") setFieldErrors((current) => ({ ...current, [providerId]: message })); else setAuthError(message);
    } finally { setBusyProvider(null); }
  }

  async function logout(providerId: string) {
    setBusyProvider(providerId); setAuthError(null);
    try { await window.pideck.providers.logout(providerId); await loadProviders(); }
    catch (error) { setAuthError(error instanceof Error ? error.message : String(error)); }
    finally { setBusyProvider(null); }
  }

  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyProvider) onClose(); }}><section ref={dialogRef} className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="provider-title"><div className="settings-header"><div><span className="eyebrow">{t.localRuntime}</span><h2 id="provider-title">{t.providerAuthTitle}</h2><p>{t.providerAuthDescription}</p></div><button className="icon-button" onClick={onClose} aria-label={t.closeSettings}><Icon name="x" /></button></div><div className="locality-note"><span className="status-dot" /><span>{t.localCredentials}</span></div><PermissionSettings language={language} status={permissionStatus} onStatus={onPermissionStatus} />{authNotice && <div className="auth-notice" role="status"><div>{authNotice}</div>{authUrl && <button className="button primary" onClick={() => void window.pideck.providers.openAuthUrl(authUrl)}>{t.openBrowser}</button>}</div>}{authError && <div className="auth-error" role="alert"><div className="auth-error-copy">{authError}</div><div className="auth-error-actions">{authUrl && <button className="button primary" onClick={() => void window.pideck.providers.openAuthUrl(authUrl)}>{t.openBrowser}</button>}<button className="button ghost" onClick={() => { setAuthError(null); void loadProviders(); }}>{t.retry}</button></div></div>}
    <div className="provider-list">{loading ? <div className="provider-loading" role="status"><i /><i /><i /></div> : listError ? <div className="provider-list-error" role="alert"><span>{listError}</span><button className="button ghost" onClick={() => void loadProviders()}>{t.retry}</button></div> : providers.length === 0 ? <div className="provider-list-error"><span>{t.noProviders}</span></div> : providers.map((provider) => { const state = providerStates[provider.id] ?? provider.authState; const expanded = apiKeyProvider === provider.id; return <div className={`provider-card ${expanded ? "expanded" : ""} ${focusProviderId === provider.id ? "focused" : ""}`} data-provider-id={provider.id} key={provider.id}><div className="provider-main"><div className="provider-logo">{provider.name.slice(0, 1)}</div><div className="provider-copy"><div><strong>{provider.name}</strong><span className={`provider-state ${state}`}><span className="status-dot" />{state === "configured" ? t.configured : state === "expired" ? t.expired : t.missing}</span></div><small>{provider.id} · {t.providerModels(provider.modelCount)}</small></div><div className="provider-actions">{state === "configured" && <button className="button ghost" disabled={busyProvider === provider.id} onClick={() => void logout(provider.id)}>{t.logout}</button>}{provider.authMethods.includes("oauth") && <button className="button primary" disabled={busyProvider === provider.id} onClick={() => void auth(provider.id, "oauth")}>{busyProvider === provider.id ? t.authorizing : t.oauth}</button>}{provider.authMethods.includes("api-key") && <button className="button ghost" aria-expanded={expanded} aria-controls={`api-key-${provider.id}`} disabled={busyProvider === provider.id} onClick={() => { if (expanded) closeApiKeyForm(); else { setApiKeyProvider(provider.id); setApiKeyValue(""); setAuthNotice(null); setAuthUrl(null); setFieldErrors((current) => ({ ...current, [provider.id]: undefined })); } }}>{t.apiKey}</button>}</div></div>{expanded && <form id={`api-key-${provider.id}`} className="api-key-form" onSubmit={(event) => { event.preventDefault(); void auth(provider.id, "api-key", apiKeyValue); }}><label htmlFor={`api-key-input-${provider.id}`}><strong>{t.apiKey}</strong><small>{provider.name}</small></label><div className="api-key-controls"><input id={`api-key-input-${provider.id}`} type="password" autoFocus value={apiKeyValue} onChange={(event) => setApiKeyValue(event.target.value)} placeholder={t.enterApiKey} aria-describedby={fieldErrors[provider.id] ? `api-key-error-${provider.id}` : undefined} /><button className="button primary" disabled={!apiKeyValue.trim() || busyProvider === provider.id} type="submit">{busyProvider === provider.id ? t.saving : t.save}</button><button className="button ghost" type="button" onClick={closeApiKeyForm}>{t.cancel}</button></div>{fieldErrors[provider.id] && <div id={`api-key-error-${provider.id}`} className="field-error" role="alert">{fieldErrors[provider.id]}</div>}</form>}</div>; })}</div>
    <div className="settings-footer"><span>{providers.length ? t.providerCount(providers.length) : ""}</span><button className="button ghost" onClick={onClose}>{t.done}</button></div>
    {authPrompt && <div className="auth-prompt-backdrop"><form className="auth-prompt" role="alertdialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); void resolvePrompt(authPrompt.value); }}><h3>{t.authPromptTitle}</h3><p>{authPrompt.message}</p><label><span>{authPrompt.placeholder || t.authPromptFallback}</span><input autoFocus type="password" value={authPrompt.value} onChange={(event) => setAuthPrompt((current) => current ? { ...current, value: event.target.value } : current)} /></label><div><button type="button" className="button ghost" onClick={() => void resolvePrompt("")}>{t.cancel}</button><button type="submit" className="button primary" disabled={!authPrompt.value}>{t.submit}</button></div></form></div>}
  </section></div>;
}
