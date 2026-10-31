import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {lessonEventRef} from '../../shared/lesson-plan.js';
const root=new URL('../../',import.meta.url),ids=['legacy','renamed','unknown','stale','nonempty'],confirmed=new Set(),writes=[];let patches=0;
const event=id=>({id,calendar_id:'synthetic',summary:id==='renamed'?'New student':id,etag:'"'+id+'"',organizer:{self:true},start:{dateTime:'2026-10-20T10:00:00+09:00'},end:{dateTime:'2026-10-20T11:00:00+09:00'},description:id==='nonempty'?'preserve existing text':''});
const row=id=>({calendar_event_id:id,record_exists:1,record_revision:confirmed.has(id)?2:1,record_title:id==='renamed'?'Old student':null,record_observed_title:id,lesson_plan:'<img src=x onerror=alert(1)>\nOriginal plan',confirmation_test:'',homework:'',lesson_memo:''});
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/shared/auth.js'){res.setHeader('Content-Type','text/javascript');return res.end('export const getSessionToken=()=>"synthetic";export const watchAuth=o=>o.onSignedIn();');}
 if(url.pathname.startsWith('/api/')){
  assert.equal(req.headers.authorization,'Bearer synthetic');res.setHeader('Content-Type','application/json');let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):null;
  if(url.pathname.endsWith('/records'))return res.end(JSON.stringify({items:ids.map(calendar_event_id=>({calendar_event_id})),done:true}));
  if(url.pathname.endsWith('/preview')){const id=body.event_id;return res.end(JSON.stringify({calendar_id:'synthetic',event_before:event(id),record_before:row(id),plan:confirmed.has(id)?{status:'ready',ref:lessonEventRef(event(id))}:{status:'held',reason:id==='renamed'?'attribution_title_changed':'attribution_legacy_unverified'}}));}
  if(url.pathname==='/api/lesson-record'){
   if(req.method==='GET'){const id=url.searchParams.get('event_id'),target=lessonEventRef(event(id));if(id==='stale')target.etag='"changed"';return res.end(JSON.stringify({target,original_db_record:row(id),previous_record:row(id),record:{attribution_status:'legacy_unverified'}}));}
   assert.equal(req.method,'PUT');assert.equal(body.decision,'inherit');assert.equal(body.record_revision,1);assert.deepEqual(body.target,lessonEventRef(event(body.target.id)));writes.push(body);confirmed.add(body.target.id);
   if(body.target.id==='unknown'){res.statusCode=503;return res.end(JSON.stringify({error:'Synthetic lost response'}));}
   return res.end(JSON.stringify({record_revision:2,attribution_status:'confirmed'}));
  }
  if(url.pathname.endsWith('/apply')){patches++;assert.equal(body.plan.ref.id,'legacy');return res.end(JSON.stringify({status:'verified'}));}
  throw Error('Unexpected API');
 }
 res.setHeader('Content-Type',/\.(?:mjs|js)$/.test(url.pathname)?'text/javascript':'text/html');res.end(await readFile(new URL('.'+url.pathname,root)));
}catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({acceptDownloads:true});await page.goto('http://127.0.0.1:'+server.address().port+'/tutor/calendar-migration.html');await page.getByRole('button',{name:'対象と元データを確認する'}).click();await expect(page.locator('#summary')).toContainText('held: 5件');
 const item=id=>page.locator('#items > li').nth(ids.indexOf(id)),review=id=>item(id).getByRole('button',{name:'この予定への帰属を確認する'}),dialog=()=>page.getByRole('dialog');
 await expect(review('legacy')).toBeDisabled();await expect(review('nonempty')).toHaveCount(0);
 async function download(){const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'確認データを保存する'}).click();const file=await waiting;return JSON.parse(await readFile(await file.path(),'utf8'));}
 await download();await page.locator('#backup').check();
 await review('legacy').click();await expect(dialog()).toContainText('2026-10-20T10:00:00+09:00');await expect(dialog()).toContainText('<img src=x');await expect(dialog().locator('img')).toHaveCount(0);await expect(dialog().getByRole('button',{name:'この1件の帰属を確定する'})).toBeDisabled();await dialog().getByRole('button',{name:'変更せず閉じる'}).click();assert.equal(writes.length,0);
 async function confirm(id){await review(id).click();await dialog().getByRole('checkbox').check();await dialog().getByRole('button',{name:'この1件の帰属を確定する'}).dblclick();await expect(dialog()).toHaveCount(0);}
 await confirm('legacy');assert.equal(writes.length,1);assert.equal(patches,0);await expect(item('legacy').getByRole('button',{name:'この1件を転記する'})).toBeDisabled();await expect(page.getByRole('button',{name:'対象と元データを確認する'})).toBeDisabled();
 await review('renamed').click();await expect(dialog()).toContainText('New student');await expect(dialog()).toContainText('Old student');await dialog().getByRole('checkbox').check();await dialog().getByRole('button',{name:'この1件の帰属を確定する'}).click();await expect(dialog()).toHaveCount(0);assert.equal(writes.length,2);
 const snapshot=await download();assert.equal(snapshot.records[0].confirmation_before.original_db_record.record_revision,1);assert.equal(snapshot.records[0].confirmation_result.record_revision,2);await page.locator('#backup').check();await item('legacy').getByRole('button',{name:'この1件を転記する'}).click();await expect(item('legacy')).toContainText('verified');assert.equal(patches,1);
 await review('stale').click();await expect(dialog()).toHaveCount(0);await expect(item('stale')).toContainText('予定または記録が変わりました');assert.equal(writes.length,2);
 await confirm('unknown');assert.equal(writes.length,3);await expect(review('unknown')).toHaveCount(0);await expect(page.locator('#status')).toContainText('再送は停止');await expect(page.getByRole('button',{name:'対象と元データを確認する'})).toBeDisabled();assert.equal(patches,1);
 console.log('PASS attribution operator: individual old/new/date/content proof, backup and acknowledgement gates, no bulk release, fresh-target fence, archive evidence export, separate transfer gate, unknown no replay');
}finally{await browser.close();await new Promise(r=>server.close(r));}
