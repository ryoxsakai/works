import { lessonEventKey, sameLessonEvent } from "../shared/lesson-plan.js";

// All editors of one event share one draft and one write queue. Nothing is copied
// into the preceding event's record, and responses never use the later selection.
export function createLessonPlanController({ readNext, write, onChange = () => {} }) {
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
  function seed(target, value, readVersion = version, recordRevision = 0, attributionStatus = "new", ownerId = null) {
    const key = lessonEventKey(target);
    let state = plans.get(key);
    if (!state) {
      state = { key, target, value, recordRevision, attributionStatus, ownerId, base: value, dirty: false, status: "ready", revision: 0, changedAt: version, pending: 0, queue: Promise.resolve() };
      plans.set(key, state);
    } else if (!state.dirty && !state.pending && state.changedAt <= readVersion) {
      Object.assign(state, { target, value, recordRevision, attributionStatus, ownerId, base: value, status: "ready" });
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
        const changed = !sameLessonEvent(latestOwn(source), result.source)
          || (old?.dirty && !sameLessonEvent(link.target, result.target));
        link.current = result;
        if (changed) { link.status = "conflict"; notify(); return; }
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
      state.revision++; state.changedAt = ++version; notify();
    },
    async save(key, linkKey = "") {
      const state = plans.get(key), link = links.get(linkKey);
      if (!state || !state.dirty || state.status === "conflict" || (linkKey && link?.status !== "ready")) return;
      const value = state.value, revision = state.revision;
      // Freeze both source and destination before an async boundary.
      const target = structuredClone(link?.target || state.target);
      const source = link ? structuredClone(link.source) : null;
      state.pending++; state.status = "saving"; notify();
      const save = state.queue.catch(() => {}).then(async () => {
        if (state.status === "conflict" || (linkKey && link?.status === "conflict")) return;
        try {
          const effectiveTarget=latestOwn(target),effectiveSource=latestOwn(source);
          const result = await write({ target:effectiveTarget, ...(effectiveSource ? { source:effectiveSource } : {}), expected_lesson_plan: state.base, record_revision:state.recordRevision, lesson_plan: value });
          if(result.target)observeTarget(effectiveTarget,result.target);
          state.base = result.lesson_plan || "";
          state.recordRevision = result.record_revision;
          state.attributionStatus = result.attribution_status || state.attributionStatus;
          state.changedAt = ++version;
          if (state.revision === revision) { state.value = state.base; state.dirty = false; state.status = "saved"; }
          else state.status = "unsaved";
        } catch (error) {
          state.status = error.status === 409 || error.unknown || error.code==='CALENDAR_WRITE_UNKNOWN' ? "conflict" : "error";
          state.message = error.message;
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
    discard(key) {
      const state = plans.get(key);
      if (!state || state.pending) return false;
      state.value = state.base; state.dirty = false; state.status = "ready";
      state.changedAt = ++version; notify(); return true;
    },
  };
}
