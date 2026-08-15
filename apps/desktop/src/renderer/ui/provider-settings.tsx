import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthMethod, ProviderSummary } from "@pideck/contracts";
import { copy, type Language } from "@pideck/i18n";
import { Icon, useDialogFocus } from "@pideck/ui-system";
import type { AuthPromptState, ProviderFilter } from "../types";

function ProviderSettings({ language, focusProviderId, onClose, onModelsRefresh }: { language: Language; focusProviderId: string | null; onClose: () => void; onModelsRefresh: (providerId?: string) => Promise<void> | void }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [providerStates, setProviderStates] = useState<Record<string, ProviderSummary["authState"]>>({});
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [, setAuthMethod] = useState<AuthMethod | null>(null);
  const [apiKeyProvider, setApiKeyProvider] = useState<string | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [authPrompt, setAuthPrompt] = useState<AuthPromptState | null>(null);
  const [providerQuery, setProviderQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [pendingLogout, setPendingLogout] = useState<ProviderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const dialogRef = useRef<HTMLElement>(null);
  const authPromptRef = useRef<HTMLFormElement>(null);
  const logoutPromptRef = useRef<HTMLDivElement>(null);
  const t = copy[language];
  const normalizedProviderQuery = providerQuery.trim().toLocaleLowerCase();
  const filteredProviders = useMemo(() => providers.filter((provider) => {
    const state = providerStates[provider.id] ?? provider.authState;
    const matchesQuery = !normalizedProviderQuery || `${provider.name} ${provider.id}`.toLocaleLowerCase().includes(normalizedProviderQuery);
    const matchesFilter = providerFilter === "all" || (providerFilter === "missing" ? state === "missing" || state === "available" : state === providerFilter);
    return matchesQuery && matchesFilter;
  }), [normalizedProviderQuery, providerFilter, providerStates, providers]);

  function closeApiKeyForm() { setApiKeyProvider(null); setApiKeyValue(""); }
  async function resolvePrompt(value: string) {
    if (!authPrompt) return;
    const requestId = authPrompt.requestId;
    try { await window.pideck.providers.resolveAuth(requestId, value); }
    catch (error) { setAuthError(error instanceof Error ? error.message : String(error)); return; }
    setAuthPrompt(null);
    setAuthError(null);
  }
  async function cancelAuthPrompt() {
    if (!authPrompt) return;
    const requestId = authPrompt.requestId;
    try { await window.pideck.providers.resolveAuth(requestId, "", true); } catch { /* the login request will surface its cancellation result */ }
    setAuthPrompt(null);
    setAuthError(null);
    setAuthMethod(null);
  }
  useDialogFocus(dialogRef, () => {
    if (apiKeyProvider) { closeApiKeyForm(); return; }
    onClose();
  }, !authPrompt && !pendingLogout);
  useDialogFocus(authPromptRef, () => void cancelAuthPrompt(), Boolean(authPrompt));
  useDialogFocus(logoutPromptRef, () => { if (!busyProvider) setPendingLogout(null); }, Boolean(pendingLogout));

  const loadProviders = useCallback(async () => {
    setLoading(true); setListError(null);
    try {
      const next = await window.pideck.providers.list();
      setProviders([...next].sort((a, b) => Number(b.authState === "configured") - Number(a.authState === "configured") || a.name.localeCompare(b.name)));
      setProviderStates(Object.fromEntries(next.map((provider) => [provider.id, provider.authState])));
    } catch (error) { setListError(`${t.providerLoadFailed}: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setLoading(false); }
  }, [t.providerLoadFailed]);
  useEffect(() => { void loadProviders(); }, [loadProviders]);
  useEffect(() => {
    if (!focusProviderId || !providers.length) return;
    setProviderQuery("");
    setProviderFilter("all");
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-provider-id="${CSS.escape(focusProviderId)}"]`)?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [focusProviderId, providers]);
  useEffect(() => window.pideck.events.subscribe((runtimeEvent) => {
    if (runtimeEvent.type !== "auth.event" || !runtimeEvent.requestId) return;
    const event = runtimeEvent.event as any;
    if (event?.type === "prompt") {
      setAuthError(null);
      setAuthNotice(null);
      setAuthUrl(null);
      const promptType = event.prompt?.type === "select" || event.prompt?.type === "secret" || event.prompt?.type === "manual_code" ? event.prompt.type : "text";
      const options = Array.isArray(event.prompt?.options)
        ? event.prompt.options.filter((option: any) => typeof option?.id === "string" && typeof option?.label === "string").map((option: any) => ({ id: option.id, label: option.label, description: typeof option.description === "string" ? option.description : undefined }))
        : undefined;
      setAuthPrompt({ requestId: runtimeEvent.requestId, type: promptType, message: event.prompt?.message ?? t.authPromptFallback, placeholder: event.prompt?.placeholder ?? "", value: "", options });
    }
    else if (event?.type === "notify" && event.event?.type === "auth_url") {
      setAuthUrl(null); setAuthNotice(null);
      if (event.event.url) {
        const url = String(event.event.url);
        setAuthUrl(url);
        void window.pideck.providers.openAuthUrl(url).catch((error) => {
          // Auto-open failed (no default browser, shell error, etc.): keep the
          // URL visible so the user can copy or retry it manually.
          setAuthNotice(`${t.authUrlAutoOpenFailed}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    } else if (event?.type === "notify" && event.event?.type === "device_code") {
      setAuthUrl(null); setAuthNotice(null);
      if (event.event.verificationUri) {
        const url = String(event.event.verificationUri);
        setAuthUrl(url);
        void window.pideck.providers.openAuthUrl(url).catch((error) => {
          setAuthNotice(`${t.authUrlAutoOpenFailed}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }
  }), [t.authPromptFallback, t.authUrlAutoOpenFailed]);

  async function auth(providerId: string, method: AuthMethod, secret?: string) {
    if (method === "api-key" && !secret?.trim()) { setFieldErrors((current) => ({ ...current, [providerId]: t.apiKeyRequired })); return; }
    setBusyProvider(providerId); setAuthMethod(method); setAuthError(null); setAuthNotice(null); setAuthUrl(null); setFieldErrors((current) => ({ ...current, [providerId]: undefined }));
    try {
      if (method === "api-key") await window.pideck.providers.setApiKey(providerId, secret!.trim());
      else await window.pideck.providers.login(providerId, method);
      closeApiKeyForm(); setAuthNotice(null); setAuthError(null); setAuthMethod(null); await loadProviders(); await onModelsRefresh(providerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (method === "api-key") setFieldErrors((current) => ({ ...current, [providerId]: message }));
      else setAuthError(message);
    } finally { setBusyProvider(null); if (method !== "oauth") setAuthMethod(null); }
  }

  async function logout(providerId: string) {
    setBusyProvider(providerId); setAuthError(null);
    try { await window.pideck.providers.logout(providerId); setPendingLogout(null); await loadProviders(); await onModelsRefresh(providerId); }
    catch (error) { setAuthError(error instanceof Error ? error.message : String(error)); }
    finally { setBusyProvider(null); }
  }

  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyProvider) onClose(); }}><section ref={dialogRef} className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="provider-title"><div className="settings-header"><div><span className="eyebrow">{t.localRuntime}</span><h2 id="provider-title">{t.providerAuthTitle}</h2></div><button className="icon-button" onClick={onClose} aria-label={t.closeSettings} title={t.closeSettings}><Icon name="x" /></button></div><div className="locality-note"><span className="status-dot" /><span>{t.localCredentials}</span></div>{!authPrompt && authNotice && <div className="auth-notice" role="status"><div>{authNotice}</div>{authUrl && <button className="button primary" onClick={() => void window.pideck.providers.openAuthUrl(authUrl)}>{t.openBrowser}</button>}</div>}{!authPrompt && authError && <div className="auth-error" role="alert"><div className="auth-error-copy">{authError}</div><div className="auth-error-actions">{authUrl && <button className="button primary" onClick={() => void window.pideck.providers.openAuthUrl(authUrl)}>{t.openBrowser}</button>}<button className="button ghost" onClick={() => { setAuthError(null); void loadProviders(); }}>{t.retry}</button></div></div>}
    {!loading && !listError && providers.length > 0 && <div className="provider-tools"><label className="provider-search"><Icon name="search" size={14} /><input value={providerQuery} onChange={(event) => setProviderQuery(event.target.value)} placeholder={t.providerSearch} aria-label={t.providerSearch} /></label><div className="provider-filters" role="group" aria-label={t.providerAuthTitle}>{(["all", "configured", "expired", "missing"] as ProviderFilter[]).map((filter) => <button type="button" key={filter} aria-pressed={providerFilter === filter} onClick={() => setProviderFilter(filter)}>{filter === "all" ? t.providerFilterAll : filter === "configured" ? t.providerFilterConfigured : filter === "expired" ? t.providerFilterExpired : t.providerFilterMissing}</button>)}</div></div>}
    <div className="provider-list">{loading ? <div className="provider-loading" role="status"><i /><i /><i /></div> : listError ? <div className="provider-list-error" role="alert"><span>{listError}</span><button className="button ghost" onClick={() => void loadProviders()}>{t.retry}</button></div> : providers.length === 0 ? <div className="provider-list-error"><span>{t.noProviders}</span></div> : filteredProviders.length === 0 ? <div className="provider-list-empty"><Icon name="search" size={17} /><span>{t.providerNoMatches}</span></div> : filteredProviders.map((provider) => { const state = providerStates[provider.id] ?? provider.authState; const expanded = apiKeyProvider === provider.id; const oauthLocked = state === "configured"; return <div className={`provider-card ${expanded ? "expanded" : ""} ${focusProviderId === provider.id ? "focused" : ""}`} data-provider-id={provider.id} key={provider.id}><div className="provider-main"><div className="provider-logo">{provider.name.slice(0, 1)}</div><div className="provider-copy"><div><strong>{provider.name}</strong><span className={`provider-state ${state}`}><span className="status-dot" />{state === "configured" ? t.configured : state === "expired" ? t.expired : t.missing}</span></div><small>{provider.id} · {t.providerModels(provider.modelCount)}</small></div><div className="provider-actions">{state === "configured" && <button className="button danger-subtle" disabled={busyProvider === provider.id} onClick={() => setPendingLogout(provider)}>{t.removeProviderAuth}</button>}{provider.authMethods.includes("oauth") && <button className="button primary" disabled={busyProvider === provider.id || oauthLocked} onClick={() => void auth(provider.id, "oauth")}>{busyProvider === provider.id ? t.authorizing : t.oauth}</button>}{provider.authMethods.includes("api-key") && <button className="button ghost" aria-expanded={expanded} aria-controls={`api-key-${provider.id}`} disabled={busyProvider === provider.id} onClick={() => { if (expanded) closeApiKeyForm(); else { setApiKeyProvider(provider.id); setApiKeyValue(""); setAuthNotice(null); setAuthUrl(null); setFieldErrors((current) => ({ ...current, [provider.id]: undefined })); } }}>{t.apiKey}</button>}</div></div>{expanded && <form id={`api-key-${provider.id}`} className="api-key-form" onSubmit={(event) => { event.preventDefault(); void auth(provider.id, "api-key", apiKeyValue); }}><label htmlFor={`api-key-input-${provider.id}`}><strong>{t.apiKey}</strong><small>{provider.name}</small></label><div className="api-key-controls"><input id={`api-key-input-${provider.id}`} type="password" autoFocus value={apiKeyValue} onChange={(event) => setApiKeyValue(event.target.value)} placeholder={t.enterApiKey} aria-describedby={fieldErrors[provider.id] ? `api-key-error-${provider.id}` : undefined} /><button className="button primary" disabled={!apiKeyValue.trim() || busyProvider === provider.id} type="submit">{busyProvider === provider.id ? t.saving : t.save}</button><button className="button ghost" type="button" onClick={closeApiKeyForm}>{t.cancel}</button></div>{fieldErrors[provider.id] && <div id={`api-key-error-${provider.id}`} className="field-error" role="alert">{fieldErrors[provider.id]}</div>}</form>}</div>; })}</div>
    <div className="settings-footer"><span>{providers.length ? providerQuery || providerFilter !== "all" ? t.providerFilteredCount(filteredProviders.length, providers.length) : t.providerCount(providers.length) : ""}</span><button className="button ghost" onClick={onClose}>{t.done}</button></div>
    {pendingLogout && <div className="auth-prompt-backdrop"><div ref={logoutPromptRef} className="auth-prompt provider-logout-prompt" role="alertdialog" aria-modal="true" aria-labelledby="provider-logout-title" aria-describedby="provider-logout-description"><span className="confirm-icon"><Icon name="alert" /></span><h3 id="provider-logout-title">{t.removeProviderAuthTitle(pendingLogout.name)}</h3><p id="provider-logout-description">{t.removeProviderAuthBody(pendingLogout.name)}</p><div><button type="button" className="button ghost" disabled={busyProvider === pendingLogout.id} onClick={() => setPendingLogout(null)}>{t.cancel}</button><button type="button" className="button danger" disabled={busyProvider === pendingLogout.id} onClick={() => void logout(pendingLogout.id)}>{busyProvider === pendingLogout.id ? t.removingProviderAuth : t.removeProviderAuth}</button></div></div></div>}
    {authPrompt && <div className="auth-prompt-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) void cancelAuthPrompt(); }}><form ref={authPromptRef} className="auth-prompt" role="alertdialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); if (authPrompt.type !== "select") void resolvePrompt(authPrompt.value); }}><h3>{t.authPromptTitle}</h3><p>{authPrompt.message}</p>{authError && <div className="inline-error" role="alert">{authError}</div>}{authPrompt.type === "select" ? <div className="auth-prompt-options">{(authPrompt.options ?? []).map((option) => <button key={option.id} type="button" className="button ghost auth-prompt-option" onClick={() => void resolvePrompt(option.id)}><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</button>)}</div> : <label><span>{authPrompt.placeholder || t.authPromptFallback}</span><input autoFocus type={authPrompt.type === "secret" ? "password" : "text"} value={authPrompt.value} onChange={(event) => setAuthPrompt((current) => current ? { ...current, value: event.target.value } : current)} /></label>}<div><button type="button" className="button ghost" onClick={() => void cancelAuthPrompt()}>{t.cancel}</button>{authPrompt.type !== "select" && <button type="submit" className="button primary" disabled={!authPrompt.value}>{t.submit}</button>}</div></form></div>}
  </section></div>;
}

export { ProviderSettings };
