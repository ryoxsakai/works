// Keep each legacy service's modules, styles and document-level handlers isolated.
const destinations = new Set(['/', '/tutor/', '/material/', '/admission/', '/todo/', '/memo/']);
const mobile = matchMedia('(max-width: 730px)').matches;
const motion = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
const embedded = window.frameElement?.classList.contains('works-service-frame');
const app = document.querySelector('script[data-service-app]').dataset.serviceApp;
const address = new URL(location.href);
const hasSession = () => {
  try { return !!localStorage.getItem('works_session_token'); } catch { return false; }
};
const canonical = url => {
  const copy = new URL(url);
  copy.searchParams.delete('works-view');
  return copy.pathname + copy.search + copy.hash;
};

if (!embedded && window === top && mobile && hasSession() &&
    !address.searchParams.has('code') && !address.searchParams.has('error')) {
  startHost();
} else {
  if (embedded) connectView();
  await import('/shared/header.js?v=service-shell-1');
  await import(app);
  if (embedded) {
    const ready = () => {
      if (!hasSession()) {
        parent.location.replace(canonical(location.href));
        return true;
      }
      if (location.pathname === '/todo/')
        return !document.querySelector('#app').hidden ||
          document.querySelector('#login-message').textContent.includes('失敗');
      if (location.pathname === '/memo/')
        return !document.querySelector('.memo-main').hidden ||
          document.querySelector('#login-loading').textContent.includes('失敗');
      const signedIn = document.querySelector('#signed-in');
      return !signedIn || !signedIn.hidden;
    };
    const check = () => {
      if (!ready()) return;
      observer.disconnect();
      parent.dispatchEvent(new CustomEvent('works-view-ready', {detail: frameElement}));
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {subtree:true, childList:true, attributes:true, characterData:true});
    check();
  }
}

function connectView() {
  // An expired session or a sign-out must also leave the outer authenticated view.
  window.addEventListener('works-user', event => {
    if (!event.detail) parent.location.replace(canonical(location.href));
  });
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey ||
        event.shiftKey || event.altKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const next = new URL(link.href);
    if (!['http:', 'https:'].includes(next.protocol)) return;
    if (next.origin === location.origin && next.pathname === location.pathname && next.hash && next.search === location.search) return;
    event.preventDefault();
    if (next.origin === location.origin && destinations.has(next.pathname)) {
      parent.dispatchEvent(new CustomEvent('works-service-visit', {detail:{frame:frameElement, url:next.href}}));
    } else parent.location.assign(next.href);
  });
}

function startHost() {
  document.documentElement.classList.add('works-service-host');
  document.body.removeAttribute('class');
  document.body.replaceChildren();
  let visible, pending, timer;
  let activeAddress;
  function cancelPending() {
    clearTimeout(timer);
    pending?.frame.remove();
    pending = null;
  }
  function visit(url, push) {
    const path = canonical(url);
    cancelPending();
    if (visible && path === activeAddress) return;
    const frame = document.createElement('iframe');
    frame.className = 'works-service-frame';
    frame.title = 'Works';
    if (visible) {
      frame.inert = true;
      frame.setAttribute('aria-hidden', 'true');
    }
    const target = new URL(path, location.origin);
    target.searchParams.set('works-view', '1');
    frame.src = target.href;
    pending = {frame, path, push};
    document.body.append(frame);
    // A stalled service must eventually expose its own error or sign-in UI.
    timer = setTimeout(() => reveal(frame), 20000);
  }
  function reveal(frame) {
    if (!pending || frame !== pending.frame) return;
    clearTimeout(timer);
    const {path, push} = pending;
    pending = null;
    const old = visible;
    visible = frame;
    activeAddress = path;
    if (push) history.pushState({worksService:true}, '', path);
    frame.inert = false;
    frame.removeAttribute('aria-hidden');
    frame.title = frame.contentDocument?.title || 'Works';
    document.title = frame.title;
    if (old) old.inert = true;
    if (old && motion()) {
      const fade = frame.animate([{opacity:0},{opacity:1}], {duration:210,easing:'ease-out'});
      fade.finished.then(() => old.remove(), () => old.remove());
    } else old?.remove();
    if (old) frame.focus({preventScroll:true});
  }
  window.addEventListener('works-view-ready', event => reveal(event.detail));
  window.addEventListener('works-service-visit', event => {
    const {frame, url} = event.detail;
    const next = new URL(url);
    if (!visible && frame === pending?.frame) reveal(frame);
    if (frame === visible && next.origin === location.origin && destinations.has(next.pathname)) visit(next, true);
  });
  window.addEventListener('popstate', () => visit(location.href, false));
  window.addEventListener('storage', event => {
    if ((!event.key || event.key === 'works_session_token') && !hasSession()) location.reload();
  });
  visit(location.href, false);
}
