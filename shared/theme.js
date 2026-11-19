// Works is light-only. The getTheme/setTheme API stays for existing callers,
// but every page always resolves to the light theme.
const STORAGE_KEY = "works_theme";
try { localStorage.removeItem(STORAGE_KEY); } catch {}

export function getTheme() { return "light"; }

function applyTheme() {
  document.documentElement.dataset.theme = "light";
  document.documentElement.style.colorScheme = "light";
  window.dispatchEvent(new CustomEvent("works-theme-change", { detail: "light" }));
}

export function setTheme() { applyTheme(); }

applyTheme();
