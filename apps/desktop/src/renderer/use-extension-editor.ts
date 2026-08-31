import { useEffect, useRef } from "react";
import type { SessionCapabilities } from "@pideck/contracts";
import { matchesPiKeybinding } from "./pi-keybindings";

/** Mirror presentation state only; Pi keeps all extension handlers and contexts. */
export function useExtensionEditor({ taskId, cwd, text, shortcuts, enabled, onError }: {
  taskId?: string; cwd: string; text: string; shortcuts: SessionCapabilities["extensionShortcuts"];
  enabled: boolean; onError: (message: string) => void;
}) {
  const running = useRef(false);
  useEffect(() => {
    if (!taskId || !enabled || !window.pideck.extensions.syncEditor) return;
    void window.pideck.extensions.syncEditor(taskId, text, cwd).catch((error) => onError(String(error)));
  }, [taskId, cwd, text, enabled, onError]);

  useEffect(() => {
    if (!taskId || !enabled || !shortcuts?.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.matches('input, textarea, [contenteditable="true"]') && !target.matches(".composer-editor-input")) return;
      const shortcut = shortcuts.find(({ key }) => matchesPiKeybinding(event, { shortcut: [key] }, "shortcut"));
      if (!shortcut) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat || running.current) return;
      running.current = true;
      void window.pideck.extensions.invokeShortcut(taskId, shortcut.key, text, cwd)
        .catch((error) => onError(String(error)))
        .finally(() => { running.current = false; });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [taskId, cwd, text, shortcuts, enabled, onError]);
}
