const STORAGE_KEY = "works_theme";

export function getTheme() {
  const t = localStorage.getItem(STORAGE_KEY);
  return t === "light" || t === "dark" ? t : "system";
}

export function setTheme(theme) {
  if (theme === "light" || theme === "dark") {
    localStorage.setItem(STORAGE_KEY, theme);
    document.documentElement.dataset.theme = theme;
  } else {
    localStorage.removeItem(STORAGE_KEY);
    delete document.documentElement.dataset.theme;
  }
}
