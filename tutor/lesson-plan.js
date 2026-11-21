import {readPendingRecovery,persistPendingRecovery,clearPendingRecovery,pendingRecoveryCopies} from './pending-plan-draft.mjs?v=2';
import { lessonEventKey, sameLessonEvent } from "../shared/lesson-plan.js";

// All editors of one event share one draft and one write queue. Nothing is copied
// into the preceding event's record, and responses never use the later selection.
export function createLessonPlanController({ readNext, write, readCurrent, readOperation, confirmBinding, carryNextPlan, canAutoBind = () => true, onChange = () => {} }) {
  const plans = new Map(), links = new Map();
  const ownTargets=new Map(), attemptedBindings=new Set(), autoBindingReads=new Map();
  const hasEdit=state=>!!(state?.dirty||state?.pending||state?.pendingUnknown);
  const savedRecoveryFor=target=>pendingRecoveryCopies().some(copy=>copy.target?.calendar_id===target.calendar_id&&copy.target?.id===target.id);
  function latestOwn(ref){let current=ref;const seen=new Set();while(current&&ownTargets.has(JSON.stringify(current))&&!seen.has(JSON.stringify(current))){seen.add(JSON.stringify(current));current=ownTargets.get(JSON.stringify(current));}return current;}
  function observeTarget(before,after){
    if(!before||!after||!sameLessonEvent({...after,etag:before.etag},before))return;
    ownTargets.set(JSON.stringify(before),after);
    for(const state of plans.values())if(sameLessonEvent(state.target,before))state.target=after;
    for(const link of links.values()){if(sameLessonEvent(link.source,before))link.source=after;if(sameLessonEvent(link.target,before))link.target=after;}
  }
  let version = 0;
  const notify = () => onChange();
  function seed(target, value, readVersion = version, recordRevision = 0, attributionStatus = "new", ownerId = null, pendingContext = null) {
    const key = lessonEventKey(target);
    let state = plans.get(key);
    if (!state) {
      state = { key, target, value, recordRevision, attributionStatus, ownerId, pendingContext, recoveryContext:pendingContext|| (ownerId?'owner-plan:'+ownerId+':'+key:null), base: value, dirty: false, status: "ready", revision: 0, changedAt: version, pending: 0, queue: Promise.resolve() };
      plans.set(key, state);
      const recoveryContext=state.recoveryContext;const cached=recoveryContext?readPendingRecovery(recoveryContext):null;
      if(cached&&cached.context===recoveryContext&&sameLessonEvent(cached.target,target)){
        Object.assign(state,{value:cached.value,base:cached.base,recordRevision:cached.recordRevision,operationId:cached.operationId,sentValue:cached.sentValue,pendingUnknown:!!cached.unknown,dirty:true,status:cached.unknown||cached.recordRevision!==recordRevision?'conflict':'unsaved'});
      }
    } else if (!state.dirty && !state.pending && state.changedAt <= readVersion) {
      Object.assign(state, { target, value, recordRevision, attributionStatus, ownerId, pendingContext, recoveryContext:pendingContext|| (ownerId?'owner-plan:'+ownerId+':'+key:null), base: value, status: "ready" });
    }
    return state;
  }
  const controller = {
    get version() { return version; }, seed, observeTarget,
    observeRecord(target, revision) {
      const state=plans.get(lessonEventKey(target));
      if(state && !state.pending) state.recordRevision=revision;
    },
    get: (key) => plans.get(key), getLink: (key) => links.get(key),
    async loadNext(source) {
      source=latestOwn(source);
      const key = lessonEventKey(source);
      const link = links.get(key) || { key, source, generation: 0 };
      links.set(key, link);
      const generation = ++link.generation, readVersion = version;
      Object.assign(link, { source, status: "loading" }); notify();
      try {
        const withLatest=result=>({...result,source:latestOwn(result.source),target:latestOwn(result.target)});
        let result=withLatest(await readNext(source));
        if (link.generation !== generation) return;
        const changed=()=>{
          const old=plans.get(link.targetKey),sourceState=plans.get(key);
          const safeRetarget=!!(!hasEdit(old)&&sourceState?.ownerId&&(
            (!result.target&&['none','ambiguous'].includes(result.reason))
            ||(result.target&&lessonEventKey(result.target)!==link.targetKey
              &&(result.owner_confirmation_required||result.owner_id===sourceState.ownerId))));

          return !sameLessonEvent(latestOwn(source),result.source)
            || (sourceState?.ownerId&&Object.hasOwn(result,'source_owner_id')&&sourceState.ownerId!==result.source_owner_id)
            || (hasEdit(old)&&!sameLessonEvent(link.target,result.target))
            || (old?.ownerId&&Object.hasOwn(result,'owner_id')&&old.ownerId!==result.owner_id&&!safeRetarget)
            || (hasEdit(old)&&old.pendingContext&&old.pendingContext!==result.pending_context);
        };
        link.current=result;
        if(changed()){link.status="conflict";notify();return;}
        // A new blank occurrence may first need its own association, then
        // the source-authored plan can move atomically between the two records.
        for(let step=0;step<2;step++){
          const carrying=!!result.next_plan_carry,offer=carrying?result.next_plan_carry:result.next_binding;
          const submit=carrying?carryNextPlan:confirmBinding;
          const sourceState=plans.get(key),candidate=result.target;
          const candidateKey=candidate?lessonEventKey(candidate):null,fromKey=offer?.from?lessonEventKey(offer.from):null;
          const targetState=()=>candidateKey?plans.get(candidateKey):null;
          const fromState=()=>fromKey?plans.get(fromKey):null;
          const held=()=>hasEdit(plans.get(key))||hasEdit(plans.get(link.targetKey))||hasEdit(targetState())||hasEdit(fromState())
            ||savedRecoveryFor(candidate)||(offer.from&&savedRecoveryFor(offer.from));
          if(!submit||!offer?.automatic||(!carrying&&!result.owner_confirmation_required)||!candidate
           ||sourceState?.ownerId!==offer.owner_id||result.source_owner_id!==offer.owner_id
           ||sourceState?.attributionStatus!=="confirmed"||!sameLessonEvent(sourceState.target,source)
           ||!canAutoBind(source)||held())break;
          const fingerprint=offer.fingerprint,request_id=(carrying?"auto-carry-":"auto-next-")+fingerprint;
          let pending=autoBindingReads.get(request_id);
          if(!pending){
            if(attemptedBindings.has(request_id)){
              if(carrying){link.status='conflict';notify();return;}
              break;
            }
            if(attemptedBindings.size>=128)attemptedBindings.delete(attemptedBindings.values().next().value);
            attemptedBindings.add(request_id);
            const confirmed={source:structuredClone(result.source),target:structuredClone(candidate),fingerprint,
              request_id,confirm:true,...(carrying?{from:structuredClone(offer.from)}:{automatic:true})};
            // A lost POST response is not replayed. Re-read the actual association.
            pending=(async()=>{
              try{await submit(confirmed);}catch{}
              try{return withLatest(await readNext(source));}catch{return null;}
            })();
            autoBindingReads.set(request_id,pending);
            void pending.finally(()=>autoBindingReads.delete(request_id));
          }
          link.status='auto_binding';notify();
          const fresh=await pending;
          if(link.generation!==generation)return;
          if(held()||targetState()?.changedAt>readVersion||fromState()?.changedAt>readVersion){
            link.current=fresh||result;link.status="conflict";
            if(hasEdit(targetState())&&(!link.targetKey||link.targetKey===candidateKey)){link.target=candidate;link.targetKey=candidateKey;}
            notify();return;
          }
          if(carrying&&(!fresh||fresh.next_plan_carry?.fingerprint===fingerprint)){
            link.current=fresh||result;
            link.status="conflict";notify();return;
          }
          result=fresh||{...result,pending_allowed:false,next_binding:undefined};
          link.current=result;
          if(changed()){link.status="conflict";notify();return;}
        }
        if(result.owner_confirmation_required){
          link.target=result.target;link.targetKey=result.pending_allowed?seed(result.target,result.lesson_plan||'',readVersion,result.record_revision,result.attribution_status,null,result.pending_context).key:'';link.status=result.pending_allowed?'pending_owner':'owner_confirmation_required';notify();return;
        }
        if (['series_changed','series_unavailable','series_legacy_hold','legacy_unknown','known_change','title_changed','id_collision','target_unavailable'].includes(result.attribution_status)) {
          link.status='attribution'; link.targetKey=''; notify(); return;
        }
        link.target = result.target;
        link.targetKey = result.target ? seed(result.target, result.lesson_plan || "", readVersion, result.record_revision,result.attribution_status,result.owner_id||null).key : "";
        link.status = result.target ? "ready" : result.reason;
        notify();
      } catch (error) {
        if (link.generation !== generation) return;
        link.status = error.status === 409 ? "conflict" : "error";
        link.message = error.message;
        notify();
      }
    },
    edit(key, value) {
      const state = plans.get(key);
      if (!state || state.status === "conflict") return;
      state.value = value; state.dirty = true; state.status = "unsaved";
      state.revision++; state.changedAt = ++version;persistPendingRecovery(state); notify();
    },
    async save(key, linkKey = "") {
      const state = plans.get(key), link = links.get(linkKey);
      if (!state || !state.dirty || state.status === "conflict" || (linkKey && !['ready','pending_owner'].includes(link?.status))) return;
      const value = state.value, revision = state.revision;
      // Freeze both source and destination before an async boundary.
      const target = structuredClone(link?.target || state.target);
      const source = link ? structuredClone(link.source) : null;
      const pendingContext=state.pendingContext,requestId=crypto.randomUUID();
      state.pending++; state.status = "saving"; notify();
      const save = state.queue.catch(() => {}).then(async () => {
        if (state.status === "conflict" || (linkKey && link?.status === "conflict")) return;
        try {
          const effectiveTarget=latestOwn(target),effectiveSource=latestOwn(source);
          if(state.recoveryContext){state.operationId=requestId;state.sentValue=value;state.pendingUnknown=true;persistPendingRecovery(state);}
          const result = await write({ target:effectiveTarget, ...(effectiveSource ? { source:effectiveSource,...(Object.hasOwn(link.current||{},'source_owner_id')?{expected_source_owner_id:link.current.source_owner_id}:{}) } : {}), request_id:requestId,...(state.ownerId?{expected_owner_id:state.ownerId}:{}),...(pendingContext?{pending_context:pendingContext}:{}), expected_lesson_plan: state.base, record_revision:state.recordRevision, lesson_plan: value });
          if(result.target)observeTarget(effectiveTarget,result.target);
          state.base = result.lesson_plan || "";
          state.pendingUnknown=false;state.operationId=null;
          state.recordRevision = result.record_revision;
          state.attributionStatus = result.attribution_status || state.attributionStatus;
          state.changedAt = ++version;
          if (state.revision === revision) { state.value = state.base; state.dirty = false; state.status = "saved"; }
          else state.status = "unsaved";
          if(state.recoveryContext){if(state.dirty)persistPendingRecovery(state);else clearPendingRecovery(state);}
        } catch (error) {
          state.status = error.status === 409 || error.unknown || error.code==='CALENDAR_WRITE_UNKNOWN' ? "conflict" : "error";
          state.message = error.message;
          if(state.recoveryContext){state.pendingUnknown=!!(error.unknown||error.code==='LESSON_HISTORY_RELOAD');persistPendingRecovery(state);}
          state.current = error.current;
          if (link && error.status === 409 && sameLessonEvent(link.target, target)) {
            link.status = "conflict"; link.current = error.current; link.message = error.message;
          }
          throw error;
        } finally { notify(); }
      });
      state.queue = save;
      try { await save; }
      finally {
        state.pending--;
        if (state.pending && state.status !== "conflict") state.status = "saving";
        notify();
      }
      if(confirmBinding&&pendingContext&&link&&!state.dirty&&!state.pending&&!state.pendingUnknown&&state.status==="saved"
        &&sameLessonEvent(link.target,state.target)&&canAutoBind(link.source))await controller.loadNext(link.source);
    },
    async verifyPending(key){
      const state=plans.get(key);if(!state?.pendingUnknown||!state.operationId||!readOperation||!readCurrent)return false;
      try{
        const audits=await readOperation(state.operationId),audit=audits.find(a=>a.id===state.operationId&&(state.pendingContext?a.action==='write_pending_plan':['write_series_record','edit_record'].includes(a.action)));if(!audit)throw Error('保存結果をまだ確認できません。再送せず同じ操作IDで照合してください');
        const after=JSON.parse(audit.after_json),saved=after.record?{owner_id:after.record.owner_id,lesson_plan:after.record.lesson_plan,record_revision:after.record.revision}:after;if((state.pendingContext?saved.pending_context!==state.pendingContext:saved.owner_id!==state.ownerId)||saved.lesson_plan!==state.sentValue)throw Error('操作結果と保持中の入力の対応を確認できません');
        const fresh=await readCurrent(state.target);if(!sameLessonEvent(fresh.target,state.target)||(state.pendingContext?fresh.pending_context!==state.pendingContext:fresh.owner_id!==state.ownerId||fresh.attribution_status!=='confirmed'))throw Error('予定・紐づけが変わりました。入力を保持して授業履歴で確認してください');
        state.pendingUnknown=false;state.operationId=null;
        if(fresh.record_revision!==saved.record_revision||fresh.lesson_plan!==saved.lesson_plan){state.status='conflict';state.message='保存後に別の更新があります。入力を保持して最新内容と比較してください';persistPendingRecovery(state);notify();return false;}
        state.base=fresh.lesson_plan;state.recordRevision=fresh.record_revision;state.dirty=state.value!==saved.lesson_plan;state.status=state.dirty?'unsaved':'saved';if(state.dirty)persistPendingRecovery(state);else clearPendingRecovery(state);notify();return true;
      }catch(error){state.message=error.message;notify();return false;}
    },
    discard(key) {
      const state = plans.get(key);
      if (!state || state.pending||state.pendingUnknown) return false;
      state.value = state.base; state.dirty = false; state.status = "ready";
      state.changedAt = ++version;clearPendingRecovery(state); notify(); return true;
    },
  };
  return controller;
}
