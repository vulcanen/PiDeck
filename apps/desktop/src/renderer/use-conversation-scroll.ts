import { useCallback, useRef } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";

export interface ConversationScrollSnapshot {
  top: number;
  follow: boolean;
  measurements: VirtualItem[];
}

export interface ConversationScrollHandle {
  scrollToLatest: (behavior: "auto" | "smooth") => void;
}

interface ConversationScrollOptions {
  setShowJumpToLatest: (show: boolean) => void;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function useConversationScroll({ setShowJumpToLatest }: ConversationScrollOptions) {
  const scrollPositionsRef = useRef<Record<string, ConversationScrollSnapshot>>({});
  const scrollHandleRef = useRef<ConversationScrollHandle | null>(null);

  const handleTimelineAtEnd = useCallback((atEnd: boolean) => {
    setShowJumpToLatest(!atEnd);
  }, [setShowJumpToLatest]);

  const jumpToLatest = useCallback(() => {
    setShowJumpToLatest(false);
    scrollHandleRef.current?.scrollToLatest(prefersReducedMotion() ? "auto" : "smooth");
  }, [setShowJumpToLatest]);

  // Runtime queue events can arrive in the same task as the message/state
  // update that grows the virtualized timeline. Scroll once now and once
  // after layout so the newly inserted row, rather than the previous range,
  // becomes the visible latest item.
  const followLatest = useCallback(() => {
    setShowJumpToLatest(false);
    const scroll = () => scrollHandleRef.current?.scrollToLatest("auto");
    scroll();
    window.requestAnimationFrame(() => {
      scroll();
      window.requestAnimationFrame(scroll);
    });
  }, [setShowJumpToLatest]);

  return { scrollPositionsRef, scrollHandleRef, handleTimelineAtEnd, jumpToLatest, followLatest };
}
