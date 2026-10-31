import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {lessonEventRef} from '../../shared/lesson-plan.js';
const root=new URL('../../',import.meta.url),ids=['nonempty'],confirmed=new Set(),writes=[];let patches=0;
const event=id=>({id,calendar_id:'synthetic',summary:id==='renamed'?'New student':id,etag:'"'+id+'"',organizer:{self:true},start:{dateTime:'2026-10-20T10:00:00+09:00'},end:{dateTime:'2026-10-20T11:00:00+09:00'},description:id==='nonempty'?'preserve existing text':''});
const row=id=>({calendar_event_id:id,record_exists:1,record_revision:confirmed.has(id)?2:1,record_title:id==='renamed'?'Old student':null,record_observed_title:id,lesson_plan:'<img src=x onerror=alert(1)>\nOriginal plan',confirmation_test:'',homework:'',lesson_memo:''});
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/shared/auth.js'){res.setHeader('Content-Type','text/javascript');return res.end('export const getSessionToken=()=>"synthetic";export const watchAuth=o=>o.onSignedIn();');}
 if(url.pathname.startsWith('/api/')){
  assert.equal(req.headers.authorization,'Bearer synthetic');res.setHeader('Content-Type','application/json');let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):null;
  if(url.pathname.endsWith('/records'))return res.end(JSON.stringify({items:ids.map(calendar_event_id=>({calendar_event_id})),done:true}));
  if(url.pathname.endsWith('/preview')){const id=body.event_id;return res.end(JSON.stringify({calendar_id:'synthetic',event_before:event(id),record_before:row(id),plan:confirmed.has(id)?{status:'ready',mode:body.replace_unmanaged_description?'replace_unmanaged_description':undefined,ref:lessonEventRef(event(id))}:{status:'held',reason:id==='renamed'?'attribution_title_changed':'attribution_legacy_unverified'}}));}
  if(url.pathname==='/api/lesson-record'){
   if(req.method==='GET'){const id=url.searchParams.get('event_id'),target=lessonEventRef(event(id));if(id==='stale')target.etag='"changed"';return res.end(JSON.stringify({target,original_db_record:row(id),previous_record:row(id),record:{attribution_status:'legacy_unverified'}}));}
   assert.equal(req.method,'PUT');assert.equal(body.unmanaged_only,true);assert.equal(body.decision,'inherit');assert.equal(body.record_revision,1);assert.deepEqual(body.target,lessonEventRef(event(body.target.id)));writes.push(body);confirmed.add(body.target.id);
   if(body.target.id==='unknown'){res.statusCode=503;return res.end(JSON.stringify({error:'Synthetic lost response'}));}
   return res.end(JSON.stringify({record_revision:2,attribution_status:'confirmed'}));
  }
  if(url.pathname.endsWith('/apply')){patches++;assert.equal(body.plan.ref.id,'nonempty');assert.equal(body.plan.mode,'replace_unmanaged_description');return res.end(JSON.stringify({status:'verified'}));}
  throw Error('Unexpected API');
 }
 res.setHeader('Content-Type',/\.(?:mjs|js)$/.test(url.pathname)?'text/javascript':'text/html');res.end(await readFile(new URL('.'+url.pathname,root)));
}catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({acceptDownloads:true});await page.goto('http://127.0.0.1:'+server.address().port+'/tutor/calendar-migration.html');await page.getByRole('button',{name:'対象と元データを確認する'}).click();await expect(page.locator('#summary')).toContainText('held: 1件');
 const item=page.locator('#items > li'),review=item.getByRole('button',{name:'この1件の既存説明の置換を確認する'});await expect(review).toBeDisabled();await expect(item.getByRole('button',{name:'この1件を転記する'})).toHaveCount(0);
 async function download(){const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'確認データを保存する'}).click();const file=await waiting;return JSON.parse(await readFile(await file.path(),'utf8'));}
 await download();await page.locator('#backup').check();await review.click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('preserve existing text');await expect(dialog.locator('img')).toHaveCount(0);
 const accept=dialog.getByRole('button',{name:'この1件の帰属を確定する'});await dialog.getByRole('checkbox').nth(0).check();await expect(accept).toBeDisabled();await dialog.getByRole('checkbox').nth(1).check();await accept.dblclick();await expect(dialog).toHaveCount(0);assert.equal(writes.length,1);assert.equal(patches,0);
 const apply=item.getByRole('button',{name:'この1件の既存説明を置換する'});await expect(apply).toBeDisabled();const snapshot=await download();assert.equal(snapshot.records[0].replacement_before_description,'preserve existing text');await expect(apply).toBeDisabled();await page.locator('#backup').check();await apply.click();await expect(item).toContainText('verified');assert.equal(patches,1);await expect(apply).toHaveCount(0);
 console.log('PASS individual replacement: literal old text, two acknowledgements, metadata-only unmanaged guard, new backup gate, separate explicit conditional transfer, no duplicate dispatch');
}finally{await browser.close();await new Promise(r=>server.close(r));}
