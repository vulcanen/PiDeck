import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PermissionStatus } from "@pideck/contracts";
import type { ProjectSummary, TaskSummary } from "@pideck/domain";
import { copy, type Language } from "@pideck/i18n";
import { Icon } from "@pideck/ui-system";
import type { MessageLoad, TaskUiState, WorkingPhase } from "./types";
import type { ComposerProps } from "./ui";
import type { ConversationScrollHandle, ConversationScrollSnapshot } from "./use-conversation-scroll";
import { ApprovalCard, ConversationSkeleton, MemoComposer, MemoMessageTimeline, PermissionLevelControl } from "./ui";

type AppCopy = (typeof copy)[Language];

interface ConversationPaneData {
  task: TaskSummary;
  messageLoad: MessageLoad;
  messages: any[];
  isWorking: boolean;
  streamText: string;
  workingPhase: WorkingPhase;
  taskUi: TaskUiState | undefined;
  steeringMessageKeys: string[];
}

interface ConversationPaneSlotProps {
  data?: ConversationPaneData;
  active: boolean;
  language: Language;
  t: AppCopy;
  loadError: string | null;
  scrollPositionsRef: { current: Record<string, ConversationScrollSnapshot> };
  scrollHandleRef: { current: ConversationScrollHandle | null };
  onTimelineAtEnd: (atEnd: boolean) => void;
  onRetryInitialLoad: () => void | Promise<unknown>;
  onRetryMessages: () => void;
  onResolveApproval: (decision: "allow-once" | "deny") => Promise<void>;
  onPreviewImage: ComposerProps["onPreviewImage"];
  onContextMenuImage: ComposerProps["onContextMenuImage"];
}

function conversationPaneKey(projectCwd: string, taskId: string): string {
  return `${projectCwd}\u0000${taskId}`;
}

function ConversationPaneSlot({
  data, active, language, t, loadError, scrollPositionsRef, scrollHandleRef,
  onTimelineAtEnd, onRetryInitialLoad, onRetryMessages, onResolveApproval,
  onPreviewImage, onContextMenuImage,
}: ConversationPaneSlotProps) {
  // Inactive panes keep their last data and DOM mounted and are hidden with
  // `visibility`, never `display: none`. That is what lets the browser preserve
  // each pane's own scrollTop across task switches with no restore logic.
  const retainedDataRef = useRef<ConversationPaneData | undefined>(data);
  if (data) retainedDataRef.current = data;
  const retained = retainedDataRef.current;
  const paneRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);

  // Thin scroll position indicator. The native scrollbar is hidden, so this
  // thumb is the only position cue in long conversations. It writes styles
  // directly to the DOM inside a rAF to avoid re-rendering per scroll event.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    const indicator = indicatorRef.current;
    if (!pane || !indicator) return;
    const thumb = indicator.firstElementChild as HTMLElement | null;
    if (!thumb) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const { scrollTop, scrollHeight, clientHeight } = pane;
      const overflow = scrollHeight - clientHeight;
      if (overflow <= 1) { indicator.classList.remove("has-overflow"); return; }
      indicator.classList.add("has-overflow");
      const track = clientHeight - 16;
      const height = Math.max(28, track * (clientHeight / scrollHeight));
      const top = 8 + (track - height) * (scrollTop / overflow);
      thumb.style.height = `${height}px`;
      thumb.style.transform = `translateY(${top}px)`;
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    schedule();
    pane.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(pane);
    // A scroll container's own box never resizes when its content grows, so the
    // thumb has to track the transcript element itself. It mounts after this
    // effect (messages load asynchronously), hence the childList watch.
    let observedContent: Element | null = null;
    const attachContent = () => {
      const content = pane.querySelector(".timeline-list");
      if (!content || content === observedContent) return;
      if (observedContent) observer.unobserve(observedContent);
      observedContent = content;
      observer.observe(content);
    };
    attachContent();
    const mutations = new MutationObserver(attachContent);
    mutations.observe(pane, { childList: true });
    return () => {
      pane.removeEventListener("scroll", schedule);
      mutations.disconnect();
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  if (!retained) return null;

  const { task, messageLoad, messages, isWorking, streamText, workingPhase, taskUi, steeringMessageKeys } = retained;
  const scrollKey = conversationPaneKey(task.projectId, task.id);
  return <div
    ref={paneRef}
    className={`conversation-scroll conversation-pane ${active ? "is-active" : "is-inactive"}`}
    aria-hidden={!active}
  >
    <div className="scroll-indicator" ref={indicatorRef} aria-hidden="true"><span className="scroll-indicator-thumb" /></div>
    {active && loadError && <div className="runtime-error" role="alert"><strong>{loadError}</strong><button onClick={() => void onRetryInitialLoad()}>{t.retry}</button></div>}
    {messageLoad.status === "loading" && messages.length === 0 && <ConversationSkeleton label={t.loadingConversation} />}
    {messageLoad.status === "error" && <div className="conversation-error" role="alert"><span><Icon name="alert" /> <strong>{t.conversationLoadFailed}</strong><small>{messageLoad.error}</small></span><button className="button ghost" onClick={onRetryMessages}>{t.retry}</button></div>}
    {messageLoad.status === "ready" && messages.length === 0 && !isWorking && <div className="empty-conversation"><span className="empty-glyph"><Icon name="spark" size={22} /></span><h2>{t.noMessages}</h2><p>{t.typeToStart}</p></div>}
    {(messageLoad.status === "ready" || messages.length > 0 || isWorking) && <MemoMessageTimeline
      messages={messages}
      language={language}
      running={isWorking}
      activeActivity={taskUi?.activity ?? []}
      streamText={streamText}
      workingPhase={workingPhase}
      toolName={taskUi?.toolName}
      completedActivity={taskUi?.completedActivity ?? []}
      steeringMessageKeys={steeringMessageKeys}
      taskId={task.id}
      scrollKey={scrollKey}
      active={active}
      messageReady={messageLoad.status === "ready"}
      conversationRef={paneRef}
      scrollPositionsRef={scrollPositionsRef}
      scrollHandleRef={scrollHandleRef}
      onAtEndChange={onTimelineAtEnd}
      footer={taskUi?.approval ? <ApprovalCard approval={taskUi.approval} language={language} onResolve={onResolveApproval} /> : null}
      onPreviewImage={onPreviewImage}
      onContextMenuImage={onContextMenuImage}
    />}
  </div>;
}

const MemoConversationPaneSlot = memo(ConversationPaneSlot, (previous, next) =>
  previous.active === next.active
  && previous.data === next.data
  && previous.language === next.language
  && previous.t === next.t
  && (!previous.active || previous.loadError === next.loadError)
);

interface ConversationPaneDeckProps extends Omit<ConversationPaneSlotProps, "data" | "active"> {
  activeData: ConversationPaneData | null;
  tasks: TaskSummary[];
  initialLoading: boolean;
  projectSwitching: boolean;
  projectCwd: string;
  onChooseProject: () => void | Promise<unknown>;
  onCreateTask: () => void | Promise<unknown>;
}

function ConversationPaneDeck({
  activeData, tasks, initialLoading, projectSwitching, projectCwd, t, loadError,
  onChooseProject, onCreateTask, ...paneProps
}: ConversationPaneDeckProps) {
  const activePaneKey = activeData ? conversationPaneKey(activeData.task.projectId, activeData.task.id) : null;
  // LRU limit keeps long sessions from pinning every visited pane's DOM
  // (Mermaid/KaTeX/highlighted code all stay mounted). Older panes fall back
  // to the saved { top, follow } snapshot when revisited.
  const MAX_CACHED_PANES = 5;
  const [cachedPaneKeys, setCachedPaneKeys] = useState<string[]>(() => activePaneKey ? [activePaneKey] : []);

  useLayoutEffect(() => {
    if (!activePaneKey) return;
    setCachedPaneKeys((current) => {
      const next = current.filter((key) => key !== activePaneKey);
      next.push(activePaneKey);
      return next.slice(-MAX_CACHED_PANES);
    });
  }, [activePaneKey]);

  // Keep visited panes mounted across project changes. The pane's own DOM
  // scrollTop is left untouched, so switching projects is a visibility change
  // instead of a remount/restore race.
  const paneKeys = activePaneKey && !cachedPaneKeys.includes(activePaneKey)
    ? [...cachedPaneKeys, activePaneKey]
    : cachedPaneKeys;

  return <div className="conversation-pane-stack">
    {paneKeys.map((paneKey) => <MemoConversationPaneSlot
      key={paneKey}
      {...paneProps}
      t={t}
      loadError={loadError}
      data={paneKey === activePaneKey ? activeData ?? undefined : undefined}
      active={paneKey === activePaneKey}
    />)}
    {!activeData && <div className="conversation-scroll conversation-pane is-active">
      {loadError && <div className="runtime-error" role="alert"><strong>{loadError}</strong><button onClick={() => void paneProps.onRetryInitialLoad()}>{t.retry}</button></div>}
      {initialLoading && <ConversationSkeleton label={t.loading} />}
      {!initialLoading && !loadError && projectSwitching && <div className="conversation-loading" role="status"><span className="conversation-spinner" aria-hidden="true" /><span>{t.loadingConversation}</span></div>}
      {!initialLoading && !loadError && !projectSwitching && !projectCwd && <div className="empty-conversation"><span className="empty-glyph"><Icon name="folder" size={22} /></span><h2>{t.noProjects}</h2><button className="button primary" onClick={() => void onChooseProject()}><Icon name="plus" size={14} />{t.openProject}</button></div>}
      {!initialLoading && !loadError && !projectSwitching && projectCwd && tasks.length > 0 && <div className="empty-conversation"><span className="empty-glyph"><Icon name="queue" size={22} /></span><h2>{t.selectSessionTitle}</h2><p>{t.selectSessionBody}</p><button className="button primary" onClick={() => void onCreateTask()}><Icon name="plus" size={14} />{t.newTask}</button></div>}
      {!initialLoading && !loadError && !projectSwitching && projectCwd && tasks.length === 0 && <div className="empty-conversation"><span className="empty-glyph"><Icon name="spark" size={22} /></span><h2>{t.noSessions}</h2><p>{t.createFirst}</p><button className="button primary" onClick={() => void onCreateTask()}><Icon name="plus" size={14} />{t.newTask}</button></div>}
    </div>}
  </div>;
}

export interface AppConversationProps {
  language: Language;
  t: AppCopy;
  scrollPositionsRef: { current: Record<string, ConversationScrollSnapshot> };
  scrollHandleRef: { current: ConversationScrollHandle | null };
  activeTask: TaskSummary | null;
  activeProject: ProjectSummary | null;
  projectCwd: string;
  tasks: TaskSummary[];
  initialLoading: boolean;
  projectSwitching: boolean;
  loadError: string | null;
  messageLoad: MessageLoad;
  messages: any[];
  isWorking: boolean;
  streamText: string;
  workingPhase: WorkingPhase;
  activeTaskUi: TaskUiState | undefined;
  steeringMessageKeys: string[];
  showJumpToLatest: boolean;
  permissionStatus: PermissionStatus | null;
  composerProps: ComposerProps;
  onTimelineAtEnd: (atEnd: boolean) => void;
  onRetryInitialLoad: () => void | Promise<unknown>;
  onChooseProject: () => void | Promise<unknown>;
  onCreateTask: () => void | Promise<unknown>;
  onRetryMessages: () => void;
  onJumpToLatest: () => void;
  onResolveApproval: (decision: "allow-once" | "deny") => Promise<void>;
  onPermissionStatus: (status: PermissionStatus) => void;
}

export function AppConversation({
  language, t, activeTask, activeProject, projectCwd, tasks, initialLoading, projectSwitching,
  scrollPositionsRef, scrollHandleRef,
  loadError, messageLoad, messages, isWorking, streamText, workingPhase, activeTaskUi,
  steeringMessageKeys, showJumpToLatest, permissionStatus, composerProps, onTimelineAtEnd,
  onRetryInitialLoad, onChooseProject, onCreateTask, onRetryMessages, onJumpToLatest,
  onResolveApproval, onPermissionStatus,
}: AppConversationProps) {
  const activeData = useMemo<ConversationPaneData | null>(() => activeTask ? {
    task: activeTask,
    messageLoad,
    messages,
    isWorking,
    streamText,
    workingPhase,
    taskUi: activeTaskUi,
    steeringMessageKeys,
  } : null, [activeTask, activeTaskUi, isWorking, messageLoad, messages, steeringMessageKeys, streamText, workingPhase]);

  return <>
    <main className="main-column" id="main-content" tabIndex={-1}>
      {activeTask && <div className="conversation-header"><div className="conversation-title"><div className="breadcrumb"><span>{activeProject?.name ?? "PiDeck"}</span><span>/</span><span>{activeTask.title ?? t.conversation}</span></div><h1>{activeTask.title ?? t.conversation}</h1></div></div>}
      <ConversationPaneDeck
        activeData={activeData}
        tasks={tasks}
        initialLoading={initialLoading}
        projectSwitching={projectSwitching}
        projectCwd={projectCwd}
        language={language}
        t={t}
        loadError={loadError}
        scrollPositionsRef={scrollPositionsRef}
        scrollHandleRef={scrollHandleRef}
        onTimelineAtEnd={onTimelineAtEnd}
        onRetryInitialLoad={onRetryInitialLoad}
        onChooseProject={onChooseProject}
        onCreateTask={onCreateTask}
        onRetryMessages={onRetryMessages}
        onResolveApproval={onResolveApproval}
        onPreviewImage={composerProps.onPreviewImage}
        onContextMenuImage={composerProps.onContextMenuImage}
      />
      <div className="composer-dock">
        {showJumpToLatest && <button className="jump-latest" onClick={onJumpToLatest}><Icon name="down" size={13} />{t.jumpToLatest}</button>}
        <MemoComposer {...composerProps} />
        <PermissionLevelControl language={language} status={permissionStatus} onStatus={onPermissionStatus} />
      </div>
    </main>
  </>;
}
