import type { TaskSummary } from "@pideck/domain";
import { isDefaultSessionTitle } from "@pideck/domain";
import { copy, type Language } from "@pideck/i18n";
import { Icon } from "@pideck/ui-system";

function StateMark({ state, language }: { state: TaskSummary["state"]; language: Language }) {  const labels = copy[language].sessionState;
  if (state === "running") return <span className="state-mark running" role="img" aria-label={labels.running} />;
  if (state === "waiting-approval") return <span className="state-mark approval" role="img" aria-label={labels.approval}>!</span>;
  if (state === "completed") return <span className="state-mark completed" role="img" aria-label={labels.completed}><Icon name="check" size={12} /></span>;
  if (state === "failed") return <span className="state-mark failed" role="img" aria-label={labels.failed}>×</span>;
  return <span className="state-mark idle" role="img" aria-label={labels.idle} />;
}

function TaskRow({ task, active, language, onClick, onContextMenu, onMenu }: { task: TaskSummary; active: boolean; language: Language; onClick: () => void; onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void; onMenu: (rect: DOMRect) => void }) {
  const t = copy[language];
  const displayTitle = isDefaultSessionTitle(task.title) ? t.newTaskName : task.title;
  return <div className={`task-row ${active ? "active" : ""}`} onContextMenu={onContextMenu}><button className="task-main" onClick={onClick} aria-current={active ? "page" : undefined} title={displayTitle}><span className="task-copy"><strong>{displayTitle}</strong></span>{task.state === "running" && <span className="task-working-spinner" role="img" aria-label={t.sessionState.running} title={t.sessionState.running} />}{task.state === "waiting-approval" && <span className="task-approval-mark" role="img" aria-label={t.sessionState.approval} title={t.sessionState.approval}>!</span>}{task.unread && <span className="unread-dot" role="img" aria-label={t.unread} title={t.unread} />}</button><button className="task-more" aria-label={t.moreActions} title={t.moreActions} onClick={(event) => { event.stopPropagation(); onMenu(event.currentTarget.getBoundingClientRect()); }}><Icon name="more" size={14} /></button></div>;
}

export { StateMark, TaskRow };
