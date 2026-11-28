import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createFixture} from './next-lesson-fixture.mjs';

const fixture=await createFixture();
let browser,releaseAdmissions;
try {
  const [year,month]=fixture.today.split('-').map(Number);
  const season=year+Number(month>=4);
  const names=['後半医科大学','共テ医科大学','同日医科大学','旧年度医科大学','推薦医科大学','未登録医科大学','前半医科大学'];
  const schools=names.map((school_name,i)=>({id:i+1,school_name,rank:i<3?i+1:null,school_type:'private'}));
  const event=(i,date,stage='primary',selection_type='general',qualifier='')=>({
    university:names[i]+'医学部'+qualifier,schedule_date:date,stage,selection_type,
  });
  const events=[
    event(0,`${season}-02-08`),event(0,`${season}-01-04`,'first_result'),event(0,`${season}-01-05`,'primary','recommendation'),
    event(1,`${season}-01-06`,'primary','ct'),
    event(2,`${season}-01-21`),
    event(3,`${season-1}-01-01`),
    event(4,`${season}-01-07`,'primary','recommendation'),
    event(6,`${season}-02-18`,'primary','general','（後期）'),
    event(6,`${season}-01-21`,'primary','general','（前期）'),
    event(6,`${season}-01-22`,'primary','general','（前期）'),
  ];
  const admissions=new Promise(resolve=>{releaseAdmissions=resolve;});
  const reads=[],writes=[];
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.base?route.fallback():route.abort());
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['/api/schools','/api/admissions'].includes(url.pathname))return route.fallback();
    if(request.method()!=='GET'){writes.push(url.pathname);return route.abort();}
    reads.push(url.pathname);
    if(url.pathname==='/api/schools')return route.fulfill({json:schools});
    await admissions;
    return route.fulfill({json:events});
  });
  await page.goto(fixture.base+'/tutor/?'+new URLSearchParams({record_date:fixture.today,student_calendar:'qa',student_event:'a'}));
  await expect.poll(()=>new URL(page.url()).searchParams.has('student_event')).toBe(false);
  const list=page.locator('#schools-summary');
  const displayedNames=list.locator('.school-name strong');
  await expect(displayedNames).toHaveText(names);
  await expect(list).toContainText('日程を読み込み中');
  releaseAdmissions();
  const order=[2,6,0,1,3,4,5].map(i=>names[i]);
  await expect(displayedNames).toHaveText(order);
  await expect(list.locator('[data-school-toggle="1"] .school-rank')).toHaveText('第1志望');
  await expect(list.locator('[data-school-toggle="2"] .school-rank')).toHaveText('第2志望');
  await expect(list.locator('[data-school-toggle="3"] .school-rank')).toHaveText('第3志望');
  await list.locator('[data-school-toggle="7"]').click();
  await expect(list.locator('[data-school-toggle="7"]')).toHaveAttribute('aria-expanded','true');
  await expect(list.locator('.school-schedule-group[data-open=true] [data-stage="primary"] time')).toHaveCount(3);
  await expect(list.locator('.school-schedule-group[data-open=true] [data-stage="primary"] time').first()).toHaveAttribute('datetime',`${season}-01-21`);
  await page.setViewportSize({width:1280,height:900});
  await expect(displayedNames).toHaveText(order);
  assert.deepEqual(writes,[]);
  assert.equal(reads.filter(path=>path==='/api/admissions').length,1);
  console.log('PASS student exam schools: earliest current-season general primary, stable same-day ties, other methods/old seasons and undated at end, unchanged preference badges.');
} finally {
  releaseAdmissions?.();
  await browser?.close();
  await fixture.close();
}
