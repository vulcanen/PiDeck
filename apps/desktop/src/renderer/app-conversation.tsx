import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PermissionStatus } from "@pideck/contracts";
import type { ProjectSummary, TaskSummary } from "@pideck/domain";
import { copy, type Language } from "@pideck/i18n";
import { Icon } from "@pideck/ui-system";
import type { MessageLoad, TaskUiState, WorkingPhase } from "./types";
import type { ComposerProps } from "./ui-components";
import type { ConversationScrollHandle, ConversationScrollSnapshot } from "./use-conversation-scroll";
import { ApprovalCard, ConversationSkeleton, MemoComposer, MemoMessageTimeline, PermissionLevelControl } from "./ui-components";

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
  // Inactive panes keep their last data and DOM mounted. Their independent
  // scroll element remains at the exact browser-owned scrollTop, while the
  // virtualizer keeps only the small visible/overscan range in the DOM.
  const retainedDataRef = useRef<ConversationPaneData | undefined>(data);
  if (data) retainedDataRef.current = data;
  const retained = retainedDataRef.current;
  const paneRef = useRef<HTMLDivElement>(null);
  if (!retained) return null;

  const { task, messageLoad, messages, isWorking, streamText, workingPhase, taskUi, steeringMessageKeys } = retained;
  const scrollKey = conversationPaneKey(task.projectId, task.id);
  return <div
    ref={paneRef}
    className={`conversation-scroll conversation-pane ${active ? "is-active" : "is-inactive"}`}
    aria-hidden={!active}
  >
    {active && loadError && <div className="runtime-error" role="alert"><strong>{loadError}</strong><button onClick={() => void onRetryInitialLoad()}>{t.retry}</button></div>}
    {messageLoad.status === "loading" && messages.length === 0 && <ConversationSkeleton label={t.loadingConversation} />}
    {messageLoad.status === "error" && <div className="conversation-error" role="alert"><span><Icon name="alert" /> <strong>{t.conversationLoadFailed}</strong><small>{messageLoad.error}</small></span><button className="button ghost" onClick={onRetryMessages}>{t.retry}</button></div>}
    {messageLoad.status === "ready" && messages.length === 0 && !isWorking && <div className="empty-conversation"><span className="empty-glyph">P</span><h2>{t.noMessages}</h2><p>{t.typeToStart}</p></div>}
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
  projectCwd: string;
  onChooseProject: () => void | Promise<unknown>;
  onCreateTask: () => void | Promise<unknown>;
}

function ConversationPaneDeck({
  activeData, tasks, initialLoading, projectCwd, t, loadError,
  onChooseProject, onCreateTask, ...paneProps
}: ConversationPaneDeckProps) {
  const activePaneKey = activeData ? conversationPaneKey(activeData.task.projectId, activeData.task.id) : null;
  const [cachedPaneKeys, setCachedPaneKeys] = useState<string[]>(() => activePaneKey ? [activePaneKey] : []);

  useLayoutEffect(() => {
    if (!activePaneKey) return;
    setCachedPaneKeys((current) => current.includes(activePaneKey) ? current : [...current, activePaneKey]);
  }, [activePaneKey]);

  // Keep visited panes mounted across project changes. The pane's own DOM
  // scrollTop and virtualizer remain untouched, so switching projects is a
  // visibility change instead of a remount/restore race.
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
      {!initialLoading && !loadError && !projectCwd && <div className="empty-conversation"><span className="empty-glyph">P</span><h2>{t.noProjects}</h2><button className="button primary" onClick={() => void onChooseProject()}><Icon name="plus" size={14} />{t.openProject}</button></div>}
      {!initialLoading && !loadError && projectCwd && tasks.length > 0 && <div className="empty-conversation"><span className="empty-glyph">P</span><h2>{t.selectSessionTitle}</h2><p>{t.selectSessionBody}</p><button className="button primary" onClick={() => void onCreateTask()}><Icon name="plus" size={14} />{t.newTask}</button></div>}
      {!initialLoading && !loadError && projectCwd && tasks.length === 0 && <div className="empty-conversation"><span className="empty-glyph">P</span><h2>{t.noSessions}</h2><p>{t.createFirst}</p><button className="button primary" onClick={() => void onCreateTask()}><Icon name="plus" size={14} />{t.newTask}</button></div>}
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
  language, t, activeTask, activeProject, projectCwd, tasks, initialLoading,
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
      {showJumpToLatest && <button className="jump-latest" onClick={onJumpToLatest}><Icon name="down" size={13} />{t.jumpToLatest}</button>}
      <MemoComposer {...composerProps} />
      <PermissionLevelControl language={language} status={permissionStatus} onStatus={onPermissionStatus} />
    </main>
  </>;
}
