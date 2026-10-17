import { lessonEventKey, sameLessonEvent } from "../shared/lesson-plan.js";

// All editors of one event share one draft and one write queue. Nothing is copied
// into the preceding event's record, and responses never use the later selection.
export function createLessonPlanController({ readNext, write, onChange = () => {} }) {
  const plans = new Map(), links = new Map();
  let version = 0;
  const notify = () => onChange();
  function seed(target, value, readVersion = version) {
    const key = lessonEventKey(target);
    let state = plans.get(key);
    if (!state) {
      state = { key, target, value, base: value, dirty: false, status: "ready", revision: 0, changedAt: version, pending: 0, queue: Promise.resolve() };
      plans.set(key, state);
    } else if (!state.dirty && !state.pending && state.changedAt <= readVersion) {
      Object.assign(state, { target, value, base: value, status: "ready" });
    }
    return state;
  }
  return {
    get version() { return version; }, seed,
    get: (key) => plans.get(key), getLink: (key) => links.get(key),
    async loadNext(source) {
      const key = lessonEventKey(source);
      const link = links.get(key) || { key, source, generation: 0 };
      links.set(key, link);
      const generation = ++link.generation, readVersion = version;
      Object.assign(link, { source, status: "loading" }); notify();
      try {
        const result = await readNext(source);
        if (link.generation !== generation) return;
        const old = plans.get(link.targetKey);
        const changed = !sameLessonEvent(source, result.source)
          || (old?.dirty && !sameLessonEvent(link.target, result.target));
        link.current = result;
        if (changed) { link.status = "conflict"; notify(); return; }
        link.target = result.target;
        link.targetKey = result.target ? seed(result.target, result.lesson_plan || "", readVersion).key : "";
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
          const result = await write({ target, ...(source ? { source } : {}), expected_lesson_plan: state.base, lesson_plan: value });
          state.base = result.lesson_plan || "";
          state.changedAt = ++version;
          if (state.revision === revision) { state.value = state.base; state.dirty = false; state.status = "saved"; }
          else state.status = "unsaved";
        } catch (error) {
          state.status = error.status === 409 ? "conflict" : "error";
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
