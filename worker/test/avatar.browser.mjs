import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {createFixture} from './next-lesson-fixture.mjs';
const f=await createFixture(),b=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined});
const picture='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2563eb"/></svg>');
const paths=['/','/tutor/','/material/','/material-print/','/admission/','/ss/'];let cases=0;
try{for(const width of [390,1440])for(const theme of ['light','dark'])for(const path of paths){
 const ctx=await b.newContext({viewport:{width,height:900}});await ctx.addInitScript(t=>localStorage.setItem('works_theme',t),theme);
 await ctx.route('**/*',async r=>{
  const u=new URL(r.request().url());
  if(u.pathname==='/shared/auth.js')return r.fulfill({contentType:'text/javascript',body:`export const getSessionToken=()=> 'qa';export const getGoogleAccessToken=async()=> 'qa';export const signIn=()=>{};export const signOutUser=async()=>{};export const watchAuth=c=>{window.qaAuth=c;c.onSignedIn({email:'qa@example.invalid',picture:${JSON.stringify(picture)}});};`});
  return u.origin===f.base||u.protocol==='data:'?r.continue():r.abort();
 });
 const page=await ctx.newPage();await page.goto(f.base+path);const img=page.locator('#user-avatar'),fallback=page.locator('#user-avatar-fallback');
 await expect(img).toBeVisible();await expect(fallback).toBeHidden();
 assert.ok(await img.evaluate(el=>el.closest('button').getBoundingClientRect().width>=44));
 await page.evaluate(()=>window.qaAuth.onSignedIn({email:'qa@example.invalid',picture:location.origin+'/missing-avatar.png'}));await expect(img).toBeHidden();await expect(fallback).toBeVisible();
 await page.evaluate(()=>window.qaAuth.onSignedIn({email:'qa@example.invalid',picture:''}));await expect(img).toBeHidden();await expect(fallback).toBeVisible();
 await page.evaluate(p=>window.qaAuth.onSignedIn({email:'qa@example.invalid',picture:p}),picture);await expect(img).toBeVisible();await expect(fallback).toBeHidden();
 await page.reload();await expect(img).toBeVisible();await expect(fallback).toBeHidden();
 cases++;await ctx.close();
}console.log(`PASS avatar ${cases} page/width/theme combinations: real image load, failed load, absent image, repeated auth rendering and reload; exactly one visual`);
}finally{await b.close();await f.close();}
