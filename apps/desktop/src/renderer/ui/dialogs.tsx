import { useEffect, useRef, useState } from "react";
import type { ExtensionUiRequest, ModelSummary } from "@pideck/contracts";
import type { ProjectSummary, TaskSummary } from "@pideck/domain";
import { isDefaultSessionTitle } from "@pideck/domain";
import { copy, type Language } from "@pideck/i18n";
import { Icon, useDialogFocus } from "@pideck/ui-system";
import type { PreviewImage } from "../types";
import { handleRovingMenuKeyDown } from "./shared";

function ImagePreview({ image, language, onClose, onContextMenuImage }: { image: PreviewImage; language: Language; onClose: () => void; onContextMenuImage: (event: React.MouseEvent, image: PreviewImage) => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  return <div className="image-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="image-preview-dialog" role="dialog" aria-modal="true" aria-label={t.imagePreview}><button type="button" className="icon-button image-preview-close" onClick={onClose} aria-label={t.closeImagePreview} title={t.closeImagePreview}><Icon name="x" /></button><img src={image.src} alt={image.alt} onContextMenu={(event) => onContextMenuImage(event, image)} /></div></div>;
}

function CommandResultDialog({ language, title, body, onClose }: { language: Language; title: string; body: string; onClose: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby="command-result-title"><span className="eyebrow">Pi</span><h2 id="command-result-title">{title}</h2><p>{body}</p><div className="dialog-actions"><button type="button" className="button primary" onClick={onClose}>{t.commandResultClose}</button></div></div></div>;
}

function RenameSessionDialog({ language, currentName, onSave, onClose }: { language: Language; currentName: string; onSave: (name: string) => void; onClose: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(currentName);
  const [invalid, setInvalid] = useState(false);
  useDialogFocus(dialogRef, onClose);
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form ref={dialogRef} className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-session-title" onSubmit={(event) => { event.preventDefault(); const next = value.trim(); if (!next) { setInvalid(true); return; } onSave(next); }}><span className="eyebrow">Pi</span><h2 id="rename-session-title">{t.sessionNamePrompt}</h2><label className="session-name-field"><span>{t.sessionNamePrompt}</span><input autoFocus type="text" value={value} onChange={(event) => { setValue(event.target.value); setInvalid(false); }} /></label>{invalid && <div className="field-error" role="alert">{t.sessionNameRequired}</div>}<div className="dialog-actions"><button type="button" className="button ghost" onClick={onClose}>{t.cancel}</button><button type="submit" className="button primary">{t.save}</button></div></form></div>;
}

function ResumeSessionDialog({ language, project, tasks, activeTaskId, onSelect, onClose }: { language: Language; project: ProjectSummary | null; tasks: TaskSummary[]; activeTaskId?: string; onSelect: (task: TaskSummary) => void; onClose: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  const displayTitle = (title: string) => isDefaultSessionTitle(title) ? t.newTaskName : title;
  const displayModel = (model: string) => model && model !== "No model selected" ? model : t.noModelSelected;
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby="resume-title"><span className="eyebrow">Pi</span><h2 id="resume-title">{t.resumeTitle}</h2><p>{t.resumeDescription}</p>{!project || tasks.length === 0 ? <p>{t.noSessions}</p> : <div className="resume-list">{tasks.map((task) => <button type="button" className={`resume-row${task.id === activeTaskId ? " selected" : ""}`} key={task.id} onClick={() => onSelect(task)}><strong>{displayTitle(task.title)}</strong><small>{displayModel(task.model)}</small></button>)}</div>}<div className="dialog-actions"><button type="button" className="button ghost" onClick={onClose}>{t.cancel}</button></div></div></div>;
}

function TrustDialog({ language, onResolve, onClose }: { language: Language; onResolve: (trusted: boolean) => void; onClose: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby="trust-title"><span className="eyebrow">Pi</span><h2 id="trust-title">{t.trustTitle}</h2><p>{t.trustDescription}</p><div className="dialog-actions"><button type="button" className="button ghost" onClick={() => onResolve(false)}>{t.untrustProject}</button><button type="button" className="button primary" onClick={() => onResolve(true)}>{t.trustProject}</button></div></div></div>;
}

function ScopedModelsDialog({ language, models, selectedIds, onSave, onClose }: { language: Language; models: ModelSummary[]; selectedIds: string[]; onSave: (modelIds: string[] | null, persist: boolean) => void; onClose: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(() => new Set(selectedIds));
  const [persist, setPersist] = useState(false);
  useDialogFocus(dialogRef, onClose);
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const allSelected = models.length > 0 && selected.size === models.length;
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby="scoped-models-title"><span className="eyebrow">Pi</span><h2 id="scoped-models-title">{t.scopedModelsTitle}</h2><p>{t.scopedModelsDescription}</p><div className="model-scope-list">{models.map((model) => { const id = `${model.providerId}/${model.id}`; return <label key={id} className="model-scope-row"><input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} /><span><strong>{model.name}</strong><small>{id}</small></span></label>; })}</div><label className="model-scope-persist"><input type="checkbox" checked={persist} onChange={(event) => setPersist(event.target.checked)} />{t.scopedModelsPersist}</label><div className="dialog-actions"><button type="button" className="button ghost" onClick={onClose}>{t.cancel}</button><button type="button" className="button primary" disabled={models.length === 0} onClick={() => onSave(allSelected || selected.size === 0 ? null : [...selected], persist)}>{t.scopedModelsSave}</button></div></div></div>;
}

function ExtensionUiDialog({ language, request, onResolve }: { language: Language; request: ExtensionUiRequest; onResolve: (value: string | boolean | undefined) => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => setValue(request.prefill ?? ""), [request.requestId, request.prefill]);
  useDialogFocus(dialogRef, () => onResolve(request.kind === "confirm" ? false : undefined));
  const titleParts = request.title.split(/\r?\n/);
  return <div className="dialog-backdrop"><div ref={dialogRef} className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby="extension-ui-title"><span className="eyebrow">Pi Extension</span><h2 id="extension-ui-title">{titleParts[0]}</h2>{titleParts.slice(1).map((line, index) => <p key={index}>{line}</p>)}{request.message && <p>{request.message}</p>}{request.kind === "select" && <div className="extension-ui-options">{(request.options ?? []).map((option) => <button type="button" className="button ghost" key={option} onClick={() => onResolve(option)}>{option}</button>)}</div>}{request.kind === "confirm" && <div className="dialog-actions"><button type="button" className="button ghost" onClick={() => onResolve(false)}>{t.reject}</button><button type="button" className="button primary" onClick={() => onResolve(true)}>{t.approve}</button></div>}{(request.kind === "input" || request.kind === "editor") && <><textarea autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} rows={request.kind === "editor" ? 8 : 3} /><div className="dialog-actions"><button type="button" className="button ghost" onClick={() => onResolve(undefined)}>{t.cancel}</button><button type="button" className="button primary" onClick={() => onResolve(value)}>{t.submit}</button></div></>}</div></div>;
}

function ImageContextMenu({ language, x, y, onCopy }: { language: Language; x: number; y: number; onCopy: () => void }) {
  const t = copy[language];
  return <div className="image-context-menu" role="menu" aria-label={t.copyImage} style={{ left: x, top: y }} onKeyDown={handleRovingMenuKeyDown} onClick={(event) => event.stopPropagation()}><button type="button" role="menuitem" autoFocus onClick={onCopy}><Icon name="copy" size={13} />{t.copyImage}</button></div>;
}

function ConfirmDialog({ language, task, busy, onCancel, onConfirm }: { language: Language; task: TaskSummary; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, () => { if (!busy) onCancel(); });
  return <div className="dialog-backdrop"><div ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description"><span className="confirm-icon"><Icon name="alert" /></span><h2 id="delete-title">{t.deleteSessionTitle}</h2><p id="delete-description">{t.deleteSessionBody(task.title)}</p><div><button className="button ghost" disabled={busy} onClick={onCancel}>{t.cancel}</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? t.deleting : t.deleteSession}</button></div></div></div>;
}

function ProjectRemoveDialog({ language, project, busy, onCancel, onConfirm }: { language: Language; project: ProjectSummary; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, () => { if (!busy) onCancel(); });
  return <div className="dialog-backdrop"><div ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="project-remove-title" aria-describedby="project-remove-description"><span className="confirm-icon"><Icon name="alert" /></span><h2 id="project-remove-title">{t.removeProjectTitle}</h2><p id="project-remove-description">{t.removeProjectBody(project.name)}</p><div><button className="button ghost" disabled={busy} onClick={onCancel}>{t.cancel}</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? t.removingProject : t.removeProject}</button></div></div></div>;
}

export { ImagePreview, CommandResultDialog, RenameSessionDialog, ResumeSessionDialog, TrustDialog, ScopedModelsDialog, ExtensionUiDialog, ImageContextMenu, ConfirmDialog, ProjectRemoveDialog };
