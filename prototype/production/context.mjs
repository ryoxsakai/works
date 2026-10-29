import {validDay} from '../teaching-model.mjs';
import {recordDateRange} from '../../tutor/record-date.js';
export function createProductionContext(auth,{fetcher=fetch,onExpired=()=>{},onLogout=()=>location.replace('/app/'),storage}={}) {
  let active=false,epoch=0,initialization;
  const controllers=new Set();
  const metrics={authInitializations:0,mounts:0,unmounts:0,reads:0};
  function invalidate(message){context.viewState=null;context.workspaceState=null;context.serviceState=null;context.teachingState=null;active=false;epoch++;for(const controller of controllers)controller.abort();controllers.clear();onExpired(message);}
  const context={
    demo:false,metrics,
    get active(){return active;},
    session:{init(){return initialization ||= new Promise(resolve=>{
      metrics.authInitializations++;
      const generation=epoch;
      Promise.resolve(auth.watchAuth({onSignedIn:user=>{if(generation!==epoch){resolve(null);return;}active=true;resolve({user});},onSignedOut:message=>{invalidate(message||'Worksにログインして案件を確認します。');resolve(null);}})).catch(()=>{invalidate('ログイン情報を確認できませんでした。再度ログインしてください。');resolve(null);});
    });}},
    async list({signal}={}) {
      await context.session.init();
      if(!active||!auth.getSessionToken())throw Object.assign(new Error('ログインが必要です'),{status:401});
      const generation=epoch,controller=new AbortController();controllers.add(controller);
      const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
      try {
        metrics.reads++;
        const response=await fetcher('/api/ss-projects',{method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+auth.getSessionToken()},signal:controller.signal});
        if(!active||generation!==epoch)throw new DOMException('Session changed','AbortError');
        if(response.status===401||response.status===403){invalidate('ログイン状態を確認できません。再度ログインしてください。');throw Object.assign(new Error('再ログインが必要です'),{status:response.status});}
        if(!response.ok)throw Object.assign(new Error(response.status===409?'データが更新されています。更新して確認してください。':response.status===429?'アクセスが集中しています。しばらく待って再試行してください。':'SS案件を取得できませんでした。再試行してください。'),{status:response.status});
        const data=await response.json();
        if(!active||generation!==epoch||controller.signal.aborted)throw new DOMException('Session changed','AbortError');
        if(!Array.isArray(data)||data.some(row=>!row||typeof row.id!=='string'||typeof row.name!=='string'||typeof row.deadline!=='string'||typeof row.status!=='string'))throw new Error('SS案件の応答を確認できませんでした。');
        return data.map(({id,name,status,deadline,memo,remaining_days})=>({id,name,status,deadline,memo:typeof memo==='string'?memo:'',remaining_days}));
      }finally{controllers.delete(controller);signal?.removeEventListener('abort',abort);}
    },
    async request(path,{method='GET',body,signal,responseType='json'}={}) {
      if(!['json','blob'].includes(responseType)||responseType==='blob'&&(method!=='GET'||!(/^\/api\/wiki\/pages\/[^/?]+\/export\?format=(?:markdown|json)$/.test(path)||/^\/api\/material-library\/files\/[^/?]+\/(?:view|download)$/.test(path))))throw new Error('Unsupported response type');
      if(/^\/api\/(?:terms|periods|years|students)(?:\?|$)/.test(path)&&method!=='GET')throw new Error('Unsupported API');
      if(!/^\/api\/(?:settings|terms|periods|years|students|student-prefs(?:\/guarded)?|chapter-progress\/guarded|lesson-plan|student-planning\/guarded|tutor-settings\/guarded|lesson-baseline\/initialize|student-materials|lesson-record|next-lesson-plan|curriculum\/[^/?]+|todo(?:\/clone)?|memo|workflow|admissions(?:\/[^/?]+(?:\/guarded)?)?|material-library\/(?:guarded|folders|files)(?:\/[^/?]+(?:\/(?:guarded|view|download))?)?|wiki\/(?:folders(?:\/[^/?]+)?|pages(?:\/[^/?]+(?:\/(?:save|proposals|archive|history|accept|reject|restore|move|export))?)?))(?:\?.*)?$/.test(path))throw new Error('Unsupported API');
      if(path.startsWith('/api/wiki/')){const clean=path.split('?')[0],read=/^\/api\/wiki\/(?:folders|pages(?:\/[^/?]+(?:\/(?:history|export))?)?)$/.test(clean),write=/^\/api\/wiki\/(?:folders(?:\/[^/?]+)?|pages(?:\/[^/?]+\/(?:save|proposals|archive|accept|reject|restore|move))?)$/.test(clean);if(!(method==='GET'&&read||method==='POST'&&write))throw new Error('Unsupported Wiki method');}
      await context.session.init();
      if(!active||!auth.getSessionToken())throw Object.assign(new Error('再ログインが必要です'),{status:401});
      const generation=epoch,controller=new AbortController();controllers.add(controller);
      const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
      try {
        const response=await fetcher(path,{method,cache:'no-store',...(path.startsWith('/api/material-library/')?{redirect:'error'}:{}),headers:{Authorization:'Bearer '+auth.getSessionToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
        if(!active||generation!==epoch)throw new DOMException('Session changed','AbortError');
        if(response.status===401||response.status===403){invalidate('再度ログインしてください。');throw Object.assign(new Error('再ログインが必要です'),{status:response.status});}
        if(!response.ok){let message=response.status===409?'別の画面で更新されています。入力は保持しています。':response.status===429?'アクセスが集中しています。':'通信に失敗しました。';if((path.startsWith('/api/wiki/')||path.startsWith('/api/material-library/')||path.split('?')[0]==='/api/workflow')&&[400,413].includes(response.status)){const error=await response.json().catch(()=>null);if(!active||generation!==epoch||controller.signal.aborted)throw new DOMException('Session changed','AbortError');if(typeof error?.error==='string')message=error.error.slice(0,500).replace(/[\u0000-\u001f]/g,' ');}throw Object.assign(new Error(message),{status:response.status});}
        const result=await (responseType==='blob'?response.blob():response.json());
        if(!active||generation!==epoch||controller.signal.aborted)throw new DOMException('Session changed','AbortError');
        return result;
      }finally{controllers.delete(controller);signal?.removeEventListener('abort',abort);}
    },
    async uploadMaterial(file,folderId,{signal,onProgress=()=>{}}={}) {
      await context.session.init();if(!active||!auth.getSessionToken())throw Object.assign(Error('再ログインが必要です'),{status:401});
      const generation=epoch,controller=new AbortController();controllers.add(controller);
      const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
      try {return await new Promise((resolve,reject)=>{
        const xhr=new XMLHttpRequest();let settled=false;
        const finish=(fn,value)=>{if(settled)return;settled=true;controller.signal.removeEventListener('abort',cancel);fn(value);};
        const check=()=>active&&generation===epoch&&!controller.signal.aborted;
        const cancel=()=>{xhr.abort();finish(reject,new DOMException('Upload result unknown','AbortError'));};
        controller.signal.addEventListener('abort',cancel,{once:true});if(!check()){cancel();return;}
        const params=new URLSearchParams({name:file.name,size:String(file.size)});if(folderId)params.set('folder_id',folderId);
        xhr.open('POST','/api/material-library/files?'+params);xhr.setRequestHeader('Authorization','Bearer '+auth.getSessionToken());xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');xhr.responseType='json';
        xhr.upload.onprogress=event=>{if(check()&&event.lengthComputable)onProgress(Math.min(100,Math.max(0,Math.round(event.loaded/event.total*100))));};
        xhr.onload=()=>{if(!check()){cancel();return;}if([401,403].includes(xhr.status)){invalidate('再度ログインしてください。');finish(reject,Object.assign(Error('再ログインが必要です'),{status:xhr.status}));return;}if(xhr.status<200||xhr.status>=300){finish(reject,Object.assign(Error('アップロードの保存結果を確認できません。'),{status:xhr.status}));return;}finish(resolve,xhr.response);};
        xhr.onerror=()=>finish(reject,Error('アップロードの通信結果を確認できません。'));xhr.onabort=()=>finish(reject,new DOMException('Upload result unknown','AbortError'));xhr.send(file);
      });}finally{controllers.delete(controller);signal?.removeEventListener('abort',abort);}
    },
    async calendarList({signal}={}) {
      await context.session.init();if(!active||!auth.getSessionToken())throw Object.assign(new Error('再ログインが必要です'),{status:401});
      const generation=epoch,controller=new AbortController();controllers.add(controller);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
      const check=()=>{if(!active||generation!==epoch||controller.signal.aborted)throw new DOMException('Session changed','AbortError');};
      try {check();const token=await auth.getGoogleAccessToken();check();if(!token)throw new Error('カレンダー一覧の認証を確認できません。');const items=[],seen=new Set();let pageToken='';
       do {if(seen.has(pageToken)||seen.size>=20)throw new Error('カレンダー一覧が多いため取得を停止しました。');seen.add(pageToken);const query=new URLSearchParams({maxResults:'250',...(pageToken?{pageToken}:{})});const response=await fetcher('https://www.googleapis.com/calendar/v3/users/me/calendarList?'+query,{method:'GET',redirect:'error',cache:'no-store',headers:{Authorization:'Bearer '+token},signal:controller.signal});check();if(!response.ok)throw new Error('カレンダー名・色を取得できません。');const data=await response.json();check();if(!Array.isArray(data.items))throw new Error('カレンダー一覧の応答を確認できません。');items.push(...data.items.filter(row=>typeof row.id==='string'&&!row.deleted));pageToken=data.nextPageToken||'';}while(pageToken);return items;
      }finally{controllers.delete(controller);signal?.removeEventListener('abort',abort);}
    },
    calendarDay(day,options={}){return context.calendarRange(day,day,options);},
    async calendarRange(first,last,{signal,settings:providedSettings}={}) {
      if(signal?.aborted)throw new DOMException('Session changed','AbortError');
      await context.session.init();if(!active||!auth.getSessionToken())throw Object.assign(new Error('再ログインが必要です'),{status:401});
      if(!validDay(first)||!validDay(last)||first>last)throw new Error('予定の期間を確認してください。');
      const settings=providedSettings||await context.request('/api/settings',{signal});
      const ids=[...new Set((settings.selected_calendars||[]).filter(value=>typeof value==='string'&&value))];
      if(!ids.length)return {settings,events:[]};
      const generation=epoch,controller=new AbortController();controllers.add(controller);
      const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
      const check=()=>{if(!active||generation!==epoch||controller.signal.aborted)throw new DOMException('Session changed','AbortError');};
      try {
        const token=await auth.getGoogleAccessToken();check();if(!token)throw new Error('予定の認証を確認できません。');
        const [timeMin,timeMax]=recordDateRange(first,last),events=[];
        for(const calendarId of ids){let pageToken='',pages=0;const seen=new Set();
          do {if(++pages>20||seen.has(pageToken))throw new Error('予定が多いため従来画面で確認してください。');seen.add(pageToken);check();
            const query=new URLSearchParams({timeMin,timeMax,singleEvents:'true',orderBy:'startTime',maxResults:'250',...(pageToken?{pageToken}:{})});
            const response=await fetcher('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events?'+query,{method:'GET',redirect:'error',cache:'no-store',headers:{Authorization:'Bearer '+token},signal:controller.signal});check();
            if(!response.ok)throw new Error('カレンダーの予定を取得できません。更新または従来画面で確認してください。');
            const data=await response.json();check();if(!Array.isArray(data.items))throw new Error('予定の応答を確認できません。');
            events.push(...data.items.filter(event=>event.status!=='cancelled').map(event=>({...event,calendar_id:calendarId})));
            pageToken=data.nextPageToken||'';
          }while(pageToken);
        }
        return {settings,events:events.sort((a,b)=>(a.start?.dateTime||a.start?.date||'').localeCompare(b.start?.dateTime||b.start?.date||''))};
      }finally{controllers.delete(controller);signal?.removeEventListener('abort',abort);}
    },
    invalidate,
    async logout(){invalidate('ログアウトしています…');try{await auth.signOutUser();}catch{}finally{onLogout();}},
    readSort(){try{const value=JSON.parse((storage??globalThis.localStorage)?.getItem('works_ss_sort')||'null');if(['name','status','deadline','remaining'].includes(value?.key)&&['asc','desc'].includes(value.direction))return value;}catch{}return {key:'deadline',direction:'asc'};},
    saveSort(value){try{(storage??globalThis.localStorage)?.setItem('works_ss_sort',JSON.stringify(value));}catch{}},
  };
  return context;
}
export function safeShellRoute(value){
 if((value||'').startsWith('/wiki/')&&value.includes('?')){const [base,query,...extra]=value.split('?'),params=new URLSearchParams(query),keys=[...params.keys()];if(!extra.length&&keys.length>0&&keys.length<=2&&new Set(keys).size===keys.length&&keys.every(key=>['folder',...(base==='/wiki/'?['page']:[])].includes(key)&&/^[A-Za-z0-9_-]{1,100}$/.test(params.get(key)))&&safeShellRoute(base)===base)return value;return '/home/';}

 if(value==='/teaching/setup/')return value;
 if(/^\/teaching\/settings\/(?:\?panel=(?:materials|calendar|terms|periods|excluded|appearance))?$/.test(value||''))return value;
 if(/^\/teaching\/\d{4}-\d{2}-\d{2}\/schedule\/\?/.test(value||'')){const [path,query,...extra]=value.split('?'),params=new URLSearchParams(query),names=[...params.keys()];if(!extra.length&&names.length>0&&names.length<=4&&new Set(names).size===names.length&&safeShellRoute(path)===path&&names.every(key=>key==='view'?['list','calendar'].includes(params.get(key)):key==='week'||key==='month'?validDay(params.get(key)):key==='filter'?params.get(key).length<=2000&&!/[\u0000-\u001f]/.test(params.get(key)):false))return value;return '/home/';}

 if((value||'').startsWith('/teaching/')&&value.includes('?')){const [path,query,...extra]=value.split('?'),params=new URLSearchParams(query),keys=[...params.keys()];if(!extra.length&&keys.length>0&&keys.length<=2&&new Set(keys).size===keys.length&&keys.every(key=>['year','term'].includes(key)&&/^\d{0,12}$/.test(params.get(key)))&&safeShellRoute(path)===path)return value;return '/home/';}

 if(/^\/(?:home|teaching|operations|workflow|more|ss|todo|memo|wiki|material|admission|flow)\/$/.test(value||''))return value;
 if(/^\/material\/(?:files|folders)\/[A-Za-z0-9_-]{1,200}\/$/.test(value||''))return value;
 if(/^\/flow\/(?:roles|board|checks)\/$/.test(value||''))return value;
 if(/^\/flow\/(?:roles|definitions|runs)\/[A-Za-z0-9_-]{1,200}\/$/.test(value||''))return value;
 const student=/^\/teaching\/(\d{4}-\d{2}-\d{2})\/(?:student\/(?:([^/]{1,6144})\/([^/?]{1,3072})\/)?|schedule\/)(?:\?term=([0-9]{1,12}))?$/.exec(value||'');
 if(student){try{if(validDay(student[1])&&[student[2],student[3]].filter(Boolean).every(part=>!/[\u0000-\u001f]/.test(decodeURIComponent(part))))return value;}catch{}}
 if(/^\/teaching\/\d{4}-\d{2}-\d{2}\/\?term=[0-9]{1,12}$/.test(value||'')){const base=value.split('?')[0];if(safeShellRoute(base)===base)return value;}
 const teaching=/^\/teaching\/(\d{4}-\d{2}-\d{2})\/(?:([^/]{1,6144})\/([^/]{1,3072})\/)?$/.exec(value||'');
 if(teaching){try{if(new Date(teaching[1]+'T12:00:00Z').toISOString().slice(0,10)===teaching[1]&&[teaching[2],teaching[3]].filter(Boolean).every(part=>!/[\u0000-\u001f]/.test(decodeURIComponent(part))))return value;}catch{}}
 const match=/^\/(?:ss|todo|memo|wiki|material|admission)\/([^/]{1,200})\/$/.exec(value||'');
 try{if(match&&!['.','..'].includes(decodeURIComponent(match[1]))&&/^[A-Za-z0-9_.-]{1,200}$/.test(decodeURIComponent(match[1])))return value;}catch{}
 return '/home/';
}
