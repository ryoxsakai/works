export const studentProfileUrl = id => '/tutor/?' + new URLSearchParams({todo_owner: id});
export const studentCaptureUrl = student => '/todo/#' + new URLSearchParams({kind: 'student', name: student.name, owner: student.id});
export const studentMark = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2"/></svg>';
const normalized = text => text.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('ja');
export function matchingStudents(directory, query) {
  const needle = normalized(query);
  return directory.filter(student => [student.name, ...(student.aliases || [])].some(name => normalized(name).includes(needle)));
}
export function studentHint(student, rooms, directory) {
  const contexts = (student.calendars || []).map(room => rooms.get(room.id)).filter(Boolean);
  const parts = [...new Set(contexts)].map(name => /代官山/.test(name) && !/個別|集団|グループ/.test(name) ? name + '・個別' : name);
  if (directory.some(other => other.id !== student.id && normalized(other.name) === normalized(student.name))) {
    const last = student.calendars?.[0]?.lastDate;
    if (last) parts.push('授業 ' + last.slice(0, 10));
    const short = student.id.slice(0,8);
    parts.push('ID ' + (directory.some(s => s.id !== student.id && s.id.startsWith(short)) ? student.id : short));
  }
  return parts.join(' ／ ');
}
export function relatedTasks(tasks, id) {
  return tasks.filter(task => (task.status ?? (task.progress === 100 ? 'done' : 'pending')) !== 'done' &&
    task.plan?.students?.some(student => student.id === id))
    .sort((a,b) => (a.plannedDay || '9999').localeCompare(b.plannedDay || '9999') || a.name.localeCompare(b.name,'ja'));
}
