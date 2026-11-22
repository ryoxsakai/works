// Offline synthetic layout regression. No authentication, APIs or stored data.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(new URL('../..',import.meta.url).pathname);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || '../../worker/node_modules/@playwright/test/index.mjs');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
async function fixture(page, area) {
  let html=await readFile(resolve(root,area,'index.html'),'utf8');
  const css=[];
  for(const match of html.matchAll(/<link\b[^>]*href="(\/[^"?]+\.css)(?:\?[^"<>]*)?"[^>]*>/g))css.push(await readFile(resolve(root,'.'+match[1]),'utf8'));
  html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'').replace(/\son\w+="[^"]*"/g,'');
  await page.setContent(html);
  await page.addStyleTag({content:css.join('\n')});
  // Run the real page's pure presentation decorator, without auth/handlers.
  const presentation=await readFile(resolve(root,`shared/ui/${area}-presentation.mjs`),'utf8');
  const name=area==='memo'?'decorateMemo':'decorateTodo';
  const code=presentation.replace(/^import[^\n]+\n/gm,'').replaceAll('export function','function');
  await page.addScriptTag({content:code+`;${name}(document.body);`});
}
try {
 for(const width of [320,390,768,1280]) {
  const page=await browser.newPage({viewport:{width,height:700}});
  await page.route('**/*',route=>route.abort());
  await fixture(page,'memo');
  for(const id of ['memo-modal','view-modal']) {
   await page.evaluate(id=>{
    const dialog=document.getElementById(id);dialog.classList.remove('hidden');
    const content=dialog.querySelector('.memo-dialog-body');
    for(let i=0;i<30;i++){const p=document.createElement('p');p.textContent='Synthetic long memo paragraph '+i;content.append(p);}
    if(id==='view-modal')document.getElementById('view-title').textContent='LongTitle'.repeat(40);
    dialog.showModal();
   },id);
   const box=await page.locator(`#${id}`).boundingBox();
   assert(box.x>=-1&&box.x+box.width<=width+1,`${id} overflows at ${width}`);
   if(width<=730) assert(box.x>=12 && box.y>=12 && box.y+box.height<=689, id+" floating margins");
   const footer=await page.locator(`#${id} .memo-dialog-footer`).boundingBox();
   assert(footer.y>=0&&footer.y+footer.height<=701,`${id} footer offscreen at ${width}`);
   assert(await page.locator(`#${id} .memo-dialog-body`).evaluate(el=>el.scrollHeight>el.clientHeight),'long content should scroll');
   if(width<=730&&id==='memo-modal')assert.equal(await page.locator('#modal-title').evaluate(el=>getComputedStyle(el).fontSize),'16px');
   await page.keyboard.press('Escape');
   assert.equal(await page.locator(`#${id}`).evaluate(el=>el.open),false);
  }
  await fixture(page,'todo');
  await page.evaluate(()=>{document.getElementById('clone-dialog').showModal();});
  const clone=await page.locator('#clone-dialog').boundingBox();
  assert(clone.x>=-1&&clone.x+clone.width<=width+1,`clone dialog overflows at ${width}`);
  if(width<=420)for(const grid of await page.locator('#clone-dialog .form-grid').all())assert.equal(await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
  await page.keyboard.press('Escape');
  await page.close();
 }
 console.log('PASS: Memo long edit/read dialogs and ToDo clone layout at 320, 390, 768, 1280px; Escape and mobile input sizing.');
} finally {await browser.close();}
