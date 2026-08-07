import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Editor from "react-simple-code-editor";
import type { AgentQueueState, ContextUsage, ModelSummary, QueueDelivery, QueueMode } from "@pideck/contracts";
import { copy, type Language } from "@pideck/i18n";
import { Icon } from "@pideck/ui-system";
import type { ImageAttachment, PreviewImage, SuggestionMode } from "../types";
import { ContextRingPopover } from "./context-ring";
import { handleRovingMenuKeyDown } from "./shared";

function highlightComposerText(value: string, commandNames: string[]): ReactNode[] {
  const commands = new Set(commandNames.map((name) => name.replace(/^\//, "").toLowerCase()));
  const result: ReactNode[] = [];
  const pattern = /(^|\s)(\/(?:skill:)?[A-Za-z][\w:-]*|@[\w./\\-]+)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    const prefix = match[1] ?? "";
    const token = match[2] ?? "";
    const isCommand = token.startsWith("/skill:") || commands.has(token.slice(1).toLowerCase());
    if (!isCommand && token.startsWith("/")) continue;
    if (start > cursor) result.push(<span key={`text-${cursor}`}>{value.slice(cursor, start)}</span>);
    if (prefix) result.push(<span key={`space-${start}`}>{prefix}</span>);
    const isSkill = token.startsWith("/skill:");
    const isMention = token.startsWith("@");
    result.push(<mark className={`composer-token ${isSkill ? "skill-token" : isMention ? "mention-token" : "command-token"}`} key={`token-${start}`}>{token}</mark>);
    cursor = start + match[0].length;
  }
  if (cursor < value.length) result.push(<span key={`text-${cursor}`}>{value.slice(cursor)}</span>);
  return result;
}

export type ComposerProps = { sessionKey: string; value: string; onChange: (value: string) => void; onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void; onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void; onSend: () => void; onStop: () => void; isSending: boolean; language: Language; activeModel: ModelSummary | null; modelOptions: ModelSummary[]; thinkingLevel: string; thinkingLevels: string[]; thinkingMenuOpen: boolean; modelMenuOpen: boolean; suggestionMode: SuggestionMode; suggestions: any[]; suggestionIndex: number; contextUsage?: ContextUsage; commandNames: string[]; attachments: ImageAttachment[]; onRemoveAttachment: (id: string) => void; onPreviewImage: (image: PreviewImage) => void; onContextMenuImage: (event: React.MouseEvent, image: PreviewImage) => void; onThinkingMenu: () => void; onModelMenu: () => void; onThinking: (level: string) => void; onModel: (model: ModelSummary) => void; onSuggestion: (item: any) => void; queueDelivery: QueueDelivery; queueState: AgentQueueState | null; queueMutationBusy: boolean; onQueueDelivery: (delivery: QueueDelivery) => void; onQueueModes: (modes: { steeringMode?: QueueMode; followUpMode?: QueueMode }) => void; onClearQueue: () => void; onPromoteQueue: (followUpIndex: number) => void };

function Composer(props: ComposerProps) {
  const t = copy[props.language];
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const queueMenuRef = useRef<HTMLDivElement>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [queueMenuOpen, setQueueMenuOpen] = useState(false);
  const filteredModels = props.modelOptions.filter((model) => `${model.providerName} ${model.name}`.toLowerCase().includes(modelQuery.toLowerCase()));
  const activeModelIndex = filteredModels.findIndex((model) => model.id === props.activeModel?.id && model.providerId === props.activeModel?.providerId);
  useEffect(() => { suggestionRefs.current[props.suggestionIndex]?.scrollIntoView({ block: "nearest" }); }, [props.suggestionIndex, props.suggestions.length, props.suggestionMode]);
  useEffect(() => { if (!props.modelMenuOpen) setModelQuery(""); }, [props.modelMenuOpen]);
  useEffect(() => {
    if (!queueMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !queueMenuRef.current?.contains(event.target)) setQueueMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [queueMenuOpen]);
  useLayoutEffect(() => {
    const root = editorRootRef.current;
    const textarea = root?.querySelector<HTMLTextAreaElement>("textarea");
    const highlight = root?.querySelector<HTMLElement>("pre");
    if (!textarea || !highlight) return;
    const syncScroll = () => {
      // The highlight layer is not the editable viewport. Translate it with
      // the textarea instead of giving it an independent scroll position.
      highlight.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    };
    const selection = pendingSelectionRef.current;
    if (selection && textarea.value === props.value) {
      textarea.setSelectionRange(
        Math.min(selection.start, props.value.length),
        Math.min(selection.end, props.value.length),
      );
      pendingSelectionRef.current = null;
    }
    syncScroll();
    const frame = window.requestAnimationFrame(syncScroll);
    textarea.addEventListener("scroll", syncScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      textarea.removeEventListener("scroll", syncScroll);
    };
  }, [props.value]);
  const handleEditorValueChange = (value: string) => {
    const textarea = editorRootRef.current?.querySelector<HTMLTextAreaElement>("textarea");
    if (textarea) pendingSelectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
    props.onChange(value);
  };
  const queuedMessages = [
    ...(props.queueState?.steering ?? []).map((message, queueIndex) => ({ message, kind: "steering" as const, queueIndex })),
    ...(props.queueState?.followUp ?? []).map((message, queueIndex) => ({ message, kind: "followUp" as const, queueIndex })),
  ];
  const hasDraft = props.value.trim().length > 0 || props.attachments.length > 0;
  const stopOnly = props.isSending && !hasDraft;
  const handleEditorPaste: React.ClipboardEventHandler<HTMLElement> = (event) => props.onPaste(event as unknown as React.ClipboardEvent<HTMLTextAreaElement>);
  const handleEditorKeyDown: React.KeyboardEventHandler<HTMLElement> = (event) => props.onKeyDown(event as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
  return <div className="composer-wrap"><div className="composer-shell">
    {queuedMessages.length > 0 && <section className="composer-queue" aria-live="polite" aria-label={t.queuedMessages}>
      <div className="composer-queue-header"><Icon name="queue" size={14} /><strong>{t.queuedMessages}</strong><span>{queuedMessages.length}</span></div>
      <div className="composer-queue-list">{queuedMessages.map((item, index) => <article className="composer-queue-item" key={`${item.kind}-${index}-${item.message}`}><span className="composer-queue-index">{index + 1}</span><p>{item.message}</p>{item.kind === "followUp" ? <button type="button" className="composer-queue-promote" disabled={props.queueMutationBusy} onClick={() => props.onPromoteQueue(item.queueIndex)}>{props.queueMutationBusy ? t.loading : t.queuePromote}</button> : <span className="composer-queue-status" role="status">{t.queueSteeringStatus}</span>}</article>)}</div>
    </section>}
    {props.suggestionMode && props.suggestions.length > 0 && <div className="suggestion-popover" role="listbox" id="composer-suggestions" aria-label={props.suggestionMode === "mention" ? t.files : t.command}>{props.suggestions.map((item, index) => <button id={`composer-suggestion-${index}`} ref={(element) => { suggestionRefs.current[index] = element; }} key={item.name ?? item.path} type="button" role="option" aria-selected={index === props.suggestionIndex} className={index === props.suggestionIndex ? "selected" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => props.onSuggestion(item)}><span className="suggestion-symbol">{props.suggestionMode === "mention" ? "@" : "/"}</span><span><strong>{item.name ?? item.path}</strong><small>{item.description ?? item.path}</small></span></button>)}</div>}
    <div className="composer">{props.attachments.length > 0 && <div className="composer-attachments">{props.attachments.map((image) => <div className="composer-attachment" key={image.id}><button type="button" className="composer-image-preview" aria-label={t.imagePreview} title={t.imagePreview} onClick={() => props.onPreviewImage({ src: `data:${image.mimeType};base64,${image.data}`, alt: image.name || t.imageAttached })} onContextMenu={(event) => props.onContextMenuImage(event, { src: `data:${image.mimeType};base64,${image.data}`, alt: image.name || t.imageAttached })}><img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name || t.imageAttached} /></button><button type="button" className="composer-remove-image" aria-label={t.removeImage} title={t.removeImage} onClick={() => props.onRemoveAttachment(image.id)}><Icon name="x" size={11} /></button></div>)}</div>}<div ref={editorRootRef} className="composer-editor"><Editor className="composer-editor-surface" style={{ display: "block", width: "100%" }} value={props.value} onValueChange={handleEditorValueChange} highlight={(code) => <>{code ? highlightComposerText(code, props.commandNames) : <span className="composer-placeholder">{t.ask}</span>}</>} textareaClassName="composer-editor-input" preClassName="composer-highlight" padding={0} onPaste={handleEditorPaste} onKeyDown={handleEditorKeyDown} autoFocus placeholder="" aria-label={t.ask} aria-controls="composer-suggestions" aria-activedescendant={props.suggestionMode && props.suggestions.length ? `composer-suggestion-${props.suggestionIndex}` : undefined} aria-expanded={Boolean(props.suggestionMode && props.suggestions.length)} /></div><div className="composer-footer"><div className="composer-tools">
      <div className="menu-anchor"><button className="chip" title={t.chooseThinking} aria-haspopup="menu" aria-controls="thinking-menu" aria-expanded={props.thinkingMenuOpen} onClick={props.onThinkingMenu}><Icon name="spark" size={14} /><span>{props.thinkingLevel}</span><Icon name="chevron" size={13} /></button>{props.thinkingMenuOpen && <div className="inline-menu" id="thinking-menu" role="menu" aria-label={t.chooseThinking} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); props.onThinkingMenu(); } else handleRovingMenuKeyDown(event); }}><strong>{t.chooseThinking}</strong>{props.thinkingLevels.map((level, index) => <button role="menuitemradio" aria-checked={level === props.thinkingLevel} tabIndex={level === props.thinkingLevel || (!props.thinkingLevels.includes(props.thinkingLevel) && index === 0) ? 0 : -1} autoFocus={level === props.thinkingLevel || (!props.thinkingLevels.includes(props.thinkingLevel) && index === 0)} key={level} className={level === props.thinkingLevel ? "active" : ""} onClick={() => props.onThinking(level)}>{level}</button>)}</div>}</div>
      <div className="menu-anchor"><button className="model-chip" title={t.chooseModel} aria-haspopup="menu" aria-controls="model-menu" aria-expanded={props.modelMenuOpen} onClick={props.onModelMenu}><Icon name="model" size={14} /><span className="model-provider">{props.activeModel?.providerName ?? t.provider}</span><span>{props.activeModel?.name ?? (props.modelOptions.length ? t.chooseModel : t.models)}</span><ContextRingPopover usage={props.contextUsage} language={props.language} /><Icon name="chevron" size={13} /></button>{props.modelMenuOpen && <div className="inline-menu model-menu" id="model-menu" role="menu" aria-label={t.models} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); props.onModelMenu(); } else handleRovingMenuKeyDown(event); }}><label className="model-search"><Icon name="search" size={13} /><input autoFocus value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder={t.searchModels} aria-label={t.searchModels} /></label>{filteredModels.length === 0 ? <span className="menu-empty">{props.modelOptions.length ? t.noMatchingCommands : t.configureProvider}</span> : filteredModels.map((model, index) => <button role="menuitemradio" aria-checked={model.id === props.activeModel?.id && model.providerId === props.activeModel?.providerId} tabIndex={index === (activeModelIndex >= 0 ? activeModelIndex : 0) ? 0 : -1} key={`${model.providerId}/${model.id}`} className={model.id === props.activeModel?.id && model.providerId === props.activeModel?.providerId ? "active" : ""} onClick={() => props.onModel(model)}><span><strong>{model.name}</strong><small>{model.providerName}</small></span><Icon name="check" size={12} /></button>)}</div>}</div>
      <button className="chip subtle" aria-label={t.mentionLabel} title={t.mentionLabel} onClick={() => props.onChange(`${props.value}${props.value ? " " : ""}@`)}><Icon name="plus" size={14} />@</button>
      <div ref={queueMenuRef} className="menu-anchor"><button className="chip subtle" title={t.queueMode} aria-haspopup="menu" aria-controls="queue-menu" aria-expanded={queueMenuOpen} onClick={() => setQueueMenuOpen((current) => !current)}><Icon name="queue" size={13} /><span>{props.queueDelivery === "steer" ? t.steering : t.followUp}</span>{props.queueState && (props.queueState.steering.length + props.queueState.followUp.length) > 0 && <small>{props.queueState.steering.length + props.queueState.followUp.length}</small>}<Icon name="chevron" size={13} /></button>{queueMenuOpen && <div className="inline-menu" id="queue-menu" role="menu" aria-label={t.queueMode}><strong>{t.queueDelivery}</strong><button role="menuitemradio" aria-checked={props.queueDelivery === "steer"} className={props.queueDelivery === "steer" ? "active" : ""} onClick={() => { props.onQueueDelivery("steer"); setQueueMenuOpen(false); }}>{t.steering}</button><button role="menuitemradio" aria-checked={props.queueDelivery === "followUp"} className={props.queueDelivery === "followUp" ? "active" : ""} onClick={() => { props.onQueueDelivery("followUp"); setQueueMenuOpen(false); }}>{t.followUp}</button>{props.queueState && <><strong>{t.queueBatchMode}</strong><button role="menuitem" onClick={() => props.onQueueModes({ steeringMode: "all", followUpMode: "all" })}>{t.queueAll}</button><button role="menuitem" onClick={() => props.onQueueModes({ steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" })}>{t.queueOneAtATime}</button>{(props.queueState.steering.length + props.queueState.followUp.length) > 0 && <button role="menuitem" disabled={props.queueMutationBusy} onClick={() => { props.onClearQueue(); setQueueMenuOpen(false); }}>{t.clearQueue}</button>}</>}</div>}</div>
    </div><span className="composer-hint">{t.shiftEnter}</span><button className="send-button" disabled={!props.isSending && !hasDraft} aria-label={stopOnly ? t.stop : t.send} title={stopOnly ? t.stop : t.send} onClick={stopOnly ? props.onStop : props.onSend}><Icon name={stopOnly ? "stop" : "send"} size={16} /></button></div></div>
  </div></div>;
}

const MemoComposer = memo(Composer, (previous, next) =>
  previous.sessionKey === next.sessionKey
  && previous.value === next.value
  && previous.isSending === next.isSending
  && previous.language === next.language
  && previous.activeModel === next.activeModel
  && previous.modelOptions === next.modelOptions
  && previous.thinkingLevel === next.thinkingLevel
  && previous.thinkingLevels === next.thinkingLevels
  && previous.thinkingMenuOpen === next.thinkingMenuOpen
  && previous.modelMenuOpen === next.modelMenuOpen
  && previous.suggestionMode === next.suggestionMode
  && previous.suggestions === next.suggestions
  && previous.suggestionIndex === next.suggestionIndex
  && previous.contextUsage === next.contextUsage
  && previous.commandNames === next.commandNames
  && previous.attachments === next.attachments
  && previous.queueDelivery === next.queueDelivery
  && previous.queueState === next.queueState
  && previous.queueMutationBusy === next.queueMutationBusy
);

export { Composer, MemoComposer };
