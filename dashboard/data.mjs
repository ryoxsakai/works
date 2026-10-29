import { offsetDay } from "./model.mjs";

// Read-only, scoped to a captured session. No lesson-record/baseline endpoints.
export function createReader({ session, googleToken, fetcher = fetch }) {
  async function json(url, signal, token = session) {
    signal.throwIfAborted();
    const res = await fetcher(url, {
      signal,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const e = new Error(
        res.status === 401
          ? "ログインの有効期限が切れました。再読み込みしてログインしてください。"
          : `取得できませんでした (${res.status})`,
      );
      e.status = res.status;
      throw e;
    }
    return res.json();
  }
  return async (id, day, signal) => {
    if (id === "todo") {
      const v = await json("/api/todo", signal);
      if (!Array.isArray(v.tasks))
        throw new Error("ToDoの応答を確認できませんでした");
      return v.tasks;
    }
    if (id === "memo") {
      const v = await json("/api/memo", signal);
      if (!Array.isArray(v.memos))
        throw new Error("メモの応答を確認できませんでした");
      return v.memos
        .map((m) => ({ title: m.title, updatedAt: m.updatedAt }))
        .sort((a, b) =>
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
        );
    }
    if (id === "materials" || id === "ss") {
      const v = await json(
        id === "materials"
          ? "/api/material-library/files?all=1"
          : "/api/ss-projects",
        signal,
      );
      if (!Array.isArray(v))
        throw new Error("一覧の応答を確認できませんでした");
      return id === "materials"
        ? v
            .map((m) => ({ name: m.name, created_at: m.created_at }))
            .sort((a, b) =>
              String(b.created_at || "").localeCompare(
                String(a.created_at || ""),
              ),
            )
        : v
            .filter((p) => p.status !== "完了")
            .map((p) => ({
              name: p.name,
              deadline: p.deadline,
              status: p.status,
            }))
            .sort((a, b) =>
              String(a.deadline).localeCompare(String(b.deadline)),
            );
    }
    if (id !== "lessons") throw new Error("未対応のウィジェットです");
    const settings = await json("/api/settings", signal);
    if (
      !Array.isArray(settings.selected_calendars) ||
      !settings.selected_calendars.every((c) => typeof c === "string") ||
      (settings.excluded_titles !== undefined &&
        !Array.isArray(settings.excluded_titles))
    )
      throw new Error("カレンダー設定を確認できませんでした");
    const calendars = [...new Set(settings.selected_calendars)];
    if (!calendars.length) return { unconfigured: true, events: [] };
    const token = await googleToken();
    signal.throwIfAborted();
    if (!token) throw new Error("カレンダーへのログインを確認してください");
    const parentSignal = signal,
      controller = new AbortController();
    const abort = () => controller.abort();
    parentSignal.addEventListener("abort", abort, { once: true });
    if (parentSignal.aborted) controller.abort();
    signal = controller.signal;
    const events = [];
    let cursor = 0;
    // Bounded concurrency; paginated calendars are complete before claiming empty.
    await Promise.all(
      Array.from({ length: Math.min(3, calendars.length) }, async () => {
        while (cursor < calendars.length) {
          const calendar = calendars[cursor++];
          let page = "";
          const seen = new Set();
          do {
            const params = new URLSearchParams({
              timeMin: `${day}T00:00:00+09:00`,
              timeMax: `${offsetDay(day, 1)}T00:00:00+09:00`,
              singleEvents: "true",
              orderBy: "startTime",
              maxResults: "250",
              fields: "items(id,summary,start,end,status),nextPageToken",
            });
            if (page) params.set("pageToken", page);
            const data = await json(
              `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events?${params}`,
              signal,
              token,
            );
            if (data.items !== undefined && !Array.isArray(data.items))
              throw new Error("カレンダーの応答を確認できませんでした");
            events.push(
              ...(data.items || [])
                .filter(
                  (e) =>
                    e.status !== "cancelled" &&
                    !(settings.excluded_titles || []).includes(
                      (e.summary || "").trim(),
                    ),
                )
                .map((e) => ({
                  summary: e.summary,
                  start: e.start,
                  end: e.end,
                })),
            );
            page = data.nextPageToken || "";
            if (page && (typeof page !== "string" || seen.has(page)))
              throw new Error("予定の続きの取得を確認できませんでした");
            seen.add(page);
          } while (page);
        }
      }),
    )
      .catch((error) => {
        controller.abort();
        throw error;
      })
      .finally(() => parentSignal.removeEventListener("abort", abort));
    events.sort((a, b) =>
      String(a.start?.dateTime || a.start?.date || "").localeCompare(
        String(b.start?.dateTime || b.start?.date || ""),
      ),
    );
    return { unconfigured: false, events };
  };
}
