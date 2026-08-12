import type { WindowTheme } from "@pideck/contracts";

export function windowThemeColors(theme: WindowTheme): { background: string; symbol: string } {
  return theme === "dark"
    ? { background: "#1f1e1b", symbol: "#f3f0e8" }
    : { background: "#f7f6f1", symbol: "#27251f" };
}
