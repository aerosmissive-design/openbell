export type ThemeMode = "light" | "dark" | "system";

export const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "라이트" },
  { id: "dark", label: "다크" },
  { id: "system", label: "시스템" },
];

export function normalizeTheme(raw: unknown): ThemeMode {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "dark";
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export const THEME_BOOTSTRAP = `(function(){try{var m="dark";var raw=localStorage.getItem("openbell-v1");if(raw){var p=JSON.parse(raw);m=(p&&p.state&&p.state.config&&p.state.config.theme)||"dark";}if(m!=="light"&&m!=="dark"&&m!=="system")m="dark";var r=m==="system"?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):m;document.documentElement.setAttribute("data-theme",r);document.documentElement.style.colorScheme=r;}catch(e){}})();`;
