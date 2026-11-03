import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';

const root=new URL('../../',import.meta.url);
const html=`<!doctype html><html><body><div id="root"></div><button id="outside">移動</button><script type="module">
import {createOwnerMemoEditors,ownerMemoMarkup} from '/shared/owner-memo.mjs';
const host=document.querySelector('#root'),escape=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;');
let remote=JSON.parse(localStorage.getItem('remote')||'{"memo":"base","revision":1}'),mode='ok',writes=[],release;
const target={calendar_id:'synthetic',id:'lesson',title:'合成生徒',start:'2026-11-03'};
const request=async(path,opts)=>{
 if(path.includes('/audit?'))return JSON.parse(localStorage.getItem('audits')||'[]');
 if(!opts)return {...remote,owner_id:'o',owner_revision:1,target};
 const body=JSON.parse(opts.body);writes.push(body);
 if(mode==='hold')await new Promise(r=>release=r);
 if(mode==='reject')throw Object.assign(Error('rejected'),{status:400});
 if(mode==='offline')throw Error('offline');
 if(mode==='conflict'){remote={memo:'another edit',revision:remote.revision+1};throw Object.assign(Error('conflict'),{status:409});}
 assertBody(body);
 remote={memo:body.memo,revision:remote.revision+1};localStorage.setItem('remote',JSON.stringify(remote));
 const value={...remote,owner_id:'o',owner_revision:1,target};
 localStorage.setItem('audits',JSON.stringify([{id:body.request_id,action:'write_owner_memo',after_json:JSON.stringify(value)}]));
 if(mode==='lost')throw Error('response lost');
 return value;
};
function assertBody(body){if(body.owner_id!=='o'||body.revision!==remote.revision||body.expected_memo!==remote.memo||body.target.id!=='lesson')throw Object.assign(Error('wrong target/base'),{status:409});}
const controller=createOwnerMemoEditors({request});host.innerHTML=ownerMemoMarkup('o',target,escape);controller.render(host);
window.qa={mode:value=>mode=value,writes:()=>writes,remote:()=>remote,release:()=>{const complete=release;release=null;complete();},waiting:()=>!!release,dispose:()=>controller.dispose(),edits:()=>controller.hasEdits()};
</script></body></html>`;
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;if(path==='/'){res.setHeader('content-type','text/html');res.end(html);}else{res.setHeader('content-type','text/javascript');res.end(await readFile(new URL('.'+path,root)));}}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined});
try{
 const page=await browser.newPage(),url='http://127.0.0.1:'+server.address().port;
 const fresh=async()=>{await page.goto(url);await page.evaluate(()=>localStorage.clear());await page.reload();await expect(page.locator('textarea')).toHaveValue('base');};
 const area=page.locator('textarea'),status=page.locator('.owner-memo-status');
 await fresh();await expect(page.locator('.owner-memo-save')).toBeHidden();
 await area.fill('debounced');await expect.poll(()=>page.evaluate(()=>qa.remote().memo)).toBe('debounced');await expect.poll(()=>page.evaluate(()=>qa.writes().length)).toBe(1);
 await page.evaluate(()=>qa.mode('hold'));await area.fill('first');await area.press('Tab');await expect.poll(()=>page.evaluate(()=>qa.waiting())).toBe(true);
 await expect(area).toBeEditable();await area.fill('latest while saving');await page.evaluate(()=>{qa.mode('ok');qa.release();});
 await expect(area).toHaveValue('latest while saving');await expect.poll(()=>page.evaluate(()=>qa.remote().memo)).toBe('latest while saving');
 assert.equal(await page.evaluate(()=>qa.writes().at(-1).expected_memo),'first');
 await page.evaluate(()=>qa.mode('hold'));await area.fill('temporary sent text');await area.press('Tab');await expect.poll(()=>page.evaluate(()=>qa.waiting())).toBe(true);await area.fill('latest while saving');await page.evaluate(()=>{qa.mode('ok');qa.release();});await expect.poll(()=>page.evaluate(()=>qa.remote().memo)).toBe('latest while saving');await expect(area).toHaveValue('latest while saving');
 await area.fill('target unchanged');await area.press('Tab');await expect.poll(()=>page.evaluate(()=>qa.remote().memo)).toBe('target unchanged');assert(await page.evaluate(()=>qa.writes().every(x=>x.target.id==='lesson'&&x.owner_id==='o')));
 await fresh();await page.evaluate(()=>qa.mode('reject'));await area.fill('keep rejected');await area.press('Tab');await expect(status).toContainText('rejected');await expect(area).toHaveValue('keep rejected');assert.equal(await page.evaluate(()=>qa.writes().length),1);
 await page.evaluate(()=>qa.mode('ok'));await page.locator('.owner-memo-reload').click();await expect(area).toBeEditable();await area.focus();await area.press('Tab');await expect.poll(()=>page.evaluate(()=>qa.remote().memo)).toBe('keep rejected');
 await fresh();await page.evaluate(()=>qa.mode('offline'));await area.fill('offline copy');await area.press('Tab');await expect(status).toContainText('結果が不明');await page.reload();await expect(area).toHaveValue('offline copy');await expect(area).toHaveAttribute('readonly','');assert.equal(await page.evaluate(()=>qa.writes().length),0);
 await fresh();await page.evaluate(()=>qa.mode('lost'));await area.fill('committed copy');await area.press('Tab');await expect(status).toContainText('結果が不明');await page.reload();await page.locator('.owner-memo-verify').click();await expect(status).toContainText('保存しました');assert.equal(await page.evaluate(()=>qa.writes().length),0);
 await fresh();await page.evaluate(()=>qa.mode('conflict'));await area.fill('my copy');await area.press('Tab');await expect(page.locator('.owner-memo-comparison')).toBeVisible();await expect(area).toHaveValue('my copy');await page.locator('.owner-memo-resolve').click();assert.equal(await page.evaluate(()=>qa.writes().length),1);await page.evaluate(()=>qa.mode('ok'));await page.locator('.owner-memo-ack').check();await page.locator('.owner-memo-resolve').click();await expect.poll(()=>page.evaluate(()=>qa.remote().memo)).toBe('my copy');
 await fresh();await area.dispatchEvent('compositionstart');await area.fill('変換中');await page.waitForTimeout(750);assert.equal(await page.evaluate(()=>qa.writes().length),0);await area.dispatchEvent('compositionend');await expect.poll(()=>page.evaluate(()=>qa.remote().memo)).toBe('変換中');
 await fresh();await area.fill('unmounted copy');await page.evaluate(()=>qa.dispose());await page.waitForTimeout(750);assert.equal(await page.evaluate(()=>qa.writes().length),0);await page.reload();await expect(area).toHaveValue('unmounted copy');await page.waitForTimeout(750);assert.equal(await page.evaluate(()=>qa.writes().length),0);await area.fill('explicit resumed edit');await area.press('Tab');await expect.poll(()=>page.evaluate(()=>qa.remote().memo)).toBe('explicit resumed edit');
 console.log('PASS autosave debounce, serialized edits, failure/retry, offline/reload, operation verification, conflict comparison, IME, disposal/recovery, keyboard and target isolation');
}finally{await browser.close();await new Promise(r=>server.close(r));}
