import {readPendingRecovery,persistPendingRecovery,clearPendingRecovery} from './pending-plan-draft.mjs?v=1';
import { lessonEventKey, sameLessonEvent } from "../shared/lesson-plan.js";

// All editors of one event share one draft and one write queue. Nothing is copied
// into the preceding event's record, and responses never use the later selection.
export function createLessonPlanController({ readNext, write, readCurrent, readOperation, onChange = () => {} }) {
  const plans = new Map(), links = new Map();
  const ownTargets=new Map();
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
      state = { key, target, value, recordRevision, attributionStatus, ownerId, pendingContext, base: value, dirty: false, status: "ready", revision: 0, changedAt: version, pending: 0, queue: Promise.resolve() };
      plans.set(key, state);
      const cached=pendingContext?readPendingRecovery(pendingContext):null;
      if(cached&&cached.context===pendingContext&&sameLessonEvent(cached.target,target)){
        Object.assign(state,{value:cached.value,base:cached.base,recordRevision:cached.recordRevision,operationId:cached.operationId,sentValue:cached.sentValue,pendingUnknown:!!cached.unknown,dirty:true,status:cached.unknown||cached.recordRevision!==recordRevision?'conflict':'unsaved'});
      }
    } else if (!state.dirty && !state.pending && state.changedAt <= readVersion) {
      Object.assign(state, { target, value, recordRevision, attributionStatus, ownerId, pendingContext, base: value, status: "ready" });
    }
    return state;
  }
  return {
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
        const rawResult = await readNext(source);
        const result={...rawResult,source:latestOwn(rawResult.source),target:latestOwn(rawResult.target)};
        if (link.generation !== generation) return;
        const old = plans.get(link.targetKey);
        const sourceState=plans.get(key);
        const changed = !sameLessonEvent(latestOwn(source), result.source)
          || (sourceState?.ownerId&&Object.hasOwn(result,'source_owner_id')&&sourceState.ownerId!==result.source_owner_id)
          || (old?.dirty && !sameLessonEvent(link.target, result.target))
          || (old?.ownerId&&Object.hasOwn(result,'owner_id')&&old.ownerId!==result.owner_id)
          || (old?.dirty&&old.pendingContext&&old.pendingContext!==result.pending_context);
        link.current = result;
        if (changed) { link.status = "conflict"; notify(); return; }
        if(result.owner_confirmation_required){
          link.target=result.target;link.targetKey=result.pending_allowed?seed(result.target,result.lesson_plan||'',readVersion,result.record_revision,result.attribution_status,null,result.pending_context).key:'';link.status=result.pending_allowed?'pending_owner':'owner_confirmation_required';notify();return;
        }
        if (['legacy_unknown','known_change','title_changed','id_collision','target_unavailable'].includes(result.attribution_status)) {
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
      const pendingContext=state.pendingContext,requestId=pendingContext?crypto.randomUUID():null;
      state.pending++; state.status = "saving"; notify();
      const save = state.queue.catch(() => {}).then(async () => {
        if (state.status === "conflict" || (linkKey && link?.status === "conflict")) return;
        try {
          const effectiveTarget=latestOwn(target),effectiveSource=latestOwn(source);
          if(pendingContext){state.operationId=requestId;state.sentValue=value;state.pendingUnknown=true;persistPendingRecovery(state);}
          const result = await write({ target:effectiveTarget, ...(effectiveSource ? { source:effectiveSource,...(Object.hasOwn(link.current||{},'source_owner_id')?{expected_source_owner_id:link.current.source_owner_id}:{}) } : {}), ...(pendingContext?{pending_context:pendingContext,request_id:requestId}:{}), expected_lesson_plan: state.base, record_revision:state.recordRevision, lesson_plan: value });
          if(result.target)observeTarget(effectiveTarget,result.target);
          state.base = result.lesson_plan || "";
          state.pendingUnknown=false;state.operationId=null;
          state.recordRevision = result.record_revision;
          state.attributionStatus = result.attribution_status || state.attributionStatus;
          state.changedAt = ++version;
          if (state.revision === revision) { state.value = state.base; state.dirty = false; state.status = "saved"; }
          else state.status = "unsaved";
          if(state.pendingContext){if(state.dirty)persistPendingRecovery(state);else clearPendingRecovery(state);}
        } catch (error) {
          state.status = error.status === 409 || error.unknown || error.code==='CALENDAR_WRITE_UNKNOWN' ? "conflict" : "error";
          state.message = error.message;
          if(state.pendingContext){state.pendingUnknown=!!(error.unknown||error.code==='LESSON_HISTORY_RELOAD');persistPendingRecovery(state);}
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
    },
    async verifyPending(key){
      const state=plans.get(key);if(!state?.pendingUnknown||!state.operationId||!readOperation||!readCurrent)return false;
      try{
        const audits=await readOperation(state.operationId),audit=audits.find(a=>a.id===state.operationId&&a.action==='write_pending_plan');if(!audit)throw Error('保存結果をまだ確認できません。再送せず同じ操作IDで照合してください');
        const saved=JSON.parse(audit.after_json);if(saved.pending_context!==state.pendingContext||saved.lesson_plan!==state.sentValue)throw Error('操作結果と保持中の入力の対応を確認できません');
        const fresh=await readCurrent(state.target);if(!sameLessonEvent(fresh.target,state.target)||fresh.pending_context!==state.pendingContext)throw Error('予定・紐づけが変わりました。入力を保持して授業履歴で確認してください');
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
}
