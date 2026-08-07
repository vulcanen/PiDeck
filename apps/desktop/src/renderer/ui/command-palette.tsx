import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { copy, type Language } from "@pideck/i18n";
import { Icon, useDialogFocus } from "@pideck/ui-system";

class CommandPaletteBoundary extends Component<{ children: ReactNode; language: Language; onClose: () => void }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : String(error) }; }
  componentDidCatch(error: unknown, info: ErrorInfo) { console.error("Command palette render failed", error, info.componentStack); }
  render() {
    if (this.state.error) { const t = copy[this.props.language]; return <div className="palette-backdrop"><div className="command-palette palette-error" role="alert"><strong>{t.commandPanelError}</strong><button className="button ghost" onClick={this.props.onClose}>{t.retry}</button></div></div>; }
    return this.props.children;
  }
}

function CommandPalette({ language, commands, shortcut, onCommand, onClose, onNewTask, onSettings, onPackages, onCompact, onExport }: { language: Language; commands: Array<{ name: string; description?: string; source?: string }>; shortcut: (key: string) => string; onCommand: (command: { name: string }) => void; onClose: () => void; onNewTask: () => void; onSettings: () => void; onPackages: () => void; onCompact?: () => void; onExport?: (format: "jsonl" | "html") => void }) {
  const t = copy[language];
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useDialogFocus(dialogRef, onClose);
  const quickItems = [
    { id: "new-task", label: t.newTask, description: shortcut("N"), action: onNewTask, icon: "plus" },
    { id: "provider", label: t.provider, description: shortcut(","), action: onSettings, icon: "settings" },
    { id: "packages", label: t.packageManager, description: t.packageManagerDescription, action: onPackages, icon: "package" },
    ...(onCompact ? [{ id: "compact", label: t.compactContext, description: t.compactContext, action: onCompact, icon: "spark" }] : []),
    ...(onExport ? [{ id: "export-jsonl", label: t.exportJsonl, description: t.exportJsonl, action: () => onExport("jsonl"), icon: "file" }, { id: "export-html", label: t.exportHtml, description: t.exportHtml, action: () => onExport("html"), icon: "file" }] : []),
  ];
  const safeCommands = (Array.isArray(commands) ? commands : []).filter((command) => command && typeof command.name === "string").map((command) => ({ ...command, description: typeof command.description === "string" ? command.description : "" }));
  const filteredCommands = safeCommands.filter((command) => `${command.name} ${command.description}`.toLowerCase().includes(query.toLowerCase()));
  const filteredQuick = quickItems.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
  const items = [...filteredQuick, ...filteredCommands.map((command) => ({ id: `command:${command.name}`, label: `/${command.name}`, description: command.description ?? t.piCommand, action: () => onCommand(command), icon: "command" }))];
  useEffect(() => setSelectedIndex(0), [query]);
  useEffect(() => { const item = itemRefs.current[selectedIndex]; item?.scrollIntoView?.({ block: "nearest" }); }, [selectedIndex]);
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex((current) => Math.min(items.length - 1, current + 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex((current) => Math.max(0, current - 1)); }
    if (event.key === "Enter") { event.preventDefault(); items[selectedIndex]?.action(); }
  }
  return <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label={t.command}><div className="palette-search"><Icon name="search" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleKeyDown} placeholder={t.searchCommands} aria-label={t.searchCommands} /><kbd>ESC</kbd></div><div className="palette-group"><span>{query ? t.results : t.quickActions}</span>{items.length === 0 ? <div className="palette-empty">{t.noMatchingCommands}</div> : items.map((item, index) => <button ref={(element) => { itemRefs.current[index] = element; }} key={item.id} className={index === selectedIndex ? "selected" : ""} onMouseEnter={() => setSelectedIndex(index)} onClick={item.action}><Icon name={item.icon} /><span>{item.label}</span><small>{item.description}</small></button>)}</div></div></div>;
}

export { CommandPaletteBoundary, CommandPalette };
