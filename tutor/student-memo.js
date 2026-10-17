// A view-independent draft for the existing name-keyed student_prefs.memo.
// No calendar, date or lesson ID is added to the server's identity.
export function createStudentMemoStore({ readProfile, writeMemo, onChange = () => {} }) {
  const students = new Map();
  function entry(name) {
    if (!students.has(name)) students.set(name, {
      value: "", loaded: false, dirty: false, status: "idle", revision: 0,
      saveVersion: 0, profile: null, loading: null,
    });
    return students.get(name);
  }
  const notify = (name) => onChange(name);
  return {
    get(name) {
      const { value, loaded, dirty, status } = entry(name);
      return { value, loaded, dirty, status };
    },
    async load(name, { refresh = false } = {}) {
      const state = entry(name);
      if (state.loading) return state.loading;
      if (state.loaded && !refresh) return state.profile;
      const revision = state.revision;
      if (!state.loaded) state.status = "loading";
      notify(name);
      const loading = (async () => {
        try {
          const profile = await readProfile(name);
          state.profile = profile;
          state.loaded = true;
          // A refresh started before an edit must not replace its draft or save result.
          if (!state.dirty && revision === state.revision) {
            state.value = profile?.memo || "";
            state.status = "ready";
          }
          notify(name);
          return profile;
        } catch (error) {
          if (!state.loaded) state.status = "load-error";
          notify(name);
          throw error;
        }
      })();
      state.loading = loading;
      try { return await loading; }
      finally { if (state.loading === loading) state.loading = null; }
    },
    edit(name, value) {
      const state = entry(name);
      if (!state.loaded) return false;
      state.value = value;
      state.revision++;
      state.dirty = true;
      state.status = "unsaved";
      notify(name);
      return true;
    },
    async save(name) {
      const state = entry(name);
      if (!state.loaded) throw new Error("生徒メモを取得してから編集してください");
      const revision = state.revision;
      const version = ++state.saveVersion;
      const memo = state.value.trim();
      state.status = "saving";
      notify(name);
      try {
        await writeMemo(name, memo || null);
        if (version !== state.saveVersion) return;
        if (revision === state.revision) {
          state.value = memo;
          state.profile = { ...state.profile, memo: memo || null };
          state.dirty = false;
          state.status = "saved";
        } else {
          state.status = "unsaved";
        }
        notify(name);
      } catch (error) {
        if (version === state.saveVersion) {
          state.status = revision === state.revision ? "save-error" : "unsaved";
          notify(name);
        }
        throw error;
      }
    },
  };
}
