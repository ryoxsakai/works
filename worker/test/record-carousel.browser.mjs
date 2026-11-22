import {chromium,expect} from '@playwright/test';import assert from 'node:assert/strict';import {mkdir} from 'node:fs/promises';import {createFixture} from './next-lesson-fixture.mjs';
const f=await createFixture(),browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined}),ctx=await browser.newContext({viewport:{width:390,height:900},hasTouch:true,isMobile:true});
const out=new URL('../test-artifacts/record-carousel/',import.meta.url);await mkdir(out,{recursive:true});
const errors=[];try{const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===f.base?r.continue():r.abort());await p.goto(f.base+'/tutor/');
const root=p.locator('#record-tbody'),prev=p.getByRole('button',{name:'前の授業カード',exact:true}),next=p.getByRole('button',{name:'次の授業カード',exact:true});
const turn=key=>p.locator('#record-tbody tr.active').evaluate((row,key)=>row.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true})),key);
await expect(root).toHaveClass(/carousel-inner/);await expect(p.locator('.record-carousel-controls span')).toHaveText('1 / 4件');await expect(prev).toBeHidden();
assert.equal(await root.locator('[data-event-id=a]').count(),1);const field=root.locator('[data-event-id=a] .record-plan');await field.fill('入力を保持');await field.dispatchEvent('compositionstart');await field.press('ArrowRight');await expect(p.locator('.record-carousel-controls span')).toHaveText('1 / 4件');await field.dispatchEvent('compositionend');await field.press('Tab');await expect(root.locator('[data-event-id=a] .lesson-plan-status').first()).toHaveText('保存済み');
await turn('ArrowRight');await expect(p.locator('.record-carousel-controls span')).toHaveText('2 / 4件');await turn('ArrowLeft');await expect(p.locator('.record-carousel-controls span')).toHaveText('1 / 4件');await expect(field).toHaveValue('入力を保持');
const actions=root.locator('tr.active .record-card-meta');
const add=await actions.getByRole('link',{name:'ToDoを追加'}).boundingBox();
const refresh=await actions.locator('.record-recheck').boundingBox();
assert.ok(add.width>=44 && add.x+add.width<=refresh.x+1 && Math.abs(add.y-refresh.y)<2);
await p.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
const card=await root.locator('tr.active').boundingBox(),menu=await p.locator('.page-tabs').boundingBox();
assert.ok(card.y+card.height<=menu.y,'card can scroll above the lower menu');
await p.evaluate(()=>window.scrollTo(0,0));
// Real touch on a card surface changes the native scroll-snap viewport.
await expect.poll(()=>root.evaluate(el=>Math.round(el.scrollLeft))).toBe(0);
const box=await root.boundingBox(),cdp=await ctx.newCDPSession(p);const y=(await root.locator('tr.active .record-next-plan label').first().boundingBox()).y+6;
assert.equal(await p.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('button,input,textarea,a'),{x:box.x+box.width-95,y}),false,'swipe starts on settled card surface, not a form control');
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width-95,y}]});
for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width-95-(box.width-110)*i/12,y}]});await p.waitForTimeout(20);}
await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(p.locator('.record-carousel-controls span')).toHaveText('2 / 4件');
await turn('ArrowRight');await expect(p.locator('.record-carousel-controls span')).toHaveText('3 / 4件');await turn('ArrowRight');await expect(p.locator('.record-carousel-controls span')).toHaveText('4 / 4件');await expect(next).toBeHidden();assert.equal(await root.locator('.carousel-item').count(),4);assert.equal(await root.locator('[data-event-id=a]').count(),1);
await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await root.evaluate(el=>getComputedStyle(el).scrollBehavior),'auto');await turn('ArrowLeft');await expect(p.locator('.record-carousel-controls span')).toHaveText('3 / 4件');
for(const theme of ['light','dark']){await p.evaluate(async t=>(await import('/shared/theme.js?v=6')).setTheme(t),theme);await p.screenshot({path:new URL(`390-${theme}.png`,out).pathname});}
await p.setViewportSize({width:1440,height:900});await expect(root).not.toHaveClass(/carousel-inner/);await expect(next).toBeHidden();for(const row of await root.locator('tr[data-event-id]').all())await expect(row).toBeVisible();
await p.setViewportSize({width:390,height:900});await expect(root).toHaveClass(/carousel-inner/);await p.evaluate(()=>dispatchEvent(new Event('beforeprint')));await expect(root).not.toHaveClass(/carousel-inner/);await p.emulateMedia({media:'print'});await p.pdf({path:new URL('all-records.pdf',out).pathname});await p.emulateMedia({media:'screen'});await p.evaluate(()=>dispatchEvent(new Event('afterprint')));await expect(root).toHaveClass(/carousel-inner/);
await p.locator('[data-day=next]').click();await expect(p.locator('.record-carousel-controls')).toBeHidden();await p.locator('[data-day=next]').click();await expect(root).not.toHaveClass(/carousel-inner/);await expect(root).toContainText('予定はありません');
await p.goto(f.base+'/tutor/?'+new URLSearchParams({record_date:f.today,todo_calendar:'qa',todo_event:'none'}));
const target=root.locator('[data-event-id="none"]');
await expect(target).toHaveClass(/active/);
await expect(p.locator('.record-carousel-controls span')).toHaveText('4 / 4件');
await expect.poll(()=>target.evaluate(row=>Math.abs(row.getBoundingClientRect().left-row.parentElement.getBoundingClientRect().left))).toBeLessThan(4);
await turn('ArrowLeft');
await expect(p.locator('.record-carousel-controls span')).toHaveText('3 / 4件');
assert.deepEqual(errors,[]);assert.equal(f.control.writes.length,1,'only explicit synthetic edit saved; navigation/swipe/resize/print do not write');console.log('PASS pinned Bootstrap6 Carousel: 0/1/4 rows, native touch swipe, keyboard/input/IME, retained draft/save, edges/repeated clicks, reduced motion, desktop/rotation, themes, day reload, no clones and print all cards');
}finally{await ctx.close();await browser.close();await f.close();}
