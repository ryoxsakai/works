const STORAGE_KEY = "works_theme";
let currentTheme = readTheme();

function readTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch { return "system"; }
}

export function getTheme() { return currentTheme; }

function applyTheme(theme) {
  currentTheme = theme;
  const resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  window.dispatchEvent(new CustomEvent("works-theme-change", { detail: theme }));
}

export function setTheme(theme) {
  const value = theme === "light" || theme === "dark" ? theme : "system";
  try {
    if (value === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, value);
  } catch {}
  applyTheme(value);
}

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY || event.key === null) applyTheme(readTheme());
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (currentTheme === "system") applyTheme("system");
});
applyTheme(currentTheme);
