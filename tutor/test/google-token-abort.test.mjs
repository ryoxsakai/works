import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../shared/auth.js',import.meta.url),'utf8');
const implementation=source.slice(source.indexOf('export async function getGoogleAccessToken('),source.indexOf('export async function watchAuth(')).replace('export ','');
test('Google token abort reaches fetch, clears the shared pending read and ignores a late old token',async()=>{
 let calls=0,finishOld,finishNew,oldSignal;const context=vm.createContext({AbortSignal,DOMException,sessionToken:'synthetic-session',cachedGoogleToken:null,googleTokenPromise:null,API_BASE:'/api',fetch:(_url,{signal})=>{calls++;if(calls===1){oldSignal=signal;return new Promise(r=>finishOld=r);}return new Promise(r=>finishNew=r);}});vm.runInContext(implementation,context);
 const controller=new AbortController(),first=context.getGoogleAccessToken({signal:controller.signal}).catch(e=>e);assert.equal(oldSignal,controller.signal);controller.abort();assert.equal(context.googleTokenPromise,null);
 const second=context.getGoogleAccessToken();assert.equal(calls,2);finishOld({ok:true,json:async()=>({access_token:'old-synthetic',expires_in:3600})});assert.equal((await first).name,'AbortError');assert.equal(context.cachedGoogleToken,null);
 const third=context.getGoogleAccessToken();assert.equal(calls,2);finishNew({ok:true,json:async()=>({access_token:'new-synthetic',expires_in:3600})});assert.deepEqual(await Promise.all([second,third]),['new-synthetic','new-synthetic']);assert.equal(await context.getGoogleAccessToken(),'new-synthetic');assert.equal(calls,2);
});
