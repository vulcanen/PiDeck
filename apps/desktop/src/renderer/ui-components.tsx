import { Component, lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode, type RefObject } from "react";
import Editor from "react-simple-code-editor";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import type { AgentQueueState, AuthMethod, ContextUsage, ExtensionUiRequest, ModelSummary, PermissionMode, PermissionStatus, PiPackageSummary, ProviderSummary, QueueDelivery, QueueMode } from "@pideck/contracts";
import { parseSkillInvocation, type ProjectSummary, type TaskSummary } from "@pideck/domain";
import { copy, type Language } from "@pideck/i18n";
import { copyText, Icon, useDialogFocus } from "@pideck/ui-system";
import type { ActivityStep, AuthPromptState, ImageAttachment, PreviewImage, ProviderFilter, SuggestionMode, WorkingPhase } from "./types";
import { formatMessageTime, messageErrorText, messageIdentity, textFromMessage } from "./message-utils";
import { buildMessageTimelineItems } from "./timeline-utils";
import type { ConversationScrollHandle, ConversationScrollSnapshot } from "./use-conversation-scroll";

async function copyImageToClipboard(src: string): Promise<boolean> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
  try {
    const blob = await fetch(src).then((response) => response.blob());
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    return true;
  } catch { return false; }
}

function handleRovingMenuKeyDown(event: React.KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role='menuitem'], [role='menuitemradio']"));
  if (!items.length) return;
  const currentIndex = items.findIndex((item) => item === document.activeElement);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : event.key === "ArrowDown"
        ? (currentIndex + 1 + items.length) % items.length
        : (currentIndex - 1 + items.length) % items.length;
  event.preventDefault();
  items[nextIndex]?.focus();
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

export const MarkdownContent = memo(function MarkdownContent({ text, language }: { text: string; language: Language }) {
  return <div className="markdown-content"><Suspense fallback={<p>{text}</p>}><MarkdownRenderer text={text} language={language} /></Suspense></div>;
});
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
  return <div className={`task-row ${active ? "active" : ""}`} onContextMenu={onContextMenu}><button className="task-main" onClick={onClick} aria-current={active ? "page" : undefined} title={task.title}><span className="task-copy"><strong>{task.title}</strong></span>{task.state === "running" && <span className="task-working-spinner" role="img" aria-label={t.sessionState.running} title={t.sessionState.running} />}{task.state === "waiting-approval" && <span className="task-approval-mark" role="img" aria-label={t.sessionState.approval} title={t.sessionState.approval}>!</span>}{task.unread && <span className="unread-dot" role="img" aria-label={t.unread} title={t.unread} />}</button><button className="task-more" aria-label={t.moreActions} title={t.moreActions} onClick={(event) => { event.stopPropagation(); onMenu(event.currentTarget.getBoundingClientRect()); }}><Icon name="more" size={14} /></button></div>;
}

function MessageView({ message, language, onPreviewImage, onContextMenuImage }: { message: any; language: Language; onPreviewImage: (image: PreviewImage) => void; onContextMenuImage: (event: React.MouseEvent, image: PreviewImage) => void }) {
  const text = textFromMessage(message);
  const images = Array.isArray(message?.content) ? message.content.filter((part: any) => part?.type === "image" && part.data && part.mimeType) : [];
  const t = copy[language];
  const role = message?.role === "user" ? "user" : message?.role === "toolResult" ? "tool" : "assistant";
  const skillInvocation = role === "user" ? parseSkillInvocation(text) : null;
  const visibleText = skillInvocation ? skillInvocation.userMessage ?? "" : text;
  const errorText = messageErrorText(message);
  if (!visibleText && !skillInvocation && !images.length && !errorText && message?.role !== "toolResult") return null;
  if (role === "tool") {
    const toolName = message?.toolName ?? message?.name ?? t.toolResult;
    const failed = Boolean(message?.isError);
    return <div className={`tool-message ${failed ? "failed" : ""}`}><div className="tool-message-heading"><span className="tool-icon"><Icon name={failed ? "alert" : "terminal"} size={14} /></span><strong>{toolName}</strong><span>{failed ? t.sessionState.failed : t.sessionState.completed}</span></div><pre>{text || t.toolResult}</pre></div>;
  }
  const messageTime = formatMessageTime(message.timestamp, language);
  return <article className={`message ${role === "user" ? "user-message" : "assistant-message"}`} tabIndex={0}><div className="message-bubble"><div className="message-content">{skillInvocation && <div className="message-invocations"><code className="message-invocation">/skill:{skillInvocation.name}</code></div>}{images.length > 0 && <div className="message-images">{images.map((image: any, index: number) => <button type="button" className="image-preview-trigger" key={`${message.id ?? "image"}-${index}`} aria-label={t.imagePreview} onClick={() => onPreviewImage({ src: `data:${image.mimeType};base64,${image.data}`, alt: t.imageAttached })} onContextMenu={(event) => onContextMenuImage(event, { src: `data:${image.mimeType};base64,${image.data}`, alt: t.imageAttached })}><img src={`data:${image.mimeType};base64,${image.data}`} alt={t.imageAttached} /></button>)}</div>}{visibleText && <MarkdownContent text={visibleText} language={language} />}{errorText && <div className="message-error" role="alert"><span className="message-error-heading"><Icon name="alert" size={13} /><strong>{t.assistantResponseFailed}</strong></span><code>{errorText}</code></div>}</div></div>{messageTime && <div className="message-hover-meta"><time dateTime={new Date(message.timestamp).toISOString()}>{messageTime}</time></div>}</article>;
}

const MemoMessageView = memo(MessageView, (previous, next) => previous.message === next.message && previous.language === next.language && previous.onPreviewImage === next.onPreviewImage && previous.onContextMenuImage === next.onContextMenuImage);

function activityValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function formatActivityDuration(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function ExecutionSummary({ steps, language, running }: { steps: ActivityStep[]; language: Language; running: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || !steps.length) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running, steps.length]);
  if (!steps.length) return null;
  const t = copy[language];
  const startedAt = Math.min(...steps.map((step) => step.startedAt));
  const endedAt = running ? now : Math.max(...steps.map((step) => step.endedAt ?? step.startedAt));
  const persistedDurationMs = running ? undefined : steps.find((step) => Number.isFinite(step.durationMs))?.durationMs;
  const seconds = Math.max(0, (persistedDurationMs ?? endedAt - startedAt) / 1000);
  const duration = formatActivityDuration(seconds);
  // A restored group can have unknown per-step timing while its total run
  // duration is authoritative in the persisted metadata.
  const timingKnown = running || persistedDurationMs !== undefined || steps.every((step) => step.timing !== "unknown");
  return <details className="execution-summary" open={false}>
    <summary><span>{running ? t.executionProcessing(duration) : timingKnown ? t.executionProcessed(duration) : t.executionProcessedUnknown}</span><Icon name="chevron" size={13} /></summary>
    <div className="execution-details">
      {steps.map((step) => <div className={`execution-step ${step.isError ? "failed" : ""}`} key={step.id}>
        <div className="execution-step-heading"><span className="execution-step-icon"><Icon name={step.kind === "thinking" ? "spark" : step.isError ? "alert" : "terminal"} size={13} /></span><strong>{step.kind === "thinking" ? t.executionThinking : step.label}</strong><small>{step.timing === "unknown" ? "—" : step.endedAt ? `${((step.endedAt - step.startedAt) / 1000).toFixed(1)}s` : t.working}</small></div>
        {step.kind === "thinking" && step.detail && <pre>{step.detail}</pre>}
        {step.kind === "tool" && step.args !== undefined && <div className="execution-value"><span>{t.executionArguments}</span><pre>{activityValue(step.args)}</pre></div>}
        {step.kind === "tool" && step.result !== undefined && <div className="execution-value"><span>{t.executionResult}</span><pre>{activityValue(step.result)}</pre></div>}
      </div>)}
    </div>
  </details>;
}

interface MessageTimelineProps {
  messages: any[];
  language: Language;
  running: boolean;
  activeActivity: ActivityStep[];
  streamText: string;
  workingPhase: WorkingPhase;
  toolName?: string;
  completedActivity: ActivityStep[][];
  steeringMessageKeys: string[];
  taskId: string;
  scrollKey: string;
  active: boolean;
  messageReady: boolean;
  conversationRef: RefObject<HTMLDivElement | null>;
  scrollPositionsRef: { current: Record<string, ConversationScrollSnapshot> };
  scrollHandleRef: { current: ConversationScrollHandle | null };
  onAtEndChange: (atEnd: boolean) => void;
  footer?: ReactNode;
  onPreviewImage: (image: PreviewImage) => void;
  onContextMenuImage: (event: React.MouseEvent, image: PreviewImage) => void;
}

// Long conversations use TanStack Virtual's chat contract: dynamic row
// measurement, stable message keys, end anchoring, and follow-on-append.
// This component is the single owner of timeline scrolling. It snapshots both
// the virtualizer measurements and offset on unmount, then consumes them once
// as the next mount's initial state. No parent effect writes scrollTop.
function MessageTimeline({ messages, language, running, activeActivity, streamText, workingPhase, toolName, completedActivity, steeringMessageKeys, taskId, scrollKey, active, messageReady, conversationRef, scrollPositionsRef, scrollHandleRef, onAtEndChange, footer, onPreviewImage, onContextMenuImage }: MessageTimelineProps) {
  const items = useMemo(() => buildMessageTimelineItems({ messages, language, running, completedActivity, steeringMessageKeys, taskId, liveText: streamText, activeActivity, workingPhase, toolName }), [activeActivity, completedActivity, language, messages, running, steeringMessageKeys, streamText, taskId, toolName, workingPhase]);
  const count = items.length + (footer ? 1 : 0);
  const initialSnapshotRef = useRef<ConversationScrollSnapshot | undefined>(scrollPositionsRef.current[scrollKey]);
  const initializedRef = useRef(false);
  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, HTMLDivElement> | null>(null);
  const userScrollOverrideRef = useRef(false);
  const getScrollElement = useCallback(() => conversationRef.current, [conversationRef]);
  const getItemKey = useCallback((index: number) => {
    if (index >= items.length) return `footer-${taskId}`;
    const item = items[index];
    if (item.type === "execution") return item.stableKey ?? `execution-${item.steps[0]?.id ?? item.index}`;
    if (item.type === "live") return item.stableKey;
    return item.stableKey ?? messageIdentity(item.message) ?? `message-${item.index}`;
  }, [items, taskId]);
  const handleVirtualizerChange = useCallback((instance: Virtualizer<HTMLDivElement, HTMLDivElement>, sync: boolean) => {
    const previous = scrollPositionsRef.current[scrollKey];
    const element = conversationRef.current;
    const measurements = sync
      ? previous?.measurements ?? initialSnapshotRef.current?.measurements ?? []
      : instance.takeSnapshot();
    const follow = element
      ? Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop) <= 80
      : instance.isAtEnd();
    const effectiveFollow = userScrollOverrideRef.current ? false : follow;
    scrollPositionsRef.current[scrollKey] = {
      // The browser owns the physical scroll position. TanStack's internal
      // offset can temporarily include an anchor adjustment while a measured
      // row settles; persisting that value makes each task switch drift a few
      // pixels farther down. Prefer the actual DOM scrollTop whenever it exists.
      top: conversationRef.current?.scrollTop ?? instance.scrollOffset ?? 0,
      follow: effectiveFollow,
      measurements,
    };
    if (active) onAtEndChange(effectiveFollow);
  }, [active, conversationRef, onAtEndChange, scrollKey, scrollPositionsRef]);

  // This cleanup is intentionally declared before useVirtualizer's own layout
  // effects. React runs layout cleanups in declaration order, so it captures
  // the offset and end state while TanStack is still attached to the shared
  // scroll element.
  useLayoutEffect(() => () => {
    const instance = virtualizerRef.current;
    const element = conversationRef.current;
    const previous = scrollPositionsRef.current[scrollKey];
    const domFollow = element
      ? Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop) <= 80
      : false;
    scrollPositionsRef.current[scrollKey] = {
      top: element?.scrollTop ?? instance?.scrollOffset ?? previous?.top ?? 0,
      follow: instance ? instance.isAtEnd() : previous?.follow ?? domFollow,
      measurements: instance?.takeSnapshot() ?? previous?.measurements ?? initialSnapshotRef.current?.measurements ?? [],
    };
  }, [conversationRef, scrollKey, scrollPositionsRef]);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement,
    estimateSize: (index) => index >= items.length ? 80 : items[index]?.type === "execution" ? 56 : 120,
    getItemKey,
    measureElement: (element) => element.getBoundingClientRect().height,
    // When switching to a cached task, defer restoring its offset until the
    // fresh message snapshot is ready. Applying the old offset to stale row
    // heights is what causes a small cumulative drift in variable-height
    // conversations after each switch.
    // A task without a snapshot is being opened for the first time. Seed the
    // virtualizer at an intentionally oversized offset so the browser clamps
    // it to the real bottom during TanStack's own mount pass. Starting at 0
    // and calling scrollToEnd only afterwards can render the first range and
    // let that top position win before the scroll container is measured.
    initialOffset: messageReady
      ? initialSnapshotRef.current && !initialSnapshotRef.current.follow
        ? initialSnapshotRef.current.top
        : Number.MAX_SAFE_INTEGER
      : 0,
    initialMeasurementsCache: messageReady ? initialSnapshotRef.current?.measurements ?? [] : [],
    overscan: 6,
    anchorTo: "end",
    followOnAppend: "auto",
    scrollEndThreshold: 80,
    onChange: handleVirtualizerChange,
  });
  virtualizerRef.current = virtualizer;
  const renderedItems = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    if (initializedRef.current || !messageReady || count === 0) return;
    initializedRef.current = true;
    const initial = initialSnapshotRef.current;
    if (!initial || initial.follow) {
      virtualizer.scrollToEnd();
      // Re-assert the initial latest position after the first browser layout.
      // This catches a zero-sized flex viewport during Electron's startup
      // without changing later user-controlled positions.
      const frame = window.requestAnimationFrame(() => virtualizer.scrollToEnd());
      return () => window.cancelAnimationFrame(frame);
    } else {
      // The scroll element is intentionally shared between task mounts. TanStack
      // restores its internal offset from `initialOffset`, but an existing DOM
      // scrollTop can still win during the first layout pass. Re-apply the
      // historical offset after the new measurements are installed so switching
      // away from a task at the bottom cannot force this task to the bottom too.
      virtualizer.scrollToOffset(initial.top, { behavior: "auto" });
      if (active) onAtEndChange(false);
    }
  }, [active, count, messageReady, onAtEndChange, virtualizer]);

  // A streaming response grows an existing virtual row instead of appending
  // a new row. Keep the viewport at the latest content while the user is
  // following the conversation; once they scroll away, the saved `follow`
  // flag prevents the assistant from pulling them back down.
  useLayoutEffect(() => {
    if (!active || !messageReady || !items.length || !scrollPositionsRef.current[scrollKey]?.follow) return;
    const frame = window.requestAnimationFrame(() => {
      if (scrollPositionsRef.current[scrollKey]?.follow) virtualizer.scrollToEnd({ behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, items.length, messageReady, messages, scrollKey, scrollPositionsRef, streamText, taskId, virtualizer]);

  useLayoutEffect(() => {
    if (!active) return;
    onAtEndChange(virtualizer.isAtEnd());
    const handle: ConversationScrollHandle = {
      scrollToLatest: (behavior) => {
        userScrollOverrideRef.current = false;
        virtualizer.scrollToEnd({ behavior });
        onAtEndChange(true);
      },
    };
    scrollHandleRef.current = handle;
    return () => {
      if (scrollHandleRef.current === handle) scrollHandleRef.current = null;
    };
  }, [active, onAtEndChange, scrollHandleRef, virtualizer]);

  // Keep the task snapshot and the jump affordance in sync with the browser's
  // actual scrollTop as well as TanStack's virtual offset. This covers a wheel
  // event that lands before the virtualizer publishes its next range and avoids
  // losing the user's position when they switch tasks immediately afterward.
  const handleNativeScroll = useCallback(() => {
    const element = conversationRef.current;
    if (!element) return;
    const previous = scrollPositionsRef.current[scrollKey];
    const top = element.scrollTop;
    const movingAwayFromEnd = previous ? top < previous.top - 1 : false;
    const follow = Math.max(0, element.scrollHeight - element.clientHeight - top) <= 80;
    if (movingAwayFromEnd) userScrollOverrideRef.current = true;
    else if (follow) userScrollOverrideRef.current = false;
    const effectiveFollow = userScrollOverrideRef.current ? false : follow;
    scrollPositionsRef.current[scrollKey] = {
      top,
      // A user-initiated upward wheel gesture must opt out of end-following
      // immediately, even while still inside the 80px end threshold. Without
      // this distinction the next virtualizer measurement snaps the wheel
      // back to the bottom and feels like scroll resistance.
      follow: effectiveFollow,
      measurements: previous?.measurements ?? initialSnapshotRef.current?.measurements ?? [],
    };
    if (active) onAtEndChange(effectiveFollow);
  }, [active, conversationRef, onAtEndChange, scrollKey, scrollPositionsRef]);

  useLayoutEffect(() => {
    const element = conversationRef.current;
    if (!element) return;
    element.addEventListener("scroll", handleNativeScroll, { passive: true, capture: true });
    return () => element.removeEventListener("scroll", handleNativeScroll, true);
  }, [conversationRef, handleNativeScroll]);

  const renderItem = useCallback((index: number) => {
    if (index >= items.length) return footer;
    const item = items[index];
    return item.type === "execution"
      ? <ExecutionSummary steps={item.steps} language={language} running={Boolean(item.running)} />
      : item.type === "live"
        ? <article className="message assistant-message live-message"><div className="live-message-status">{item.text ? <span className="live-pill"><span className="live-dot" />{copy[language].working}</span> : null}</div>{item.text ? <div className="message-content"><MarkdownContent text={item.text} language={language} /></div> : <WorkingIndicator language={language} phase={item.phase} toolName={item.toolName} />}</article>
      : <MemoMessageView message={item.message} language={language} onPreviewImage={onPreviewImage} onContextMenuImage={onContextMenuImage} />;
  }, [footer, items, language, onContextMenuImage, onPreviewImage]);

  if (count === 0) return null;
  return <div className="timeline-virtual-host" style={{ height: virtualizer.getTotalSize() }}>
    {renderedItems.map((virtualItem) => <div
      key={virtualItem.key}
      ref={virtualizer.measureElement}
      data-index={virtualItem.index}
      className="timeline-item"
      style={{ transform: `translateY(${virtualItem.start}px)` }}
    >{renderItem(virtualItem.index)}</div>)}
  </div>;
}

const MemoMessageTimeline = memo(MessageTimeline, (previous, next) => previous.messages === next.messages && previous.language === next.language && previous.running === next.running && previous.activeActivity === next.activeActivity && previous.streamText === next.streamText && previous.workingPhase === next.workingPhase && previous.toolName === next.toolName && previous.completedActivity === next.completedActivity && previous.steeringMessageKeys === next.steeringMessageKeys && previous.taskId === next.taskId && previous.scrollKey === next.scrollKey && previous.active === next.active && previous.messageReady === next.messageReady && previous.conversationRef === next.conversationRef && previous.scrollPositionsRef === next.scrollPositionsRef && previous.scrollHandleRef === next.scrollHandleRef && previous.onAtEndChange === next.onAtEndChange && previous.footer === next.footer && previous.onPreviewImage === next.onPreviewImage && previous.onContextMenuImage === next.onContextMenuImage);

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

function ContextRingPopover({ usage, language }: { usage?: ContextUsage; language: Language }) {
  const t = copy[language];
  const percent = usage?.percent === null || usage?.percent === undefined ? 0 : Math.max(0, Math.min(100, usage.percent));
  const circumference = 2 * Math.PI * 8;
  const dash = circumference * percent / 100;
  const percentLabel = usage?.percent === null || usage?.percent === undefined ? t.contextUnknown : `${Math.round(percent)}% ${t.contextUsed}`;
  const totalLabel = usage?.tokens === null || usage?.tokens === undefined || usage?.contextWindow === null || usage?.contextWindow === undefined
    ? t.contextUnknown
    : `${formatTokenCount(usage.tokens)} / ${formatTokenCount(usage.contextWindow)} ${t.tokenUnit}`;
  return <span className="context-ring-wrap" tabIndex={0} aria-label={usage?.percent === null || usage?.percent === undefined ? t.contextUsage : `${t.contextUsage}, ${Math.round(percent)}%`}>
    <span className="context-ring"><svg viewBox="0 0 20 20" aria-hidden="true"><circle className="context-ring-track" cx="10" cy="10" r="8" /><circle className="context-ring-progress" cx="10" cy="10" r="8" strokeDasharray={`${dash} ${circumference - dash}`} /></svg></span>
    <span className="context-tooltip" role="tooltip"><strong>{t.contextWindow}</strong><span className="context-percentage">{percentLabel}</span><span className="context-total">{totalLabel}</span></span>
  </span>;
}

function PermissionLevelControl({ language, status, onStatus }: { language: Language; status: PermissionStatus | null; onStatus: (status: PermissionStatus) => void }) {
  const t = copy[language];
  const modes: Array<{ id: PermissionMode; label: string; description: string }> = [
    { id: "ask", label: t.permissionModeAsk, description: t.permissionModeAskDescription },
    { id: "allow", label: t.permissionModeAllow, description: t.permissionModeAllowDescription },
    { id: "deny", label: t.permissionModeDeny, description: t.permissionModeDenyDescription },
    { id: "yolo", label: t.permissionModeYolo, description: t.permissionModeYoloDescription },
  ];
  const current = modes.find((mode) => mode.id === status?.mode) ?? modes[0];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function changeMode(mode: PermissionMode) {
    setBusy(true); setError(null);
    try { onStatus(await window.pideck.permissions.setMode(mode)); setOpen(false); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => { if (event.target instanceof Element && !event.target.closest(".permission-level-wrap")) setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  return <div className="permission-level-wrap"><button type="button" className="permission-level-button" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((value) => !value)}><span className={`permission-mode-dot ${current.id}`} /><span>{current.label}</span><Icon name="chevron" size={13} /></button>{open && <div className="permission-level-menu" role="menu" aria-label={current.label} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); } else handleRovingMenuKeyDown(event); }}>{modes.map((mode) => <button type="button" role="menuitemradio" aria-checked={mode.id === current.id} tabIndex={mode.id === current.id ? 0 : -1} autoFocus={mode.id === current.id} key={mode.id} className={mode.id === current.id ? "selected" : ""} onClick={() => void changeMode(mode.id)}><span className={`permission-mode-dot ${mode.id}`} /><span><strong>{mode.label}</strong><small>{mode.description}</small></span><Icon name="check" size={13} /></button>)}</div>}{error && <span className="permission-level-error" role="alert">{error}</span>}</div>;
}

function WorkingIndicator({ language, phase, toolName }: { language: Language; phase: WorkingPhase; toolName?: string }) {
  const t = copy[language];
  const label = phase === "tool" ? toolName ? t.toolRunning(toolName) : t.toolStatus : phase === "responding" ? t.respondingStatus : phase === "compacting" ? t.compactingStatus : t.thinkingStatus;
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
  return <div className="approval-card" role="alert"><div className="approval-top"><div className="approval-title"><span className="approval-icon"><Icon name="terminal" size={15} /></span><div><strong>{t.approval}</strong><small>{t.approvalRequest(approval.toolName)}</small></div></div><span className="approval-tool-label">{t.toolCall}</span></div><div className="command-preview"><span className="prompt-symbol">$</span><code>{JSON.stringify(approval.args ?? {}, null, 2)}</code></div>{error && <div className="inline-error" role="alert">{error}</div>}<div className="approval-actions"><button className="button primary" disabled={resolving} onClick={() => void resolve("allow-once")}><Icon name="check" size={14} />{t.approve}</button><button className="button ghost" disabled={resolving} onClick={() => void resolve("deny")}><Icon name="x" size={14} />{t.reject}</button><span className="approval-scope">{resolving ? t.loading : t.approvalScope}</span></div></div>;
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
    const isSkill = token.startsWith("/skill:");
    const isMention = token.startsWith("@");
    result.push(<mark className={`composer-token ${isSkill ? "skill-token" : isMention ? "mention-token" : "command-token"}`} key={`token-${start}`}>{token}</mark>);
    cursor = start + match[0].length;
  }
  if (cursor < value.length) result.push(<span key={`text-${cursor}`}>{value.slice(cursor)}</span>);
  return result;
}

export type ComposerProps = { sessionKey: string; value: string; onChange: (value: string) => void; onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void; onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void; onSend: () => void; onStop: () => void; isSending: boolean; language: Language; activeModel: ModelSummary | null; modelOptions: ModelSummary[]; thinkingLevel: string; thinkingLevels: string[]; thinkingMenuOpen: boolean; modelMenuOpen: boolean; suggestionMode: SuggestionMode; suggestions: any[]; suggestionIndex: number; contextUsage?: ContextUsage; commandNames: string[]; attachments: ImageAttachment[]; onRemoveAttachment: (id: string) => void; onPreviewImage: (image: PreviewImage) => void; onContextMenuImage: (event: React.MouseEvent, image: PreviewImage) => void; onThinkingMenu: () => void; onModelMenu: () => void; onThinking: (level: string) => void; onModel: (model: ModelSummary) => void; onSuggestion: (item: any) => void; onTerminal: () => void; queueDelivery: QueueDelivery; queueState: AgentQueueState | null; queueMutationBusy: boolean; onQueueDelivery: (delivery: QueueDelivery) => void; onQueueModes: (modes: { steeringMode?: QueueMode; followUpMode?: QueueMode }) => void; onClearQueue: () => void; onPromoteQueue: (followUpIndex: number) => void };

function Composer(props: ComposerProps) {
  const t = copy[props.language];
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const queueMenuRef = useRef<HTMLDivElement>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [queueMenuOpen, setQueueMenuOpen] = useState(false);
  const filteredModels = props.modelOptions.filter((model) => `${model.providerName} ${model.name}`.toLowerCase().includes(modelQuery.toLowerCase()));
  const activeModelIndex = filteredModels.findIndex((model) => model.id === props.activeModel?.id && model.providerId === props.activeModel?.providerId);
  useEffect(() => { suggestionRefs.current[props.suggestionIndex]?.scrollIntoView({ block: "nearest" }); }, [props.suggestionIndex, props.suggestions.length, props.suggestionMode]);
  useEffect(() => { if (!props.modelMenuOpen) setModelQuery(""); }, [props.modelMenuOpen]);
  useEffect(() => {
    if (!queueMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !queueMenuRef.current?.contains(event.target)) setQueueMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [queueMenuOpen]);
  useLayoutEffect(() => {
    const root = editorRootRef.current;
    const textarea = root?.querySelector<HTMLTextAreaElement>("textarea");
    const highlight = root?.querySelector<HTMLElement>("pre");
    if (!textarea || !highlight) return;
    const syncScroll = () => {
      // The highlight layer is not the editable viewport. Translate it with
      // the textarea instead of giving it an independent scroll position.
      highlight.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    };
    const selection = pendingSelectionRef.current;
    if (selection && textarea.value === props.value) {
      textarea.setSelectionRange(
        Math.min(selection.start, props.value.length),
        Math.min(selection.end, props.value.length),
      );
      pendingSelectionRef.current = null;
    }
    syncScroll();
    const frame = window.requestAnimationFrame(syncScroll);
    textarea.addEventListener("scroll", syncScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      textarea.removeEventListener("scroll", syncScroll);
    };
  }, [props.value]);
  const handleEditorValueChange = (value: string) => {
    const textarea = editorRootRef.current?.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea) pendingSelectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
    props.onChange(value);
  };
  const queuedMessages = [
    ...(props.queueState?.steering ?? []).map((message, queueIndex) => ({ message, kind: "steering" as const, queueIndex })),
    ...(props.queueState?.followUp ?? []).map((message, queueIndex) => ({ message, kind: "followUp" as const, queueIndex })),
  ];
  const hasDraft = props.value.trim().length > 0 || props.attachments.length > 0;
  const stopOnly = props.isSending && !hasDraft;
  const handleEditorPaste: React.ClipboardEventHandler<HTMLElement> = (event) => props.onPaste(event as unknown as React.ClipboardEvent<HTMLTextAreaElement>);
  const handleEditorKeyDown: React.KeyboardEventHandler<HTMLElement> = (event) => props.onKeyDown(event as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
  return <div className="composer-wrap"><div className="composer-shell">
    {queuedMessages.length > 0 && <section className="composer-queue" aria-live="polite" aria-label={t.queuedMessages}>
      <div className="composer-queue-header"><Icon name="queue" size={14} /><strong>{t.queuedMessages}</strong><span>{queuedMessages.length}</span></div>
      <div className="composer-queue-list">{queuedMessages.map((item, index) => <article className="composer-queue-item" key={`${item.kind}-${index}-${item.message}`}><span className="composer-queue-index">{index + 1}</span><p>{item.message}</p>{item.kind === "followUp" ? <button type="button" className="composer-queue-promote" disabled={props.queueMutationBusy} onClick={() => props.onPromoteQueue(item.queueIndex)}>{props.queueMutationBusy ? t.loading : t.queuePromote}</button> : <span className="composer-queue-status" role="status">{t.queueSteeringStatus}</span>}</article>)}</div>
    </section>}
    {props.suggestionMode && props.suggestions.length > 0 && <div className="suggestion-popover" role="listbox" id="composer-suggestions" aria-label={props.suggestionMode === "mention" ? t.files : t.command}>{props.suggestions.map((item, index) => <button id={`composer-suggestion-${index}`} ref={(element) => { suggestionRefs.current[index] = element; }} key={item.name ?? item.path} type="button" role="option" aria-selected={index === props.suggestionIndex} className={index === props.suggestionIndex ? "selected" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => props.onSuggestion(item)}><span className="suggestion-symbol">{props.suggestionMode === "mention" ? "@" : "/"}</span><span><strong>{item.name ?? item.path}</strong><small>{item.description ?? item.path}</small></span></button>)}</div>}
    <div className="composer">{props.attachments.length > 0 && <div className="composer-attachments">{props.attachments.map((image) => <div className="composer-attachment" key={image.id}><button type="button" className="composer-image-preview" aria-label={t.imagePreview} title={t.imagePreview} onClick={() => props.onPreviewImage({ src: `data:${image.mimeType};base64,${image.data}`, alt: image.name || t.imageAttached })} onContextMenu={(event) => props.onContextMenuImage(event, { src: `data:${image.mimeType};base64,${image.data}`, alt: image.name || t.imageAttached })}><img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name || t.imageAttached} /></button><button type="button" className="composer-remove-image" aria-label={t.removeImage} title={t.removeImage} onClick={() => props.onRemoveAttachment(image.id)}><Icon name="x" size={11} /></button></div>)}</div>}<div ref={editorRootRef} className="composer-editor"><Editor className="composer-editor-surface" style={{ display: "block", width: "100%" }} value={props.value} onValueChange={handleEditorValueChange} highlight={(code) => <>{code ? highlightComposerText(code, props.commandNames) : <span className="composer-placeholder">{t.ask}</span>}</>} textareaClassName="composer-editor-input" preClassName="composer-highlight" padding={0} onPaste={handleEditorPaste} onKeyDown={handleEditorKeyDown} autoFocus placeholder="" aria-label={t.ask} aria-controls="composer-suggestions" aria-activedescendant={props.suggestionMode && props.suggestions.length ? `composer-suggestion-${props.suggestionIndex}` : undefined} aria-expanded={Boolean(props.suggestionMode && props.suggestions.length)} /></div><div className="composer-footer"><div className="composer-tools">
      <div className="menu-anchor"><button className="chip" title={t.chooseThinking} aria-haspopup="menu" aria-controls="thinking-menu" aria-expanded={props.thinkingMenuOpen} onClick={props.onThinkingMenu}><Icon name="spark" size={14} /><span>{props.thinkingLevel}</span><Icon name="chevron" size={13} /></button>{props.thinkingMenuOpen && <div className="inline-menu" id="thinking-menu" role="menu" aria-label={t.chooseThinking} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); props.onThinkingMenu(); } else handleRovingMenuKeyDown(event); }}><strong>{t.chooseThinking}</strong>{props.thinkingLevels.map((level, index) => <button role="menuitemradio" aria-checked={level === props.thinkingLevel} tabIndex={level === props.thinkingLevel || (!props.thinkingLevels.includes(props.thinkingLevel) && index === 0) ? 0 : -1} autoFocus={level === props.thinkingLevel || (!props.thinkingLevels.includes(props.thinkingLevel) && index === 0)} key={level} className={level === props.thinkingLevel ? "active" : ""} onClick={() => props.onThinking(level)}>{level}</button>)}</div>}</div>
      <div className="menu-anchor"><button className="model-chip" title={t.chooseModel} aria-haspopup="menu" aria-controls="model-menu" aria-expanded={props.modelMenuOpen} onClick={props.onModelMenu}><Icon name="model" size={14} /><span className="model-provider">{props.activeModel?.providerName ?? t.provider}</span><span>{props.activeModel?.name ?? (props.modelOptions.length ? t.chooseModel : t.models)}</span><ContextRingPopover usage={props.contextUsage} language={props.language} /><Icon name="chevron" size={13} /></button>{props.modelMenuOpen && <div className="inline-menu model-menu" id="model-menu" role="menu" aria-label={t.models} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); props.onModelMenu(); } else handleRovingMenuKeyDown(event); }}><label className="model-search"><Icon name="search" size={13} /><input autoFocus value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder={t.searchModels} aria-label={t.searchModels} /></label>{filteredModels.length === 0 ? <span className="menu-empty">{props.modelOptions.length ? t.noMatchingCommands : t.configureProvider}</span> : filteredModels.map((model, index) => <button role="menuitemradio" aria-checked={model.id === props.activeModel?.id && model.providerId === props.activeModel?.providerId} tabIndex={index === (activeModelIndex >= 0 ? activeModelIndex : 0) ? 0 : -1} key={`${model.providerId}/${model.id}`} className={model.id === props.activeModel?.id && model.providerId === props.activeModel?.providerId ? "active" : ""} onClick={() => props.onModel(model)}><span><strong>{model.name}</strong><small>{model.providerName}</small></span><Icon name="check" size={12} /></button>)}</div>}</div>
      <button className="chip subtle" aria-label={t.mentionLabel} title={t.mentionLabel} onClick={() => props.onChange(`${props.value}${props.value ? " " : ""}@`)}><Icon name="plus" size={14} />@</button>
      <div ref={queueMenuRef} className="menu-anchor"><button className="chip subtle" title={t.queueMode} aria-haspopup="menu" aria-controls="queue-menu" aria-expanded={queueMenuOpen} onClick={() => setQueueMenuOpen((current) => !current)}><Icon name="queue" size={13} /><span>{props.queueDelivery === "steer" ? t.steering : t.followUp}</span>{props.queueState && (props.queueState.steering.length + props.queueState.followUp.length) > 0 && <small>{props.queueState.steering.length + props.queueState.followUp.length}</small>}<Icon name="chevron" size={13} /></button>{queueMenuOpen && <div className="inline-menu" id="queue-menu" role="menu" aria-label={t.queueMode}><strong>{t.queueDelivery}</strong><button role="menuitemradio" aria-checked={props.queueDelivery === "steer"} className={props.queueDelivery === "steer" ? "active" : ""} onClick={() => { props.onQueueDelivery("steer"); setQueueMenuOpen(false); }}>{t.steering}</button><button role="menuitemradio" aria-checked={props.queueDelivery === "followUp"} className={props.queueDelivery === "followUp" ? "active" : ""} onClick={() => { props.onQueueDelivery("followUp"); setQueueMenuOpen(false); }}>{t.followUp}</button>{props.queueState && <><strong>{t.queueBatchMode}</strong><button role="menuitem" onClick={() => props.onQueueModes({ steeringMode: "all", followUpMode: "all" })}>{t.queueAll}</button><button role="menuitem" onClick={() => props.onQueueModes({ steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" })}>{t.queueOneAtATime}</button>{(props.queueState.steering.length + props.queueState.followUp.length) > 0 && <button role="menuitem" disabled={props.queueMutationBusy} onClick={() => { props.onClearQueue(); setQueueMenuOpen(false); }}>{t.clearQueue}</button>}</>}</div>}</div>
      <button className="chip subtle terminal-trigger" onClick={props.onTerminal}><Icon name="terminal" size={13} />{t.terminal}</button>
    </div><span className="composer-hint">{t.shiftEnter}</span><button className="send-button" disabled={!props.isSending && !hasDraft} aria-label={stopOnly ? t.stop : t.send} title={stopOnly ? t.stop : t.send} onClick={stopOnly ? props.onStop : props.onSend}><Icon name={stopOnly ? "stop" : "send"} size={16} /></button></div></div>
  </div></div>;
}

const MemoComposer = memo(Composer, (previous, next) =>
  previous.sessionKey === next.sessionKey
  && previous.value === next.value
  && previous.isSending === next.isSending
  && previous.language === next.language
  && previous.activeModel === next.activeModel
  && previous.modelOptions === next.modelOptions
  && previous.thinkingLevel === next.thinkingLevel
  && previous.thinkingLevels === next.thinkingLevels
  && previous.thinkingMenuOpen === next.thinkingMenuOpen
  && previous.modelMenuOpen === next.modelMenuOpen
  && previous.suggestionMode === next.suggestionMode
  && previous.suggestions === next.suggestions
  && previous.suggestionIndex === next.suggestionIndex
  && previous.contextUsage === next.contextUsage
  && previous.commandNames === next.commandNames
  && previous.attachments === next.attachments
  && previous.queueDelivery === next.queueDelivery
  && previous.queueState === next.queueState
  && previous.queueMutationBusy === next.queueMutationBusy
);

function TerminalPanel({ language, cwd, output, command, running, onCommand, onExecute, onClose }: { language: Language; cwd: string; output: string[]; command: string; running: boolean; onCommand: (value: string) => void; onExecute: () => void; onClose: () => void }) {
  const t = copy[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (followRef.current && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [output]);
  return <section className="terminal-float" role="dialog" aria-modal="false" aria-label={t.terminal}><div className="terminal-float-header"><span><Icon name="terminal" size={14} />{t.terminal}</span><small>{cwd} · {t.terminalRuntime}</small><button className="icon-button" onClick={onClose} aria-label={t.closeTerminal} title={t.closeTerminal}><Icon name="x" size={14} /></button></div><div ref={outputRef} className="terminal-output" role="log" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40; }}>{output.length === 0 ? <div className="terminal-muted">{t.terminalEmpty}</div> : output.map((line, index) => <pre className="terminal-line" key={`${index}-${line.slice(0, 20)}`}>{line}</pre>)}</div><form className="terminal-input-row" onSubmit={(event) => { event.preventDefault(); onExecute(); }}><span className="terminal-green">›</span><input ref={inputRef} value={command} onChange={(event) => onCommand(event.target.value)} placeholder={t.terminalPlaceholder} aria-label={t.terminalPlaceholder} disabled={running} /><span className="terminal-running">{running ? "…" : ""}</span></form></section>;
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

function CommandPalette({ language, commands, shortcut, onCommand, onClose, onNewTask, onTerminal, onSettings, onPackages, onCompact, onExport }: { language: Language; commands: Array<{ name: string; description?: string; source?: string }>; shortcut: (key: string) => string; onCommand: (command: { name: string }) => void; onClose: () => void; onNewTask: () => void; onTerminal: () => void; onSettings: () => void; onPackages: () => void; onCompact?: () => void; onExport?: (format: "jsonl" | "html") => void }) {
  const t = copy[language];
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useDialogFocus(dialogRef, onClose);
  const quickItems = [
    { id: "new-task", label: t.newTask, description: shortcut("N"), action: onNewTask, icon: "plus" },
    { id: "terminal", label: t.terminal, description: shortcut("J"), action: onTerminal, icon: "terminal" },
    { id: "provider", label: t.provider, description: shortcut(","), action: onSettings, icon: "settings" },
    { id: "packages", label: t.packageManager, description: t.packageManagerDescription, action: onPackages, icon: "package" },
    ...(onCompact ? [{ id: "compact", label: t.compactContext, description: t.compactContext, action: onCompact, icon: "spark" }] : []),
    ...(onExport ? [{ id: "export-jsonl", label: t.exportJsonl, description: t.exportJsonl, action: () => onExport("jsonl"), icon: "file" }, { id: "export-html", label: t.exportHtml, description: t.exportHtml, action: () => onExport("html"), icon: "file" }] : []),
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

function ImagePreview({ image, language, onClose, onContextMenuImage }: { image: PreviewImage; language: Language; onClose: () => void; onContextMenuImage: (event: React.MouseEvent, image: PreviewImage) => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  return <div className="image-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="image-preview-dialog" role="dialog" aria-modal="true" aria-label={t.imagePreview}><button type="button" className="icon-button image-preview-close" onClick={onClose} aria-label={t.closeImagePreview} title={t.closeImagePreview}><Icon name="x" /></button><img src={image.src} alt={image.alt} onContextMenu={(event) => onContextMenuImage(event, image)} /></div></div>;
}

function CommandResultDialog({ language, title, body, onClose }: { language: Language; title: string; body: string; onClose: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  return <div className="dialog-backdrop"><div ref={dialogRef} className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby="command-result-title"><span className="eyebrow">Pi</span><h2 id="command-result-title">{title}</h2><p>{body}</p><div className="dialog-actions"><button type="button" className="button primary" onClick={onClose}>{t.commandResultClose}</button></div></div></div>;
}

function RenameSessionDialog({ language, currentName, onSave, onClose }: { language: Language; currentName: string; onSave: (name: string) => void; onClose: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(currentName);
  const [invalid, setInvalid] = useState(false);
  useDialogFocus(dialogRef, onClose);
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form ref={dialogRef} className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-session-title" onSubmit={(event) => { event.preventDefault(); const next = value.trim(); if (!next) { setInvalid(true); return; } onSave(next); }}><span className="eyebrow">Pi</span><h2 id="rename-session-title">{t.sessionNamePrompt}</h2><label className="session-name-field"><span>{t.sessionNamePrompt}</span><input autoFocus type="text" value={value} onChange={(event) => { setValue(event.target.value); setInvalid(false); }} /></label>{invalid && <div className="field-error" role="alert">{t.sessionNameRequired}</div>}<div className="dialog-actions"><button type="button" className="button ghost" onClick={onClose}>{t.cancel}</button><button type="submit" className="button primary">{t.save}</button></div></form></div>;
}

function ResumeSessionDialog({ language, project, tasks, activeTaskId, onSelect, onClose }: { language: Language; project: ProjectSummary | null; tasks: TaskSummary[]; activeTaskId?: string; onSelect: (task: TaskSummary) => void; onClose: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  return <div className="dialog-backdrop"><div ref={dialogRef} className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby="resume-title"><span className="eyebrow">Pi</span><h2 id="resume-title">{t.resumeTitle}</h2><p>{t.resumeDescription}</p>{!project || tasks.length === 0 ? <p>{t.noSessions}</p> : <div className="resume-list">{tasks.map((task) => <button type="button" className={`resume-row${task.id === activeTaskId ? " selected" : ""}`} key={task.id} onClick={() => onSelect(task)}><strong>{task.title}</strong><small>{task.model}</small></button>)}</div>}<div className="dialog-actions"><button type="button" className="button ghost" onClick={onClose}>{t.cancel}</button></div></div></div>;
}

function TrustDialog({ language, onResolve, onClose }: { language: Language; onResolve: (trusted: boolean) => void; onClose: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  return <div className="dialog-backdrop"><div ref={dialogRef} className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby="trust-title"><span className="eyebrow">Pi</span><h2 id="trust-title">{t.trustTitle}</h2><p>{t.trustDescription}</p><div className="dialog-actions"><button type="button" className="button ghost" onClick={() => onResolve(false)}>{t.untrustProject}</button><button type="button" className="button primary" onClick={() => onResolve(true)}>{t.trustProject}</button></div></div></div>;
}

function ScopedModelsDialog({ language, models, selectedIds, onSave, onClose }: { language: Language; models: ModelSummary[]; selectedIds: string[]; onSave: (modelIds: string[] | null, persist: boolean) => void; onClose: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(() => new Set(selectedIds));
  const [persist, setPersist] = useState(false);
  useDialogFocus(dialogRef, onClose);
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const allSelected = models.length > 0 && selected.size === models.length;
  return <div className="dialog-backdrop"><div ref={dialogRef} className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby="scoped-models-title"><span className="eyebrow">Pi</span><h2 id="scoped-models-title">{t.scopedModelsTitle}</h2><p>{t.scopedModelsDescription}</p><div className="model-scope-list">{models.map((model) => { const id = `${model.providerId}/${model.id}`; return <label key={id} className="model-scope-row"><input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} /><span><strong>{model.name}</strong><small>{id}</small></span></label>; })}</div><label className="model-scope-persist"><input type="checkbox" checked={persist} onChange={(event) => setPersist(event.target.checked)} />{t.scopedModelsPersist}</label><div className="dialog-actions"><button type="button" className="button ghost" onClick={onClose}>{t.cancel}</button><button type="button" className="button primary" disabled={models.length === 0} onClick={() => onSave(allSelected || selected.size === 0 ? null : [...selected], persist)}>{t.scopedModelsSave}</button></div></div></div>;
}

function ExtensionUiDialog({ language, request, onResolve }: { language: Language; request: ExtensionUiRequest; onResolve: (value: string | boolean | undefined) => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => setValue(request.prefill ?? ""), [request.requestId, request.prefill]);
  useDialogFocus(dialogRef, () => onResolve(request.kind === "confirm" ? false : undefined));
  const titleParts = request.title.split(/\r?\n/);
  return <div className="dialog-backdrop"><div ref={dialogRef} className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby="extension-ui-title"><span className="eyebrow">Pi Extension</span><h2 id="extension-ui-title">{titleParts[0]}</h2>{titleParts.slice(1).map((line, index) => <p key={index}>{line}</p>)}{request.message && <p>{request.message}</p>}{request.kind === "select" && <div className="extension-ui-options">{(request.options ?? []).map((option) => <button type="button" className="button ghost" key={option} onClick={() => onResolve(option)}>{option}</button>)}</div>}{request.kind === "confirm" && <div className="dialog-actions"><button type="button" className="button ghost" onClick={() => onResolve(false)}>{t.reject}</button><button type="button" className="button primary" onClick={() => onResolve(true)}>{t.approve}</button></div>}{(request.kind === "input" || request.kind === "editor") && <><textarea autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} rows={request.kind === "editor" ? 8 : 3} /><div className="dialog-actions"><button type="button" className="button ghost" onClick={() => onResolve(undefined)}>{t.cancel}</button><button type="button" className="button primary" onClick={() => onResolve(value)}>{t.submit}</button></div></>}</div></div>;
}

function ImageContextMenu({ language, x, y, onCopy }: { language: Language; x: number; y: number; onCopy: () => void }) {
  const t = copy[language];
  return <div className="image-context-menu" role="menu" aria-label={t.copyImage} style={{ left: x, top: y }} onKeyDown={handleRovingMenuKeyDown} onClick={(event) => event.stopPropagation()}><button type="button" role="menuitem" autoFocus onClick={onCopy}><Icon name="copy" size={13} />{t.copyImage}</button></div>;
}

function ConfirmDialog({ language, task, busy, onCancel, onConfirm }: { language: Language; task: TaskSummary; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, () => { if (!busy) onCancel(); });
  return <div className="dialog-backdrop"><div ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description"><span className="confirm-icon"><Icon name="alert" /></span><h2 id="delete-title">{t.deleteSessionTitle}</h2><p id="delete-description">{t.deleteSessionBody(task.title)}</p><div><button className="button ghost" disabled={busy} onClick={onCancel}>{t.cancel}</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? t.deleting : t.deleteSession}</button></div></div></div>;
}

function ProjectRemoveDialog({ language, project, busy, onCancel, onConfirm }: { language: Language; project: ProjectSummary; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, () => { if (!busy) onCancel(); });
  return <div className="dialog-backdrop"><div ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="project-remove-title" aria-describedby="project-remove-description"><span className="confirm-icon"><Icon name="alert" /></span><h2 id="project-remove-title">{t.removeProjectTitle}</h2><p id="project-remove-description">{t.removeProjectBody(project.name)}</p><div><button className="button ghost" disabled={busy} onClick={onCancel}>{t.cancel}</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? t.removingProject : t.removeProject}</button></div></div></div>;
}

function PackageSettings({ language, cwd, onClose, onNotice, onPackagesChanged }: { language: Language; cwd: string; onClose: () => void; onNotice: (message: string) => void; onPackagesChanged?: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLElement>(null);
  const [packages, setPackages] = useState<PiPackageSummary[]>([]);
  const [source, setSource] = useState("");
  const [local, setLocal] = useState(Boolean(cwd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadVersionRef = useRef(0);
  useDialogFocus(dialogRef, onClose);
  async function load() {
    const loadVersion = ++loadVersionRef.current;
    const requestCwd = cwd || undefined;
    setError(null);
    try {
      const next = await window.pideck.packages.list(requestCwd);
      if (loadVersion === loadVersionRef.current) setPackages(next);
    }
    catch (reason) { if (loadVersion === loadVersionRef.current) setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  useEffect(() => { void load(); }, [cwd]);
  async function run(action: () => Promise<void>, successMessage: string = t.packageManager) {
    setBusy(true); setError(null);
    try { await action(); onPackagesChanged?.(); await load(); setSource(""); onNotice(successMessage); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <div className="settings-backdrop"><section ref={dialogRef} className="settings-sheet package-settings" role="dialog" aria-modal="true" aria-labelledby="package-title"><div className="settings-header"><div><span className="eyebrow">Pi</span><h2 id="package-title">{t.packageManager}</h2><p>{t.packageManagerDescription}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label={t.closeSettings}><Icon name="x" /></button></div><form className="package-install-form" onSubmit={(event) => { event.preventDefault(); if (source.trim()) void run(() => window.pideck.packages.install(source.trim(), local, cwd || undefined), t.packageInstalled); }}><input value={source} onChange={(event) => setSource(event.target.value)} placeholder={t.packageSource} aria-label={t.packageSource} /><label><input type="checkbox" checked={local} onChange={(event) => setLocal(event.target.checked)} />{local ? t.packageLocal : t.packageUser}</label><button type="submit" className="button primary" disabled={busy || !source.trim()}>{busy ? t.packageBusy : t.packageInstall}</button></form>{error && <div className="auth-error" role="alert"><span>{error}</span><button type="button" className="button ghost" onClick={() => void load()}>{t.retry}</button></div>}<div className="package-list">{packages.length === 0 ? <div className="provider-list-empty">{t.noPackages}</div> : packages.map((item) => <div className="package-row" key={`${item.scope}:${item.source}`}><div><strong>{item.source}</strong><small>{item.scope === "project" ? t.packageLocal : t.packageUser}{item.installedPath ? ` · ${item.installedPath}` : ""}</small></div><div className="package-actions"><button type="button" className="button ghost" disabled={busy} onClick={() => void run(() => window.pideck.packages.configure(item.source, item.disabled, item.scope === "project", cwd || undefined), item.disabled ? t.packageEnabled : t.packageDisabled)}>{item.disabled ? t.packageConfigure : t.packageDisable}</button><button type="button" className="button danger-subtle" disabled={busy} onClick={() => void run(() => window.pideck.packages.remove(item.source, item.scope === "project", cwd || undefined), t.packageRemoved)}>{t.packageRemove}</button></div></div>)}</div><div className="settings-footer"><button type="button" className="button ghost" disabled={busy} onClick={() => void run(() => window.pideck.packages.update(undefined, cwd || undefined), t.packageUpdated)}>{t.packageUpdate}</button><button type="button" className="button ghost" onClick={onClose}>{t.done}</button></div></section></div>;
}

function ProviderSettings({ language, focusProviderId, onClose, onModelsRefresh }: { language: Language; focusProviderId: string | null; onClose: () => void; onModelsRefresh: (providerId?: string) => Promise<void> | void }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [providerStates, setProviderStates] = useState<Record<string, ProviderSummary["authState"]>>({});
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [, setAuthMethod] = useState<AuthMethod | null>(null);
  const [apiKeyProvider, setApiKeyProvider] = useState<string | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [authPrompt, setAuthPrompt] = useState<AuthPromptState | null>(null);
  const [providerQuery, setProviderQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [pendingLogout, setPendingLogout] = useState<ProviderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const dialogRef = useRef<HTMLElement>(null);
  const authPromptRef = useRef<HTMLFormElement>(null);
  const logoutPromptRef = useRef<HTMLDivElement>(null);
  const t = copy[language];
  const normalizedProviderQuery = providerQuery.trim().toLocaleLowerCase();
  const filteredProviders = useMemo(() => providers.filter((provider) => {
    const state = providerStates[provider.id] ?? provider.authState;
    const matchesQuery = !normalizedProviderQuery || `${provider.name} ${provider.id}`.toLocaleLowerCase().includes(normalizedProviderQuery);
    const matchesFilter = providerFilter === "all" || (providerFilter === "missing" ? state === "missing" || state === "available" : state === providerFilter);
    return matchesQuery && matchesFilter;
  }), [normalizedProviderQuery, providerFilter, providerStates, providers]);

  function closeApiKeyForm() { setApiKeyProvider(null); setApiKeyValue(""); }
  async function resolvePrompt(value: string) {
    if (!authPrompt) return;
    const requestId = authPrompt.requestId;
    try { await window.pideck.providers.resolveAuth(requestId, value); }
    catch (error) { setAuthError(error instanceof Error ? error.message : String(error)); return; }
    setAuthPrompt(null);
    setAuthError(null);
  }
  async function cancelAuthPrompt() {
    if (!authPrompt) return;
    const requestId = authPrompt.requestId;
    try { await window.pideck.providers.resolveAuth(requestId, "", true); } catch { /* the login request will surface its cancellation result */ }
    setAuthPrompt(null);
    setAuthError(null);
    setAuthMethod(null);
  }
  useDialogFocus(dialogRef, () => {
    if (apiKeyProvider) { closeApiKeyForm(); return; }
    onClose();
  }, !authPrompt && !pendingLogout);
  useDialogFocus(authPromptRef, () => void cancelAuthPrompt(), Boolean(authPrompt));
  useDialogFocus(logoutPromptRef, () => { if (!busyProvider) setPendingLogout(null); }, Boolean(pendingLogout));

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
    setProviderQuery("");
    setProviderFilter("all");
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-provider-id="${CSS.escape(focusProviderId)}"]`)?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [focusProviderId, providers]);
  useEffect(() => window.pideck.events.subscribe((runtimeEvent) => {
    if (runtimeEvent.type !== "auth.event" || !runtimeEvent.requestId) return;
    const event = runtimeEvent.event as any;
    if (event?.type === "prompt") {
      setAuthError(null);
      setAuthNotice(null);
      setAuthUrl(null);
      const promptType = event.prompt?.type === "select" || event.prompt?.type === "secret" || event.prompt?.type === "manual_code" ? event.prompt.type : "text";
      const options = Array.isArray(event.prompt?.options)
        ? event.prompt.options.filter((option: any) => typeof option?.id === "string" && typeof option?.label === "string").map((option: any) => ({ id: option.id, label: option.label, description: typeof option.description === "string" ? option.description : undefined }))
        : undefined;
      setAuthPrompt({ requestId: runtimeEvent.requestId, type: promptType, message: event.prompt?.message ?? t.authPromptFallback, placeholder: event.prompt?.placeholder ?? "", value: "", options });
    }
    else if (event?.type === "notify" && event.event?.type === "auth_url") {
      setAuthUrl(null); setAuthNotice(null);
      if (event.event.url) void window.pideck.providers.openAuthUrl(event.event.url).catch(() => undefined);
    } else if (event?.type === "notify" && event.event?.type === "device_code") {
      setAuthUrl(null); setAuthNotice(null);
      if (event.event.verificationUri) void window.pideck.providers.openAuthUrl(event.event.verificationUri).catch(() => undefined);
    }
  }), [language]);

  async function auth(providerId: string, method: AuthMethod, secret?: string) {
    if (method === "api-key" && !secret?.trim()) { setFieldErrors((current) => ({ ...current, [providerId]: t.apiKeyRequired })); return; }
    setBusyProvider(providerId); setAuthMethod(method); setAuthError(null); setAuthNotice(null); setAuthUrl(null); setFieldErrors((current) => ({ ...current, [providerId]: undefined }));
    try {
      if (method === "api-key") await window.pideck.providers.setApiKey(providerId, secret!.trim());
      else await window.pideck.providers.login(providerId, method);
      closeApiKeyForm(); setAuthNotice(null); setAuthError(null); setAuthMethod(null); await loadProviders(); await onModelsRefresh(providerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (method === "api-key") setFieldErrors((current) => ({ ...current, [providerId]: message }));
      else setAuthError(message);
    } finally { setBusyProvider(null); if (method !== "oauth") setAuthMethod(null); }
  }

  async function logout(providerId: string) {
    setBusyProvider(providerId); setAuthError(null);
    try { await window.pideck.providers.logout(providerId); setPendingLogout(null); await loadProviders(); await onModelsRefresh(providerId); }
    catch (error) { setAuthError(error instanceof Error ? error.message : String(error)); }
    finally { setBusyProvider(null); }
  }

  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyProvider) onClose(); }}><section ref={dialogRef} className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="provider-title"><div className="settings-header"><div><span className="eyebrow">{t.localRuntime}</span><h2 id="provider-title">{t.providerAuthTitle}</h2></div><button className="icon-button" onClick={onClose} aria-label={t.closeSettings} title={t.closeSettings}><Icon name="x" /></button></div><div className="locality-note"><span className="status-dot" /><span>{t.localCredentials}</span></div>{!authPrompt && authNotice && <div className="auth-notice" role="status"><div>{authNotice}</div>{authUrl && <button className="button primary" onClick={() => void window.pideck.providers.openAuthUrl(authUrl)}>{t.openBrowser}</button>}</div>}{!authPrompt && authError && <div className="auth-error" role="alert"><div className="auth-error-copy">{authError}</div><div className="auth-error-actions">{authUrl && <button className="button primary" onClick={() => void window.pideck.providers.openAuthUrl(authUrl)}>{t.openBrowser}</button>}<button className="button ghost" onClick={() => { setAuthError(null); void loadProviders(); }}>{t.retry}</button></div></div>}
    {!loading && !listError && providers.length > 0 && <div className="provider-tools"><label className="provider-search"><Icon name="search" size={14} /><input value={providerQuery} onChange={(event) => setProviderQuery(event.target.value)} placeholder={t.providerSearch} aria-label={t.providerSearch} /></label><div className="provider-filters" role="group" aria-label={t.providerAuthTitle}>{(["all", "configured", "expired", "missing"] as ProviderFilter[]).map((filter) => <button type="button" key={filter} aria-pressed={providerFilter === filter} onClick={() => setProviderFilter(filter)}>{filter === "all" ? t.providerFilterAll : filter === "configured" ? t.providerFilterConfigured : filter === "expired" ? t.providerFilterExpired : t.providerFilterMissing}</button>)}</div></div>}
    <div className="provider-list">{loading ? <div className="provider-loading" role="status"><i /><i /><i /></div> : listError ? <div className="provider-list-error" role="alert"><span>{listError}</span><button className="button ghost" onClick={() => void loadProviders()}>{t.retry}</button></div> : providers.length === 0 ? <div className="provider-list-error"><span>{t.noProviders}</span></div> : filteredProviders.length === 0 ? <div className="provider-list-empty"><Icon name="search" size={17} /><span>{t.providerNoMatches}</span></div> : filteredProviders.map((provider) => { const state = providerStates[provider.id] ?? provider.authState; const expanded = apiKeyProvider === provider.id; const oauthLocked = state === "configured"; return <div className={`provider-card ${expanded ? "expanded" : ""} ${focusProviderId === provider.id ? "focused" : ""}`} data-provider-id={provider.id} key={provider.id}><div className="provider-main"><div className="provider-logo">{provider.name.slice(0, 1)}</div><div className="provider-copy"><div><strong>{provider.name}</strong><span className={`provider-state ${state}`}><span className="status-dot" />{state === "configured" ? t.configured : state === "expired" ? t.expired : t.missing}</span></div><small>{provider.id} · {t.providerModels(provider.modelCount)}</small></div><div className="provider-actions">{state === "configured" && <button className="button danger-subtle" disabled={busyProvider === provider.id} onClick={() => setPendingLogout(provider)}>{t.removeProviderAuth}</button>}{provider.authMethods.includes("oauth") && <button className="button primary" disabled={busyProvider === provider.id || oauthLocked} onClick={() => void auth(provider.id, "oauth")}>{busyProvider === provider.id ? t.authorizing : t.oauth}</button>}{provider.authMethods.includes("api-key") && <button className="button ghost" aria-expanded={expanded} aria-controls={`api-key-${provider.id}`} disabled={busyProvider === provider.id} onClick={() => { if (expanded) closeApiKeyForm(); else { setApiKeyProvider(provider.id); setApiKeyValue(""); setAuthNotice(null); setAuthUrl(null); setFieldErrors((current) => ({ ...current, [provider.id]: undefined })); } }}>{t.apiKey}</button>}</div></div>{expanded && <form id={`api-key-${provider.id}`} className="api-key-form" onSubmit={(event) => { event.preventDefault(); void auth(provider.id, "api-key", apiKeyValue); }}><label htmlFor={`api-key-input-${provider.id}`}><strong>{t.apiKey}</strong><small>{provider.name}</small></label><div className="api-key-controls"><input id={`api-key-input-${provider.id}`} type="password" autoFocus value={apiKeyValue} onChange={(event) => setApiKeyValue(event.target.value)} placeholder={t.enterApiKey} aria-describedby={fieldErrors[provider.id] ? `api-key-error-${provider.id}` : undefined} /><button className="button primary" disabled={!apiKeyValue.trim() || busyProvider === provider.id} type="submit">{busyProvider === provider.id ? t.saving : t.save}</button><button className="button ghost" type="button" onClick={closeApiKeyForm}>{t.cancel}</button></div>{fieldErrors[provider.id] && <div id={`api-key-error-${provider.id}`} className="field-error" role="alert">{fieldErrors[provider.id]}</div>}</form>}</div>; })}</div>
    <div className="settings-footer"><span>{providers.length ? providerQuery || providerFilter !== "all" ? t.providerFilteredCount(filteredProviders.length, providers.length) : t.providerCount(providers.length) : ""}</span><button className="button ghost" onClick={onClose}>{t.done}</button></div>
    {pendingLogout && <div className="auth-prompt-backdrop"><div ref={logoutPromptRef} className="auth-prompt provider-logout-prompt" role="alertdialog" aria-modal="true" aria-labelledby="provider-logout-title" aria-describedby="provider-logout-description"><span className="confirm-icon"><Icon name="alert" /></span><h3 id="provider-logout-title">{t.removeProviderAuthTitle(pendingLogout.name)}</h3><p id="provider-logout-description">{t.removeProviderAuthBody(pendingLogout.name)}</p><div><button type="button" className="button ghost" disabled={busyProvider === pendingLogout.id} onClick={() => setPendingLogout(null)}>{t.cancel}</button><button type="button" className="button danger" disabled={busyProvider === pendingLogout.id} onClick={() => void logout(pendingLogout.id)}>{busyProvider === pendingLogout.id ? t.removingProviderAuth : t.removeProviderAuth}</button></div></div></div>}
    {authPrompt && <div className="auth-prompt-backdrop"><form ref={authPromptRef} className="auth-prompt" role="alertdialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); if (authPrompt.type !== "select") void resolvePrompt(authPrompt.value); }}><h3>{t.authPromptTitle}</h3><p>{authPrompt.message}</p>{authError && <div className="inline-error" role="alert">{authError}</div>}{authPrompt.type === "select" ? <div className="auth-prompt-options">{(authPrompt.options ?? []).map((option) => <button key={option.id} type="button" className="button ghost auth-prompt-option" onClick={() => void resolvePrompt(option.id)}><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</button>)}</div> : <label><span>{authPrompt.placeholder || t.authPromptFallback}</span><input autoFocus type={authPrompt.type === "secret" ? "password" : "text"} value={authPrompt.value} onChange={(event) => setAuthPrompt((current) => current ? { ...current, value: event.target.value } : current)} /></label>}<div><button type="button" className="button ghost" onClick={() => void cancelAuthPrompt()}>{t.cancel}</button>{authPrompt.type !== "select" && <button type="submit" className="button primary" disabled={!authPrompt.value}>{t.submit}</button>}</div></form></div>}
  </section></div>;
}


export { handleRovingMenuKeyDown, copyImageToClipboard, SidebarSkeleton, ConversationSkeleton, StateMark, TaskRow, MessageView, ExecutionSummary, MemoMessageTimeline, ContextRing, ContextRingPopover, PermissionLevelControl, WorkingIndicator, ApprovalCard, Composer, MemoComposer, TerminalPanel, CommandPaletteBoundary, CommandPalette, ImagePreview, CommandResultDialog, RenameSessionDialog, ResumeSessionDialog, TrustDialog, ScopedModelsDialog, ExtensionUiDialog, ImageContextMenu, ConfirmDialog, ProjectRemoveDialog, PackageSettings, ProviderSettings };
