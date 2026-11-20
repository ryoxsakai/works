// Pure synthetic browser fixtures. No live auth, calendars, files or API access.
// Run from the repository root: node tests/tutor-material-dialogs.cjs
const {chromium} = require('../worker/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const output = process.env.WORKS_QA_DIR || '/tmp/works-tutor-material-1120';
fs.mkdirSync(output, {recursive:true});
const auth = `export const getSessionToken=()=>"synthetic"; export const getGoogleAccessToken=async()=>"synthetic"; export const signIn=()=>{}; export const signOutUser=()=>{}; export const isStandaloneHomeScreenApp=()=>false; export const watchAuth=({onSignedIn})=>setTimeout(()=>onSignedIn({email:"synthetic@example.invalid"}),0);`;
const filename = '合成教材_長いファイル名でヘッダーの折り返しを確認するためのサンプル.txt';
const file = {id:'synthetic-file',name:filename,mime_type:'text/plain',size:2048,material_code:'fixture-01',created_at:'2026-11-20'};
const folders = [{id:'synthetic-folder',name:'合成フォルダ',parent_id:null}];
(async()=>{
  const browser=await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
  try {
    const reports=[];
    for (const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390},{width:1280,height:900}]) {
      const context=await browser.newContext({viewport,hasTouch:viewport.width<1000, reducedMotion:'reduce'});
      const page=await context.newPage();
      const errors=[],writes=[]; let failWrite=true;
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',async route=>{
        const req=route.request(),url=new URL(req.url());
        if(url.hostname==='www.googleapis.com') return route.fulfill({json:{items:url.pathname.endsWith('/calendarList')?Array.from({length:24},(_,i)=>({id:'fixture-'+i,summary:'合成教室 '+(i+1)})):[]}});
        if(url.hostname!=='localhost') return route.abort();
        if(url.pathname==='/shared/auth.js')return route.fulfill({contentType:'text/javascript',body:auth});
        if(url.pathname.startsWith('/api/')) {
          if(req.method()!=='GET') {
            writes.push({method:req.method(),path:url.pathname,body:JSON.parse(req.postData())});
            return route.fulfill({status:failWrite?503:200,json:failWrite?{error:'合成エラー：保存できませんでした。入力内容は保持しています。'}:{id:'synthetic-saved'}});
          }
          if(url.pathname.endsWith('/view'))return route.fulfill({contentType:'text/plain',body:Array.from({length:150},(_,i)=>`合成教材の本文 ${i+1}`).join('\n')});
          const data={
            '/api/material-library/folders':folders,'/api/material-library/files':[file],
            '/api/settings':{selected_calendars:[]},'/api/years':[{id:1,label:'合成年度'}],
            '/api/student-prefs':{print_name:'',memo:''}
          };
          return route.fulfill({json:data[url.pathname]||[]});
        }
        const local=path.join(process.cwd(),decodeURIComponent(url.pathname));
        if(fs.existsSync(local)&&fs.statSync(local).isFile()) return route.fulfill({path:local});
        return route.fulfill({status:404,body:''});
      });
      const checkDialog=async selector=>{
        const result=await page.locator(selector).evaluate(el=>{
          const r=el.getBoundingClientRect(),h=el.querySelector('.modal-header').getBoundingClientRect();
          const fields=[...el.querySelectorAll('input:not([type="checkbox"],[type="radio"]),select,textarea')].filter(n=>n.getClientRects().length);
          const close=el.querySelector('.modal-close').getBoundingClientRect();
          return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},header:{top:h.top,bottom:h.bottom},title:document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim(),close:{width:close.width,height:close.height},fields:fields.map(n=>({font:parseFloat(getComputedStyle(n).fontSize),right:n.getBoundingClientRect().right,left:n.getBoundingClientRect().left}))};
        });
        assert(result.title,selector+' accessible name');
        assert(result.rect.x>=0&&result.rect.y>=0,selector+' top/left in viewport');
        assert(result.rect.x+result.rect.width<=viewport.width+1,selector+' right in viewport');
        assert(result.rect.y+result.rect.height<=viewport.height+1,selector+' bottom in viewport');
        assert(result.close.width>=44&&result.close.height>=44,selector+' close touch target');
        for(const f of result.fields){
          if(viewport.width<1000)assert(f.font>=16,selector+' touch input font');
          assert(f.left>=result.rect.x&&f.right<=result.rect.x+result.rect.width+1,selector+' input fits');
        }
        return result;
      };
      await page.goto('http://localhost/tutor/index.html');
      await page.locator('#open-settings').click();
      await page.locator('#calendar-checklist label').first().waitFor();
      await checkDialog('#settings-modal');
      assert.equal(await page.locator('#settings-modal .tab-btn[aria-selected="true"]').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
      const headerTop=await page.locator('#settings-modal .modal-header').evaluate(e=>e.getBoundingClientRect().top);
      await page.locator('#settings-modal [data-tab-panel="calendar"]').evaluate(e=>e.scrollTop=e.scrollHeight);
      assert.equal(await page.locator('#settings-modal .modal-header').evaluate(e=>e.getBoundingClientRect().top),headerTop);
      for(const tab of ['materials','terms','periods','excluded']){
        await page.locator(`[data-tab="${tab}"]`).click();
        await checkDialog('#settings-modal');
      }
      await page.screenshot({path:path.join(output,`tutor-settings-${viewport.width}.png`)});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#settings-modal').evaluate(e=>e.open),false);
      assert.equal(await page.locator('#open-settings').evaluate(e=>document.activeElement===e),true);
      await page.locator('#open-settings').click();
      await page.locator('#settings-close').click();
      // These editors require a selected student; inspect their native presentation
      // directly without selecting a live student or exercising any save operation.
      for(const id of ['material-chapters-modal','curriculum-search-modal','goal-modal','schools-modal']){
        await page.locator('#'+id).evaluate(e=>e.showModal());
        await checkDialog('#'+id);
        await page.locator('#'+id+' .modal-tab-panel').first().evaluate(e=>e.scrollTop=e.scrollHeight);
        await checkDialog('#'+id);
        await page.keyboard.press('Escape');
      }
      assert.equal(writes.length,0,'tutor layout inspection never writes');
      await page.goto('http://localhost/material/index.html');
      await page.locator('.material-file-item').waitFor();
      await page.locator('#new-folder').click();
      await checkDialog('#new-folder-modal');
      await page.locator('#new-folder-name').fill('合成の新しいフォルダ');
      await page.locator('#new-folder-form button[type="submit"]').click();
      await page.locator('#new-folder-modal [role="alert"]:not([hidden])').waitFor();
      assert.equal(await page.locator('#new-folder-name').inputValue(),'合成の新しいフォルダ');
      assert.equal(writes.length,1,'one explicit submit is one request');
      await checkDialog('#new-folder-modal');
      await page.screenshot({path:path.join(output,`material-error-${viewport.width}.png`)});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#new-folder').evaluate(e=>document.activeElement===e),true);
      await page.locator('#new-folder').click();
      assert.equal(await page.locator('#new-folder-modal [role="alert"]').isVisible(),false,'stale error cleared on reopen');
      await page.locator('#new-folder-name').fill('合成の新しいフォルダ');
      failWrite=false;
      await page.locator('#new-folder-form button[type="submit"]').click();
      await page.locator('#new-folder-modal').waitFor({state:'hidden'});
      assert.deepEqual(writes.at(-1),{method:'POST',path:'/api/material-library/folders',body:{name:'合成の新しいフォルダ',parent_id:null}});
      failWrite=true;
      await page.getByRole('button',{name:filename+'の名前・教材コードを編集',exact:true}).click();
      await checkDialog('#rename-material-modal');
      await page.locator('#rename-material-name').fill('合成教材の変更名.txt');
      await page.locator('#material-code').fill('fixture-02');
      await page.locator('#rename-material-form button[type="submit"]').click();
      await page.locator('#rename-material-modal [role="alert"]:not([hidden])').waitFor();
      assert.equal(await page.locator('#rename-material-name').inputValue(),'合成教材の変更名.txt');
      assert.equal(await page.locator('#material-code').inputValue(),'fixture-02');
      assert.deepEqual(writes.at(-1),{method:'PUT',path:'/api/material-library/files/synthetic-file',body:{name:'合成教材の変更名.txt',material_code:'fixture-02'}});
      await page.locator('#rename-material-close').click();
      await page.getByRole('button',{name:filename+'を閲覧',exact:true}).click();
      await page.locator('.material-text-preview').waitFor();
      await checkDialog('#material-preview-modal');
      await page.locator('.material-preview-body').evaluate(e=>e.scrollTop=e.scrollHeight);
      await checkDialog('#material-preview-modal');
      await page.screenshot({path:path.join(output,`material-preview-${viewport.width}.png`)});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#material-preview-body').textContent(),'','preview close cleanup preserved');
      for(const tab of ['tree','tags','library'])await page.locator(`[data-material-tab="${tab}"]`).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
      assert.deepEqual(errors,[],'no browser runtime errors');
      reports.push({viewport,dialogs:8,writes:writes.length});
      await context.close();
    }
    console.log(JSON.stringify({passed:true,reports,screenshots:output},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
