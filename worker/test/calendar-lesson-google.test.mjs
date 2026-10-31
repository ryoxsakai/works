import test from 'node:test';import assert from 'node:assert/strict';
import {calendarLessonGoogle} from '../src/calendar-lesson-google.js';
test('existing-token adapter paginates complete ACL and sends only description with instance ETag',async()=>{
 const calls=[];const api=calendarLessonGoogle({accessToken:'synthetic',fetcher:async(url,options)=>{
  calls.push({url,options});assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer synthetic');
  if(url.includes('calendarList'))return Response.json({accessRole:'owner'});
  if(url.includes('/acl'))return Response.json(new URL(url).searchParams.has('pageToken')?{items:[{role:'freeBusyReader',scope:{type:'default'}}]}:{items:[{role:'owner',scope:{type:'user',value:'owner@example.invalid'}}],nextPageToken:'next'});
  return Response.json({id:'instance',etag:'"new"'});
 }});
 const privacy=await api.privacy('cal@example.invalid');assert.equal(privacy.complete,true);assert.equal(privacy.rules.length,2);assert.equal(calls.length,3);
 await api.patch('cal@example.invalid','instance',{description:'授業予定：'},{ifMatch:'"old"',sendUpdates:'none'});
 const sent=calls.at(-1);assert.ok(sent.url.endsWith('/events/instance?sendUpdates=none'));assert.equal(sent.options.headers['If-Match'],'"old"');assert.deepEqual(JSON.parse(sent.options.body),{description:'授業予定：'});
});
test('missing ACL grant is explicit; no grant expansion, redirection or mutation retry',async()=>{
 let calls=0;const api=calendarLessonGoogle({accessToken:'synthetic',fetcher:async()=>{calls++;return Response.json({error:'insufficient scope'},{status:403});}});
 await assert.rejects(api.privacy('calendar'),e=>e.status===403&&e.code==='CALENDAR_EXISTING_GRANT_INSUFFICIENT');assert.equal(calls,1);
 await assert.rejects(api.patch('calendar','instance',{description:'x'},{ifMatch:'"old"',sendUpdates:'none'}),e=>e.status===403);assert.equal(calls,2);
 await assert.rejects(api.patch('calendar','series',{description:'x',recurrence:[]},{ifMatch:'"old"',sendUpdates:'none'}));assert.equal(calls,2);
});
test('ACL malformed/repeated continuation is not a complete sharing proof',async()=>{
 for(const page of [{},{items:[],nextPageToken:'same'}]){
  const api=calendarLessonGoogle({accessToken:'synthetic',fetcher:async url=>Response.json(url.includes('calendarList')?{accessRole:'owner'}:page)});
  await assert.rejects(api.privacy('calendar'));
 }
});
test('exact private calendar attestation is not mislabeled as ACL evidence and does not request a new scope',async()=>{
 const paths=[];const api=calendarLessonGoogle({accessToken:'synthetic',ownerEmail:'owner@example.invalid',attestedCalendars:['approved'],fetcher:async url=>{paths.push(url);return Response.json({accessRole:'owner'});}});
 const proof=await api.privacy('approved');assert.equal(proof.basis,'owner_attested');assert.equal(proof.complete,undefined);assert.equal(proof.rules,undefined);assert.equal(paths.length,1);assert.ok(!paths.some(p=>p.includes('/acl')));
});
