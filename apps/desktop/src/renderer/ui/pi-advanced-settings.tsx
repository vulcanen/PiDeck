import type { PiSettingsSummary, PiSettingsUpdate } from "@pideck/contracts";
import { copy, type Language } from "@pideck/i18n";

export function PiAdvancedSettings({ language, settings, onChange }: {
  language: Language; settings: PiSettingsSummary; onChange: (patch: Omit<PiSettingsUpdate, "modelThinkingLevels">) => void;
}) {
  const t = copy[language];
  const numbers = [
    ["retryMaxRetries", t.piRetryMaxRetries, 0, 100],
    ["retryBaseDelayMs", t.piRetryBaseDelayMs, 0, 2147483647],
    ["compactionReserveTokens", t.piCompactionReserveTokens, 1, 100000000],
    ["compactionKeepRecentTokens", t.piCompactionKeepRecentTokens, 0, 100000000],
    ["httpIdleTimeoutMs", t.piHttpIdleTimeoutMs, 0, 2147483647],
  ] as const;
  return <details className="pi-settings-advanced" data-testid="pi-advanced-settings">
    <summary>{t.piAdvancedSettings}</summary>
    <div className="pi-settings-fields">
      <label className="pi-settings-check"><input type="checkbox" checked={settings.retryEnabled ?? true} onChange={(event) => onChange({ retryEnabled: event.target.checked })} /><span>{t.piRetryEnabled}</span></label>
      {numbers.map(([key, label, min, max]) => <label key={key}><span>{label}</span><input type="number" data-testid={`pi-${key}`} min={min} max={max} step={1} required defaultValue={settings[key]} onChange={(event) => onChange({ [key]: event.target.valueAsNumber })} /></label>)}
      <label><span>{t.piHttpProxy}</span><input type="url" data-testid="pi-httpProxy" defaultValue={settings.httpProxy ?? ""} autoComplete="off" spellCheck={false} maxLength={4096} placeholder={t.piHttpProxyPlaceholder} onChange={(event) => onChange({ httpProxy: event.target.value })} /><small>{t.piHttpProxyHint}</small>{settings.httpProxyHasCredentials && <small>{t.piHttpProxyCredentialsHint}</small>}</label>
      <label className="pi-settings-check"><input type="checkbox" checked={settings.defaultTools == null} onChange={(event) => onChange({ defaultTools: event.target.checked ? null : [] })} /><span>{t.piDefaultToolsAutomatic}</span></label>
      {settings.defaultTools != null && <label><span>{t.piDefaultTools}</span><input type="text" data-testid="pi-defaultTools" defaultValue={settings.defaultTools.join(", ")} autoComplete="off" spellCheck={false} onChange={(event) => onChange({ defaultTools: event.target.value.split(/[\s,]+/).filter(Boolean) })} /><small>{t.piDefaultToolsHint}</small></label>}
      <p className="pi-settings-hint">{t.piAdvancedSettingsHint}</p>
    </div>
  </details>;
}
