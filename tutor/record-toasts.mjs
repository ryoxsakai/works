// Presentation observes existing controllers; persistence and error gates stay in place.
export function attachRecordToasts(root, { duration = 4000 } = {}) {
  const region = document.createElement('div');
  region.className = 'record-save-toasts';
  region.setAttribute('aria-label', '授業記録の保存状態');
  document.body.append(region);
  const seen = new WeakMap(), notices = new Map();
  function clear() {
    for (const {timer} of notices.values()) clearTimeout(timer);
    notices.clear(); region.replaceChildren();
  }
  function sync() {
    for (const [key, item] of notices) if (!root.contains(item.row)) { clearTimeout(item.timer); item.element.remove(); notices.delete(key); }
    root.querySelectorAll('.lesson-plan-status,.student-memo-status').forEach(status => {
      const text = status.textContent;
      const transient = /^(未保存|保存中|保存済み)/.test(text) && status.dataset.error !== 'true';
      status.classList.toggle('record-transient-status', transient);
      if (seen.get(status) === text) return;
      seen.set(status, text);
      const row = status.closest('tr[data-event-id]');
      if (!row) return;
      const field = status.matches('.student-memo-status') ? '生徒メモ' : status.closest('.record-next-plan') ? '次回授業予定' : '授業予定';
      const key = row.dataset.eventId + ':' + field;
      const prior = notices.get(key);
      if (prior) { clearTimeout(prior.timer); prior.element.remove(); notices.delete(key); }
      if (!transient) return; // Failures/conflicts remain beside the input; no stale success toast.
      const element = document.createElement('div');
      element.className = 'record-save-toast alert'; element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite'); element.setAttribute('aria-atomic', 'true');
      region.append(element);
      const slot = [...row.querySelectorAll(".record-card-meta > span")].map(el=>el.textContent).join(" ");
      const day = document.querySelector("#record-date-label")?.textContent || "";
      element.textContent = `${row.querySelector('.record-student-link').textContent.trim()}（${day} ${row.dataset.calendarName || ""} ${slot}）・${field}: ${text}`;
      const timer = setTimeout(() => { if (notices.get(key)?.element === element) { element.remove(); notices.delete(key); } }, duration);
      notices.set(key, {element, timer, row});
    });
  }
  const observer = new MutationObserver(sync);
  observer.observe(root, {childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-error']});
  window.addEventListener('pagehide', clear);
  sync();
  return {clear, destroy() { observer.disconnect(); clear(); region.remove(); window.removeEventListener('pagehide',clear); }};
}
