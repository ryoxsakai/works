import test from 'node:test';
import assert from 'node:assert/strict';
import {migrationDryRun} from '../calendar-lesson-dry-run.mjs';
test('offline dry run produces exact mappings and reason counts without guessing calendar identity',()=>{
 const row=id=>({calendar_event_id:id,record_exists:1,record_calendar_id:'calendar',record_title:'合成名',record_revision:1,record_generation:0,lesson_plan:'予定'});
 const event=id=>({id,calendar_id:'calendar',summary:'合成名',etag:'"e"',organizer:{self:true},start:{dateTime:'2026-10-20T10:00:00+09:00'},end:{dateTime:'2026-10-20T11:00:00+09:00'}});
 const snapshot={ownerEmail:'owner@example.invalid',records:[row('ready'),row('missing'),row('duplicate'),row('old'),{...row('unknown'),record_title:null}],events:[event('ready'),event('duplicate'),{...event('duplicate'),calendar_id:'other'},{...event('old'),start:{dateTime:'2026-10-19T10:00:00+09:00'}},event('unknown')],privacy:[{calendar_id:'calendar',accessRole:'owner',complete:true,rules:[{role:'owner',scope:{type:'user',value:'owner@example.invalid'}}]}]};
 const original=structuredClone(snapshot),result=migrationDryRun(snapshot);
 assert.deepEqual(snapshot,original);assert.deepEqual(result.counts,{ready:1,held:3,historical:1});assert.equal(result.executed,0);assert.equal(result.ownership_inferred,false);
 assert.equal(result.items.find(r=>r.event_id==='ready').calendar_id,'calendar');assert.equal(result.items.find(r=>r.event_id==='duplicate').reason,'event_id_collision');
 assert.equal(result.items.find(r=>r.event_id==='unknown').reason,'attribution_legacy_historical');
});
