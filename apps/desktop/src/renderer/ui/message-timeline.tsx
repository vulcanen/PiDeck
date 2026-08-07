import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { copy, type Language } from "@pideck/i18n";
import type { ActivityStep, PreviewImage, WorkingPhase } from "../types";
import { messageIdentity } from "../message-utils";
import { buildMessageTimelineItems } from "../timeline-utils";
import type { ConversationScrollHandle, ConversationScrollSnapshot } from "../use-conversation-scroll";
import { ExecutionSummary } from "./execution-summary";
import { MarkdownContent } from "./markdown";
import { MemoMessageView } from "./message-view";
import { WorkingIndicator } from "./working-indicator";

// Rows render in plain document flow, matching how ChatGPT and Claude desktop
// render their transcripts. Virtualization was removed deliberately: agent
// messages contain asynchronously sized content (Mermaid SVG, KaTeX, syntax
// highlighting) whose height is unknown until after paint, which permanently
// fights any measurement cache and produced jumping, overlap and rubber-banding.
//
// What a plain list still needs is a ceiling on mounted nodes, otherwise very
// long sessions exhaust the renderer heap. Only the newest FOLD_WINDOW items
// stay mounted; older ones sit behind a "show earlier" affordance.
const FOLD_WINDOW = 200;
const FOLD_STEP = 200;
// Distance from the bottom that still counts as reading the latest message.
const FOLLOW_THRESHOLD = 80;

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

// This component is the single owner of timeline scrolling. Position is owned
// by the browser: the scroll element keeps its own scrollTop across task
// switches (inactive panes are `visibility: hidden`, never unmounted), and the
// container enables native scroll anchoring so a diagram resolving above the
// viewport does not move what the reader is looking at.
function MessageTimeline({ messages, language, running, activeActivity, streamText, workingPhase, toolName, completedActivity, steeringMessageKeys, taskId, scrollKey, active, messageReady, conversationRef, scrollPositionsRef, scrollHandleRef, onAtEndChange, footer, onPreviewImage, onContextMenuImage }: MessageTimelineProps) {
  const items = useMemo(() => buildMessageTimelineItems({ messages, language, running, completedActivity, steeringMessageKeys, taskId, liveText: streamText, activeActivity, workingPhase, toolName }), [activeActivity, completedActivity, language, messages, running, steeringMessageKeys, streamText, taskId, toolName, workingPhase]);
  const initialSnapshotRef = useRef<ConversationScrollSnapshot | undefined>(scrollPositionsRef.current[scrollKey]);
  const initializedRef = useRef(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Following is left by an actual input gesture, never by inferring direction
  // from scrollTop. Content routinely *shrinks* (a live row is replaced by the
  // final message, the working indicator disappears, an execution summary
  // collapses), and a delta-based guess reads that as "the user scrolled up"
  // and silently kills auto-scroll.
  const userScrollOverrideRef = useRef(false);
  const touchActiveRef = useRef(false);
  // True while a programmatic scroll-to-latest is in flight. A smooth scroll
  // reports "not at the bottom" for its whole duration, which would flash the
  // jump-to-latest button back on mid-animation.
  const pinningRef = useRef(false);
  const pinningTimeoutRef = useRef<number | null>(null);

  // Only the trailing window is mounted. Because it is measured from the end,
  // a growing conversation always keeps the newest messages rendered without
  // ever touching this state.
  const [visibleCount, setVisibleCount] = useState(FOLD_WINDOW);
  const firstVisibleIndex = Math.max(0, items.length - visibleCount);
  const hiddenCount = firstVisibleIndex;

  const getItemKey = useCallback((index: number) => {
    const item = items[index];
    if (!item) return `item-${index}`;
    if (item.type === "execution") return item.stableKey ?? `execution-${item.steps[0]?.id ?? item.index}`;
    if (item.type === "live") return item.stableKey;
    return item.stableKey ?? messageIdentity(item.message) ?? `message-${item.index}`;
  }, [items]);

  const pinToBottom = useCallback(() => {
    const element = conversationRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [conversationRef]);

  const setFollow = useCallback((follow: boolean) => {
    const element = conversationRef.current;
    const previous = scrollPositionsRef.current[scrollKey];
    scrollPositionsRef.current[scrollKey] = { top: element?.scrollTop ?? previous?.top ?? 0, follow };
    if (active) onAtEndChange(follow);
  }, [active, conversationRef, onAtEndChange, scrollKey, scrollPositionsRef]);

  const endPinning = useCallback(() => {
    pinningRef.current = false;
    if (pinningTimeoutRef.current === null) return;
    window.clearTimeout(pinningTimeoutRef.current);
    pinningTimeoutRef.current = null;
  }, []);

  const beginPinning = useCallback(() => {
    pinningRef.current = true;
    if (pinningTimeoutRef.current !== null) window.clearTimeout(pinningTimeoutRef.current);
    // Safety valve: a smooth scroll interrupted before it reaches the bottom
    // must never leave following latched on.
    pinningTimeoutRef.current = window.setTimeout(() => {
      pinningTimeoutRef.current = null;
      pinningRef.current = false;
    }, 1000);
  }, []);

  useLayoutEffect(() => endPinning, [endPinning]);

  // An upward wheel/trackpad gesture opts out of following immediately, even
  // while still inside the bottom threshold. Writing the flag here rather than
  // waiting for the scroll event closes the window in which a pending pin could
  // yank the reader back down, which is what made scrolling up feel springy.
  const handleWheel = useCallback((event: WheelEvent) => {
    if (event.deltaY >= 0) return;
    endPinning();
    if (userScrollOverrideRef.current) return;
    userScrollOverrideRef.current = true;
    setFollow(false);
  }, [endPinning, setFollow]);

  const handleTouchStart = useCallback(() => { touchActiveRef.current = true; }, []);
  const handleTouchEnd = useCallback(() => { touchActiveRef.current = false; }, []);

  const handleNativeScroll = useCallback(() => {
    const element = conversationRef.current;
    if (!element) return;
    const previous = scrollPositionsRef.current[scrollKey];
    const top = element.scrollTop;
    const nearBottom = Math.max(0, element.scrollHeight - element.clientHeight - top) <= FOLLOW_THRESHOLD;
    // Touch input emits no wheel events, so a finger drag is the one case where
    // direction still has to be inferred. It is safe here because a programmatic
    // pin can never happen while a touch is down.
    if (touchActiveRef.current && previous && top < previous.top - 1) { userScrollOverrideRef.current = true; endPinning(); }
    else if (nearBottom) { userScrollOverrideRef.current = false; endPinning(); }
    const follow = userScrollOverrideRef.current ? false : nearBottom || pinningRef.current;
    scrollPositionsRef.current[scrollKey] = { top, follow };
    if (active) onAtEndChange(follow);
  }, [active, conversationRef, endPinning, onAtEndChange, scrollKey, scrollPositionsRef]);

  useLayoutEffect(() => {
    const element = conversationRef.current;
    if (!element) return;
    element.addEventListener("scroll", handleNativeScroll, { passive: true, capture: true });
    element.addEventListener("wheel", handleWheel, { passive: true });
    element.addEventListener("touchstart", handleTouchStart, { passive: true });
    element.addEventListener("touchend", handleTouchEnd, { passive: true });
    element.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    return () => {
      element.removeEventListener("scroll", handleNativeScroll, true);
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [conversationRef, handleNativeScroll, handleTouchEnd, handleTouchStart, handleWheel]);

  // First paint of a task: land on the latest message, or restore the offset
  // this task was left at. Runs once; later task switches are pure visibility
  // changes and the browser has already preserved the pane's scrollTop.
  useLayoutEffect(() => {
    if (initializedRef.current || !messageReady || items.length === 0) return;
    initializedRef.current = true;
    const element = conversationRef.current;
    if (!element) return;
    const initial = initialSnapshotRef.current;
    if (!initial || initial.follow) {
      pinToBottom();
      // Re-assert after the first browser layout. This catches a zero-sized
      // flex viewport during Electron startup without moving a user-chosen
      // position later on.
      const frame = window.requestAnimationFrame(pinToBottom);
      return () => window.cancelAnimationFrame(frame);
    }
    element.scrollTop = initial.top;
    if (active) onAtEndChange(false);
  }, [active, conversationRef, items.length, messageReady, onAtEndChange, pinToBottom]);

  // Streaming grows the last row in place and new turns append rows. Either way
  // a following reader stays pinned to the newest content.
  useLayoutEffect(() => {
    if (!active || !messageReady) return;
    if (!scrollPositionsRef.current[scrollKey]?.follow) return;
    pinToBottom();
  }, [active, footer, items, messageReady, pinToBottom, scrollKey, scrollPositionsRef, streamText]);

  // Mermaid and KaTeX finish rendering after the layout effects above, so the
  // transcript keeps growing once React is done. Re-pin on those late resizes.
  // Readers who are not following are handled by native scroll anchoring.
  useLayoutEffect(() => {
    const element = conversationRef.current;
    const host = hostRef.current;
    if (!element || !host) return;
    let previousHeight = host.getBoundingClientRect().height;
    const observer = new ResizeObserver(() => {
      const nextHeight = host.getBoundingClientRect().height;
      if (Math.abs(nextHeight - previousHeight) < 1) return;
      previousHeight = nextHeight;
      if (scrollPositionsRef.current[scrollKey]?.follow) pinToBottom();
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [conversationRef, pinToBottom, scrollKey, scrollPositionsRef]);

  useLayoutEffect(() => {
    if (!active) return;
    onAtEndChange(scrollPositionsRef.current[scrollKey]?.follow ?? true);
    const handle: ConversationScrollHandle = {
      scrollToLatest: (behavior) => {
        userScrollOverrideRef.current = false;
        beginPinning();
        const element = conversationRef.current;
        if (behavior === "smooth" && element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
        else pinToBottom();
        // Record the intent, not just the position. `sendPrompt` calls this
        // before the optimistic message exists, so this flag is what keeps the
        // viewport pinned once the new rows actually render.
        setFollow(true);
      },
    };
    scrollHandleRef.current = handle;
    return () => {
      if (scrollHandleRef.current === handle) scrollHandleRef.current = null;
    };
  }, [active, conversationRef, onAtEndChange, pinToBottom, scrollHandleRef, scrollKey, scrollPositionsRef, setFollow]);

  // Revealing older messages inserts content above the viewport. Native scroll
  // anchoring keeps the reader's current row visually fixed, so no manual
  // offset compensation happens here on purpose: doing both would double-correct
  // and reintroduce the jump this replaces.
  const showEarlier = useCallback(() => setVisibleCount((current) => current + FOLD_STEP), []);

  const renderItem = useCallback((index: number) => {
    const item = items[index];
    if (!item) return null;
    return item.type === "execution"
      ? <ExecutionSummary steps={item.steps} language={language} running={Boolean(item.running)} />
      : item.type === "live"
        ? <article className="message assistant-message live-message"><div className="live-message-status">{item.text ? <span className="live-pill"><span className="live-dot" />{copy[language].working}</span> : null}</div>{item.text ? <div className="message-content"><MarkdownContent text={item.text} language={language} /></div> : <WorkingIndicator language={language} phase={item.phase} toolName={item.toolName} />}</article>
        : <MemoMessageView message={item.message} language={language} onPreviewImage={onPreviewImage} onContextMenuImage={onContextMenuImage} />;
  }, [items, language, onContextMenuImage, onPreviewImage]);

  const visibleIndexes = useMemo(() => {
    const list: number[] = [];
    for (let index = firstVisibleIndex; index < items.length; index += 1) list.push(index);
    return list;
  }, [firstVisibleIndex, items.length]);

  if (items.length === 0 && !footer) return null;
  return <div className="timeline-list" ref={hostRef}>
    {hiddenCount > 0 && <button type="button" className="timeline-show-earlier" onClick={showEarlier}>
      {language === "zh" ? `查看更早的 ${hiddenCount} 条消息` : `Show ${hiddenCount} earlier message${hiddenCount === 1 ? "" : "s"}`}
    </button>}
    {visibleIndexes.map((index) => <div key={getItemKey(index)} className="timeline-item">{renderItem(index)}</div>)}
    {footer ? <div className="timeline-item">{footer}</div> : null}
  </div>;
}

const MemoMessageTimeline = memo(MessageTimeline, (previous, next) => previous.messages === next.messages && previous.language === next.language && previous.running === next.running && previous.activeActivity === next.activeActivity && previous.streamText === next.streamText && previous.workingPhase === next.workingPhase && previous.toolName === next.toolName && previous.completedActivity === next.completedActivity && previous.steeringMessageKeys === next.steeringMessageKeys && previous.taskId === next.taskId && previous.scrollKey === next.scrollKey && previous.active === next.active && previous.messageReady === next.messageReady && previous.conversationRef === next.conversationRef && previous.scrollPositionsRef === next.scrollPositionsRef && previous.scrollHandleRef === next.scrollHandleRef && previous.onAtEndChange === next.onAtEndChange && previous.footer === next.footer && previous.onPreviewImage === next.onPreviewImage && previous.onContextMenuImage === next.onContextMenuImage);

export { MemoMessageTimeline };
