import {createShell} from '../shell-app.mjs';
import {createProductionContext,safeShellRoute} from './context.mjs';
const authUrl='/shared/auth.js?v=12';
const auth=await import(/* @vite-ignore */ authUrl);
const authScreen=document.querySelector('#auth-screen'),message=document.querySelector('#auth-message'),login=document.querySelector('#app-sign-in');
let shell;
function signedOut(text){shell?.suspend();authScreen.hidden=false;message.textContent=text;login.hidden=false;login.disabled=text==='ログアウトしています…';}
const context=createProductionContext(auth,{onExpired:signedOut});
context.toggleTheme=async()=>{const url='/shared/theme.js?v=6';const theme=await import(/* @vite-ignore */ url);theme.setTheme(theme.getTheme()==='dark'?'light':'dark');};
login.onclick=()=>{
  try{sessionStorage.setItem('works_shell_return_route',safeShellRoute(location.hash.replace(/^#!/,'')));localStorage.setItem('works_pending_destination','/app/');}
  catch{signedOut('ブラウザの保存を許可してから、従来のホームでログインしてください。');return;}
  auth.signIn('/tutor/');
};
window.addEventListener('storage',event=>{if(event.key===null||event.key==='works_session_token')context.invalidate('別のタブでログイン状態が変更されました。再度ログインしてください。');});
window.addEventListener('pagehide',()=>shell?.suspend());
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
const signedIn=await context.session.init();
if(signedIn&&context.active){
  if(!location.hash){let route='/home/';try{route=safeShellRoute(sessionStorage.getItem('works_shell_return_route'));sessionStorage.removeItem('works_shell_return_route');}catch{}history.replaceState(null,'',location.pathname+location.search+'#!'+route);}
  authScreen.hidden=true;document.querySelector('#app').hidden=false;
  shell=await createShell(context,{entryRoot:'/app/',demo:false});
  if(!context.active)shell.suspend();
}
