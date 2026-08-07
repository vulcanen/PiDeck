import { copy, type Language } from "@pideck/i18n";
import type { WorkingPhase } from "../types";

function WorkingIndicator({ language, phase, toolName }: { language: Language; phase: WorkingPhase; toolName?: string }) {
  const t = copy[language];
  const label = phase === "tool" ? toolName ? t.toolRunning(toolName) : t.toolStatus : phase === "responding" ? t.respondingStatus : phase === "compacting" ? t.compactingStatus : t.thinkingStatus;
  return <div className="working-indicator" role="status" aria-live="polite"><span>{label}</span><span className="working-dots"><span /><span /><span /></span></div>;
}

export { WorkingIndicator };
