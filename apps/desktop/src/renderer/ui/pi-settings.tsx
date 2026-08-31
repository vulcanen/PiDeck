import { useEffect, useRef, useState } from "react";
import type { ModelSummary, PiSettingsSummary, PiSettingsUpdate } from "@pideck/contracts";
import { copy, type Language } from "@pideck/i18n";
import { Icon, useDialogFocus } from "@pideck/ui-system";

export function PiSettings({ language, cwd, models, onClose, onNotice }: {
  language: Language;
  cwd: string;
  models: ModelSummary[];
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const t = copy[language];
  const dialogRef = useRef<HTMLElement>(null);
  const [settings, setSettings] = useState<PiSettingsSummary | null>(null);
  const [editorMode, setEditorMode] = useState<"automatic" | "custom">("automatic");
  const [busy, setBusy] = useState(false);
  const [editorPicking, setEditorPicking] = useState(false);
  const [editorPickerError, setEditorPickerError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDialogFocus(dialogRef, onClose);

  function applySettings(value: PiSettingsSummary) {
    setSettings(value);
    setEditorMode(value.externalEditor ? "custom" : "automatic");
  }

  async function loadSettings() {
    setError(null);
    try {
      const value = await window.pideck.settings.get(cwd || undefined);
      applySettings(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  useEffect(() => {
    let active = true;
    setError(null);
    void window.pideck.settings.get(cwd || undefined)
      .then((value) => { if (active) applySettings(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [cwd]);

  async function save() {
    if (!settings) return;
    setBusy(true); setError(null);
    try {
      const update: PiSettingsUpdate = {
        defaultProvider: settings.defaultProvider,
        defaultModel: settings.defaultModel,
        defaultThinkingLevel: settings.defaultThinkingLevel,
        transport: settings.transport,
        compactionEnabled: settings.compactionEnabled,
        steeringMode: settings.steeringMode,
        followUpMode: settings.followUpMode,
        externalEditor: editorMode === "automatic" ? "" : settings.externalEditor,
      };
      const next = await window.pideck.settings.update(update, cwd || undefined);
      setSettings(next);
      onNotice(t.piSettingsSaved);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function chooseExternalEditor() {
    setEditorPicking(true); setEditorPickerError(null);
    try {
      const command = await window.pideck.settings.chooseExternalEditor();
      if (command) setSettings((current) => current ? { ...current, externalEditor: command } : current);
    } catch (reason) { setEditorPickerError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setEditorPicking(false); }
  }

  const modelValue = settings?.defaultProvider && settings.defaultModel ? `${settings.defaultProvider}/${settings.defaultModel}` : "";
  const editorCommandMissing = editorMode === "custom" && !settings?.externalEditor?.trim();
  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="settings-sheet pi-settings" role="dialog" aria-modal="true" aria-labelledby="pi-settings-title" data-testid="pi-settings-dialog">
      <div className="settings-header"><div><span className="eyebrow">Pi</span><h2 id="pi-settings-title">{t.piSettingsTitle}</h2><p>{t.piSettingsDescription}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label={t.closeSettings}><Icon name="x" /></button></div>
      {!settings && !error && <div className="provider-list-empty">{t.loading}</div>}
      {error && <div className="auth-error" role="alert"><span>{error}</span><button type="button" className="button ghost" onClick={() => void loadSettings()}>{t.retry}</button></div>}
      {settings && <div className="pi-settings-fields">
        <label><span>{t.piDefaultModel}</span><select value={modelValue} onChange={(event) => { const [defaultProvider, ...parts] = event.target.value.split("/"); setSettings((current) => current ? { ...current, defaultProvider, defaultModel: parts.join("/") } : current); }}><option value="" disabled>{t.chooseModel}</option>{models.map((model) => <option key={`${model.providerId}/${model.id}`} value={`${model.providerId}/${model.id}`}>{model.providerName} · {model.name}</option>)}</select></label>
        <label><span>{t.piDefaultThinking}</span><select value={settings.defaultThinkingLevel} onChange={(event) => setSettings({ ...settings, defaultThinkingLevel: event.target.value })}>{["off", "minimal", "low", "medium", "high", "xhigh"].map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
        <label><span>{t.piTransport}</span><select value={settings.transport} onChange={(event) => setSettings({ ...settings, transport: event.target.value as PiSettingsSummary["transport"] })}><option value="auto">auto</option><option value="sse">SSE</option><option value="websocket">WebSocket</option></select></label>
        <label><span>{t.piSteeringMode}</span><select value={settings.steeringMode} onChange={(event) => setSettings({ ...settings, steeringMode: event.target.value as PiSettingsSummary["steeringMode"] })}><option value="one-at-a-time">one-at-a-time</option><option value="all">all</option></select></label>
        <label><span>{t.piFollowUpMode}</span><select value={settings.followUpMode} onChange={(event) => setSettings({ ...settings, followUpMode: event.target.value as PiSettingsSummary["followUpMode"] })}><option value="one-at-a-time">one-at-a-time</option><option value="all">all</option></select></label>
        <fieldset className="pi-settings-editor">
          <legend>{t.piExternalEditor}</legend>
          <div className="pi-settings-editor-modes">
            <label className={`pi-settings-editor-mode${editorMode === "automatic" ? " selected" : ""}`}>
              <input type="radio" name="external-editor-mode" value="automatic" data-testid="pi-external-editor-automatic" checked={editorMode === "automatic"} onChange={() => setEditorMode("automatic")} />
              <span><strong>{t.piExternalEditorAutomatic}</strong><small>{t.piExternalEditorAutomaticDescription}</small></span>
            </label>
            <label className={`pi-settings-editor-mode${editorMode === "custom" ? " selected" : ""}`}>
              <input type="radio" name="external-editor-mode" value="custom" data-testid="pi-external-editor-custom" checked={editorMode === "custom"} onChange={() => setEditorMode("custom")} />
              <span><strong>{t.piExternalEditorCustom}</strong><small>{t.piExternalEditorCustomDescription}</small></span>
            </label>
          </div>
          {editorMode === "custom" && <div className="pi-settings-editor-control">
            <label htmlFor="pi-external-editor-command">{t.piExternalEditorCommand}</label>
            <div className="pi-settings-editor-command-row">
              <input id="pi-external-editor-command" type="text" data-testid="pi-external-editor" value={settings.externalEditor ?? ""} maxLength={1000} autoComplete="off" spellCheck={false} placeholder={t.piExternalEditorPlaceholder} aria-invalid={editorCommandMissing} aria-describedby={`pi-external-editor-status pi-external-editor-hint${editorCommandMissing ? " pi-external-editor-required" : ""}`} onChange={(event) => setSettings({ ...settings, externalEditor: event.target.value })} />
              <button type="button" className="button ghost" data-testid="pi-external-editor-choose" disabled={editorPicking} onClick={() => void chooseExternalEditor()}>{editorPicking ? t.piExternalEditorChoosing : t.piExternalEditorChoose}</button>
            </div>
            {editorPickerError && <div className="pi-settings-editor-error" role="alert"><span>{editorPickerError}</span><button type="button" className="button ghost" onClick={() => void chooseExternalEditor()}>{t.retry}</button></div>}
            {editorCommandMissing && <small id="pi-external-editor-required" className="pi-settings-field-error" role="alert">{t.piExternalEditorRequired}</small>}
            <small id="pi-external-editor-hint">{t.piExternalEditorHint}</small>
          </div>}
          <small id="pi-external-editor-status" className="pi-settings-effective">{t.piExternalEditorEffective(settings.effectiveExternalEditor, settings.externalEditorSource)}</small>
        </fieldset>
        <label className="pi-settings-check"><input type="checkbox" checked={settings.compactionEnabled} onChange={(event) => setSettings({ ...settings, compactionEnabled: event.target.checked })} /><span>{t.piAutoCompaction}</span></label>
        <p className="pi-settings-hint">{t.piSettingsReloadHint}</p>
      </div>}
      <div className="settings-footer"><button type="button" className="button ghost" onClick={onClose}>{t.cancel}</button><button type="button" className="button primary" data-testid="pi-settings-save" disabled={busy || editorPicking || !settings || editorCommandMissing} onClick={() => void save()}>{busy ? t.saving : t.save}</button></div>
    </section>
  </div>;
}
