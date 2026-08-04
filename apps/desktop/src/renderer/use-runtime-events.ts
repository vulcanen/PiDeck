import { useEffect } from "react";
import type { AgentQueueState, ContextUsage, ExtensionUiRequest, PiDeckRuntimeEvent } from "@pideck/contracts";
import type { TaskSummary } from "@pideck/domain";
import { copy, type Language } from "@pideck/i18n";
import type { ActivityStep, TaskUiState } from "./types";
import { createDefaultTaskUiState, mergeMessageSnapshot, messageIdentity, sortTasksByUpdatedAt } from "./message-utils";

export interface RuntimeEventsOptions {
  projectCwd: string;
  language: Language;
  activeTaskId?: string;
  queueModes: Partial<Pick<AgentQueueState, "steeringMode" | "followUpMode">>;
  queueState: AgentQueueState | null;
  setRuntimeStatus: (status: "connected" | "starting" | "disconnected") => void;
  showNotice: (message: string) => void;
  patchTaskUi: (taskId: string, patch: Partial<TaskUiState>) => void;
  updateTaskLists: (update: (tasks: TaskSummary[]) => TaskSummary[]) => void;
  discardStreamDeltas: (taskId: string) => void;
  queueStreamDelta: (taskId: string, delta: string) => void;
  updateActivity: (taskId: string, update: (steps: ActivityStep[]) => ActivityStep[]) => void;
  setQueueState: (state: AgentQueueState | null) => void;
  setExtensionUiRequest: (request: ExtensionUiRequest | null) => void;
  setSteeringMessageKeysByTask: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  setMessagesByTask: React.Dispatch<React.SetStateAction<Record<string, any[]>>>;
  setTaskUi: React.Dispatch<React.SetStateAction<Record<string, TaskUiState>>>;
  setMessageLoads: React.Dispatch<React.SetStateAction<Record<string, { status: "idle" | "loading" | "ready" | "error"; error?: string }>>>;
  setContextUsage: (usage: ContextUsage | undefined) => void;
  setActiveTask: React.Dispatch<React.SetStateAction<TaskSummary | null>>;
  refreshWorkspace: () => Promise<void>;
  onQueueActivity: () => void;
}

export function useRuntimeEvents({
  projectCwd, language, activeTaskId, queueModes, queueState, setRuntimeStatus, showNotice,
  patchTaskUi, updateTaskLists, discardStreamDeltas, queueStreamDelta, updateActivity,
  setQueueState, setExtensionUiRequest, setSteeringMessageKeysByTask, setMessagesByTask,
  setTaskUi, setMessageLoads, setContextUsage, setActiveTask, refreshWorkspace,
  onQueueActivity,
}: RuntimeEventsOptions) {
  useEffect(() => window.pideck.events.subscribe((runtimeEvent: PiDeckRuntimeEvent) => {
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
      if (taskId === activeTaskId) {
        const nextQueue = { steering: Array.isArray(event.steering) ? [...event.steering] : [], followUp: Array.isArray(event.followUp) ? [...event.followUp] : [], steeringMode: queueState?.steeringMode ?? queueModes.steeringMode ?? "one-at-a-time", followUpMode: queueState?.followUpMode ?? queueModes.followUpMode ?? "one-at-a-time" };
        setQueueState(nextQueue);
        onQueueActivity();
      }
      return;
    }
    if (event?.type === "agent_start") {
      discardStreamDeltas(taskId);
      setTaskUi((current) => {
        const previous = current[taskId] ?? createDefaultTaskUiState();
        const startedAt = Date.now();
        const activity = previous.activity.length > 0 ? previous.activity : [{ id: `${taskId}:thinking:${startedAt}`, kind: "thinking" as const, label: copy[language].executionThinking, startedAt }];
        return { ...current, [taskId]: { ...previous, isSending: true, isCompacting: false, workingPhase: "thinking", streamText: "", toolName: undefined, activity } };
      });
      const updatedAt = new Date().toISOString();
      updateTaskLists((current) => sortTasksByUpdatedAt(current.map((task) => task.id === taskId ? { ...task, state: "running", updatedAt } : task)));
      void window.pideck.sessions.capabilities(taskId, projectCwd).then((next) => setContextUsage(next.contextUsage)).catch(() => undefined);
    } else if (event?.type === "message_start" && event.message?.role === "user") {
      const queueDelivery = event.queueDelivery === "steer" ? "steer" : "followUp";
      discardStreamDeltas(taskId);
      const steeringMessageKey = queueDelivery === "steer" ? messageIdentity(event.message) : undefined;
      if (steeringMessageKey) setSteeringMessageKeysByTask((current) => ({ ...current, [taskId]: [...new Set([...(current[taskId] ?? []), steeringMessageKey])] }));
      setMessagesByTask((current) => ({ ...current, [taskId]: mergeMessageSnapshot(current[taskId] ?? [], [event.message]) }));
      if (event.queueDelivery && taskId === activeTaskId) onQueueActivity();
      setTaskUi((current) => {
        const previous = current[taskId] ?? { ...createDefaultTaskUiState(), isSending: true };
        const isSteeringMessage = queueDelivery === "steer";
        const hasCompletedWork = previous.activity.some((step) => step.endedAt || step.kind === "tool" || Boolean(step.detail));
        const startedAt = Date.now();
        return { ...current, [taskId]: { ...previous, isSending: true, isCompacting: false, workingPhase: "thinking", streamText: "", toolName: undefined, activity: isSteeringMessage && previous.activity.length > 0 ? previous.activity : [{ id: `${taskId}:thinking:${startedAt}`, kind: "thinking", label: copy[language].executionThinking, startedAt }], completedActivity: !isSteeringMessage && hasCompletedWork ? [...previous.completedActivity, previous.activity] : previous.completedActivity } };
      });
    } else if (event?.type === "turn_start") patchTaskUi(taskId, { workingPhase: "thinking", toolName: undefined });
    else if (event?.type === "compaction_start") patchTaskUi(taskId, { isCompacting: true, workingPhase: "compacting", toolName: undefined });
    else if (event?.type === "compaction_end") { patchTaskUi(taskId, { isCompacting: false, workingPhase: "thinking" }); void window.pideck.sessions.capabilities(taskId, projectCwd).then((next) => setContextUsage(next.contextUsage)).catch(() => undefined); }
    else if (event?.type === "message_start" || event?.type === "message_end") void window.pideck.sessions.capabilities(taskId, projectCwd).then((next) => setContextUsage(next.contextUsage)).catch(() => undefined);
    else if (event?.type === "message_update" && event.stream?.type === "thinking_delta" && event.stream.delta) {
      updateActivity(taskId, (steps) => { const last = steps[steps.length - 1]; if (last?.kind === "thinking" && !last.endedAt) return [...steps.slice(0, -1), { ...last, detail: `${last.detail ?? ""}${event.stream.delta}` }]; return [...steps, { id: `${taskId}:thinking:${Date.now()}`, kind: "thinking", label: copy[language].executionThinking, detail: event.stream.delta, startedAt: Date.now() }]; });
      patchTaskUi(taskId, { workingPhase: "thinking" });
    } else if (event?.type === "message_update" && event.stream?.type === "text_delta" && event.stream.delta) {
      updateActivity(taskId, (steps) => steps.map((step) => step.kind === "thinking" && !step.endedAt ? { ...step, endedAt: Date.now() } : step));
      queueStreamDelta(taskId, event.stream.delta);
    } else if (event?.type === "tool_execution_start") {
      const startedAt = Date.now();
      updateActivity(taskId, (steps) => [...steps.map((step) => step.kind === "thinking" && !step.endedAt ? { ...step, endedAt: startedAt } : step), { id: event.toolCallId ?? `${taskId}:tool:${startedAt}`, kind: "tool", label: event.toolName ?? copy[language].toolResult, args: event.args, startedAt }]);
      patchTaskUi(taskId, { workingPhase: "tool", toolName: event.toolName });
    } else if (event?.type === "tool_execution_update") updateActivity(taskId, (steps) => steps.map((step) => step.id === event.toolCallId ? { ...step, result: event.partialResult } : step));
    else if (event?.type === "tool_execution_end") { updateActivity(taskId, (steps) => steps.map((step) => step.id === event.toolCallId ? { ...step, endedAt: Date.now(), result: event.result, isError: Boolean(event.isError) } : step)); patchTaskUi(taskId, { workingPhase: "thinking", toolName: undefined }); void window.pideck.sessions.capabilities(taskId, projectCwd).then((next) => setContextUsage(next.contextUsage)).catch(() => undefined); }
    else if (event?.type === "session_info_changed" && typeof event.name === "string" && event.name.trim()) { const title = event.name.trim(); updateTaskLists((current) => current.map((task) => task.id === taskId ? { ...task, title } : task)); setActiveTask((current) => current?.id === taskId ? { ...current, title } : current); }
    else if (event?.type === "message.snapshot") { discardStreamDeltas(taskId); setMessagesByTask((current) => ({ ...current, [taskId]: mergeMessageSnapshot(current[taskId] ?? [], Array.isArray(event.messages) ? event.messages : [], true) })); setMessageLoads((current) => ({ ...current, [taskId]: { status: "ready" } })); patchTaskUi(taskId, { streamText: "" }); }
    else if (event?.type === "agent_end") { discardStreamDeltas(taskId); updateActivity(taskId, (steps) => steps.map((step) => step.endedAt ? step : { ...step, endedAt: Date.now() })); patchTaskUi(taskId, { workingPhase: "thinking", streamText: "", toolName: undefined }); }
    else if (event?.type === "agent_settled") {
      discardStreamDeltas(taskId);
      const endedAt = Date.now();
      updateActivity(taskId, (steps) => steps.map((step) => step.endedAt ? step : { ...step, endedAt }));
      setTaskUi((current) => { const previous = current[taskId] ?? createDefaultTaskUiState(); const completedActivity = previous.activity.length > 0 ? [...previous.completedActivity, previous.activity.map((step) => step.endedAt ? step : { ...step, endedAt })] : previous.completedActivity; return { ...current, [taskId]: { ...previous, isSending: false, isCompacting: false, workingPhase: null, streamText: "", toolName: undefined, activity: [], completedActivity } }; });
      void window.pideck.sessions.messages(taskId, projectCwd).then((next) => { setMessagesByTask((current) => ({ ...current, [taskId]: mergeMessageSnapshot(current[taskId] ?? [], next as any[], true) })); setMessageLoads((current) => ({ ...current, [taskId]: { status: "ready" } })); }).catch((error) => setMessageLoads((current) => ({ ...current, [taskId]: { status: "error", error: error instanceof Error ? error.message : String(error) } })));
      void window.pideck.sessions.capabilities(taskId, projectCwd).then((next) => setContextUsage(next.contextUsage)).catch(() => undefined);
      void refreshWorkspace();
      updateTaskLists((current) => sortTasksByUpdatedAt(current.map((task) => task.id === taskId ? { ...task, state: "idle", updatedAt: new Date().toISOString() } : task)));
    }
  }), [projectCwd, language, activeTaskId, queueState?.steeringMode, queueState?.followUpMode, onQueueActivity]);
}
