import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {readLessonPlan,readNextLessonPlan,writeLessonPlan} from '../src/lesson-plan.js';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url))); 
export async function createFixture(port=0){
const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-08-01',d1Databases:{DB:'next-lesson-fixture'}});
const DB=await mf.getD1Database('DB');
await DB.prepare('CREATE TABLE curriculum_entries(calendar_event_id TEXT PRIMARY KEY,completed INTEGER DEFAULT 0,lesson_plan TEXT,confirmation_test TEXT,homework TEXT,lesson_memo TEXT,updated_at TEXT)').run();
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const event=(id,hour,day=today,calendar_id='qa',summary='サンプル生徒')=>({id,calendar_id,summary,etag:`"${id}-1"`,start:{dateTime:`${day}T${hour}:00:00+09:00`},end:{dateTime:`${day}T${hour+1}:00:00+09:00`}});
const events=[event('a',10),event('b',11),event('c',10,shift(7)),event('none',13,today,'qa','次回なし'),event('other',10,today,'qa-tomas'),event('other-next',11,shift(1),'qa-tomas')];
for(const [id,value]of Object.entries({b:'既存の次回予定',c:'次週の既存予定','other-next':'別教室の予定'}))await DB.prepare('INSERT INTO curriculum_entries(calendar_event_id,lesson_plan,homework,lesson_memo)VALUES(?,?,?,?)').bind(id,value,'既存宿題','既存授業メモ').run();
const settings={selected_calendars:['qa','qa-tomas'],selected_term_ids:[2],excluded_titles:['空き']};
const deps={settings:async()=>settings,token:async()=>({access_token:'synthetic'}),event:async(_t,cal,id)=>structuredClone(events.find(e=>e.calendar_id===cal&&e.id===id)||null),events:async(_t,cal,min,max)=>structuredClone(events.filter(e=>e.calendar_id===cal&&Date.parse(e.end.dateTime)>Date.parse(min)&&Date.parse(e.start.dateTime)<Date.parse(max)))};
const control={failSave:false,holdSave:null,writes:[]};
const prefs=new Map([['サンプル生徒',{name:'サンプル生徒',memo:'既存の生徒メモ',print_name:'印刷サンプル'}],['サンプル別生徒',{name:'サンプル別生徒',memo:'別生徒のメモ'}]]);
const calendars=[{id:'qa',summary:'代官山メディカル',backgroundColor:'#8e24aa'},{id:'qa-tomas',summary:'TOMAS',backgroundColor:'#039be5'}];
const listKeys=['students','goal-templates','periods','materials','material-categories','schools','goals'];
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  const send=(type,body,status=200)=>{res.writeHead(status,{'Content-Type':type+(type.startsWith('text/')?'; charset=utf-8':''),'Cache-Control':'no-store'});res.end(body);};
  const json=body=>send('application/json',JSON.stringify(body));
  const readBody=async()=>{let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text);};
  if(url.pathname==='/qa-control'){const {action}=await readBody();if(action==='fail')control.failSave=true;if(action==='move')events.find(e=>e.id==='b').status='cancelled';return json({ok:true});}
  if(url.pathname==='/qa')return send('text/html',`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Works UI QA — synthetic only</title><style>body{margin:0;font-family:system-ui;background:#ddd}header{padding:10px;display:flex;gap:8px;position:relative;background:white}iframe{display:block;border:0;background:white;margin:0}button,select{font-size:16px}</style><header><strong>次回授業予定・実データなし</strong><button data-control="fail">次の保存を失敗</button><button data-control="move">次回を変更</button><button data-width="320">320px</button><button data-width="390">390px</button><button data-width="1280">1280px</button><select aria-label="サービス"><option value="/tutor/">授業管理</option><option value="/">ホーム</option><option value="/wiki/">Wiki</option><option value="/kdp/">KDP</option><option value="/ss/">SS</option><option value="/material/">教材管理</option><option value="/admission/">入試管理</option><option value="/memo/">メモ</option><option value="/todo/">ToDo</option><option value="/material-print/">教材印刷</option></select></header><iframe id="qa-frame" title="Works sample" src="/tutor/" width="390" height="820"></iframe><script>document.querySelectorAll('[data-control]').forEach(b=>b.onclick=()=>fetch('/qa-control',{method:'POST',body:JSON.stringify({action:b.dataset.control})}));document.querySelectorAll('[data-width]').forEach(b=>b.onclick=()=>document.querySelector('iframe').width=b.dataset.width);document.querySelector('select').onchange=e=>document.querySelector('iframe').src=e.target.value;</script>`);
  if(url.pathname==='/shared/auth.js')return send('text/javascript',`export const getSessionToken=()=> 'qa';export const getGoogleAccessToken=async()=> 'qa';export const signIn=()=>{};export const signOutUser=async()=>{};export const watchAuth=({onSignedIn})=>onSignedIn({email:'qa@example.invalid',picture:''});`);
  if(url.pathname.startsWith('/api/')){
    const key=url.pathname.slice(5);
    if(key==='next-lesson-plan')return json(await readNextLessonPlan({DB},url.searchParams.get('calendar_id'),url.searchParams.get('event_id'),deps));
    if(key==='lesson-plan'){
      if(req.method==='GET')return json(await readLessonPlan({DB},url.searchParams.get('calendar_id'),url.searchParams.get('event_id'),deps));
      const value=await readBody();control.writes.push(value);if(control.holdSave)await control.holdSave;
      if(control.failSave){control.failSave=false;return send('application/json',JSON.stringify({error:'サンプル保存失敗'}),500);}
      return json(await writeLessonPlan({DB},value,deps));
    }
    if(req.method==='PUT' && key.startsWith('curriculum/')){
      const value=await readBody(),id=decodeURIComponent(key.slice('curriculum/'.length));
      await DB.prepare('INSERT OR IGNORE INTO curriculum_entries(calendar_event_id)VALUES(?)').bind(id).run();
      for(const field of ['completed','confirmation_test','homework','lesson_memo'])if(Object.hasOwn(value,field))await DB.prepare(`UPDATE curriculum_entries SET ${field}=? WHERE calendar_event_id=?`).bind(value[field],id).run();
      return json({ok:true});
    }
    if(key==='student-prefs'){
      if(req.method==='PUT'){
        let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);
        prefs.set(body.name,{...prefs.get(body.name),...body});return json(prefs.get(body.name));
      }
      const name=url.searchParams.get('name');
      return json(prefs.get(name)||{name,memo:null,print_name:null});
    }
    if(req.method!=='GET')return send('text/plain','Only sample record saves are allowed',403);
    if(key==='settings')return json(settings);
    if(key==='years')return json([{id:1,label:'2026年度'}]);
    if(key==='terms')return json([{id:2,year_id:1,label:'後期',start_date:shift(-30),end_date:shift(60)}]);
    if(key==='curriculum')return json((await DB.prepare('SELECT * FROM curriculum_entries').all()).results);
    if(key.startsWith('student-prefs'))return json({});
    if(listKeys.includes(key))return json([]);
    return json([]);
  }
  if(url.pathname==='/qa-calendars')return json({items:calendars});
  if(url.pathname==='/qa-events'){
    return json({items:await deps.events('',url.searchParams.get('calendar'),url.searchParams.get('timeMin'),url.searchParams.get('timeMax'))});
  }
  if(req.method!=='GET')return send('text/plain','Preview writes blocked',403);
  try {
    let relative=decodeURIComponent(url.pathname);if(relative.endsWith('/'))relative+='index.html';
    const file=path.resolve(root,'.'+relative);if(!file.startsWith(root+path.sep))return send('text/plain','Forbidden',403);
    let data=await readFile(file);
    if(relative==='/tutor/app.js')data=`const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>{let u=String(input);if(u.startsWith('https://www.googleapis.com/calendar/')){const p=new URL(u);u=p.pathname.endsWith('calendarList')?'/qa-calendars':'/qa-events?'+p.searchParams.toString()+'&calendar='+encodeURIComponent(decodeURIComponent(p.pathname.split('/')[4]));}return nativeFetch(u,init);};\n`+data;
    return send(({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream',data);
  } catch {return send('text/plain','Not found',404);}
 }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message,code:error.code,current:error.current}));}
});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
return {base:`http://127.0.0.1:${server.address().port}`,events,DB,control,today,async close(){await new Promise(resolve=>server.close(resolve));await mf.dispose();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const fixture=await createFixture(8768);console.log(fixture.base+'/qa');}
