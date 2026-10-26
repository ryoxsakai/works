// Native dialogs provide focus containment and Escape; history makes Back close them.
const openDialogs = new Set();
export function showDialog(dialog) {
  if (dialog.open) return;
  const opener = document.activeElement;
  history.pushState({ ...history.state, workflowModal: dialog.id }, "");
  openDialogs.add(dialog);
  dialog.addEventListener(
    "close",
    () => {
      openDialogs.delete(dialog);
      if (history.state?.workflowModal === dialog.id) {
        const { workflowModal, ...rest } = history.state;
        history.replaceState(rest, "");
      }
      if (opener?.isConnected) opener.focus();
    },
    { once: true },
  );
  dialog.showModal();
}
window.addEventListener("popstate", () => {
  for (const dialog of openDialogs)
    if (history.state?.workflowModal !== dialog.id) dialog.close();
});
