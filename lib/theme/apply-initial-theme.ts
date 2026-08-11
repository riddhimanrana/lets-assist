type Theme = "light" | "dark" | "system";

function normalizeTheme(value: string | null): Theme {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function applyInitialTheme() {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  try {
    const root = document.documentElement;
    const theme = normalizeTheme(window.localStorage.getItem("theme"));
    const resolvedTheme =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;

    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
  } catch {
    // Storage and media queries can be unavailable in restricted browsers.
  }
}
