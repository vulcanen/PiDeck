import { CommandPalette, CommandPaletteBoundary, CommandResultDialog, ConfirmDialog, ExtensionUiDialog, handleRovingMenuKeyDown, ImageContextMenu, ImagePreview, PackageSettings, ProjectRemoveDialog, ProviderSettings, RenameSessionDialog, ResumeSessionDialog, ScopedModelsDialog, TrustDialog, copyImageToClipboard } from "./ui";
import type { AppController } from "./use-app-controller";

// All floating layers (dialogs, palette, toast, context menus) render
// here so app-view.tsx only owns the shell layout. Add new overlays in this
// file; the controller contract stays the single source of state.
export function AppOverlays({ controller }: { controller: AppController }) {
  const {
    language, t, shortcut, projectCwd, tasks, activeTask, activeProject,
    paletteOpen, setPaletteOpen, paletteCommands, composer, updateComposer, createTask, openProviderSettings, setPackagesOpen, compactSession, exportSession,
    notices, contextMenu, setContextMenu, projectContextMenu, setProjectContextMenu,
    pendingDelete, setPendingDelete, deletingTaskId, deleteTask,
    pendingProjectRemove, setPendingProjectRemove, removingProjectCwd, removeProject,
    extensionUiRequest, setExtensionUiRequest, showNotice,
    packagesOpen, setMessageReload, settingsOpen, setSettingsOpen, providerFocus, setProviderFocus, refreshModels,
    commandDialog, setCommandDialog, renameOpen, setRenameOpen, renameSession,
    resumeOpen, setResumeOpen, selectTask, trustOpen, setTrustOpen, resolveTrust,
    scopedModelsOpen, setScopedModelsOpen, modelOptions, capabilities, saveScopedModels,
    previewImage, setPreviewImage, imageContextMenu, setImageContextMenu, openImageContextMenu,
  } = controller;
  return <>
    {paletteOpen && <CommandPaletteBoundary language={language} onClose={() => setPaletteOpen(false)}><CommandPalette language={language} commands={paletteCommands} shortcut={shortcut} onCommand={(command) => { updateComposer(`${composer}${composer && !composer.endsWith(" ") ? " " : ""}/${command.name} `); setPaletteOpen(false); }} onClose={() => setPaletteOpen(false)} onNewTask={() => { setPaletteOpen(false); void createTask(); }} onSettings={() => { setPaletteOpen(false); openProviderSettings(); }} onPackages={() => { setPaletteOpen(false); setPackagesOpen(true); }} onCompact={activeTask ? () => { setPaletteOpen(false); void compactSession(); } : undefined} onExport={activeTask ? (format) => { setPaletteOpen(false); void exportSession(format); } : undefined} /></CommandPaletteBoundary>}
    {notices.length > 0 && <div className="toast-stack">
      {notices.map((item) => <div key={item.id} className={`toast ${item.closing ? "closing" : ""}`} role="status" aria-live="polite">{item.message}</div>)}
    </div>}
    {contextMenu && <div className="task-context-menu" role="menu" aria-label={t.moreActions} style={{ left: contextMenu.x, top: contextMenu.y }} onKeyDown={handleRovingMenuKeyDown} onClick={(event) => event.stopPropagation()}><button role="menuitem" autoFocus onClick={() => { setPendingDelete(contextMenu.task); setContextMenu(null); }}>{t.deleteSession}</button></div>}
    {projectContextMenu && <div className="task-context-menu" role="menu" aria-label={t.moreActions} style={{ left: projectContextMenu.x, top: projectContextMenu.y }} onKeyDown={handleRovingMenuKeyDown} onClick={(event) => event.stopPropagation()}><button role="menuitem" autoFocus disabled={removingProjectCwd !== null} onClick={() => { setPendingProjectRemove(projectContextMenu.project); setProjectContextMenu(null); }}>{t.removeProject}</button></div>}
    {pendingDelete && <ConfirmDialog language={language} task={pendingDelete} busy={deletingTaskId === pendingDelete.id} onCancel={() => setPendingDelete(null)} onConfirm={() => void deleteTask(pendingDelete)} />}
    {pendingProjectRemove && <ProjectRemoveDialog language={language} project={pendingProjectRemove} busy={removingProjectCwd === pendingProjectRemove.cwd} onCancel={() => setPendingProjectRemove(null)} onConfirm={() => void removeProject(pendingProjectRemove)} />}
    {extensionUiRequest && <ExtensionUiDialog request={extensionUiRequest} language={language} onResolve={(value) => { void window.pideck.extensions.resolveUi(extensionUiRequest.requestId, value).then(() => setExtensionUiRequest(null)).catch((error) => showNotice(error instanceof Error ? error.message : String(error))); }} />}
    {packagesOpen && <PackageSettings language={language} cwd={activeProject?.cwd ?? projectCwd} onClose={() => setPackagesOpen(false)} onNotice={showNotice} onPackagesChanged={() => setMessageReload((current) => current + 1)} />}
    {settingsOpen && <ProviderSettings language={language} focusProviderId={providerFocus} onClose={() => { setSettingsOpen(false); setProviderFocus(null); }} onModelsRefresh={refreshModels} />}
    {commandDialog && <CommandResultDialog language={language} title={commandDialog.title} body={commandDialog.body} onClose={() => setCommandDialog(null)} />}
    {renameOpen && activeTask && <RenameSessionDialog language={language} currentName={activeTask.title} onSave={(name) => void renameSession(name)} onClose={() => setRenameOpen(false)} />}
    {resumeOpen && <ResumeSessionDialog language={language} project={activeProject} tasks={tasks} activeTaskId={activeTask?.id} onSelect={(task) => { if (activeProject) void selectTask(activeProject, task); setResumeOpen(false); }} onClose={() => setResumeOpen(false)} />}
    {trustOpen && <TrustDialog language={language} onResolve={(trusted) => void resolveTrust(trusted)} onClose={() => setTrustOpen(false)} />}
    {scopedModelsOpen && <ScopedModelsDialog language={language} models={modelOptions} selectedIds={capabilities?.scopedModels?.length ? capabilities.scopedModels : modelOptions.map((model) => `${model.providerId}/${model.id}`)} onSave={(modelIds, persist) => void saveScopedModels(modelIds, persist)} onClose={() => setScopedModelsOpen(false)} />}
    {previewImage && <ImagePreview image={previewImage} language={language} onClose={() => setPreviewImage(null)} onContextMenuImage={openImageContextMenu} />}
    {imageContextMenu && <ImageContextMenu language={language} x={imageContextMenu.x} y={imageContextMenu.y} onCopy={async () => { const copied = await copyImageToClipboard(imageContextMenu.image.src); setImageContextMenu(null); showNotice(copied ? t.copiedImage : t.copyImageFailed); }} />}
  </>;
}
