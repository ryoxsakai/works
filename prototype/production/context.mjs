export function createProductionContext(auth,{fetcher=fetch,onExpired=()=>{},onLogout=()=>location.replace('/app/'),storage}={}) {
  let active=false,epoch=0,initialization;
  const controllers=new Set();
  const metrics={authInitializations:0,mounts:0,unmounts:0,reads:0};
  function invalidate(message){context.viewState=null;context.workspaceState=null;active=false;epoch++;for(const controller of controllers)controller.abort();controllers.clear();onExpired(message);}
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
      if(!/^\/api\/(?:todo|memo|wiki\/pages(?:\/[^/?]+(?:\/save)?)?)(?:\?.*)?$/.test(path))throw new Error('Unsupported API');
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
    invalidate,
    async logout(){invalidate('ログアウトしています…');try{await auth.signOutUser();}catch{}finally{onLogout();}},
    readSort(){try{const value=JSON.parse((storage??globalThis.localStorage)?.getItem('works_ss_sort')||'null');if(['name','status','deadline','remaining'].includes(value?.key)&&['asc','desc'].includes(value.direction))return value;}catch{}return {key:'deadline',direction:'asc'};},
    saveSort(value){try{(storage??globalThis.localStorage)?.setItem('works_ss_sort',JSON.stringify(value));}catch{}},
  };
  return context;
}
export function safeShellRoute(value){
 if(/^\/(?:home|teaching|operations|workflow|more|ss|todo|memo|wiki)\/$/.test(value||''))return value;
 const match=/^\/(?:ss|todo|memo|wiki)\/([^/]{1,200})\/$/.exec(value||'');
 try{if(match&&!['.','..'].includes(decodeURIComponent(match[1]))&&/^[A-Za-z0-9_.-]{1,200}$/.test(decodeURIComponent(match[1])))return value;}catch{}
 return '/home/';
}
