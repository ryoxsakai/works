// The same adapter accepts shared/auth.watchAuth in a later authenticated pilot.
// This prototype injects a synthetic identity. It never reads browser credentials.
export function createSessionAdapter(watchAuth, token) {
  let initialization;
  return {
    init() {
      return initialization ||= new Promise((resolve,reject)=>watchAuth({
        onSignedIn:user=>resolve({user,token:typeof token==='function'?token():token}),
        onSignedOut:message=>reject(new Error(message||'ログインが必要です')),
      }));
    },
  };
}
export function createDemoContext(scenario='normal') {
  const metrics={authInitializations:0,mounts:0,unmounts:0,saves:0,reads:0};
  const session=createSessionAdapter(({onSignedIn})=>{
    metrics.authInitializations++;onSignedIn({email:'synthetic@example.test',name:'サンプル利用者'});
  },'synthetic-session');
  const drafts=new Map(),receipts=new Map();
  const projects=[
    {id:'ss-101',name:'英語・読解問題の作成',status:'問題作成中',deadline:'2026-10-30',memo:'英文と設問の対応を確認。出典を添えて初稿をまとめる。',subject:'英語',progress:65},
    {id:'ss-102',name:'数学・素材案の確認',status:'素材案確認待ち',deadline:'2026-11-02',memo:'グラフと条件の整合を確認する。',subject:'数学',progress:40},
    {id:'ss-103',name:'理科・次回原稿の準備',status:'原稿待ち',deadline:'2026-11-08',memo:'原稿到着後に構成を確認。',subject:'理科',progress:15},
    {id:'ss-104',name:'英語・完成原稿の整理',status:'完了',deadline:'2026-10-20',memo:'確認済みの合成サンプル。',subject:'英語',progress:100},
  ];
  return {
    session,metrics,scenario,
    async list({signal}={}) {
      metrics.reads++;
      await new Promise(resolve=>setTimeout(resolve,scenario==='slow'?450:20));
      signal?.throwIfAborted();
      if(scenario==='error')throw new Error('サンプル案件を読み込めませんでした。再試行してください。');
      return scenario==='empty'?[]:structuredClone(projects);
    },
    draft:id=>drafts.get(id)||'',
    async save(id,text,requestId) {
      if(receipts.has(requestId))return receipts.get(requestId);
      // A synchronous receipt registration prevents double submissions.
      const receipt=Promise.resolve().then(()=>{metrics.saves++;drafts.set(id,text);return text;});
      receipts.set(requestId,receipt);return receipt;
    },
  };
}
