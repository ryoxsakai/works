import {termPlanKey} from '../shared/term-lesson-plan.mjs';
const path='/term-lesson-plans';
const blank={value:'',revision:0};

export function createTermPlanEditors(root,{request,escapeHtml,resize=()=>{}}) {
  const states=new Map();
  const stateFor=element=>states.get(element.dataset.termSlot);
  function renderKey(key) {
    for(const editor of root.querySelectorAll('[data-term-slot]')){
      if(editor.dataset.termSlot!==key)continue;
      const state=stateFor(editor),input=editor.querySelector('textarea');
      if(input.value!==state.value)input.value=state.value;
      input.disabled=state.loading;
      input.readOnly=state.unavailable||state.conflict||state.unknown;
      editor.querySelector('[role=status]').textContent=state.message||'';
      const action=editor.querySelector('button');
      action.hidden=!(state.unavailable||state.conflict||state.unknown||state.failed);
      action.disabled=state.loading||state.saving;
      action.textContent=state.conflict||state.unknown||state.unavailable?'保存内容を再確認': '再保存';
      const legacy=editor.querySelector('[data-term-previous]');
      if(legacy&&!legacy.dataset.initialized&&!state.loading){
        legacy.open=!legacy.hasAttribute('data-compact')&&!state.value;legacy.dataset.initialized='true';
      }
      const previous=editor.querySelector('[data-saved-version]');
      previous.hidden=!state.conflict||!state.remote;
      previous.querySelector('pre').textContent=state.remote?.value||'（未入力）';
      const use=previous.querySelector('[data-term-use-saved]');
      use.hidden=!state.remote;
      const overwrite=previous.querySelector('[data-term-keep]');
      overwrite.hidden=!state.remote;
      resize(input);
    }
  }
  const read=async slots=>{
    const received=new Map();
    for(let i=0;i<slots.length;i+=200){
      const chunk=slots.slice(i,i+200);
      const {plans}=await request(path,{method:'POST',body:JSON.stringify({slots:chunk}),signal:AbortSignal.timeout(15000)});
      if(!Array.isArray(plans))throw Error('unexpected read');
      for(const item of plans)received.set(termPlanKey(item),item);
    }
    return received;
  };
  function observe(state,server) {
    if(state.saving||state.revision>server.revision)return;
    if(state.unknown&&server.value===state.sent&&server.revision>state.revision){
      state.unknown=false;state.revision=server.revision;state.base=server.value;
    }
    if((state.dirty||state.unknown)&&state.revision!==server.revision){
      state.unknown=false;state.conflict=true;state.remote=server;
      state.message='別の内容が保存されています。入力は残しています。';
      return;
    }
    if(state.unknown){
      state.unknown=false;state.failed=true;state.message='保存されていません。入力を残しています。';
      return;
    }
    if(!state.dirty){
      state.value=server.value;state.base=server.value;state.revision=server.revision;
      state.conflict=false;state.remote=null;state.failed=false;state.message='';
    }else if(!state.conflict&&!state.failed){
      state.message=state.value===state.base?'保存済み':'未保存';
    }else if(state.conflict){
      state.remote=server;
      state.message='別の内容が保存されています。入力は残しています。';
    }
    state.dirty=state.value!==state.base;
  }
  async function load(slots) {
    const unique=[...new Map(slots.filter(Boolean).map(slot=>[termPlanKey(slot),slot])).entries()];
    if(!unique.length)return;
    const tasks=unique.map(([key,slot])=>{
      if(!states.has(key))states.set(key,{...blank,base:'',slot,generation:0});
      const state=states.get(key);
      const generation=++state.generation;
      if(!state.saving){state.loading=true;state.message='読み込み中…';renderKey(key);}
      return {key,slot,state,generation};
    });
    let received;
    try {received=await read(tasks.map(t=>t.slot));}catch{}
    for(const {key,state,generation} of tasks){
      if(state.generation!==generation)continue;
      state.loading=false;state.unavailable=!received;
      if(received)observe(state,received.get(key)||blank);
      else state.message='回数別の予定を取得できません。';
      renderKey(key);
    }
  }
  async function save(key) {
    const state=states.get(key);
    if(!state?.dirty||state.loading||state.conflict||state.unknown||state.unavailable)return;
    if(state.saving){state.saveAgain=true;return;}
    const value=state.value, revision=state.revision;
    state.saving=true;state.message='保存中…';state.failed=false;state.sent=value;renderKey(key);
    try {
      const result=await request(path,{method:'PUT',body:JSON.stringify({slot:state.slot,value,revision}),signal:AbortSignal.timeout(15000)});
      if(result.value!==value||result.revision!==revision+1)throw Error('unexpected save');
      Object.assign(state,{revision:result.revision,base:value,dirty:state.value!==value,message:state.value===value?'保存済み':'未保存'});
    }catch(error){
      if(error.status===409){state.conflict=true;state.message='別の画面で更新されています。入力は残しています。';}
      else if(!error.status||error.status>=500){state.unknown=true;state.message='保存結果が不明です。再送する前に保存内容を確認してください。';}
      else {state.failed=true;state.message='保存できませんでした。入力は残しています。';}
    }finally{
      state.saving=false;
      const again=state.saveAgain;
      state.saveAgain=false;
      renderKey(key);
      if(again&&!state.failed)void save(key);
    }
  }
  root.addEventListener('input',event=>{
    const editor=event.target.closest('[data-term-slot]'),state=editor&&stateFor(editor);
    if(!state||event.target.disabled||event.target.readOnly)return;
    state.value=event.target.value;state.dirty=state.value!==state.base;
    if(!state.saving){state.message=state.dirty?'未保存。入力欄を離れると保存します。':'';renderKey(editor.dataset.termSlot);}
  });
  root.addEventListener('change',event=>{
    const key=event.target.closest('[data-term-slot]')?.dataset.termSlot;
    if(key)void save(key);
  });
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-term-action]'),editor=button?.closest('[data-term-slot]');
    if(button&&!button.disabled&&editor){
      const state=stateFor(editor),key=editor.dataset.termSlot;
      if(state.failed&&!state.conflict&&!state.unknown&&!state.unavailable)void save(key);
      else void load([state.slot]);
      return;
    }
    const decision=event.target.closest('[data-term-use-saved],[data-term-keep]');
    const target=decision?.closest('[data-term-slot]'),state=target&&stateFor(target);
    if(!state?.remote||state.loading||state.saving)return;
    const useSaved=decision.hasAttribute('data-term-use-saved'), remote=state.remote;
    Object.assign(state,{revision:remote.revision,base:remote.value,conflict:false,remote:null,failed:false});
    if(useSaved)state.value=remote.value;
    state.dirty=state.value!==state.base;
    state.message=state.dirty?'内容を確認しました。編集するか、保存する場合は再保存を押してください。':'保存済み';
    state.failed=state.dirty;
    renderKey(target.dataset.termSlot);
  });
  function markup(slot,label,legacy='',{compact=false}={}) {
    return `<div data-term-slot="${escapeHtml(termPlanKey(slot))}" class="term-plan-editor"><label>${escapeHtml(label)}
      <textarea class="term-plan-input" rows="1" maxlength="5000" aria-label="${escapeHtml(label)}" disabled></textarea></label>
      <div class="lesson-plan-feedback"><small role="status" aria-live="polite"></small><button type="button" data-term-action hidden></button></div>
      <div data-saved-version hidden><small>現在の保存内容</small><pre></pre><button type="button" data-term-use-saved>保存内容を使う</button> <button type="button" data-term-keep>自分の入力を保持</button></div>
      ${legacy?`<details data-term-previous${compact?' data-compact':''}><summary>以前の予定別の記録</summary><p>${escapeHtml(legacy)}</p></details>`:''}</div>`;
  }
  return {markup,load,hasEdits:()=>[...states.values()].some(s=>s.dirty||s.saving||s.unknown),
    repaint:()=>{for(const key of states.keys())renderKey(key);}};
}
