import http from 'node:http';import {readFile,mkdir} from 'node:fs/promises';import {chromium,expect} from '@playwright/test';import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url),owners=[{id:'owner-a',name:'あおい',kind:'student',revision:1,record_count:1},{id:'owner-b',name:'英語クラス',kind:'class',revision:1,record_count:0}];
const records=[{id:'record-a',owner_id:'owner-a',lesson_date:'2026-10-20',title_snapshot:'以前の名前',revision:1,lesson_plan:'予定が削除されても残る本文',confirmation_test:'',homework:'',lesson_memo:'',completed:0}];let writes=0,lost=false,auditKnown=false;
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://fixture');
 if(u.pathname==='/shared/auth.js'){res.setHeader('Content-Type','text/javascript');return res.end('export const getSessionToken=()=>"synthetic";export const watchAuth=o=>o.onSignedIn({email:"synthetic"});');}
 if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');assert.equal(req.headers.authorization,'Bearer synthetic');
  let body={};if(req.method!=='GET'){let raw='';for await(const c of req)raw+=c;body=JSON.parse(raw);}
  if(u.pathname.endsWith('/status'))return res.end(JSON.stringify({mode:'prepare'}));if(u.pathname==='/api/settings')return res.end(JSON.stringify({selected_calendars:['calendar-a']}));
  if(u.pathname.endsWith('/owners'))return res.end(JSON.stringify(owners));
  if(u.pathname.endsWith('/records'))return res.end(JSON.stringify(records.filter(r=>r.owner_id===u.searchParams.get('owner_id'))));
  if(u.pathname.endsWith('/audit'))return res.end(JSON.stringify(auditKnown?[{id:u.searchParams.get('operation_id'),action:'edit_record',created_at:'2026-11-01'}]:[]));
  if(req.method==='PUT'&&u.pathname.endsWith('/records/record-a')){writes++;if(lost){res.statusCode=503;return res.end(JSON.stringify({error:'保存結果が不明',code:'LESSON_HISTORY_UNKNOWN'}));}assert.equal(body.revision,records[0].revision);Object.assign(records[0],body,{revision:body.revision+1});return res.end(JSON.stringify({record:records[0],operation_id:body.request_id}));}
  if(u.pathname.endsWith('/target'))return res.end(JSON.stringify({target:{calendar_id:'calendar-a',id:'event-a',title:'現在の名前',start:'2026-11-01',etag:'v1'},link:null}));
  if(u.pathname.endsWith('/legacy'))return res.end('[]');
  res.statusCode=404;return res.end(JSON.stringify({error:'not found'}));
 }
 const mime=/\.(js|mjs)$/.test(u.pathname)?'text/javascript':u.pathname.endsWith('.css')?'text/css':'text/html';res.setHeader('Content-Type',mime);res.end(await readFile(new URL('.'+u.pathname,root)));
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();page.on('dialog',dialog=>dialog.accept());await page.goto('http://127.0.0.1:'+server.address().port+'/tutor/history.html');
 await expect(page.locator('#owner')).toBeEnabled();await expect(page.locator('#records')).toContainText('以前の名前');await expect(page.getByLabel('授業予定',{exact:true})).toHaveValue('予定が削除されても残る本文');
 await page.getByLabel('授業予定',{exact:true}).fill('最新の本文\n宿題: p.10');await page.getByRole('button',{name:'授業記録を保存',exact:true}).click();await expect(page.getByLabel('授業予定',{exact:true})).toHaveValue('最新の本文\n宿題: p.10');assert.equal(writes,1);
 await page.locator('#owner').selectOption('owner-b');await expect(page.locator('#history-empty')).toContainText('まだありません');await page.locator('#owner').selectOption('owner-a');await expect(page.locator('#records article')).toHaveCount(1);
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('h1')).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await mkdir(new URL('../test-artifacts/',import.meta.url),{recursive:true});await page.screenshot({path:new URL('../test-artifacts/owner-history-mobile.png',import.meta.url).pathname,fullPage:true});
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:new URL('../test-artifacts/owner-history-desktop.png',import.meta.url).pathname,fullPage:true});
 lost=true;await page.getByLabel('授業予定',{exact:true}).fill('結果不明の入力を保持');await page.getByRole('button',{name:'授業記録を保存',exact:true}).click();await expect(page.locator('#status')).toContainText('再送せず');await expect(page.getByRole('button',{name:'授業記録を保存',exact:true})).toBeDisabled();await expect(page.getByLabel('授業予定',{exact:true})).toHaveValue('結果不明の入力を保持');assert.equal(writes,2);
 await page.reload();await expect(page.locator('#status')).toContainText('未確認の保存');await expect(page.getByRole('button',{name:'授業記録を保存',exact:true})).toBeDisabled();await page.getByText('保存結果を操作IDで確認',{exact:true}).click();await page.getByRole('button',{name:'保存結果だけを照合'}).click();await expect(page.locator('#operation-result')).toContainText('まだ保存を確認できません');assert.equal(writes,2);auditKnown=true;await page.getByRole('button',{name:'保存結果だけを照合'}).click();await expect(page.locator('#operation-result')).toContainText('保存済み');await expect(page.getByRole('button',{name:'授業記録を保存',exact:true})).toBeEnabled();assert.equal(writes,2);
 console.log('PASS owner history UI: schedule-independent history, class/empty switch, save/readback, mobile/reduced motion, unknown blocks replay');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
