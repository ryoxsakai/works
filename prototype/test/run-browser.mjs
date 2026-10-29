import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
let server;
async function ready(){try{const result=await fetch('http://127.0.0.1:4173/prototype/',{signal:AbortSignal.timeout(1000)});return result.ok&&(await result.text()).includes('統合画面の試作');}catch{return false;}}
function run(file){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file],{cwd,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(file+' exited '+code)));});}
try {
 if(!await ready()){
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','vite.config.mjs'],{cwd,stdio:'inherit'});
  for(let i=0;i<60&&!await ready();i++)await new Promise(resolve=>setTimeout(resolve,200));
  if(!await ready())throw new Error('Local shell server did not become ready');
 }
 const files=['test/shell.browser.mjs','test/auth.browser.mjs','test/production.browser.mjs','test/wiki-native.browser.mjs','test/workflow-native.browser.mjs','test/material-native.browser.mjs','test/ss-native.browser.mjs','test/kdp-native.browser.mjs','test/admission-native.browser.mjs','test/services.browser.mjs','test/logo.browser.mjs','test/drawer.browser.mjs','test/teaching.browser.mjs','test/student-planning.browser.mjs','test/teaching-schedule.browser.mjs','test/tutor-settings.browser.mjs','test/lesson-native.browser.mjs','test/todo-native.browser.mjs','test/memo-native.browser.mjs'];
 const requested=process.argv.slice(2);if(requested.some(file=>!files.includes(file)))throw new Error('Unknown browser suite');
 for(const file of requested.length?requested:files)await run(file);
}finally{if(server){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}}
