import logoUrl from '../logo.png';
import {createSidebarController} from './sidebar-controller.mjs';
import Framework7 from 'framework7';
import Panel from 'framework7/components/panel';
import 'framework7/css';
import 'framework7/components/panel/css';
import './shell.css';
import {mountServices} from './services-module.mjs';
import {mountWorkspace} from './workspace-module.mjs';
import {mountSS} from './ss-module.mjs';
import {installNavigationGuard} from './navigation-guard.mjs';
Framework7.use([Panel]);
export async function createShell(context,{entryRoot='/prototype/',demo=true}={}) {
const nav=[['home','⌂','ホーム'],['teaching','▤','授業'],['operations','✓','業務'],['workflow','◇','ワークフロー'],['more','•••','その他']];
if(!demo){document.documentElement.classList.add('logo-enabled');document.querySelector('.brand').innerHTML=`<img class="sidebar-logo" src="${logoUrl}" width="160" height="160" alt="Works"><small>WORKSPACE</small>`;}
const fullNav=demo?nav.map(([key,icon,label])=>({key,icon,label,path:`/${key}/`})):[
 {key:'home',icon:'⌂',label:'ホーム',path:'/home/'},{key:'teaching',icon:'▤',label:'授業管理',path:'/teaching/'},
 {key:'material',icon:'▥',label:'教材管理',path:'/material/'},{key:'todo',icon:'✓',label:'TODO',path:'/todo/'},{key:'memo',icon:'▧',label:'メモ',path:'/memo/'},
 {key:'admission',icon:'▦',label:'入試管理',path:'/admission/'},{key:'flow',icon:'◇',label:'ワークフロー',path:'/flow/'},{key:'wiki',icon:'▣',label:'Wiki',path:'/wiki/'},
 {key:'ss',icon:'▱',label:'SS管理',path:'/ss/'},{key:'kdp',icon:'▤',label:'KDP管理（従来画面）',path:'/kdp/',external:true}];
const navLink=({key,icon,label,path,external})=>`<a href="${path}" data-area="${key}" class="${external?'external':''}"><span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span></a>`;
document.querySelector('.side-links').innerHTML=fullNav.map(navLink).join('');
document.querySelector('.toolbar-inner').innerHTML=(demo?fullNav:fullNav.slice(0,5)).map(navLink).join('');
const sidebar=document.querySelector('.panel-left');sidebar.id='works-side-menu';sidebar.classList.remove('panel-reveal');sidebar.classList.add('panel-cover');
const closeButton=document.createElement('button');closeButton.type='button';closeButton.className='drawer-close';closeButton.textContent='閉じる';closeButton.setAttribute('aria-label','全メニューを閉じる');sidebar.prepend(closeButton);
let drawer;

const legacy={teaching:[['授業管理','予定と授業記録','/tutor/'],['教材管理','教材の分類・保管','/material/'],['入試管理','日程と進路情報','/admission/']],operations:[['ToDo','優先度・締切・進捗','/todo/'],['メモ','本文・補足・タグ','/memo/']],workflow:[['ワークフロー','本人が許可した仕事の進行確認','/workflow/'],['Wiki','知識と出典・改稿履歴','/wiki/']],more:[['KDP管理','構成・原稿・出典','/kdp/']]};
let mounted=null,view;
const page=(title,subtitle,body)=>`<div class="page" data-name="shell"><header class="app-header"><div class="shell-title"><button type="button" class="menu-button" data-menu-open aria-label="全メニューを開く" aria-haspopup="dialog" aria-controls="works-side-menu" aria-expanded="false"><span aria-hidden="true">☰</span></button>${demo?'':`<img class="header-logo" src="${logoUrl}" width="88" height="88" alt="Works">`}<div><span class="breadcrumb">Works / ${title}</span><h1 tabindex="-1">${title}</h1></div></div>${demo?'<span class="session-badge">サンプル表示</span>':'<div class="shell-account"><button type="button" data-refresh>更新</button><button type="button" data-theme-toggle>テーマ</button><button type="button" data-sign-out>ログアウト</button></div>'}</header><div class="page-content"><div class="module-host"><p class="eyebrow">${subtitle}</p>${body}</div></div></div>`;
const home=()=>page('ホーム','YOUR WORKSPACE',`<section class="welcome"><div><span class="date-label">今日のワークスペース</span><h2>ひとつの場所で、<br>今日の仕事を進める。</h2><p>予定を見て、案件を進め、必要な確認へ。<br>Worksの機能をまとめる、新しい入口です。</p><a href="/ss/" class="primary-link">SS案件を確認 <span>↗</span></a></div><div class="welcome-art" aria-hidden="true"><div class="art-paper"><i></i><i></i><i></i><strong>W</strong></div><span class="art-check">✓</span></div></section><section class="home-sections"><div class="section-line"><h2>仕事の入口</h2><span class="muted">使いたい機能から</span></div><div class="entry-grid"><a href="/teaching/"><span class="entry-icon rose">▤</span><h3>授業・教材</h3><p>授業、教材、入試の管理</p><span>${demo?'従来画面へ案内':'授業・教材の一覧へ'} →</span></a><a href="/operations/"><span class="entry-icon green">✓</span><h3>業務</h3><p>ToDo、メモを整理</p><span>${demo?'従来画面へ案内':'この画面で整理'} →</span></a><a href="/workflow/"><span class="entry-icon violet">◇</span><h3>ワークフロー</h3><p>許可した仕事と確認事項</p><span>${demo?'従来画面へ案内':'この画面で確認'} →</span></a><a href="/ss/" class="entry-ready"><span class="entry-icon blue">▣</span><h3>SS案件</h3><p>一覧と詳細をこの画面で</p><span>${demo?'試作を開く':'SS案件を開く'} →</span></a></div></section><aside class="pilot-note"><strong>${demo?"統合画面の試作":"Works 統合画面"}</strong><p>${demo?"SSは合成データです。その他の機能は従来画面で開きます。本番のデータや実行許可は変更しません。":"SS案件、ToDo・メモ・Wiki、ワークフロー・教材・入試情報をこの画面で確認できます。高度な操作と授業記録は従来画面で利用できます。"}</p><a class="external" href="/">従来のホームへ</a></aside>`);
function category(area){const title=nav.find(n=>n[0]===area)?.[2]||'その他';const ss=area==='more'?`<a href="/ss/" class="legacy-card ready"><strong>SS案件</strong><p>一覧・詳細をこの画面で確認できます。</p><span>${demo?'試作を開く':'SS案件を開く'} →</span></a>`:'';return page(title,'WORKS SERVICES',`<div class="category-intro"><h2>${area==='teaching'?'授業記録は従来画面で利用できます。':area==='operations'?'毎日の業務を整える。':area==='workflow'?'進める仕事と、必要な確認。':'制作の仕事をまとめて確認。'}</h2><p>${demo||area==='more'?'この分類の機能はまだ統合していません。従来の画面を開きます。':'統合済みの機能はこの画面で開きます。その他は従来の画面で利用できます。'}</p></div><div class="legacy-grid">${ss}${(legacy[area]||[]).map(([name,description,url])=>!demo&&['/todo/','/memo/','/wiki/','/material/','/admission/','/workflow/'].includes(url)?`<a href="${url==='/workflow/'?'/flow/':url}" class="legacy-card ready"><strong>${name}</strong><p>${description}</p><span>この画面で開く →</span></a>`:`<a href="${demo?'https://works.lrnr.jp':''}${url}" target="_blank" rel="noopener" class="external legacy-card"><strong>${name}</strong><p>${description}</p><span>従来画面を開く（別タブ）↗</span></a>`).join('')}</div>`);}
const workspaceRoutes=demo?[]:['todo','memo','wiki'].flatMap(kind=>[undefined,':id'].map(id=>({path:`/${kind}/${id?id+'/':''}`,content:page(({todo:'ToDo',memo:'メモ',wiki:'Wiki'})[kind],'WORKSPACE',`<div data-workspace="${kind}"></div>`)})));
const serviceRoutes=demo?[]:[...['/material/','/material/:type/:id/','/admission/','/admission/:id/','/flow/','/flow/:step/','/flow/:type/:id/'].map(path=>{const kind=path.split('/')[1];return {path,content:page(({material:'教材',admission:'入試情報',flow:'ワークフロー'})[kind],'WORKSPACE',`<div data-service="${kind}"></div>`)};})];
const navigation=installNavigationGuard(()=>mounted,()=>view?.router);
const routes=[...serviceRoutes,...workspaceRoutes,{path:'/home/',content:home()},{path:'/ss/',content:page('SS案件','PROJECT TRACKER',`${demo?'':'<p class="ss-legacy-link"><a class="external" href="/ss/">従来のSS画面へ ↗</a></p>'}<div id="ss-host"></div>`)},{path:'/ss/:id/',content:page('SS案件','PROJECT TRACKER',`${demo?'':'<p class="ss-legacy-link"><a class="external" href="/ss/">従来のSS画面へ ↗</a></p>'}<div id="ss-host"></div>`)},...['teaching','operations','workflow','more'].map(area=>({path:`/${area}/`,content:category(area)})),{path:'(.*)',content:page('ページが見つかりません','WORKS','<p>試験画面の入口から選び直してください。</p><a href="/home/">ホームへ</a>')}].map(route=>({...route,beforeLeave:navigation.beforeLeave,beforeEnter:({resolve,reject})=>context.active===false?reject():resolve()}));
await context.session.init();
const lifetime=new AbortController();
if(!location.hash) history.replaceState(null,"",location.pathname+location.search+"#!/home/");
const app=new Framework7({el:'#app',name:'Works prototype',theme:'ios',routes,clicks:{externalLinks:'.external'},view:{animate:false,iosSwipeBack:false,browserHistory:true,browserHistoryRoot:entryRoot,browserHistorySeparator:'#!',preloadPreviousPage:false,restoreScrollTopOnBack:true},panel:{visibleBreakpoint:1024}});
function mountRoute(route,previous,router){drawer?.close({restore:false});navigation.settled();mounted?.unmount();mounted=null;const moduleKind=route.path.split('/')[1];const area=['material','admission'].includes(moduleKind)?'teaching':['todo','memo'].includes(moduleKind)?'operations':['flow','wiki'].includes(moduleKind)?'workflow':moduleKind==='ss'?'more':moduleKind;for(const link of document.querySelectorAll('[data-area]')){const active=link.dataset.area===(demo?area:moduleKind);link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}const pageEl=router?.currentPageEl||view?.router.currentPageEl||document.querySelector('.view-main .page-current');const host=pageEl?.querySelector('#ss-host');if(host)mounted=mountSS(host,context,{id:route.params?.id,navigate:(url,options)=>view.router.navigate(url,options)});const workspace=pageEl?.querySelector('[data-workspace]');if(workspace)mounted=mountWorkspace(workspace,context,{kind:workspace.dataset.workspace,id:route.params?.id,navigate:(url,options)=>view.router.navigate(url,options)});const service=pageEl?.querySelector('[data-service]');if(service)mounted=mountServices(service,context,{kind:service.dataset.service,id:route.params?.id,type:route.params?.type,step:route.params?.step});const heading=pageEl?.querySelector('h1');heading?.focus({preventScroll:true});document.querySelector('#announcer').textContent=heading?.textContent||'';document.title=`${heading?.textContent||'Works'} | Works${demo?' 試作':''}`;}
view=app.views.create('.view-main',{url:location.hash.replace(/^#!/,'')||'/home/',on:{pageAfterIn:page=>mountRoute(page.route,null,{currentPageEl:page.el})}});
const panel=app.panel.create({el:'.panel-left',visibleBreakpoint:1024,backdrop:true,closeByBackdropClick:true});
drawer=createSidebarController(panel,{background:[document.querySelector('.view-main'),document.querySelector('.app-tabs')]});closeButton.onclick=()=>drawer.close();
queueMicrotask(()=>{if(!document.querySelector('.page-current'))return;if(!mounted)mountRoute(view.router.currentRoute);});
window.addEventListener('beforeunload',event=>{if(mounted?.dirty){event.preventDefault();event.returnValue='';}},{signal:lifetime.signal});
document.addEventListener('click',event=>{
 const opener=event.target.closest('[data-menu-open]');if(opener)drawer.open(opener);
 const menuLink=event.target.closest('#works-side-menu a:not(.external)');if(menuLink&&menuLink.getAttribute('href')===view.router.currentRoute.path)drawer.close();
 const link=event.target.closest('a.external');if(link&&mounted&&!mounted.canLeave())event.preventDefault();
 if(event.target.closest('[data-sign-out]'))context.logout();
 if(event.target.closest('[data-theme-toggle]'))context.toggleTheme?.();
 if(event.target.closest('[data-refresh]')&&(!mounted||mounted.canLeave()))view.router.navigate(view.router.currentRoute.url,{reloadCurrent:true});
},{capture:true,signal:lifetime.signal});
function keyboardInset(){const viewport=window.visualViewport;const inset=viewport?Math.max(0,innerHeight-viewport.height-viewport.offsetTop):0;const editing=!!document.activeElement?.matches('input,textarea,[contenteditable=true]');const open=editing&&inset>120;document.documentElement.classList.toggle('keyboard-open',open);document.documentElement.style.setProperty('--visual-viewport-height',`${viewport?.height||innerHeight}px`);if(open)requestAnimationFrame(()=>document.activeElement?.scrollIntoView({block:'center'}));}
document.addEventListener('focusout',()=>queueMicrotask(keyboardInset),{signal:lifetime.signal});document.addEventListener('focusin',keyboardInset,{signal:lifetime.signal});
window.visualViewport?.addEventListener('resize',keyboardInset,{signal:lifetime.signal});window.visualViewport?.addEventListener('scroll',keyboardInset,{signal:lifetime.signal});
if(demo)Object.defineProperty(window,'worksPrototype',{value:{metrics:context.metrics,get route(){return view.router.currentRoute.url;},framework:app.version}});

if(!demo){document.querySelector('.side-note').textContent='Works 統合画面';document.querySelectorAll('.side-links').forEach(nav=>{const old=document.createElement('a');old.className='external';old.href='/';old.textContent='従来のホームへ ↗';nav.append(old);});}
return {suspend(){drawer?.dispose();mounted?.unmount();mounted=null;lifetime.abort();document.querySelectorAll('.module-host').forEach(root=>root.replaceChildren());document.querySelector('#app').hidden=true;}};
}
