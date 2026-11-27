// Keep one tablist and move it below the active view's heading. The existing
// mobile CSS still positions it at the bottom, independent of the panel.
export function placeServiceTabs(tablist, heading) {
  if (!tablist || !heading || heading.nextElementSibling === tablist) return;
  const focused = tablist.contains(document.activeElement) ? document.activeElement : null;
  heading.after(tablist);
  return focused;
}
