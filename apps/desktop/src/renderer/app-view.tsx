import { Icon } from "@pideck/ui-system";
import { AppConversation } from "./app-conversation";
import { AppOverlays } from "./app-overlays";
import { AppSidebar } from "./app-sidebar";
import type { AppController } from "./use-app-controller";

export function AppView({ controller }: { controller: AppController }) {
  const {
    language, setLanguage, theme, themePreference, cycleTheme, projectCwd, projects, expandedProjectCwds, tasks,
    projectTasksByCwd, projectTaskLoads, activeTask, initialLoading, projectSwitching, runtimeStatus, shortcut, t, isMac,
    sidebarRef, searchInputRef, mobileSidebarOpen, setMobileSidebarOpen, createTask, chooseProjectDirectory,
    openCommandPalette, selectProject, openProjectContextMenu, selectTask, openContextMenu, loadProjectSessions, createTaskForProject,
    searchQuery, setSearchQuery,
    loadInitialData, scrollPositionsRef, scrollHandleRef, handleTimelineAtEnd, activeProject, loadError, messageLoad, messages, isWorking, streamText,
    workingPhase, activeTaskUi, steeringMessageKeysByTask, showJumpToLatest, permissionStatus,
    composerProps, jumpToLatest,
    setMessageReload, showNotice, handlePermissionStatus, openProviderSettings,
    patchTaskUi, updateTaskLists, restartHost,
  } = controller;
  return <div className={`app-shell ${theme}${isMac ? " platform-macos" : " platform-overlay"}`}>
    <a className="skip-link" href="#main-content">{t.skipToContent}</a>
    <header className="titlebar">
      <div className="brand-lockup"><img className="brand-mark" src="./pideck-icon.png" alt="" aria-hidden="true" draggable={false} /><span className="brand-name">PiDeck</span><span className="brand-divider" /><span className="eyebrow">{t.workspace}</span></div>
      <div className="window-drag" />
      <div className="titlebar-actions">
        <button className="icon-button mobile-nav-trigger" type="button" title={mobileSidebarOpen ? t.closeNavigation : t.openNavigation} aria-label={mobileSidebarOpen ? t.closeNavigation : t.openNavigation} aria-expanded={mobileSidebarOpen} aria-controls="workspace-sidebar" onClick={() => setMobileSidebarOpen((current) => !current)}><Icon name="folder" /></button>
        <button className="quiet-button" onClick={openCommandPalette}><Icon name="command" />{t.command}<kbd>{shortcut("K")}</kbd></button>
        <button className="icon-button" title={themePreference === "system" ? t.themeToLight : theme === "light" ? t.themeToDark : t.themeToSystem} aria-label={themePreference === "system" ? t.themeToLight : theme === "light" ? t.themeToDark : t.themeToSystem} onClick={cycleTheme}><Icon name={themePreference === "system" ? "auto" : theme === "light" ? "moon" : "sun"} /></button>
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
        onCreateTaskForProject={createTaskForProject}
        onChooseProject={chooseProjectDirectory}
        onOpenCommandPalette={openCommandPalette}
        onSearchQuery={setSearchQuery}
        onSelectProject={selectProject}
        onOpenProjectContext={openProjectContextMenu}
        onSelectTask={selectTask}
        onOpenTaskContext={openContextMenu}
        onTaskMenu={(task, rect) => openContextMenu(task, rect.right - 160, rect.bottom + 4)}
        onLoadProjectSessions={loadProjectSessions}
        onRetry={runtimeStatus === "disconnected" ? restartHost : loadInitialData}
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
        projectSwitching={projectSwitching}
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
        onRetryInitialLoad={runtimeStatus === "disconnected" ? restartHost : loadInitialData}
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

    <AppOverlays controller={controller} />
  </div>;
}
