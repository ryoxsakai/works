export const servicePaths = ['/tutor/', '/material/', '/admission/', '/todo/', '/memo/'];
const key = 'works_last_service';

export function lastService() {
  try {
    const saved = localStorage.getItem(key);
    if (servicePaths.includes(saved)) return saved;
  } catch {}
  return '/tutor/';
}

export function rememberService(path) {
  if (!servicePaths.includes(path)) return;
  try { localStorage.setItem(key, path); } catch {}
}
