import { useEffect, type RefObject } from "react";

interface GlobalShortcutsOptions {
  searchInputRef: RefObject<HTMLInputElement | null>;
  paletteOpen: boolean;
  settingsOpen: boolean;
  piSettingsOpen: boolean;
  quickSettingsOpen: boolean;
  packagesOpen: boolean;
  extensionUiOpen: boolean;
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
  onQuickSettings: () => void;
  onCreateTask: () => void | Promise<unknown>;
  onCloseMenus: () => void;
}

export function useGlobalShortcuts({
  searchInputRef, paletteOpen, settingsOpen, piSettingsOpen, quickSettingsOpen, packagesOpen, extensionUiOpen, commandDialogOpen, renameOpen, resumeOpen, trustOpen, scopedModelsOpen, pendingDelete, pendingProjectRemove, previewImage,
  thinkingMenuOpen, modelMenuOpen, suggestionMode, contextMenu, projectContextMenu, imageContextMenu,
  onCommandPalette, onQuickSettings, onCreateTask, onCloseMenus,
}: GlobalShortcutsOptions) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const modalOpen = paletteOpen || settingsOpen || piSettingsOpen || quickSettingsOpen || packagesOpen || extensionUiOpen || commandDialogOpen || renameOpen || resumeOpen || trustOpen || scopedModelsOpen || pendingDelete || pendingProjectRemove || previewImage;
      if (modalOpen) return;
      if (modifier && event.key.toLowerCase() === "k") { event.preventDefault(); onCommandPalette(); return; }
      if (modifier && event.key.toLowerCase() === "n") { event.preventDefault(); void onCreateTask(); return; }
      if (modifier && event.key === ",") { event.preventDefault(); onQuickSettings(); return; }
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
      if (event.key === "/" && !typing) { event.preventDefault(); searchInputRef.current?.focus(); return; }
      if (event.key === "Escape") {
        if (thinkingMenuOpen || modelMenuOpen || suggestionMode || contextMenu || projectContextMenu || imageContextMenu) { onCloseMenus(); return; }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandDialogOpen, contextMenu, extensionUiOpen, imageContextMenu, modelMenuOpen, onCloseMenus, onCommandPalette, onCreateTask, onQuickSettings, packagesOpen, paletteOpen, pendingDelete, pendingProjectRemove, piSettingsOpen, previewImage, projectContextMenu, quickSettingsOpen, renameOpen, resumeOpen, searchInputRef, scopedModelsOpen, settingsOpen, suggestionMode, thinkingMenuOpen, trustOpen]);
}
