// Static markup only: callers own the request lifetime and aria-busy state.
export function cardLoading(label = '読み込み中…') {
  return `<div class="card-loading"><p role="status">${label}</p><div class="card-loading-shapes" aria-hidden="true"><span></span><span></span><span></span></div></div>`;
}
