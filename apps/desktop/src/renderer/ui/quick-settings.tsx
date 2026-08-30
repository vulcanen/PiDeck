import { useRef } from "react";
import { copy, type Language } from "@pideck/i18n";
import { Icon, useDialogFocus } from "@pideck/ui-system";
import { handleRovingMenuKeyDown } from "./shared";

export function QuickSettings({ language, hasProject, hasSession, onCommand, onProviders, onPackages, onClose }: {
  language: Language;
  hasProject: boolean;
  hasSession: boolean;
  onCommand: (command: { name: string }) => void;
  onProviders: () => void;
  onPackages: () => void;
  onClose: () => void;
}) {
  const t = copy[language];
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose);
  const items = [
    { id: "settings", label: t.piSettingsTitle, description: t.piSettingsDescription, icon: "settings", action: () => onCommand({ name: "settings" }) },
    { id: "providers", label: t.providerSettings, description: t.providerAuthTitle, icon: "brain", action: onProviders },
    { id: "packages", label: t.packageManager, description: t.packageManagerDescription, icon: "package", action: onPackages },
    { id: "scoped-models", label: t.scopedModelsTitle, description: hasSession ? t.scopedModelsDescription : t.noSessions, icon: "model", action: () => onCommand({ name: "scoped-models" }), disabled: !hasSession },
    { id: "trust", label: t.trustTitle, description: hasProject ? t.trustDescription : t.selectProjectFirst, icon: "shield", action: () => onCommand({ name: "trust" }), disabled: !hasProject },
    { id: "hotkeys", label: t.hotkeysTitle, description: t.quickSettingsHotkeysHint, icon: "command", action: () => onCommand({ name: "hotkeys" }) },
  ];
  return <div className="settings-backdrop quick-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="quick-settings-panel" id="quick-settings-panel" role="dialog" aria-modal="true" aria-labelledby="quick-settings-title">
      <div className="quick-settings-header"><h2 id="quick-settings-title">{t.quickSettings}</h2><button type="button" className="icon-button" title={t.closeSettings} aria-label={t.closeSettings} onClick={onClose}><Icon name="x" /></button></div>
      <div className="quick-settings-items" role="menu" aria-label={t.quickSettings} onKeyDown={handleRovingMenuKeyDown}>
        {items.map((item) => <button type="button" role="menuitem" key={item.id} disabled={item.disabled} onClick={item.action} title={item.description}>
          <Icon name={item.icon} /><span><strong>{item.label}</strong><small>{item.description}</small></span><Icon name="chevron" size={12} />
        </button>)}
      </div>
    </section>
  </div>;
}
