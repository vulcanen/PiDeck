import type { TaskSummary } from "@pideck/domain";
import type { Language } from "@pideck/i18n";
import type { TaskUiState } from "./types";

export function createDefaultTaskUiState(): TaskUiState {
  return { isSending: false, isCompacting: false, streamText: "", workingPhase: null, activity: [], completedActivity: [] };
}

export function sortTasksByUpdatedAt(tasks: TaskSummary[]): TaskSummary[] {
  return [...tasks].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt);
    const bTime = Date.parse(b.updatedAt);
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });
}

export function textFromMessage(message: any): string {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content.map((part: any) => part?.type === "text" ? part.text : "").filter(Boolean).join("\n");
}

// A failed model call (usage limits, provider/auth errors) surfaces as an
// assistant message with an empty text body plus stopReason "error" and
// errorMessage. The timeline must treat it as a real reply instead of
// dropping it. User-initiated aborts (stopReason "aborted") are deliberate
// and stay silent, matching the TUI.
export function messageErrorText(message: any): string {
  if (message?.role !== "assistant") return "";
  if (message?.stopReason !== "error") return "";
  const errorMessage = message?.errorMessage;
  return typeof errorMessage === "string" ? errorMessage.trim() : "";
}

export function messageIdentity(message: any): string | undefined {
  const id = typeof message?.id === "string" && message.id ? message.id : undefined;
  if (id) return `id:${id}`;
  // Pi messages are not guaranteed to expose an id. Their timestamp is
  // stable across message_start and the later full message.snapshot, so use
  // it with the role/content as a fallback identity. Without this, every
  // deferred snapshot appends the same message again.
  const timestamp = message?.timestamp;
  if ((typeof timestamp !== "string" && typeof timestamp !== "number") || !String(timestamp)) return undefined;
  const role = typeof message?.role === "string" ? message.role : "";
  const text = textFromMessage(message);
  const images = Array.isArray(message?.content)
    ? message.content.filter((part: any) => part?.type === "image").map((part: any) => part?.mimeType ?? "image").join(",")
    : "";
  return `message:${role}|${String(timestamp)}|${text}|${images}`;
}

export function mergeMessageSnapshot(previous: any[], snapshot: any[], authoritativeOrder = false): any[] {
  if (!snapshot.length) return previous;
  // Full session snapshots are already in Pi's canonical turn order. Sorting
  // them by timestamps is incorrect for queued turns because user messages
  // can be persisted before the assistant responses are finalized, which
  // groups all summaries before the actual replies. Rebuild from the
  // snapshot's order and only retain local/live messages that are not present.
  if (authoritativeOrder) {
    const usedPrevious = new Set<number>();
    const ordered = snapshot.map((message) => {
      const identity = messageIdentity(message);
      let index = identity
        ? previous.findIndex((item, itemIndex) => !usedPrevious.has(itemIndex) && messageIdentity(item) === identity)
        : -1;
      // Replace the optimistic local user message with Pi's persisted message.
      if (index < 0 && message?.role === "user") {
        index = previous.findIndex((item, itemIndex) => !usedPrevious.has(itemIndex) && typeof item?.id === "string" && item.id.startsWith("local-") && textFromMessage(item) === textFromMessage(message));
      }
      if (index >= 0) usedPrevious.add(index);
      return message;
    });
    for (const [index, message] of previous.entries()) if (!usedPrevious.has(index)) ordered.push(message);
    return ordered;
  }

  // Event-level snapshots (for example message_start) are incremental. Keep
  // the existing timeline order and replace matching messages in place.
  const merged = [...previous];
  for (const message of snapshot) {
    const identity = messageIdentity(message);
    let index = identity ? merged.findIndex((item) => messageIdentity(item) === identity) : -1;
    if (index < 0 && message?.role === "user") {
      index = merged.findIndex((item) => typeof item?.id === "string" && item.id.startsWith("local-") && textFromMessage(item) === textFromMessage(message));
    }
    if (index >= 0) merged[index] = message;
    else merged.push(message);
  }
  return merged;
}

export function formatMessageTime(value: string | number | undefined, language: Language) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function copyImageToClipboard(src: string): Promise<boolean> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
  try {
    const blob = await fetch(src).then((response) => response.blob());
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    return true;
  } catch { return false; }
}
