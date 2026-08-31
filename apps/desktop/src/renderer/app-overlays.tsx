import { CommandResultDialog, ConfirmDialog, ExtensionUiDialog, handleRovingMenuKeyDown, ImageContextMenu, ImagePreview, PackageSettings, PiSettings, ProjectRemoveDialog, ProviderSettings, QuickSettings, QuickSettingsBoundary, RenameSessionDialog, ResumeSessionDialog, ScopedModelsDialog, TrustDialog, copyImageToClipboard } from "./ui";
import { Icon } from "@pideck/ui-system";
import type { AppController } from "./use-app-controller";

// All floating layers (dialogs, settings, toast, context menus) render
// here so app-view.tsx only owns the shell layout. Add new overlays in this
// file; the controller contract stays the single source of state.
export function AppOverlays({ controller }: { controller: AppController }) {
  const {
    language, theme, t, shortcut, projectCwd, tasks, activeTask, activeProject, isMac,
    paletteCommands, selectPaletteCommand, createTask, openProviderSettings, setPackagesOpen, compactSession, exportSession,
    quickSettingsOpen, quickSettingsPage, setQuickSettingsOpen,
    notices, contextMenu, setContextMenu, projectContextMenu, setProjectContextMenu,
    pendingDelete, setPendingDelete, deletingTaskId, deleteTask,
    pendingProjectRemove, setPendingProjectRemove, removingProjectCwd, removeProject,
    extensionUiRequest, setExtensionUiRequest, showNotice, dismissNotice,
    packagesOpen, setMessageReload, settingsOpen, setSettingsOpen, piSettingsOpen, setPiSettingsOpen, providerFocus, setProviderFocus, refreshModels,
    commandDialog, setCommandDialog, renameOpen, setRenameOpen, renameSession,
    resumeOpen, setResumeOpen, selectTask, trustOpen, setTrustOpen, trustProject, trustStatus, trustBusy, openProjectTrust, resolveTrust,
    scopedModelsOpen, setScopedModelsOpen, modelOptions, capabilities, saveScopedModels,
    previewImage, setPreviewImage, imageContextMenu, setImageContextMenu, openImageContextMenu,
  } = controller;
  return <div className={`overlay-root ${theme}${isMac ? " platform-macos" : " platform-overlay"}`}>
    {quickSettingsOpen && <QuickSettingsBoundary language={language} onClose={() => setQuickSettingsOpen(false)}><QuickSettings
      language={language}
      commands={paletteCommands}
      initialPage={quickSettingsPage}
      shortcut={shortcut}
      hasProject={Boolean(projectCwd)}
      hasSession={Boolean(activeTask)}
      onCommand={(command) => void selectPaletteCommand(command)}
      onProviders={() => openProviderSettings()}
      onPackages={() => { setQuickSettingsOpen(false); setPackagesOpen(true); }}
      onNewTask={() => { setQuickSettingsOpen(false); void createTask(); }}
      onCompact={() => { setQuickSettingsOpen(false); void compactSession(); }}
      onExport={(format) => { setQuickSettingsOpen(false); void exportSession(format); }}
      onClose={() => setQuickSettingsOpen(false)}
    /></QuickSettingsBoundary>}
    {notices.length > 0 && <div className="toast-stack">
      {notices.map((item) => <div key={item.id} className={`toast ${item.kind === "error" ? "toast-error" : ""} ${item.closing ? "closing" : ""}`} role={item.kind === "error" ? "alert" : "status"} aria-live="polite"><span className="toast-message">{item.message}</span>{item.kind === "error" && <button className="toast-close" type="button" title={t.closeNotice} aria-label={t.closeNotice} onClick={() => dismissNotice(item.id)}><Icon name="x" size={12} /></button>}</div>)}
    </div>}
    {contextMenu && <div className="task-context-menu" role="menu" aria-label={t.moreActions} style={{ left: contextMenu.x, top: contextMenu.y }} onKeyDown={handleRovingMenuKeyDown} onClick={(event) => event.stopPropagation()}><button role="menuitem" autoFocus onClick={() => { setPendingDelete(contextMenu.task); setContextMenu(null); }}>{t.deleteSession}</button></div>}
    {projectContextMenu && <div className="task-context-menu" role="menu" aria-label={t.moreActions} style={{ left: projectContextMenu.x, top: projectContextMenu.y }} onKeyDown={handleRovingMenuKeyDown} onClick={(event) => event.stopPropagation()}><button type="button" role="menuitem" autoFocus data-project-action="trust" onClick={() => { const project = projectContextMenu.project; setProjectContextMenu(null); void openProjectTrust(project); }}>{t.trustTitle}</button><button type="button" role="menuitem" disabled={removingProjectCwd !== null} onClick={() => { setPendingProjectRemove(projectContextMenu.project); setProjectContextMenu(null); }}>{t.removeProject}</button></div>}
    {pendingDelete && <ConfirmDialog language={language} task={pendingDelete} busy={deletingTaskId === pendingDelete.id} onCancel={() => setPendingDelete(null)} onConfirm={() => void deleteTask(pendingDelete)} />}
    {pendingProjectRemove && <ProjectRemoveDialog language={language} project={pendingProjectRemove} busy={removingProjectCwd === pendingProjectRemove.cwd} onCancel={() => setPendingProjectRemove(null)} onConfirm={() => void removeProject(pendingProjectRemove)} />}
    {extensionUiRequest && <ExtensionUiDialog request={extensionUiRequest} language={language} onResolve={(value) => { void window.pideck.extensions.resolveUi(extensionUiRequest.requestId, value).then(() => setExtensionUiRequest(null)).catch((error) => showNotice(error instanceof Error ? error.message : String(error))); }} />}
    {packagesOpen && <PackageSettings language={language} cwd={activeProject?.cwd ?? projectCwd} onClose={() => setPackagesOpen(false)} onNotice={showNotice} onPackagesChanged={() => setMessageReload((current) => current + 1)} onModelsRefresh={() => refreshModels()} />}
    {settingsOpen && <ProviderSettings language={language} focusProviderId={providerFocus} onClose={() => { setSettingsOpen(false); setProviderFocus(null); }} onModelsRefresh={refreshModels} />}
    {piSettingsOpen && <PiSettings language={language} cwd={activeProject?.cwd ?? projectCwd} models={modelOptions} onClose={() => setPiSettingsOpen(false)} onNotice={showNotice} />}
    {commandDialog && <CommandResultDialog language={language} title={commandDialog.title} body={commandDialog.body} onClose={() => setCommandDialog(null)} />}
    {renameOpen && activeTask && <RenameSessionDialog language={language} currentName={activeTask.title} onSave={(name) => void renameSession(name)} onClose={() => setRenameOpen(false)} />}
    {resumeOpen && <ResumeSessionDialog language={language} project={activeProject} tasks={tasks} activeTaskId={activeTask?.id} onSelect={(task) => { if (activeProject) void selectTask(activeProject, task); setResumeOpen(false); }} onClose={() => setResumeOpen(false)} />}
    {trustOpen && trustProject && trustStatus && <TrustDialog language={language} project={trustProject} status={trustStatus} busy={trustBusy} onResolve={(trusted) => void resolveTrust(trusted)} onClose={() => { if (!trustBusy) setTrustOpen(false); }} />}
    {scopedModelsOpen && <ScopedModelsDialog language={language} models={modelOptions} selectedModels={capabilities?.scopedModels ?? []} onSave={(models, persist) => void saveScopedModels(models, persist)} onClose={() => setScopedModelsOpen(false)} />}
    {previewImage && <ImagePreview image={previewImage} language={language} onClose={() => setPreviewImage(null)} onContextMenuImage={openImageContextMenu} />}
    {imageContextMenu && <ImageContextMenu language={language} x={imageContextMenu.x} y={imageContextMenu.y} onCopy={async () => { const copied = await copyImageToClipboard(imageContextMenu.image.src); setImageContextMenu(null); showNotice(copied ? t.copiedImage : t.copyImageFailed); }} />}
  </div>;
}
