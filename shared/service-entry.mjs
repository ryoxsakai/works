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
  if (embedded && frameElement.hasAttribute('data-standby')) {
    const hint = document.createElement('link');
    hint.rel = 'modulepreload';
    hint.href = app;
    document.head.append(hint);
    await new Promise(resolve => window.addEventListener('works-activate', resolve, {once:true}));
  }
  if (embedded) connectView();
  await import('/shared/header.js?v=menu-swipe-1');
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
      parent.dispatchEvent(new CustomEvent('works-service-visit', {detail:{frame:frameElement, url:next.href, step:Number(link.dataset.swipeStep) || 0}}));
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
  const standby = new Map();
  const hinted = new Set();
  function createFrame(path, dormant = false) {
    const frame = document.createElement('iframe');
    frame.className = 'works-service-frame';
    frame.title = 'Works';
    if (dormant) frame.dataset.standby = '';
    if (visible || dormant) {
      frame.inert = true;
      frame.setAttribute('aria-hidden', 'true');
    }
    const target = new URL(path, location.origin);
    target.searchParams.set('works-view', '1');
    frame.src = target.href;
    return frame;
  }
  async function warmAssets(path) {
    // Only public, same-origin page assets enter the HTTP cache. App data is
    // requested by the active service using its normal authentication flow.
    const url = new URL(path + '?works-view=1', location.origin);
    const response = await fetch(url, {priority:'low'});
    if (!response.ok) return;
    const template = document.createElement('template');
    template.innerHTML = await response.text();
    const appPath = template.content.querySelector('[data-service-app]')?.dataset.serviceApp;
    if (!appPath || document.hidden) return;
    for (const source of [appPath, ...Array.from(template.content.querySelectorAll('link[rel="stylesheet"]'), link => link.getAttribute('href'))]) {
      const asset = new URL(source, url);
      if (asset.origin !== location.origin || hinted.has(asset.href)) continue;
      hinted.add(asset.href);
      await (await fetch(asset, {priority:'low'})).arrayBuffer();
      if (document.hidden) return;
    }
  }
  function prepareServices() {
    const connection = navigator.connection;
    if (document.hidden || pending || !hasSession() || connection?.saveData ||
        /^(slow-)?2g$/.test(connection?.effectiveType)) return;
    for (const path of destinations) {
      if (path === new URL(activeAddress, location.origin).pathname) continue;
      if (path === '/todo/' || path === '/memo/') {
        if (standby.has(path)) continue;
        const frame = createFrame(path, true);
        standby.set(path, frame);
        document.body.append(frame);
      } else if (!hinted.has(path)) {
        hinted.add(path);
        warmAssets(path).catch(() => hinted.delete(path));
      }
    }
  }
  function visit(url, push, step = 0) {
    const path = canonical(url);
    cancelPending();
    if (visible && path === activeAddress) return;
    const frame = standby.get(path) || createFrame(path);
    pending = {frame, path, push, step};
    if (standby.delete(path)) {
      frame.removeAttribute('data-standby');
      frame.contentWindow.dispatchEvent(new Event('works-activate'));
    } else document.body.append(frame);
    // A stalled service must eventually expose its own error or sign-in UI.
    timer = setTimeout(() => reveal(frame), 20000);
  }
  function reveal(frame) {
    if (!pending || frame !== pending.frame) return;
    clearTimeout(timer);
    const {path, push, step} = pending;
    pending = null;
    const old = visible;
    visible = frame;
    activeAddress = path;
    if (push) history.pushState({worksService:true}, '', path);
    frame.inert = false;
    frame.removeAttribute('aria-hidden');
    frame.title = frame.contentDocument?.title || 'Works';
    document.title = frame.title;
    frame.style.zIndex = '2';
    if (old) {
      old.inert = true;
      old.style.zIndex = '1';
    }
    if (window.requestIdleCallback) requestIdleCallback(prepareServices, {timeout:2500});
    else setTimeout(prepareServices, 350);
    if (old && motion()) {
      const fade = frame.animate([{opacity:0, translate:`${step * 22}px 0`},{opacity:1, translate:"0 0"}], {duration:210,easing:'ease-out'});
      fade.finished.then(() => old.remove(), () => old.remove());
    } else old?.remove();
    if (old) frame.focus({preventScroll:true});
  }
  window.addEventListener('works-view-ready', event => reveal(event.detail));
  window.addEventListener('works-service-visit', event => {
    const {frame, url, step} = event.detail;
    const next = new URL(url);
    if (!visible && frame === pending?.frame) reveal(frame);
    if (frame === visible && next.origin === location.origin && destinations.has(next.pathname)) visit(next, true, step);
  });
  window.addEventListener('popstate', () => visit(location.href, false));
  window.addEventListener('storage', event => {
    if ((!event.key || event.key === 'works_session_token') && !hasSession()) location.reload();
  });
  visit(location.href, false);
}
