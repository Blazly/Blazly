import { useEffect, useState } from "react";

const THEME_KEY = "blazly-theme";

export const THEME_OPTIONS = [
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
  { id: "system", label: "System", icon: "monitor" },
];

function systemPrefersDark() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
}

export function readThemePreference() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEME_OPTIONS.some((option) => option.id === saved) ? saved : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(preference) {
  if (typeof document === "undefined") return;
  const dark = preference === "dark" || (preference === "system" && systemPrefersDark());
  const root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1c1b19" : "#faf9f6");
}

export function useThemePreference() {
  const [theme, setTheme] = useState(readThemePreference);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // The choice still applies for this session if storage is blocked.
    }
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return undefined;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [theme]);

  return [theme, setTheme];
}
