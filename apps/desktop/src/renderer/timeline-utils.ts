import { copy, type Language } from "@pideck/i18n";
import type { ActivityStep, WorkingPhase } from "./types";
import { messageIdentity, textFromMessage } from "./message-utils";

export type MessageTimelineItem =
  | { type: "message"; message: any; index: number; stableKey?: string }
  | { type: "execution"; steps: ActivityStep[]; index: number; stableKey?: string; running?: boolean }
  | { type: "live"; text: string; index: number; stableKey: string; phase: WorkingPhase; toolName?: string };

function activityFromMessages(messages: any[], language: Language): ActivityStep[] {
  const steps: ActivityStep[] = [];
  const toolSteps = new Map<string, ActivityStep>();
  let firstMessageAt: number | undefined;
  let lastAssistantAt: number | undefined;
  let assistantMessageId: string | number | undefined;
  for (const message of messages) {
    const timestamp = typeof message?.timestamp === "number" ? message.timestamp : Date.parse(message?.timestamp ?? "") || Date.now();
    if (message?.role === "user" && firstMessageAt === undefined) firstMessageAt = timestamp;
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      lastAssistantAt = timestamp;
      assistantMessageId = message.id ?? timestamp;
      for (const part of message.content) {
        if (part?.type === "thinking" && part.thinking) steps.push({ id: `${message.id ?? timestamp}:thinking:${steps.length}`, kind: "thinking", label: copy[language].executionThinking, detail: part.thinking, startedAt: timestamp, endedAt: timestamp });
        if (part?.type === "toolCall" || part?.type === "tool_call") {
          const step = { id: part.id ?? part.toolCallId ?? `${message.id ?? timestamp}:tool:${steps.length}`, kind: "tool" as const, label: part.name ?? part.toolName ?? copy[language].toolResult, args: part.arguments ?? part.args ?? {}, startedAt: timestamp };
          steps.push(step);
          toolSteps.set(step.id, step);
        }
      }
    }
    if (message?.role === "assistant" && !Array.isArray(message.content)) {
      lastAssistantAt = timestamp;
      assistantMessageId = message.id ?? timestamp;
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
  // Pi may persist the final assistant text without its transient thinking
  // and tool events. Recreate a compact historical summary from the turn
  // timestamps so a restart does not make recent “processed” rows disappear.
  if (!steps.length && lastAssistantAt !== undefined) {
    const startedAt = firstMessageAt ?? lastAssistantAt;
    steps.push({
      id: `${assistantMessageId ?? lastAssistantAt}:summary`,
      kind: "thinking",
      label: copy[language].executionThinking,
      startedAt,
      endedAt: Math.max(startedAt, lastAssistantAt),
    });
  }
  return steps;
}

export function buildMessageTimelineItems({
  messages,
  language,
  running,
  completedActivity,
  steeringMessageKeys,
  taskId = "timeline",
  liveText = "",
  activeActivity = [],
  workingPhase = "thinking",
  toolName,
}: {
  messages: any[];
  language: Language;
  running: boolean;
  completedActivity: ActivityStep[][];
  steeringMessageKeys: string[];
  taskId?: string;
  liveText?: string;
  activeActivity?: ActivityStep[];
  workingPhase?: WorkingPhase;
  toolName?: string;
}): MessageTimelineItem[] {
  const items: MessageTimelineItem[] = [];
  let turn: any[] = [];
  let turnIndex = 0;
  let hasAssistantInTurn = false;
  const steeringKeys = new Set(steeringMessageKeys);

  // A steering message is delivered inside the current agent run, so it does
  // not create another logical turn or another completed activity summary.
  let userTurnCount = 0;
  let hasAssistantInLogicalTurn = false;
  let hasMessageInLogicalTurn = false;
  for (const message of messages) {
    const isSteeringMessage = message?.role === "user" && steeringKeys.has(messageIdentity(message) ?? "");
    if (message?.role === "user") {
      if (!hasMessageInLogicalTurn) {
        userTurnCount += 1;
        hasMessageInLogicalTurn = true;
      } else if (hasAssistantInLogicalTurn && !isSteeringMessage) {
        userTurnCount += 1;
        hasAssistantInLogicalTurn = false;
      }
    } else if (message?.role === "assistant") {
      hasAssistantInLogicalTurn = true;
    }
  }

  // completedActivity only covers turns observed during the current app
  // lifetime. Align it to the newest persisted turns when the session already
  // contains older history.
  const observedTurnCount = completedActivity.length + (running ? 1 : 0);
  const activityOffset = Math.max(0, userTurnCount - observedTurnCount);
  const flushTurn = (isFinal = false) => {
    if (!turn.length) return;
    const activeTurn = isFinal && running;
    // Runtime activity has the real start/end times. Persisted messages only
    // retain a result timestamp, which would make every historical summary
    // appear as 0s and can associate a queued turn with the previous one.
    const recordedActivity = completedActivity[turnIndex - activityOffset];
    const steps = activeTurn && activeActivity.length
      ? activeActivity
      : recordedActivity?.length
      ? recordedActivity
      : activityFromMessages(turn, language);
    const responseKey = `response-${taskId}-${turnIndex}`;
    let hasAssistantText = false;
    if (!steps.length && !activeTurn) {
      for (const [index, message] of turn.entries()) if (message?.role !== "toolResult") items.push({ type: "message", message, index: items.length + index });
      turn = [];
      hasAssistantInTurn = false;
      turnIndex += 1;
      return;
    }
    // Keep every user message in a shared steering turn. The summary is
    // inserted once immediately before the first assistant reply, so all
    // inputs are visible above it and the response follows below it.
    let summaryInserted = false;
    for (const message of turn) {
      if (message?.role === "user") {
        items.push({ type: "message", message, index: items.length });
      } else if (message?.role === "assistant" && textFromMessage(message)) {
        hasAssistantText = true;
        // While a queued turn is running, keep earlier turns (which are no
        // longer the final turn) visible with their completed execution summary.
        if (!summaryInserted && (activeTurn || !running || !isFinal) && steps.length) {
          items.push({ type: "execution", steps, index: items.length, stableKey: `execution-${steps[0]?.id ?? `${taskId}-${turnIndex}`}`, running: activeTurn });
          summaryInserted = true;
        }
        items.push({ type: "message", message, index: items.length, stableKey: activeTurn || isFinal ? responseKey : undefined });
      }
    }
    // A completed turn can contain user messages without a textual assistant
    // reply (for example an interrupted/empty response). Keep its summary
    // visible after the inputs instead of dropping it.
    if (!summaryInserted && (activeTurn || !running || !isFinal) && steps.length) {
      items.push({ type: "execution", steps, index: items.length, stableKey: `execution-${steps[0]?.id ?? `${taskId}-${turnIndex}`}`, running: activeTurn });
    }
    if (activeTurn && !hasAssistantText) {
      items.push({ type: "live", text: liveText, index: items.length, stableKey: responseKey, phase: workingPhase, toolName });
    }
    turn = [];
    hasAssistantInTurn = false;
    turnIndex += 1;
  };

  for (const message of messages) {
    // Steering messages are delivered inside the current agent run. Keep
    // them in the same timeline turn so the run has one shared summary.
    const isSteeringMessage = message?.role === "user" && steeringKeys.has(messageIdentity(message) ?? "");
    if (message?.role === "user" && turn.length && !isSteeringMessage && hasAssistantInTurn) flushTurn();
    turn.push(message);
    if (message?.role === "assistant") hasAssistantInTurn = true;
  }
  flushTurn(true);
  return items;
}
