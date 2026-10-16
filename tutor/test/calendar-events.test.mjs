import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('async function fetchCalendarEvents('), source.indexOf('\nfunction isExcludedScheduleEvent'));
function setup(fetch) {
  const context = vm.createContext({ URLSearchParams, selectedCalendarIds: new Set(['one', 'two']), getGoogleAccessToken: async () => 'fixture', fetch, isExcludedScheduleEvent: ev => ev.summary === '空き', extractGoogleErrorDetail: async () => 'fixture error' });
  vm.runInContext(helper, context);
  return options => context.fetchCalendarEvents('2026-09-01T00:00:00+09:00', '2026-12-06T00:00:00+09:00', options);
}
test('all pages from each calendar reach the term end, preserving IDs and filters', async () => {
  const requests = [];
  const load = setup(async input => {
    const url = new URL(input); requests.push(url);
    const calendar = url.pathname.split('/').at(-2);
    const page = url.searchParams.get('pageToken');
    assert.equal(url.searchParams.get('timeMax'), '2026-12-06T00:00:00+09:00');
    if (!page) return { ok: true, json: async () => ({ items: Array.from({length:250}, (_,i) => ({id: `${calendar}-${i}`, summary:'授業'})), nextPageToken: `${calendar}-next` }) };
    assert.equal(page, `${calendar}-next`);
    return { ok: true, json: async () => ({ items: [{id:`${calendar}-dec5`, summary:'授業', start:{date:'2026-12-05'}}, {id:`${calendar}-free`,summary:'空き'}] }) };
  });
  const events = await load({withCalendarId:true});
  assert.equal(events.length, 502);
  assert.equal(events.filter(ev => ev.start?.date === '2026-12-05').length, 2);
  assert.ok(events.every(ev => ev.id.startsWith(ev._calendarId)));
  assert.equal(requests.length, 4);
  assert.equal((await load({includeExcluded:true})).length, 504);
});
test('later-page failure is reported instead of returning a partial schedule', async () => {
  const load = setup(async input => new URL(input).searchParams.has('pageToken')
    ? {ok:false,status:403}
    : {ok:true,json:async()=>({items:[{id:'early'}],nextPageToken:'next'})});
  await assert.rejects(load(), /403.*fixture error/);
});
test('empty calendars produce an empty result', async () => {
  assert.equal((await setup(async()=>({ok:true,json:async()=>({})}))()).length, 0);
});
test('schedule and records still load when restored curriculum fails', async () => {
  const calls = [];
  const section = source.slice(source.indexOf('      // Load the schedule independently'), source.indexOf('      await loadRecordTable();', source.indexOf('      // Load the schedule independently')) + '      await loadRecordTable();'.length);
  const context = vm.createContext({els:{curriculumName:{value:'fixture'},curriculumTermSelect:{value:'1'}},loadCalendarEvents:async()=>calls.push('schedule'),loadCurriculumEvents:async()=>{throw Error('fixture curriculum error');},showEventPlaceholder:()=>{},showActionError:()=>calls.push('error'),loadRecordTable:async()=>calls.push('records')});
  await vm.runInContext(`(async()=>{${section}})()`, context);
  assert.deepEqual(calls, ['schedule','error','records']);
});
