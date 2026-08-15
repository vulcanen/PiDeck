import { useCallback, useEffect, useRef, useState } from "react";
import type { PiPackageSummary } from "@pideck/contracts";
import { copy, type Language } from "@pideck/i18n";
import { Icon, useDialogFocus } from "@pideck/ui-system";

function PackageSettings({ language, cwd, onClose, onNotice, onPackagesChanged }: { language: Language; cwd: string; onClose: () => void; onNotice: (message: string) => void; onPackagesChanged?: () => void }) {
  const t = copy[language];
  const dialogRef = useRef<HTMLElement>(null);
  const [packages, setPackages] = useState<PiPackageSummary[]>([]);
  const [source, setSource] = useState("");
  const [local, setLocal] = useState(Boolean(cwd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadVersionRef = useRef(0);
  useDialogFocus(dialogRef, onClose);
  const load = useCallback(async () => {
    const loadVersion = ++loadVersionRef.current;
    const requestCwd = cwd || undefined;
    setError(null);
    try {
      const next = await window.pideck.packages.list(requestCwd);
      if (loadVersion === loadVersionRef.current) setPackages(next);
    }
    catch (reason) { if (loadVersion === loadVersionRef.current) setError(reason instanceof Error ? reason.message : String(reason)); }
  }, [cwd]);
  useEffect(() => { void load(); }, [load]);
  async function run(action: () => Promise<void>, successMessage: string = t.packageManager) {
    setBusy(true); setError(null);
    try { await action(); onPackagesChanged?.(); await load(); setSource(""); onNotice(successMessage); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="settings-sheet package-settings" role="dialog" aria-modal="true" aria-labelledby="package-title"><div className="settings-header"><div><span className="eyebrow">Pi</span><h2 id="package-title">{t.packageManager}</h2><p>{t.packageManagerDescription}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label={t.closeSettings}><Icon name="x" /></button></div><form className="package-install-form" onSubmit={(event) => { event.preventDefault(); if (source.trim()) void run(() => window.pideck.packages.install(source.trim(), local, cwd || undefined), t.packageInstalled); }}><input value={source} onChange={(event) => setSource(event.target.value)} placeholder={t.packageSource} aria-label={t.packageSource} /><label><input type="checkbox" checked={local} onChange={(event) => setLocal(event.target.checked)} />{local ? t.packageLocal : t.packageUser}</label><button type="submit" className="button primary" disabled={busy || !source.trim()}>{busy ? t.packageBusy : t.packageInstall}</button></form>{error && <div className="auth-error" role="alert"><span>{error}</span><button type="button" className="button ghost" onClick={() => void load()}>{t.retry}</button></div>}<div className="package-list">{packages.length === 0 ? <div className="provider-list-empty">{t.noPackages}</div> : packages.map((item) => <div className="package-row" key={`${item.scope}:${item.source}`}><div><strong>{item.source}</strong><small>{item.scope === "project" ? t.packageLocal : t.packageUser}{item.installedPath ? ` · ${item.installedPath}` : ""}</small></div><div className="package-actions"><button type="button" className="button ghost" disabled={busy} onClick={() => void run(() => window.pideck.packages.configure(item.source, item.disabled, item.scope === "project", cwd || undefined), item.disabled ? t.packageEnabled : t.packageDisabled)}>{item.disabled ? t.packageConfigure : t.packageDisable}</button><button type="button" className="button danger-subtle" disabled={busy} onClick={() => void run(() => window.pideck.packages.remove(item.source, item.scope === "project", cwd || undefined), t.packageRemoved)}>{t.packageRemove}</button></div></div>)}</div><div className="settings-footer"><button type="button" className="button ghost" disabled={busy} onClick={() => void run(() => window.pideck.packages.update(undefined, cwd || undefined), t.packageUpdated)}>{t.packageUpdate}</button><button type="button" className="button ghost" onClick={onClose}>{t.done}</button></div></section></div>;
}

export { PackageSettings };
