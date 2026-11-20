import {relatedTasks, studentCaptureUrl, studentProfileUrl} from '../shared/todo-students.mjs?v=1';

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
function link(label, href) {
  const node = element('a', label);
  node.href = href;
  return node;
}
function lessonDay(date) {
  const ms = Date.parse(date);
  return Number.isFinite(ms) ? new Date(ms + 9 * 3600000).toISOString().slice(0,10) : '';
}

export function createStudentTodos(read) {
  const related = document.getElementById('student-related-todos');
  const fixed = document.getElementById('linked-student-profile');
  const regular = document.querySelector('.curriculum-panel');
  const requested = new URLSearchParams(location.search).get('todo_owner');
  let ids = [], generation = 0, fixedGeneration = 0, resolved = [], registry;
  function directory() {
    registry ||= read('/lesson-history/owners?view=student-links').then(rows => rows.filter(row => row.kind === 'student'))
      .catch(error => { registry = null; throw error; });
    return registry;
  }
  function reset() {
    generation++; ids = []; resolved = []; related.hidden = true; related.replaceChildren();
  }
  function retry(host, action) {
    const button = element('button','再読み込み');
    button.type = 'button'; button.onclick = action; host.append(button);
  }
  function list(tasks, student) {
    const rows = relatedTasks(tasks, student.id);
    if (!rows.length) return element('p','未完了のToDoはありません。');
    const ul = element('ul');
    for (const task of rows) {
      const li = element('li');
      li.append(link(task.name, '/todo/?' + new URLSearchParams({task:task.id})), element('small',task.plannedDay || '作業日なし'));
      ul.append(li);
    }
    return ul;
  }
  async function showRelated(values) {
    reset();
    ids = [...new Set(values.filter(Boolean))];
    if (!ids.length || regular.hidden) return;
    const version = generation;
    try {
      const students = (await directory()).filter(s => ids.includes(s.id));
      if (!students.length || version !== generation) return;
      resolved = students;
      const {tasks} = await read('/todo');
      if (version !== generation) return;
      related.append(element('h3','関連ToDo'));
      for (const student of students) {
        related.append(link(student.name, studentProfileUrl(student.id)),list(tasks,student));
      }
    } catch {
      if (version !== generation) return;
      related.textContent = '関連ToDoを取得できませんでした。';
      retry(related, () => showRelated(ids));
    }
    related.hidden = false;
  }
  // The fixed-ID view stays usable even when a student is outside the selected
  // term or multiple people share the legacy name-keyed curriculum profile.
  async function openFixed() {
    if (!requested) return;
    const version = ++fixedGeneration;
    regular.hidden = true; fixed.hidden = false;
    fixed.textContent = '生徒情報を読み込み中…';
    try {
      const owners = await directory();
      const student = owners.find(s => s.id === requested);
      if (version !== fixedGeneration) return;
      if (!student) throw Error('リンク先の生徒を確認できませんでした。');
      fixed.replaceChildren(element('p','生徒情報'),element('h2',student.name),
        link('＋ この生徒のToDo', studentCaptureUrl(student)), element('h3','関連ToDo'));
      const memoArea = element('p','読み込み中…');
      const tasksArea = element('div','読み込み中…'), historyArea = element('div','読み込み中…');
      fixed.append(tasksArea, element('h3','生徒メモ'), memoArea, element('h3','授業記録'), historyArea, link('生徒一覧へ','/tutor/'));
      const results = await Promise.allSettled([read('/todo'),read('/lesson-history/records?' + new URLSearchParams({owner_id:student.id})),read('/lesson-history/owner-memo?' + new URLSearchParams({owner_id:student.id}))]);
      if (version !== fixedGeneration) return;
      memoArea.textContent = results[2].status === 'fulfilled' ? results[2].value.memo || '生徒メモはありません。' : '生徒メモを取得できませんでした。';
      if (results[0].status === 'fulfilled') tasksArea.replaceChildren(list(results[0].value.tasks,student));
      else { tasksArea.textContent = '関連ToDoを取得できませんでした。'; retry(tasksArea,openFixed); }
      if (results[1].status === 'rejected') { historyArea.textContent = '授業記録を取得できませんでした。'; retry(historyArea,openFixed); return; }
      const records = results[1].value.filter(record => record.owner_id === student.id).reverse();
      historyArea.replaceChildren();
      if (!records.length) historyArea.textContent = '登録済みの授業記録はありません。';
      for (const record of records) {
        const item = element('details');
        const day = lessonDay(record.lesson_date);
        item.append(element('summary', [day,record.title_snapshot || student.name].join('　')));
        for (const [key,name] of [['lesson_plan','授業予定'],['confirmation_test','確認テスト'],['homework','宿題'],['lesson_memo','授業メモ']]) {
          if (record[key]) item.append(element('h4',name),element('p',record[key]));
        }
        if (record.calendar_id && record.event_id) item.append(link('授業記録を開く','/tutor/?'+new URLSearchParams({record_date:day,todo_event:record.event_id,todo_calendar:record.calendar_id})));
        historyArea.append(item);
      }
      const key = name => name.normalize('NFKC').replace(/\s+/gu,'');
      const unique = !owners.some(other => other.id !== student.id &&
        [other.name,...(other.aliases || [])].some(name => key(name) === key(student.name)));
      return {student, records, unique};
    } catch (error) {
      if (version !== fixedGeneration) return;
      fixed.textContent = error.message; retry(fixed,openFixed); fixed.append(link('生徒一覧へ','/tutor/'));
    }
  }
  function updateVisible() {
    if (document.hidden || document.querySelector('[data-page-tab-panel="curriculum"]').hidden) return;
    if (requested && !fixed.hidden) void openFixed();
    else if (ids.length) void showRelated(ids);
  }
  document.addEventListener('visibilitychange', updateVisible);
  window.addEventListener('pageshow', event => { if (event.persisted) updateVisible(); });
  function useRegular(id) {
    ++fixedGeneration; fixed.hidden = true; regular.hidden = false;
    void showRelated([id]);
  }
  function leaveFixed() {
    const url = new URL(location.href);
    if (!url.searchParams.has('todo_owner')) return;
    ++fixedGeneration; fixed.hidden = true; regular.hidden = false;
    url.searchParams.delete('todo_owner');
    history.replaceState(history.state,'',url);
  }
  return {reset,showRelated,openFixed,useRegular,leaveFixed,requested,candidate:() => ids.length === 1 ? ids[0] : null,selected:() => resolved.length === 1 ? resolved[0] : null};
}
