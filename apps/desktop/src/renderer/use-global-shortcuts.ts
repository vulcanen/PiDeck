import { useEffect, type RefObject } from "react";

interface GlobalShortcutsOptions {
  searchInputRef: RefObject<HTMLInputElement | null>;
  paletteOpen: boolean;
  settingsOpen: boolean;
  commandDialogOpen: boolean;
  renameOpen: boolean;
  resumeOpen: boolean;
  trustOpen: boolean;
  scopedModelsOpen: boolean;
  pendingDelete: boolean;
  pendingProjectRemove: boolean;
  previewImage: boolean;
  thinkingMenuOpen: boolean;
  modelMenuOpen: boolean;
  suggestionMode: string | null;
  contextMenu: boolean;
  projectContextMenu: boolean;
  imageContextMenu: boolean;
  onCommandPalette: () => void;
  onProviderSettings: () => void;
  onCreateTask: () => void | Promise<unknown>;
  onCloseMenus: () => void;
}

export function useGlobalShortcuts({
  searchInputRef, paletteOpen, settingsOpen, commandDialogOpen, renameOpen, resumeOpen, trustOpen, scopedModelsOpen, pendingDelete, pendingProjectRemove, previewImage,
  thinkingMenuOpen, modelMenuOpen, suggestionMode, contextMenu, projectContextMenu, imageContextMenu,
  onCommandPalette, onProviderSettings, onCreateTask, onCloseMenus,
}: GlobalShortcutsOptions) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const modalOpen = paletteOpen || settingsOpen || commandDialogOpen || renameOpen || resumeOpen || trustOpen || scopedModelsOpen || pendingDelete || pendingProjectRemove || previewImage;
      if (modalOpen) return;
      if (modifier && event.key.toLowerCase() === "k") { event.preventDefault(); onCommandPalette(); return; }
      if (modifier && event.key.toLowerCase() === "n") { event.preventDefault(); void onCreateTask(); return; }
      if (modifier && event.key === ",") { event.preventDefault(); onProviderSettings(); return; }
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
      if (event.key === "/" && !typing) { event.preventDefault(); searchInputRef.current?.focus(); return; }
      if (event.key === "Escape") {
        if (thinkingMenuOpen || modelMenuOpen || suggestionMode || contextMenu || projectContextMenu || imageContextMenu) { onCloseMenus(); return; }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandDialogOpen, contextMenu, imageContextMenu, modelMenuOpen, onCloseMenus, onCommandPalette, onCreateTask, onProviderSettings, paletteOpen, pendingDelete, pendingProjectRemove, previewImage, projectContextMenu, renameOpen, resumeOpen, searchInputRef, scopedModelsOpen, settingsOpen, suggestionMode, thinkingMenuOpen, trustOpen]);
}
