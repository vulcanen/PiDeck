import { useEffect } from "react";
import type { ContextUsage, ModelSummary, SessionCapabilities } from "@pideck/contracts";
import type { MessageLoad } from "./types";

export interface SessionDataOptions {
  projectCwd: string;
  taskId?: string;
  models: ModelSummary[];
  messageReload: number;
  setMessageLoads: React.Dispatch<React.SetStateAction<Record<string, MessageLoad>>>;
  setMessagesByTask: React.Dispatch<React.SetStateAction<Record<string, any[]>>>;
  setCapabilities: React.Dispatch<React.SetStateAction<SessionCapabilities | null>>;
  setActiveModel: React.Dispatch<React.SetStateAction<ModelSummary | null>>;
  setThinkingLevel: (level: string) => void;
  setThinkingLevels: (levels: string[]) => void;
  setContextUsage: (usage: ContextUsage | undefined) => void;
  showNotice: (message: string) => void;
}

export function useSessionData({
  projectCwd, taskId, models, messageReload, setMessageLoads, setMessagesByTask,
  setCapabilities, setActiveModel, setThinkingLevel, setThinkingLevels, setContextUsage, showNotice,
}: SessionDataOptions) {
  useEffect(() => {
    let cancelled = false;
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
  }, [projectCwd, taskId, models, messageReload]);
}
