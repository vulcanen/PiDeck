import { Icon } from "@pideck/ui-system";
import { AppConversation } from "./app-conversation";
import { AppSidebar } from "./app-sidebar";
import type { AppController } from "./use-app-controller";
import { CommandPalette, CommandPaletteBoundary, ConfirmDialog, ExtensionUiDialog, handleRovingMenuKeyDown, ImageContextMenu, ImagePreview, PackageSettings, ProjectRemoveDialog, ProviderSettings, TerminalPanel, copyImageToClipboard } from "./ui-components";

export function AppView({ controller }: { controller: AppController }) {
  const {
    language, setLanguage, theme, setTheme, projectCwd, projects, expandedProjectCwds, tasks,
    projectTasksByCwd, projectTaskLoads, activeTask, initialLoading, runtimeStatus, shortcut, t, isMac,
    sidebarRef, searchInputRef, mobileSidebarOpen, setMobileSidebarOpen, createTask, chooseProjectDirectory,
    openCommandPalette, selectProject, openProjectContextMenu, selectTask, openContextMenu, loadProjectSessions,
    searchQuery, setSearchQuery,
    loadInitialData, scrollPositionsRef, scrollHandleRef, handleTimelineAtEnd, activeProject, loadError, messageLoad, messages, isWorking, streamText,
    workingPhase, activeTaskUi, steeringMessageKeysByTask, showJumpToLatest, permissionStatus,
    composerProps, jumpToLatest, executeTerminal, terminalOpen, terminalCommand,
    terminalOutput, terminalRunning, setTerminalCommand, setTerminalOpen, paletteOpen, setPaletteOpen, paletteCommands,
    composer, updateComposer, compactSession, exportSession, notice, contextMenu, projectContextMenu,
    pendingDelete, pendingProjectRemove, deletingTaskId, removingProjectCwd, extensionUiRequest,
    packagesOpen, settingsOpen, providerFocus, previewImage, imageContextMenu, setPendingDelete,
    setPendingProjectRemove, setContextMenu, setProjectContextMenu, setPackagesOpen, setSettingsOpen,
    setProviderFocus, setPreviewImage, setImageContextMenu, setExtensionUiRequest, openImageContextMenu, deleteTask,
    removeProject, refreshModels, showNotice, handlePermissionStatus, openProviderSettings,
    patchTaskUi, updateTaskLists, setMessageReload,
  } = controller;
  return <div className={`app-shell ${theme}${isMac ? " platform-macos" : ""}`}>
    <a className="skip-link" href="#main-content">{t.skipToContent}</a>
    <header className="titlebar">
      <div className="brand-lockup"><img className="brand-mark" src="./pideck-icon.png" alt="" aria-hidden="true" draggable={false} /><span className="brand-name">PiDeck</span><span className="brand-divider" /><span className="eyebrow">{t.workspace}</span></div>
      <div className="window-drag" />
      <div className="titlebar-actions">
        <button className="icon-button mobile-nav-trigger" type="button" title={mobileSidebarOpen ? t.closeNavigation : t.openNavigation} aria-label={mobileSidebarOpen ? t.closeNavigation : t.openNavigation} aria-expanded={mobileSidebarOpen} aria-controls="workspace-sidebar" onClick={() => setMobileSidebarOpen((current) => !current)}><Icon name="folder" /></button>
        <button className="quiet-button" onClick={openCommandPalette}><Icon name="command" />{t.command}<kbd>{shortcut("K")}</kbd></button>
        <button className="icon-button" title={theme === "light" ? t.themeToDark : t.themeToLight} aria-label={theme === "light" ? t.themeToDark : t.themeToLight} onClick={() => setTheme(theme === "light" ? "dark" : "light")}><Icon name={theme === "light" ? "moon" : "sun"} /></button>
        <button className="lang-button" aria-label={t.switchLanguage} title={t.switchLanguage} onClick={() => setLanguage(language === "zh" ? "en" : "zh")}>{language === "zh" ? "中" : "EN"}</button>
        <button className="icon-button" title={t.providerSettings} aria-label={t.providerSettings} onClick={() => openProviderSettings()}><Icon name="settings" /></button>
      </div>
    </header>

    <div className="workspace-grid">
      <AppSidebar
        language={language}
        t={t}
        sidebarRef={sidebarRef}
        searchInputRef={searchInputRef}
        mobileSidebarOpen={mobileSidebarOpen}
        projectCwd={projectCwd}
        projects={projects}
        tasks={tasks}
        projectTasksByCwd={projectTasksByCwd}
        projectTaskLoads={projectTaskLoads}
        expandedProjectCwds={expandedProjectCwds}
        searchQuery={searchQuery}
        activeTask={activeTask}
        initialLoading={initialLoading}
        runtimeStatus={runtimeStatus}
        shortcut={shortcut}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onCreateTask={createTask}
        onChooseProject={chooseProjectDirectory}
        onOpenCommandPalette={openCommandPalette}
        onSearchQuery={setSearchQuery}
        onSelectProject={selectProject}
        onOpenProjectContext={openProjectContextMenu}
        onSelectTask={selectTask}
        onOpenTaskContext={openContextMenu}
        onTaskMenu={(task, rect) => openContextMenu(task, rect.right - 160, rect.bottom + 4)}
        onLoadProjectSessions={loadProjectSessions}
        onRetry={loadInitialData}
      />

      <AppConversation
        language={language}
        t={t}
        scrollPositionsRef={scrollPositionsRef}
        scrollHandleRef={scrollHandleRef}
        activeTask={activeTask}
        activeProject={activeProject}
        projectCwd={projectCwd}
        tasks={tasks}
        initialLoading={initialLoading}
        loadError={loadError}
        messageLoad={messageLoad}
        messages={messages}
        isWorking={isWorking}
        streamText={streamText}
        workingPhase={workingPhase}
        activeTaskUi={activeTaskUi}
        steeringMessageKeys={activeTask ? steeringMessageKeysByTask[activeTask.id] ?? [] : []}
        showJumpToLatest={showJumpToLatest}
        permissionStatus={permissionStatus}
        composerProps={composerProps}
        onTimelineAtEnd={handleTimelineAtEnd}
        onRetryInitialLoad={loadInitialData}
        onChooseProject={chooseProjectDirectory}
        onCreateTask={createTask}
        onRetryMessages={() => setMessageReload((current) => current + 1)}
        onJumpToLatest={jumpToLatest}
        onResolveApproval={async (decision) => {
          if (!activeTaskUi?.approval) return;
          try { await window.pideck.approvals.resolve(activeTaskUi.approval.requestId, decision); if (activeTask) { patchTaskUi(activeTask.id, { approval: undefined, workingPhase: decision === "allow-once" ? "thinking" : null }); updateTaskLists((current) => current.map((task) => task.id === activeTask.id ? { ...task, state: decision === "allow-once" ? "running" : task.state } : task)); } }
          catch (error) { showNotice(error instanceof Error ? error.message : String(error)); throw error; }
        }}
        onPermissionStatus={handlePermissionStatus}
      />

    </div>

    {terminalOpen && <TerminalPanel language={language} cwd={projectCwd} output={terminalOutput} command={terminalCommand} running={terminalRunning} onCommand={setTerminalCommand} onExecute={() => void executeTerminal()} onClose={() => setTerminalOpen(false)} />}
    {paletteOpen && <CommandPaletteBoundary language={language} onClose={() => setPaletteOpen(false)}><CommandPalette language={language} commands={paletteCommands} shortcut={shortcut} onCommand={(command) => { updateComposer(`${composer}${composer && !composer.endsWith(" ") ? " " : ""}/${command.name} `); setPaletteOpen(false); }} onClose={() => setPaletteOpen(false)} onNewTask={() => { setPaletteOpen(false); void createTask(); }} onTerminal={() => { setPaletteOpen(false); setTerminalOpen(true); }} onSettings={() => { setPaletteOpen(false); openProviderSettings(); }} onPackages={() => { setPaletteOpen(false); setPackagesOpen(true); }} onCompact={activeTask ? () => { setPaletteOpen(false); void compactSession(); } : undefined} onExport={activeTask ? (format) => { setPaletteOpen(false); void exportSession(format); } : undefined} /></CommandPaletteBoundary>}
    {notice && <div className={`toast ${terminalOpen ? "with-terminal" : ""}`} role="status" aria-live="polite">{notice}</div>}
    {contextMenu && <div className="task-context-menu" role="menu" aria-label={t.moreActions} style={{ left: contextMenu.x, top: contextMenu.y }} onKeyDown={handleRovingMenuKeyDown} onClick={(event) => event.stopPropagation()}><button role="menuitem" autoFocus onClick={() => { setPendingDelete(contextMenu.task); setContextMenu(null); }}>{t.deleteSession}</button></div>}
    {projectContextMenu && <div className="task-context-menu" role="menu" aria-label={t.moreActions} style={{ left: projectContextMenu.x, top: projectContextMenu.y }} onKeyDown={handleRovingMenuKeyDown} onClick={(event) => event.stopPropagation()}><button role="menuitem" autoFocus disabled={removingProjectCwd !== null} onClick={() => { setPendingProjectRemove(projectContextMenu.project); setProjectContextMenu(null); }}>{t.removeProject}</button></div>}
    {pendingDelete && <ConfirmDialog language={language} task={pendingDelete} busy={deletingTaskId === pendingDelete.id} onCancel={() => setPendingDelete(null)} onConfirm={() => void deleteTask(pendingDelete)} />}
    {pendingProjectRemove && <ProjectRemoveDialog language={language} project={pendingProjectRemove} busy={removingProjectCwd === pendingProjectRemove.cwd} onCancel={() => setPendingProjectRemove(null)} onConfirm={() => void removeProject(pendingProjectRemove)} />}
    {extensionUiRequest && <ExtensionUiDialog request={extensionUiRequest} language={language} onResolve={(value) => { void window.pideck.extensions.resolveUi(extensionUiRequest.requestId, value).then(() => setExtensionUiRequest(null)).catch((error) => showNotice(error instanceof Error ? error.message : String(error))); }} />}
    {packagesOpen && <PackageSettings language={language} cwd={projectCwd} onClose={() => setPackagesOpen(false)} onNotice={showNotice} />}
    {settingsOpen && <ProviderSettings language={language} focusProviderId={providerFocus} onClose={() => { setSettingsOpen(false); setProviderFocus(null); }} onModelsRefresh={refreshModels} />}
    {previewImage && <ImagePreview image={previewImage} language={language} onClose={() => setPreviewImage(null)} onContextMenuImage={openImageContextMenu} />}
    {imageContextMenu && <ImageContextMenu language={language} x={imageContextMenu.x} y={imageContextMenu.y} onCopy={async () => { const copied = await copyImageToClipboard(imageContextMenu.image.src); setImageContextMenu(null); showNotice(copied ? t.copiedImage : t.copyImageFailed); }} />}
  </div>;
}
