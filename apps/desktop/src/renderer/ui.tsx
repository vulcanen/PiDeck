import { useEffect, useRef, type RefObject } from "react";

export const icons: Record<string, string> = {
  plus: "M8 3v10M3 8h10",
  search: "m12 12-2.8-2.8M6.8 10.2a3.4 3.4 0 1 1 4.8-4.8 3.4 3.4 0 0 1-4.8 4.8Z",
  chevron: "m5 6 3 3 3-3",
  panel: "M3 3h10v10H3zM3 6h10M6 6v7",
  terminal: "m4 5 3 3-3 3M8 11h4",
  file: "M4 2.5h5l3 3V13H4zM9 2.5v3h3",
  send: "m3 8 10-5-3 10-2-4-5-1Z",
  stop: "M4 4h8v8H4z",
  settings: "M8 3.2 9.1 4.1l1.4-.4.7 1.3 1.4.4-.1 1.5 1 1-.9 1.2.4 1.4-1.3.7-.4 1.4-1.5-.1-1 1-1.2-.9-1.4.4-.7-1.3-1.4-.4.1-1.5-1-1 .9-1.2-.4-1.4 1.3-.7.4-1.4 1.5.1zM6.4 8a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 0 0-3.2 0Z",
  key: "M10.5 3.5a2.5 2.5 0 1 0 1.7 4.3L14 10v1.5h-1.5V13H11v-1.5H9.5L8 10l2.2-2.2a2.5 2.5 0 0 0 .3-4.3Z",
  shield: "M8 2.5 13 4v3.7c0 2.7-1.8 4.8-5 5.8-3.2-1-5-3.1-5-5.8V4zM5.5 8l1.6 1.6L10.7 6",
  moon: "M11.5 10.5A4.5 4.5 0 0 1 5.5 4.1 5 5 0 1 0 11.5 10.5Z",
  sun: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M12.6 3.4l-.7.7M4.1 11.9l-.7.7",
  command: "M4 4h8v8H4zM6 8h4M8 6v4",
  model: "M3 5.2 8 2.5l5 2.7v5.6L8 13.5l-5-2.7zM3 5.2l5 2.7 5-2.7M8 7.9v5.6",
  spark: "m8 2 .8 3.2L12 6l-3.2.8L8 10l-.8-3.2L4 6l3.2-.8z",
  check: "m3 8 3 3 5-6",
  x: "m4 4 8 8M12 4l-8 8",
  folder: "M2.5 4.5h4l1.3 1.5h5.7v6.5h-11z",
  folderOpen: "M2.5 5V4h4l1.3 1.5H13M2.5 6.5h11l-1.4 6H2.5z",
  more: "M4 8h.01M8 8h.01M12 8h.01",
  copy: "M5 5h7v8H5zM3 11H2.5V3h7v.5",
  alert: "M8 2.5 14 13H2zM8 6v3.5M8 11.5h.01",
  down: "m4 6 4 4 4-4",
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"><path d={icons[name] ?? icons.file} /></svg>;
}

export function useDialogFocus(ref: RefObject<HTMLElement | null>, onEscape: () => void, enabled = true) {
  const escapeRef = useRef(onEscape);
  useEffect(() => { escapeRef.current = onEscape; }, [onEscape]);
  useEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    const focusable = () => Array.from(root?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? []);
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.requestAnimationFrame(() => previous?.focus());
    };
  }, [enabled, ref]);
}

export async function copyText(value: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
