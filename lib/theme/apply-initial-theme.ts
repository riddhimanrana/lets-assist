// This stays literal so the server compiler cannot erase browser-only branches.
export const INITIAL_THEME_SCRIPT = `(function () {
  var theme = null;
  try {
    theme = window.localStorage.getItem("theme");
  } catch (_) {}
  if (theme !== "light" && theme !== "dark") {
    theme = "light";
    try {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
    } catch (_) {}
  }
  var root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
})();`;
