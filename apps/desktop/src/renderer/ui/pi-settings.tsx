import { useEffect, useRef, useState } from "react";
import type { ModelSummary, PiSettingsSummary } from "@pideck/contracts";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialogFocus(dialogRef, onClose);

  useEffect(() => {
    let active = true;
    setError(null);
    void window.pideck.settings.get(cwd || undefined)
      .then((value) => { if (active) setSettings(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [cwd]);

  async function save() {
    if (!settings) return;
    setBusy(true); setError(null);
    try {
      const next = await window.pideck.settings.update(settings, cwd || undefined);
      setSettings(next);
      onNotice(t.piSettingsSaved);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  const modelValue = settings?.defaultProvider && settings.defaultModel ? `${settings.defaultProvider}/${settings.defaultModel}` : "";
  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="settings-sheet pi-settings" role="dialog" aria-modal="true" aria-labelledby="pi-settings-title">
      <div className="settings-header"><div><span className="eyebrow">Pi</span><h2 id="pi-settings-title">{t.piSettingsTitle}</h2><p>{t.piSettingsDescription}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label={t.closeSettings}><Icon name="x" /></button></div>
      {!settings && !error && <div className="provider-list-empty">{t.loading}</div>}
      {error && <div className="auth-error" role="alert">{error}</div>}
      {settings && <div className="pi-settings-fields">
        <label><span>{t.piDefaultModel}</span><select value={modelValue} onChange={(event) => { const [defaultProvider, ...parts] = event.target.value.split("/"); setSettings((current) => current ? { ...current, defaultProvider, defaultModel: parts.join("/") } : current); }}><option value="" disabled>{t.chooseModel}</option>{models.map((model) => <option key={`${model.providerId}/${model.id}`} value={`${model.providerId}/${model.id}`}>{model.providerName} · {model.name}</option>)}</select></label>
        <label><span>{t.piDefaultThinking}</span><select value={settings.defaultThinkingLevel} onChange={(event) => setSettings({ ...settings, defaultThinkingLevel: event.target.value })}>{["off", "minimal", "low", "medium", "high", "xhigh"].map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
        <label><span>{t.piTransport}</span><select value={settings.transport} onChange={(event) => setSettings({ ...settings, transport: event.target.value as PiSettingsSummary["transport"] })}><option value="auto">auto</option><option value="sse">SSE</option><option value="websocket">WebSocket</option></select></label>
        <label><span>{t.piSteeringMode}</span><select value={settings.steeringMode} onChange={(event) => setSettings({ ...settings, steeringMode: event.target.value as PiSettingsSummary["steeringMode"] })}><option value="one-at-a-time">one-at-a-time</option><option value="all">all</option></select></label>
        <label><span>{t.piFollowUpMode}</span><select value={settings.followUpMode} onChange={(event) => setSettings({ ...settings, followUpMode: event.target.value as PiSettingsSummary["followUpMode"] })}><option value="one-at-a-time">one-at-a-time</option><option value="all">all</option></select></label>
        <label className="pi-settings-check"><input type="checkbox" checked={settings.compactionEnabled} onChange={(event) => setSettings({ ...settings, compactionEnabled: event.target.checked })} /><span>{t.piAutoCompaction}</span></label>
        <p className="pi-settings-hint">{t.piSettingsReloadHint}</p>
      </div>}
      <div className="settings-footer"><button type="button" className="button ghost" onClick={onClose}>{t.cancel}</button><button type="button" className="button primary" disabled={busy || !settings || !modelValue} onClick={() => void save()}>{busy ? t.saving : t.save}</button></div>
    </section>
  </div>;
}
