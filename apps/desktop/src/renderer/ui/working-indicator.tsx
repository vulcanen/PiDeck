import { useEffect, useState } from "react";
import { copy, type Language } from "@pideck/i18n";
import type { WorkingPhase } from "../types";

function WorkingIndicator({ language, phase, toolName, message, frames, interval = 120 }: { language: Language; phase: WorkingPhase; toolName?: string; message?: string; frames?: string[]; interval?: number }) {
  const t = copy[language];
  const [frameIndex, setFrameIndex] = useState(0);
  useEffect(() => {
    setFrameIndex(0);
    if (!frames || frames.length < 2) return;
    const timer = window.setInterval(() => setFrameIndex((current) => (current + 1) % frames.length), interval);
    return () => window.clearInterval(timer);
  }, [frames, interval]);
  const label = message || (phase === "tool" ? toolName ? t.toolRunning(toolName) : t.toolStatus : phase === "responding" ? t.respondingStatus : phase === "compacting" ? t.compactingStatus : t.thinkingStatus);
  return <div className="working-indicator" role="status" aria-live="polite">{frames?.length ? <span aria-hidden="true">{frames[frameIndex]}</span> : null}<span>{label}</span>{frames?.length ? null : <span className="working-dots"><span /><span /><span /></span>}</div>;
}

export { WorkingIndicator };
