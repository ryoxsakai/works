// Keep each legacy service's modules, styles and document-level handlers isolated.
import { servicePaths, rememberService } from './resume-service.mjs';
const destinations = new Set(servicePaths);
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
  else {
    window.addEventListener('works-user', event => {
      if (event.detail && !address.searchParams.has('code')) rememberService(location.pathname);
    });
    if (hasSession() && !address.searchParams.has('code')) rememberService(location.pathname);
  }
  await import('/shared/header.js?v=resume-1');
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
      if (['/', '/tutor/', '/admission/', '/material/'].includes(location.pathname)) return document.body.dataset.serviceReady === 'true';
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
  const sessions = new Map();
  const ready = new WeakSet();
  const priority = ['/tutor/', ...[...destinations].filter(path => path !== '/tutor/')];
  const skipped = new Set();
  let warming, warmTimer, scheduled = false;

  function createFrame(path, background) {
    const frame = document.createElement('iframe');
    frame.className = 'works-service-frame';
    frame.title = 'Works';
    if (background || visible) {
      frame.inert = true;
      frame.setAttribute('aria-hidden', 'true');
    }
    if (background) frame.dataset.preloading = '';
    const target = new URL(path, location.origin);
    target.searchParams.set('works-view', '1');
    frame.src = target.href;
    if (destinations.has(path)) sessions.set(path, frame);
    document.body.append(frame);
    return frame;
  }

  function prepareNext() {
    scheduled = false;
    const connection = navigator.connection;
    if (!visible || warming || pending || document.hidden || !hasSession() ||
        connection?.saveData || /^(slow-)?2g$/.test(connection?.effectiveType)) return;
    const path = priority.find(path => !sessions.has(path) && !skipped.has(path) && path !== new URL(activeAddress, location.origin).pathname);
    if (path) {
      warming = createFrame(path, true);
      const frame = warming;
      warmTimer = setTimeout(() => abandonWarmup(frame), 30000);
    }
  }
  function abandonWarmup(frame) {
    if (warming !== frame) return;
    clearTimeout(warmTimer);
    warming = null;
    if (frame.hasAttribute('data-preloading')) {
      const path = new URL(frame.src).pathname;
      sessions.delete(path);
      skipped.add(path);
      frame.remove();
    }
    schedulePreparation();
  }
  window.addEventListener('works-preload-failed', event => abandonWarmup(event.detail));
  function schedulePreparation() {
    if (scheduled) return;
    scheduled = true;
    if (window.requestIdleCallback) requestIdleCallback(prepareNext, {timeout:1500});
    else setTimeout(prepareNext, 250);
  }
  function park(frame) {
    if (frame === visible) return;
    frame.inert = true;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.zIndex = '0';
    if (![...sessions.values()].includes(frame)) frame.remove();
  }
  function visit(url, push, step = 0) {
    const path = canonical(url);
    if (pending?.path === path) return;
    clearTimeout(timer);
    if (pending) park(pending.frame);
    pending = null;
    if (visible && path === activeAddress) {
      schedulePreparation();
      return;
    }
    // An explicit task, student or quick-add URL must run its own route handler.
    const frame = sessions.get(path) || createFrame(path, false);
    delete frame.dataset.preloading;
    pending = {frame, path, push, step};
    if (ready.has(frame)) reveal(frame);
    else timer = setTimeout(() => reveal(frame), 20000);
  }
  function reveal(frame) {
    if (frame !== pending?.frame) return;
    clearTimeout(timer);
    const {path, push, step} = pending;
    pending = null;
    const old = visible;
    visible = frame;
    activeAddress = path;
    rememberService(new URL(path, location.origin).pathname);
    if (push) history.pushState({worksService:true}, '', path);
    frame.inert = false;
    frame.removeAttribute('aria-hidden');
    frame.title = frame.contentDocument?.title || 'Works';
    document.title = frame.title;
    frame.style.zIndex = '2';
    if (old) {
      old.inert = true;
      old.style.zIndex = '1';
      if (motion()) {
        const fade = frame.animate([{opacity:0, translate:`${step * 22}px 0`},{opacity:1, translate:"0 0"}], {duration:210,easing:'ease-out'});
        fade.finished.then(() => park(old), () => park(old));
      } else park(old);
      frame.focus({preventScroll:true});
    }
    schedulePreparation();
  }
  window.addEventListener('works-view-ready', event => {
    const frame = event.detail;
    ready.add(frame);
    if (warming === frame) { clearTimeout(warmTimer); warming = null; }
    reveal(frame);
    schedulePreparation();
  });
  document.addEventListener('visibilitychange', schedulePreparation);
  window.addEventListener('works-service-visit', event => {
    const {frame, url, step} = event.detail;
    const next = new URL(url);
    if (!visible && frame === pending?.frame) reveal(frame);
    if (frame === visible && next.origin === location.origin && destinations.has(next.pathname)) visit(next, true, step);
  });
  window.addEventListener('popstate', () => visit(location.href, false));
  window.addEventListener('storage', event => {
    if ((event.key === 'works_session_token' && event.oldValue !== event.newValue) || !hasSession()) location.reload();
  });
  visit(location.href, false);
}
