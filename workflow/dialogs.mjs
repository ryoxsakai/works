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
    if (!dialog.open) {
      const opener=record.opener?.isConnected?record.opener:document.querySelector('dialog[open] button, #workflow-steps [aria-current="step"]');
      opener?.focus();
    }
  });
}
const snapshot = dialog => JSON.stringify([...dialog.querySelectorAll('input:not([data-immediate]),select:not([data-immediate]),textarea:not([data-immediate])')].map(el=>[el.name||el.id,el.type==='checkbox'?el.checked:el.tagName==='SELECT'&&el.multiple?[...el.selectedOptions].map(o=>o.value):el.value]));
const savedFields=new WeakMap();
export function markDialogSaved(dialog) {savedFields.set(dialog,snapshot(dialog));}
const dirty=dialog=>savedFields.has(dialog)&&savedFields.get(dialog)!==snapshot(dialog);
const canClose=dialog=>!dirty(dialog)||confirm('未保存の編集があります。閉じると今回の入力を破棄します。閉じますか？');
export function closeDialog(dialog) {
  if(dialog.open && !canClose(dialog))return false;
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
  markDialogSaved(dialog);
  dialog.showModal();
}
window.addEventListener("popstate", () => {
  const finish = finishNavigation;
  finishNavigation = null;
  for (const [dialog, record] of records)
    if (history.state?.workflowModal !== record.entry) {
      if(!canClose(dialog)){history.pushState({...history.state,workflowModal:record.entry},"");finish?.();return;}
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

window.addEventListener('beforeunload',event=>{if([...records.keys()].some(dirty)){event.preventDefault();event.returnValue='';}});
