import {boundedRead} from '../record-read.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
import * as lessonPlan from '../../shared/lesson-plan.js';
const helper = source.slice(source.indexOf('async function fetchCalendarEvents('), source.indexOf('\nfunction isExcludedScheduleEvent'));
function setup(fetch) {
  const context = vm.createContext({ ...lessonPlan, boundedRead, URLSearchParams, selectedCalendarIds: new Set(['one', 'two']), getGoogleAccessToken: async () => 'fixture', fetch, isExcludedScheduleEvent: ev => ev.summary === '空き', extractGoogleErrorDetail: async () => 'fixture error' });
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

test('synced ToDo events are excluded even when displaying free slots', async () => {
  const items = [
    {id:'lesson',summary:'教材準備'},
    {id:'timed-task',summary:'教材準備',extendedProperties:{private:{worksTodo:'task-1'}}},
    {id:'free',summary:'空き'},
  ];
  const load = setup(async () => ({ok:true,json:async()=>({items})}));
  for (const includeExcluded of [false,true]) {
    const events = Array.from(await load({includeExcluded,withCalendarId:true}));
    assert.deepEqual(events.filter(e=>e._calendarId==='one').map(e=>e.id),includeExcluded?['lesson','free']:['lesson']);
  }
});
test('repeating a continuation token reports failure before requesting it twice', async () => {
  const counts = new Map();
  const load = setup(async input => {
    const url=new URL(input), count=(counts.get(url.pathname)||0)+1;
    counts.set(url.pathname,count);
    if(count>2) throw Error('requested the same page twice');
    return {ok:true,json:async()=>({items:[],nextPageToken:'stuck'})};
  });
  await assert.rejects(load(), /続き/);
});
