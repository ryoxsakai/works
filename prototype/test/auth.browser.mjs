import {chromium} from '../../worker/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const page=await browser.newPage();let tokenReads=0,userReads=0;
await page.route('**/*',route=>{
 const url=new URL(route.request().url());
 if(url.origin==='http://127.0.0.1:4173'){
  if(url.pathname==='/api/google-token'){tokenReads++;return route.fulfill({json:{access_token:'synthetic-google',expires_in:3600}});}
  if(url.pathname.startsWith('/api/'))throw new Error('unexpected API '+url.pathname);
  return route.continue();
 }
 if(url.href==='https://www.googleapis.com/oauth2/v3/userinfo'){userReads++;return route.fulfill({json:{email:'synthetic@example.test',picture:''}});}
 return route.abort();
});
try {
 await page.goto('http://127.0.0.1:4173/prototype/');
 const result=await page.evaluate(async()=>{
  localStorage.setItem('works_session_token','synthetic-session-only');
  const auth=await import('/shared/auth.js?v=12');
  const {createSessionAdapter}=await import('/prototype/session.mjs');
  const session=createSessionAdapter(auth.watchAuth,auth.getSessionToken);
  const [one,two]=await Promise.all([session.init(),session.init()]);
  localStorage.removeItem('works_session_token');
  return {same:one===two,email:one.user.email,token:one.token};
 });
 assert.deepEqual(result,{same:true,email:'synthetic@example.test',token:'synthetic-session-only'});assert.equal(tokenReads,1);assert.equal(userReads,1);
 console.log('PASS existing shared/auth.js integration: one initialization and one token/user lookup, all credentials/responses synthetic and intercepted.');
}finally{await browser.close();}
