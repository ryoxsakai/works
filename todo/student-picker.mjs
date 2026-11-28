import * as auth from '../shared/auth.js?v=15';
import {matchingStudents, studentHint, studentProfileUrl, studentMark} from '../shared/todo-students.mjs?v=1';

async function read(path) {
  const response = await fetch('/api' + path, {cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: {Authorization: 'Bearer ' + auth.getSessionToken()}});
  if (!response.ok) throw Error('生徒情報を取得できませんでした');
  return response.json();
}

async function calendarNames() {
  const signal = AbortSignal.timeout(10000);
  const token = await auth.getGoogleAccessToken({signal});
  const names = new Map();
  let pageToken = '';
  do {
    const params = new URLSearchParams({fields:'nextPageToken,items(id,summary,summaryOverride)', maxResults:'250', pageToken});
    const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?' + params, {signal, headers:{Authorization:'Bearer ' + token}});
    if (!response.ok) throw Error('教室名を取得できませんでした');
    const result = await response.json();
    for (const room of result.items || []) names.set(room.id, room.summaryOverride || room.summary);
    pageToken = result.nextPageToken;
  } while (pageToken);
  return names;
}

export function studentPicker(esc, refresh) {
  let directory = [], rooms = new Map(), pending, ready = false, failed = false;
  const chosen = new Map();
  const students = () => [...chosen.values()];
  const find = id => directory.find(s => s.id === id);
  const matches = query => matchingStudents(directory, query).filter(s => !chosen.has(s.id));
  const hint = s => studentHint(s, rooms, directory);
  const nameOf = s => find(s.id)?.name || s.name;
  function load() {
    if (!pending) {
      failed = false;
      pending = read('/lesson-history/owners?view=student-links').then(items => {
        directory = items.filter(s => s.kind === 'student');
        ready = true;
        if (directory.some(s => s.calendars?.length)) {
          calendarNames().then(names => { rooms = names; refresh(); }).catch(() => {});
        }
        refresh();
      }).catch(() => { failed = true; pending = null; refresh(); });
    }
    return pending;
  }
  function select(s) { chosen.set(s.id, {id:s.id, name:nameOf(s)}); }
  function reset(items = []) { chosen.clear(); items.forEach(select); }
  function link(s) {
    return `<a class="student-task-chip" href="${esc(studentProfileUrl(s.id))}" aria-label="${esc(nameOf(s))}の生徒情報">${studentMark}${esc(nameOf(s))}</a>`;
  }
  function chips(container, editing) {
    container.replaceChildren();
    for (const s of students()) {
      const chip = document.createElement('span');
      chip.className = 'student-task-choice';
      if (editing) chip.innerHTML = link(s);
      else { chip.innerHTML = studentMark; chip.append(nameOf(s)); }
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label',nameOf(s) + 'の紐付けを解除');
      remove.onclick = () => { chosen.delete(s.id); refresh(); };
      chip.append(remove); container.append(chip);
    }
  }
  return {load, find, matches, hint, select, students, reset, link, chips,
    ready: () => ready, failed: () => failed,
    async originStudent(source, owner) {
      if (!owner && source?.kind === 'lesson') {
        const result = await read('/lesson-plan?' + new URLSearchParams({calendar_id:source.calendar,event_id:source.event}));
        if (result.attribution_status === 'confirmed') owner = result.owner_id;
      }
      if (!owner) return null;
      await load();
      if (!ready) throw Error('生徒候補を再読み込みしてください');
      return find(owner);
    }
  };
}
