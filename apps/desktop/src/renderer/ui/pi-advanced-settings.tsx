import type { PiSettingsSummary, PiSettingsUpdate, PiThinkingBudgets } from "@pideck/contracts";
import { copy, type Language } from "@pideck/i18n";
import { SelectControl } from "./select-control";

export function PiAdvancedSettings({ language, settings, onChange }: {
  language: Language; settings: PiSettingsSummary; onChange: (patch: Omit<PiSettingsUpdate, "modelThinkingLevels">) => void;
}) {
  const t = copy[language];
  const numbers = [
    ["providerRetryTimeoutMs", t.piProviderRetryTimeoutMs, 0, 2147483647, false],
    ["providerRetryMaxRetries", t.piProviderRetryMaxRetries, 0, 100, false],
    ["providerRetryMaxRetryDelayMs", t.piProviderRetryMaxRetryDelayMs, 0, 2147483647, false],
    ["retryMaxRetries", t.piRetryMaxRetries, 0, 100, true],
    ["retryBaseDelayMs", t.piRetryBaseDelayMs, 0, 2147483647, true],
    ["compactionReserveTokens", t.piCompactionReserveTokens, 1, 100000000, true],
    ["compactionKeepRecentTokens", t.piCompactionKeepRecentTokens, 0, 100000000, true],
    ["httpIdleTimeoutMs", t.piHttpIdleTimeoutMs, 0, 2147483647, true],
    ["websocketConnectTimeoutMs", t.piWebsocketConnectTimeoutMs, 0, 2147483647, false],
  ] as const;
  const thinkingBudgetRows = [
    ["minimal", t.piThinkingBudgetMinimal],
    ["low", t.piThinkingBudgetLow],
    ["medium", t.piThinkingBudgetMedium],
    ["high", t.piThinkingBudgetHigh],
  ] as const;
  const npmCommand = settings.npmCommand?.join("\n") ?? "";
  function updateThinkingBudget(level: keyof PiThinkingBudgets, value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    const next = { ...(settings.thinkingBudgets ?? {}), [level]: value };
    onChange({ thinkingBudgets: next });
  }
  return <details className="pi-settings-advanced" data-testid="pi-advanced-settings">
    <summary>{t.piAdvancedSettings}</summary>
    <div className="pi-settings-fields">
      <label className="pi-settings-check"><input type="checkbox" checked={settings.retryEnabled ?? true} onChange={(event) => onChange({ retryEnabled: event.target.checked })} /><span>{t.piRetryEnabled}</span></label>
      <p className="pi-settings-hint">{t.piRetryAndCompactionHint}</p>
      {numbers.map(([key, label, min, max, required]) => <label key={key}><span>{label}</span><input type="number" data-testid={`pi-${key}`} min={min} max={max} step={1} required={required} defaultValue={settings[key]} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) onChange({ [key]: event.target.valueAsNumber }); }} /></label>)}
      <label><span>{t.piHttpProxy}</span><input type="url" data-testid="pi-httpProxy" defaultValue={settings.httpProxy ?? ""} autoComplete="off" spellCheck={false} maxLength={4096} placeholder={t.piHttpProxyPlaceholder} onChange={(event) => onChange({ httpProxy: event.target.value })} /><small>{t.piHttpProxyHint}</small>{settings.httpProxyHasCredentials && <small>{t.piHttpProxyCredentialsHint}</small>}</label>
      <label className="pi-settings-check"><input type="checkbox" checked={settings.defaultTools == null} onChange={(event) => onChange({ defaultTools: event.target.checked ? null : [] })} /><span>{t.piDefaultToolsAutomatic}</span></label>
      {settings.defaultTools != null && <label><span>{t.piDefaultTools}</span><input type="text" data-testid="pi-defaultTools" defaultValue={settings.defaultTools.join(", ")} autoComplete="off" spellCheck={false} onChange={(event) => onChange({ defaultTools: event.target.value.split(/[\s,]+/).filter(Boolean) })} /><small>{t.piDefaultToolsHint}</small></label>}
      <fieldset className="pi-settings-subsection">
        <legend>{t.piThinkingAndImages}</legend>
        <p className="pi-settings-hint">{t.piThinkingAndImagesHint}</p>
        <label className="pi-settings-check"><input type="checkbox" data-testid="pi-imageAutoResize" checked={settings.imageAutoResize ?? true} onChange={(event) => onChange({ imageAutoResize: event.target.checked })} /><span>{t.piImageAutoResize}</span></label>
        <label className="pi-settings-check"><input type="checkbox" data-testid="pi-blockImages" checked={settings.blockImages ?? false} onChange={(event) => onChange({ blockImages: event.target.checked })} /><span>{t.piBlockImages}</span></label>
        <div className="pi-settings-budget-grid">
          <span>{t.piThinkingBudgets}</span>
          <small>{t.piThinkingBudgetsHint}</small>
          {thinkingBudgetRows.map(([level, label]) => <label key={level}><span>{label}</span><input type="number" data-testid={`pi-thinking-budget-${level}`} min={1} max={100000000} step={1} value={settings.thinkingBudgets?.[level] ?? ""} onChange={(event) => updateThinkingBudget(level, event.target.valueAsNumber)} /></label>)}
          <button type="button" className="button ghost" onClick={() => onChange({ thinkingBudgets: null })}>{t.piClearThinkingBudgets}</button>
        </div>
      </fieldset>
      <fieldset className="pi-settings-subsection">
        <legend>{t.piBranchSummary}</legend>
        <p className="pi-settings-hint">{t.piBranchSummaryHint}</p>
        <label><span>{t.piBranchSummaryReserveTokens}</span><input type="number" data-testid="pi-branchSummaryReserveTokens" min={1} max={100000000} step={1} required defaultValue={settings.branchSummaryReserveTokens} onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) onChange({ branchSummaryReserveTokens: event.target.valueAsNumber }); }} /></label>
        <label className="pi-settings-check"><input type="checkbox" data-testid="pi-branchSummarySkipPrompt" checked={settings.branchSummarySkipPrompt ?? false} onChange={(event) => onChange({ branchSummarySkipPrompt: event.target.checked })} /><span>{t.piBranchSummarySkipPrompt}</span></label>
        <small className="pi-settings-hint">{t.piBranchSummarySkipPromptHint}</small>
      </fieldset>
      <fieldset className="pi-settings-subsection">
        <legend>{t.piProjectTrustAndResources}</legend>
        <p className="pi-settings-hint">{t.piProjectTrustAndResourcesHint}</p>
        <label><span>{t.piDefaultProjectTrust}</span><SelectControl testId="pi-defaultProjectTrust" aria-label={t.piDefaultProjectTrust} value={settings.defaultProjectTrust ?? "ask"} options={[{ value: "ask", label: t.piProjectTrustAsk }, { value: "always", label: t.piProjectTrustAlways }, { value: "never", label: t.piProjectTrustNever }]} onChange={(value) => onChange({ defaultProjectTrust: value as PiSettingsSummary["defaultProjectTrust"] })} /><small>{t.piDefaultProjectTrustHint}</small></label>
        <label className="pi-settings-check"><input type="checkbox" data-testid="pi-enableSkillCommands" checked={settings.enableSkillCommands ?? true} onChange={(event) => onChange({ enableSkillCommands: event.target.checked })} /><span>{t.piEnableSkillCommands}</span></label>
      </fieldset>
      <fieldset className="pi-settings-subsection">
        <legend>{t.piShellAndSession}</legend>
        <p className="pi-settings-hint">{t.piShellAndSessionHint}</p>
        <label><span>{t.piShellPath}</span><input type="text" data-testid="pi-shellPath" defaultValue={settings.shellPath ?? ""} autoComplete="off" spellCheck={false} maxLength={4096} onChange={(event) => onChange({ shellPath: event.target.value })} /><small>{t.piShellPathHint}</small></label>
        <label><span>{t.piShellCommandPrefix}</span><input type="text" data-testid="pi-shellCommandPrefix" defaultValue={settings.shellCommandPrefix ?? ""} autoComplete="off" spellCheck={false} maxLength={4096} onChange={(event) => onChange({ shellCommandPrefix: event.target.value })} /><small>{t.piShellCommandPrefixHint}</small></label>
        <label><span>{t.piNpmCommand}</span><textarea data-testid="pi-npmCommand" rows={3} defaultValue={npmCommand} autoComplete="off" spellCheck={false} maxLength={4096} onChange={(event) => { const parts = event.target.value.split(/\r?\n/).map((part) => part.trim()).filter(Boolean); onChange({ npmCommand: parts.length ? parts : null }); }} /><small>{t.piNpmCommandHint}</small></label>
        <label><span>{t.piSessionDir}</span><input type="text" data-testid="pi-sessionDir" defaultValue={settings.sessionDir ?? ""} autoComplete="off" spellCheck={false} maxLength={4096} onChange={(event) => onChange({ sessionDir: event.target.value })} /><small>{t.piSessionDirHint}</small></label>
      </fieldset>
      <fieldset className="pi-settings-subsection">
        <legend>{t.piPrivacyAndTelemetry}</legend>
        <p className="pi-settings-hint">{t.piPrivacyAndTelemetryHint}</p>
        <label className="pi-settings-check"><input type="checkbox" data-testid="pi-enableInstallTelemetry" checked={settings.enableInstallTelemetry ?? true} onChange={(event) => onChange({ enableInstallTelemetry: event.target.checked })} /><span>{t.piEnableInstallTelemetry}</span></label>
      </fieldset>
      <p className="pi-settings-hint">{t.piAdvancedSettingsHint}</p>
    </div>
  </details>;
}
