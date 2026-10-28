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
    async request(path,{method='GET',body,signal}={}) {
      if(!/^\/api\/(?:settings|student-prefs|student-materials|lesson-record|next-lesson-plan|curriculum\/[^/?]+|todo|memo|workflow|admissions(?:\/[^/?]+(?:\/guarded)?)?|material-library\/(?:folders|files)(?:\/[^/?]+(?:\/guarded)?)?|wiki\/pages(?:\/[^/?]+(?:\/save)?)?)(?:\?.*)?$/.test(path))throw new Error('Unsupported API');
      await context.session.init();
      if(!active||!auth.getSessionToken())throw Object.assign(new Error('再ログインが必要です'),{status:401});
      const generation=epoch,controller=new AbortController();controllers.add(controller);
      const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
      try {
        const response=await fetcher(path,{method,cache:'no-store',headers:{Authorization:'Bearer '+auth.getSessionToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
        if(!active||generation!==epoch)throw new DOMException('Session changed','AbortError');
        if(response.status===401||response.status===403){invalidate('再度ログインしてください。');throw Object.assign(new Error('再ログインが必要です'),{status:response.status});}
        if(!response.ok)throw Object.assign(new Error(response.status===409?'別の画面で更新されています。入力は保持しています。':response.status===429?'アクセスが集中しています。':'通信に失敗しました。'),{status:response.status});
        const result=await response.json();
        if(!active||generation!==epoch||controller.signal.aborted)throw new DOMException('Session changed','AbortError');
        return result;
      }finally{controllers.delete(controller);signal?.removeEventListener('abort',abort);}
    },
    async calendarDay(day,{signal}={}) {
      const settings=await context.request('/api/settings',{signal});
      const ids=[...new Set((settings.selected_calendars||[]).filter(value=>typeof value==='string'&&value))];
      if(!ids.length)return {settings,events:[]};
      const generation=epoch,controller=new AbortController();controllers.add(controller);
      const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
      const check=()=>{if(!active||generation!==epoch||controller.signal.aborted)throw new DOMException('Session changed','AbortError');};
      try {
        const token=await auth.getGoogleAccessToken();check();if(!token)throw new Error('予定の認証を確認できません。');
        const [timeMin,timeMax]=recordDateRange(day),events=[];
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
 if(/^\/(?:home|teaching|operations|workflow|more|ss|todo|memo|wiki|material|admission|flow)\/$/.test(value||''))return value;
 if(/^\/material\/(?:files|folders)\/[A-Za-z0-9_-]{1,200}\/$/.test(value||''))return value;
 if(/^\/flow\/(?:roles|board|checks)\/$/.test(value||''))return value;
 if(/^\/flow\/(?:roles|definitions|runs)\/[A-Za-z0-9_-]{1,200}\/$/.test(value||''))return value;
 const teaching=/^\/teaching\/(\d{4}-\d{2}-\d{2})\/(?:([^/]{1,6144})\/([^/]{1,3072})\/)?$/.exec(value||'');
 if(teaching){try{if(new Date(teaching[1]+'T12:00:00Z').toISOString().slice(0,10)===teaching[1]&&[teaching[2],teaching[3]].filter(Boolean).every(part=>!/[\u0000-\u001f]/.test(decodeURIComponent(part))))return value;}catch{}}
 const match=/^\/(?:ss|todo|memo|wiki|material|admission)\/([^/]{1,200})\/$/.exec(value||'');
 try{if(match&&!['.','..'].includes(decodeURIComponent(match[1]))&&/^[A-Za-z0-9_.-]{1,200}$/.test(decodeURIComponent(match[1])))return value;}catch{}
 return '/home/';
}
