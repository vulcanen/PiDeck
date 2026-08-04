import type { RefObject } from "react";
import type { ProjectSummary, TaskSummary } from "@pideck/domain";
import { copy, type Language } from "@pideck/i18n";
import { Icon } from "@pideck/ui-system";
import { SidebarSkeleton, TaskRow } from "./ui-components";

type AppCopy = (typeof copy)[Language];

export interface AppSidebarProps {
  language: Language;
  t: AppCopy;
  sidebarRef: RefObject<HTMLElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  mobileSidebarOpen: boolean;
  projectCwd: string;
  projects: ProjectSummary[];
  tasks: TaskSummary[];
  projectTasksByCwd: Record<string, TaskSummary[]>;
  projectTaskLoads: Record<string, { status: "idle" | "loading" | "ready" | "error"; error?: string }>;
  expandedProjectCwds: string[];
  searchQuery: string;
  activeTask: TaskSummary | null;
  initialLoading: boolean;
  runtimeStatus: "connected" | "starting" | "disconnected";
  shortcut: (key: string) => string;
  onCloseMobile: () => void;
  onOpenCommandPalette: () => void;
  onCreateTask: () => void | Promise<unknown>;
  onChooseProject: () => void | Promise<unknown>;
  onSearchQuery: (value: string) => void;
  onSelectProject: (project: ProjectSummary) => void | Promise<unknown>;
  onOpenProjectContext: (project: ProjectSummary, x: number, y: number) => void;
  onSelectTask: (project: ProjectSummary, task: TaskSummary) => void | Promise<unknown>;
  onOpenTaskContext: (task: TaskSummary, x: number, y: number) => void;
  onTaskMenu: (task: TaskSummary, rect: DOMRect) => void;
  onLoadProjectSessions: (project: ProjectSummary) => void | Promise<unknown>;
  onRetry: () => void | Promise<unknown>;
}

export function AppSidebar({
  language, t, sidebarRef, searchInputRef, mobileSidebarOpen, projectCwd, projects, tasks,
  projectTasksByCwd, projectTaskLoads, expandedProjectCwds, searchQuery, activeTask,
  initialLoading, runtimeStatus, shortcut, onCloseMobile, onOpenCommandPalette, onCreateTask,
  onChooseProject, onSearchQuery, onSelectProject, onOpenProjectContext, onSelectTask,
  onOpenTaskContext, onTaskMenu, onLoadProjectSessions, onRetry,
}: AppSidebarProps) {
  const normalizedQuery = searchQuery.toLocaleLowerCase();
  return <>
    <aside ref={sidebarRef} id="workspace-sidebar" className={`sidebar ${mobileSidebarOpen ? "mobile-open" : ""}`} aria-label={t.openNavigation}>
      <div className="sidebar-mobile-header"><strong>{t.projects}</strong><button className="icon-button" type="button" title={t.closeNavigation} aria-label={t.closeNavigation} onClick={onCloseMobile}><Icon name="x" /></button></div>
      <button className="new-task" disabled={!projectCwd || initialLoading} onClick={() => { onCloseMobile(); void onCreateTask(); }}><span className="new-task-icon"><Icon name="plus" /></span><span>{t.newTask}</span><kbd>{shortcut("N")}</kbd></button>
      <label className="search-box"><Icon name="search" size={15} /><input ref={searchInputRef} value={searchQuery} onChange={(event) => onSearchQuery(event.target.value)} placeholder={t.search} aria-label={t.search} /><kbd>/</kbd></label>
      <div className="sidebar-scroll">
        <div className="section-label"><span>{t.projects}</span><button className="project-add" type="button" title={t.openProject} aria-label={t.openProject} disabled={initialLoading} onClick={() => void onChooseProject()}><Icon name="plus" size={13} /></button></div>
        <div className="project-list">
          {initialLoading && projects.length === 0 && <SidebarSkeleton />}
          {!initialLoading && projects.length === 0 && <div className="empty-sidebar"><strong>{t.noProjects}</strong><button className="button primary" type="button" onClick={() => void onChooseProject()}><Icon name="plus" size={14} />{t.openProject}</button></div>}
          {projects.map((project) => {
            const selected = project.cwd === projectCwd;
            const expanded = expandedProjectCwds.includes(project.cwd);
            const projectTasks = selected ? tasks : projectTasksByCwd[project.cwd] ?? [];
            const filteredProjectTasks = projectTasks.filter((task) => task.title.toLocaleLowerCase().includes(normalizedQuery));
            const projectTaskLoad = selected ? { status: initialLoading ? "loading" as const : "ready" as const } : projectTaskLoads[project.cwd] ?? { status: "idle" as const };
            return <section className={`project-group ${selected ? "selected" : ""} ${expanded ? "expanded" : ""}`} key={project.id}>
              <button className="project-row" type="button" disabled={initialLoading} aria-expanded={expanded} title={project.cwd} onClick={() => void onSelectProject(project)} onContextMenu={(event) => { event.preventDefault(); onOpenProjectContext(project, event.clientX, event.clientY); }} onKeyDown={(event) => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onOpenProjectContext(project, rect.left + 24, rect.bottom - 4); } }}>
                <Icon name={expanded ? "folderOpen" : "folder"} size={17} />
                <span className="project-row-copy"><strong>{project.name}</strong></span>
                <Icon name="chevron" size={14} />
              </button>
              {expanded && <div className="project-sessions"><div className="task-list">
                {projectTaskLoad.status === "loading" && projectTasks.length === 0 ? <SidebarSkeleton /> : filteredProjectTasks.map((task) => <TaskRow key={task.id} task={task} active={selected && activeTask?.id === task.id} language={language} onClick={() => void onSelectTask(project, task)} onContextMenu={(event) => { event.preventDefault(); onOpenTaskContext(task, event.clientX, event.clientY); }} onMenu={(rect) => onTaskMenu(task, rect)} />)}
                {projectTaskLoad.status === "error" && <div className="empty-sidebar" role="alert"><strong>{t.projectSessionsLoadFailed}</strong><span>{projectTaskLoad.error}</span><button className="button ghost" type="button" onClick={() => void onLoadProjectSessions(project)}>{t.retry}</button></div>}
                {projectTaskLoad.status === "ready" && filteredProjectTasks.length === 0 && <div className="empty-sidebar"><strong>{searchQuery ? t.noSessionMatches : t.noSessions}</strong><span>{searchQuery ? t.tryAnotherSearch : t.createFirst}</span>{!searchQuery && <button className="button primary" type="button" onClick={() => void onCreateTask()}><Icon name="plus" size={14} />{t.newTask}</button>}</div>}
              </div></div>}
            </section>;
          })}
        </div>
      </div>
      <div className="sidebar-footer">
        <button className="sidebar-command" type="button" onClick={() => { onCloseMobile(); onOpenCommandPalette(); }}><Icon name="command" /><span>{t.command}</span><kbd>{shortcut("K")}</kbd></button>
        <div className={`runtime-status ${runtimeStatus}`}><span className="status-dot" /><span>{runtimeStatus === "connected" ? t.connected : runtimeStatus === "starting" ? t.runtimeStarting : t.runtimeDisconnected}</span>{runtimeStatus === "disconnected" && <button onClick={() => void onRetry()}>{t.retry}</button>}</div>
      </div>
    </aside>
    {mobileSidebarOpen && <button className="sidebar-backdrop" type="button" tabIndex={-1} title={t.closeNavigation} aria-label={t.closeNavigation} onClick={onCloseMobile} />}
  </>;
}
