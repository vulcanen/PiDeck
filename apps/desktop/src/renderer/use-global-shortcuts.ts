import { useEffect, type RefObject } from "react";

interface GlobalShortcutsOptions {
  searchInputRef: RefObject<HTMLInputElement | null>;
  paletteOpen: boolean;
  settingsOpen: boolean;
  pendingDelete: boolean;
  pendingProjectRemove: boolean;
  previewImage: boolean;
  thinkingMenuOpen: boolean;
  modelMenuOpen: boolean;
  suggestionMode: string | null;
  contextMenu: boolean;
  projectContextMenu: boolean;
  imageContextMenu: boolean;
  terminalOpen: boolean;
  onCommandPalette: () => void;
  onProviderSettings: () => void;
  onToggleTerminal: () => void;
  onCreateTask: () => void | Promise<unknown>;
  onCloseMenus: () => void;
  onCloseTerminal: () => void;
}

export function useGlobalShortcuts({
  searchInputRef, paletteOpen, settingsOpen, pendingDelete, pendingProjectRemove, previewImage,
  thinkingMenuOpen, modelMenuOpen, suggestionMode, contextMenu, projectContextMenu, imageContextMenu,
  terminalOpen, onCommandPalette, onProviderSettings, onToggleTerminal, onCreateTask, onCloseMenus, onCloseTerminal,
}: GlobalShortcutsOptions) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const modalOpen = paletteOpen || settingsOpen || pendingDelete || pendingProjectRemove || previewImage;
      if (modalOpen) return;
      if (modifier && event.key.toLowerCase() === "k") { event.preventDefault(); onCommandPalette(); return; }
      if (modifier && event.key.toLowerCase() === "j") { event.preventDefault(); onToggleTerminal(); return; }
      if (modifier && event.key.toLowerCase() === "n") { event.preventDefault(); void onCreateTask(); return; }
      if (modifier && event.key === ",") { event.preventDefault(); onProviderSettings(); return; }
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
      if (event.key === "/" && !typing) { event.preventDefault(); searchInputRef.current?.focus(); return; }
      if (event.key === "Escape") {
        if (thinkingMenuOpen || modelMenuOpen || suggestionMode || contextMenu || projectContextMenu || imageContextMenu) { onCloseMenus(); return; }
        if (terminalOpen) onCloseTerminal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contextMenu, imageContextMenu, modelMenuOpen, onCloseMenus, onCloseTerminal, onCommandPalette, onCreateTask, onProviderSettings, onToggleTerminal, paletteOpen, pendingDelete, pendingProjectRemove, previewImage, projectContextMenu, searchInputRef, settingsOpen, suggestionMode, terminalOpen, thinkingMenuOpen]);
}
