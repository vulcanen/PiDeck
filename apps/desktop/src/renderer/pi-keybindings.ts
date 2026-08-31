import type { PiKeybindings } from "@pideck/contracts";

const browserKeyNames: Record<string, string> = {
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  Backspace: "backspace",
  Delete: "delete",
  Enter: "enter",
  Escape: "escape",
  PageDown: "pagedown",
  PageUp: "pageup",
  Tab: "tab",
  " ": "space",
};

function canonicalKey(value: string): string {
  const parts = value.toLowerCase().split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop() ?? "";
  const modifiers = new Set(parts.map((part) => part === "control" ? "ctrl" : part === "command" ? "meta" : part));
  return ["ctrl", "alt", "shift", "meta"].filter((modifier) => modifiers.has(modifier)).concat(key).join("+");
}

export function browserEventKey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string {
  const key = browserKeyNames[event.key] ?? event.key.toLowerCase();
  return [event.ctrlKey && "ctrl", event.altKey && "alt", event.shiftKey && "shift", event.metaKey && "meta", key]
    .filter((part): part is string => Boolean(part))
    .join("+");
}

export function matchesPiKeybinding(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  bindings: PiKeybindings | undefined,
  action: string,
): boolean {
  const pressed = canonicalKey(browserEventKey(event));
  return (bindings?.[action] ?? []).some((binding) => canonicalKey(binding) === pressed);
}

export function firstPiKeybinding(bindings: PiKeybindings | undefined, action: string): string | undefined {
  return bindings?.[action]?.[0];
}
