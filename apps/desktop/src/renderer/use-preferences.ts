import { useEffect, useState } from "react";
import type { Language } from "@pideck/i18n";
import type { Theme, ThemePreference } from "./types";

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function usePreferences() {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem("pideck.language") === "en" ? "en" : "zh");
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const stored = localStorage.getItem("pideck.theme");
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const [confirmClose, setConfirmClose] = useState<boolean>(() => {
    const stored = localStorage.getItem("pideck.confirmClose");
    return stored === "false" ? false : true;
  });
  const [resolvedSystemTheme, setResolvedSystemTheme] = useState<Theme>(systemTheme);
  const theme: Theme = themePreference === "system" ? resolvedSystemTheme : themePreference;
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setResolvedSystemTheme(event.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  useEffect(() => { localStorage.setItem("pideck.language", language); document.documentElement.lang = language === "zh" ? "zh-CN" : "en"; }, [language]);
  useEffect(() => { localStorage.setItem("pideck.theme", themePreference); document.documentElement.style.colorScheme = theme; }, [theme, themePreference]);
  useEffect(() => { localStorage.setItem("pideck.confirmClose", confirmClose ? "true" : "false"); }, [confirmClose]);
  useEffect(() => { void window.pideck.app.setLanguage(language).catch(() => undefined); }, [language]);
  useEffect(() => { void window.pideck.app.setConfirmClose(confirmClose).catch(() => undefined); }, [confirmClose]);
  // Main may ask us to persist "don't ask again" after the user ticks the
  // checkbox in the native close-confirm dialog.
  useEffect(() => {
    const handler = (enabled: boolean) => {
      localStorage.setItem("pideck.confirmClose", enabled ? "true" : "false");
      setConfirmClose(enabled);
    };
    window.pideck.app.onConfirmCloseChanged?.(handler);
    return () => window.pideck.app.offConfirmCloseChanged?.(handler);
  }, []);
  function cycleTheme() {
    setThemePreference((current) => current === "system" ? "light" : current === "light" ? "dark" : "system");
  }
  return { language, setLanguage, theme, themePreference, cycleTheme, confirmClose, setConfirmClose };
}
