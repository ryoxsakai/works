// Apply before styles load to avoid flashing the wrong theme on direct visits.
try {
  const theme = localStorage.getItem("works_theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}
