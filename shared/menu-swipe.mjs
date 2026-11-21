// A gesture belongs to the fixed bar it starts on. Leave taps, page scrolling
// and the independent card carousel to their existing handlers.
export function enableMenuSwipes() {
  const bars = document.querySelectorAll('.works-service-bar, .page-tabs, .admission-view-tabs, .bottom-tabs, .memo-menu');
  for (const bar of bars) {
    let start = null;
    bar.addEventListener('touchstart', event => {
      start = null;
      if (event.touches.length !== 1 || !matchMedia('(max-width:730px)').matches ||
          getComputedStyle(bar).position !== 'fixed') return;
      const touch = event.touches[0];
      start = {id:touch.identifier, x:touch.clientX, y:touch.clientY};
    }, {passive:true});
    bar.addEventListener('touchcancel', () => { start = null; });
    bar.addEventListener('touchmove', event => {
      if (!start) return;
      const touch = event.touches[0];
      const dx = Math.abs(touch.clientX - start.x);
      const dy = Math.abs(touch.clientY - start.y);
      if (event.touches.length !== 1 || dy > Math.max(10, dx)) start = null;
      else if (dx > 12 && dx > dy * 1.5 && event.cancelable) event.preventDefault();
    }, {passive:false});
    bar.addEventListener('touchend', event => {
      const origin = start;
      start = null;
      const touch = event.changedTouches[0];
      if (!origin || touch.identifier !== origin.id || event.touches.length) return;
      const dx = touch.clientX - origin.x;
      if (Math.abs(dx) < 36 || Math.abs(dx) < 1.5 * Math.abs(touch.clientY - origin.y)) return;
      if (event.cancelable) event.preventDefault();
      const items = [...bar.querySelectorAll('a[href],button:not(:disabled)')].filter(el => el.getClientRects().length);
      const current = bar.querySelector('[aria-expanded="true"]') ||
        (bar.matches('.bottom-tabs') && document.querySelector('#display-button[aria-expanded="true"]') && document.querySelector('#views [data-view="all"][aria-current="page"]') && bar.querySelector('#mobile-search')) ||
        bar.querySelector('[aria-selected="true"],[aria-current="page"]') ||
        bar.querySelector('.memo-list-action,#mobile-nav');
      const index = items.indexOf(current);
      if (index < 0) return;
      const step = dx < 0 ? 1 : -1;
      const next = items[index + step];
      if (!next) return;
      // Use the normal click path, including unsaved-change and sign-in guards.
      next.dataset.swipeStep = String(step);
      try { next.click(); } finally { delete next.dataset.swipeStep; }
      if (!bar.matches('.works-service-bar') && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const panel = document.querySelector('dialog[open], [data-page-tab-panel]:not([hidden]), [data-material-tab-panel]:not([hidden]), [data-admission-view]:not([hidden])');
        (panel || next).animate([{translate:`${step * 16}px 0`,opacity:.72},{translate:'0 0',opacity:1}], {duration:180,easing:'ease-out'});
      }
    }, {passive:false});
  }
}
