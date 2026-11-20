// Temporarily hidden from the shared menu and Home shortcuts, not from routing.
const hiddenServicePaths = new Set(["/workflow/", "/wiki/", "/kdp/", "/ss/"]);

export function isListedServicePath(path) {
  return !hiddenServicePaths.has(path);
}
