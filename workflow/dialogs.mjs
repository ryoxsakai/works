// Every modal owns one history entry. Close/Escape consumes it; Back closes without another Back.
const records = new Map();
let settled = Promise.resolve(),
  finishNavigation = null,
  request = 0;
function retire(dialog, fromBack = false) {
  const record = records.get(dialog);
  if (!record) return;
  records.delete(dialog);
  ++request;
  if (!fromBack && history.state?.workflowModal === record.entry) {
    settled = new Promise((resolve) => {
      finishNavigation = resolve;
    });
    history.back();
  }
  settled.then(() => {
    if (!dialog.open && record.opener?.isConnected) record.opener.focus();
  });
}
export function closeDialog(dialog) {
  retire(dialog);
  dialog.close();
}
export async function showDialog(dialog, canOpen = () => true) {
  if (dialog.open) return;
  const mine = ++request,
    opener = document.activeElement;
  await settled;
  if (mine !== request || !canOpen() || dialog.open) return;
  const entry = crypto.randomUUID();
  history.pushState({ ...history.state, workflowModal: entry }, "");
  records.set(dialog, { entry, opener });
  if (!dialog.dataset.historyBound) {
    dialog.dataset.historyBound = "true";
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeDialog(dialog);
    });
    dialog.addEventListener("close", () => retire(dialog));
  }
  dialog.showModal();
}
window.addEventListener("popstate", () => {
  const finish = finishNavigation;
  finishNavigation = null;
  for (const [dialog, record] of records)
    if (history.state?.workflowModal !== record.entry) {
      retire(dialog, true);
      dialog.close();
    }
  finish?.();
});
// A link immediately following Close must not race the pending history traversal.
document.addEventListener(
  "click",
  (event) => {
    const a = event.target.closest?.("a[href]");
    if (
      !finishNavigation ||
      !a ||
      a.target === "_blank" ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    const href = a.href;
    settled.then(() => location.assign(href));
  },
  true,
);
