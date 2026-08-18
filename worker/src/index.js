function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function json(data, headers, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// クライアントはFirebase Authを介さず直接Googleのアクセストークンを渡してくるので、
// Googleのtokeninfoエンドポイントに問い合わせてトークンの正当性とemailを確認する。
async function verifyGoogleToken(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) throw new Error("missing bearer token");

  const res = await fetch(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(match[1])}`
  );
  if (!res.ok) throw new Error("not authorized");
  const info = await res.json();

  const audienceOk = [info.aud, info.azp].includes(env.GOOGLE_CLIENT_ID);
  const emailOk = info.email?.toLowerCase() === env.ALLOWED_EMAIL.toLowerCase();
  if (!audienceOk || !emailOk || String(info.email_verified) !== "true") {
    throw new Error("not authorized");
  }

  return info;
}

async function readStudents(env) {
  const { results } = await env.DB.prepare("SELECT * FROM students ORDER BY name").all();
  return results;
}

async function createStudent(env, body) {
  const name = (body.name || "").trim();
  if (!name) throw new Error("name is required");
  return env.DB.prepare("INSERT INTO students (name, calendar_tag) VALUES (?, ?) RETURNING *")
    .bind(name, body.calendar_tag || null)
    .first();
}

async function readLessons(env, studentId) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM lesson_notes WHERE student_id = ? ORDER BY lesson_date DESC"
  )
    .bind(studentId)
    .all();
  return results;
}

async function createLesson(env, body) {
  if (!body.student_id) throw new Error("student_id is required");
  return env.DB.prepare(
    `INSERT INTO lesson_notes (student_id, calendar_event_id, lesson_date, note, score)
     VALUES (?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(
      body.student_id,
      body.calendar_event_id || null,
      body.lesson_date || null,
      body.note || null,
      body.score || null
    )
    .first();
}

// 単一ユーザー運用のアプリ設定(対象カレンダー等)をkey-valueで保存する。
// デバイスをまたいでも同じ設定が使えるようにするため、localStorageではなくD1に置く。
async function readSettings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const row of results) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return out;
}

async function writeSetting(env, key, value) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  )
    .bind(key, JSON.stringify(value))
    .run();
}

// 年度(academic_years)を親、学期(terms)を子とした階層で期間を管理する。
// 複数の学期を組み合わせて選択し、予定を絞り込むために使う。
async function readYears(env) {
  const { results } = await env.DB.prepare("SELECT * FROM academic_years ORDER BY label").all();
  return results;
}

async function createYear(env, body) {
  const label = (body.label || "").trim();
  if (!label) throw new Error("label is required");
  return env.DB.prepare("INSERT INTO academic_years (label) VALUES (?) RETURNING *")
    .bind(label)
    .first();
}

async function updateYear(env, id, body) {
  const label = (body.label || "").trim();
  if (!label) throw new Error("label is required");
  return env.DB.prepare("UPDATE academic_years SET label = ? WHERE id = ? RETURNING *")
    .bind(label, id)
    .first();
}

async function deleteYear(env, id) {
  await env.DB.prepare("DELETE FROM terms WHERE year_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM academic_years WHERE id = ?").bind(id).run();
}

async function readTerms(env) {
  const { results } = await env.DB.prepare("SELECT * FROM terms ORDER BY start_date").all();
  return results;
}

async function createTerm(env, body) {
  const label = (body.label || "").trim();
  const startDate = body.start_date;
  const endDate = body.end_date;
  const yearId = body.year_id;
  if (!yearId || !label || !startDate || !endDate) {
    throw new Error("year_id, label, start_date, end_date are required");
  }
  return env.DB.prepare(
    "INSERT INTO terms (year_id, label, start_date, end_date) VALUES (?, ?, ?, ?) RETURNING *"
  )
    .bind(yearId, label, startDate, endDate)
    .first();
}

async function updateTerm(env, id, body) {
  const label = (body.label || "").trim();
  const startDate = body.start_date;
  const endDate = body.end_date;
  if (!label || !startDate || !endDate) {
    throw new Error("label, start_date, end_date are required");
  }
  return env.DB.prepare(
    "UPDATE terms SET label = ?, start_date = ?, end_date = ? WHERE id = ? RETURNING *"
  )
    .bind(label, startDate, endDate, id)
    .first();
}

async function deleteTerm(env, id) {
  await env.DB.prepare("DELETE FROM terms WHERE id = ?").bind(id).run();
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN;
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    const url = new URL(request.url);

    try {
      await verifyGoogleToken(request, env);

      if (url.pathname === "/api/students" && request.method === "GET") {
        return json(await readStudents(env), headers);
      }

      if (url.pathname === "/api/students" && request.method === "POST") {
        const body = await request.json();
        return json(await createStudent(env, body), headers, 201);
      }

      if (url.pathname === "/api/lessons" && request.method === "GET") {
        const studentId = url.searchParams.get("student_id");
        if (!studentId) return json({ error: "student_id is required" }, headers, 400);
        return json(await readLessons(env, studentId), headers);
      }

      if (url.pathname === "/api/lessons" && request.method === "POST") {
        const body = await request.json();
        return json(await createLesson(env, body), headers, 201);
      }

      if (url.pathname === "/api/settings" && request.method === "GET") {
        return json(await readSettings(env), headers);
      }

      if (url.pathname === "/api/settings" && request.method === "PUT") {
        const body = await request.json();
        if (Array.isArray(body.selected_calendars)) {
          await writeSetting(env, "selected_calendars", body.selected_calendars);
        }
        if (Array.isArray(body.selected_term_ids)) {
          await writeSetting(env, "selected_term_ids", body.selected_term_ids);
        }
        return json(await readSettings(env), headers);
      }

      if (url.pathname === "/api/years" && request.method === "GET") {
        return json(await readYears(env), headers);
      }

      if (url.pathname === "/api/years" && request.method === "POST") {
        const body = await request.json();
        return json(await createYear(env, body), headers, 201);
      }

      const yearMatch = url.pathname.match(/^\/api\/years\/(\d+)$/);
      if (yearMatch && request.method === "PUT") {
        const body = await request.json();
        return json(await updateYear(env, yearMatch[1], body), headers);
      }

      if (yearMatch && request.method === "DELETE") {
        await deleteYear(env, yearMatch[1]);
        return json({ ok: true }, headers);
      }

      if (url.pathname === "/api/terms" && request.method === "GET") {
        return json(await readTerms(env), headers);
      }

      if (url.pathname === "/api/terms" && request.method === "POST") {
        const body = await request.json();
        return json(await createTerm(env, body), headers, 201);
      }

      const termMatch = url.pathname.match(/^\/api\/terms\/(\d+)$/);
      if (termMatch && request.method === "PUT") {
        const body = await request.json();
        return json(await updateTerm(env, termMatch[1], body), headers);
      }

      if (termMatch && request.method === "DELETE") {
        await deleteTerm(env, termMatch[1]);
        return json({ ok: true }, headers);
      }

      return json({ error: "not found" }, headers, 404);
    } catch (err) {
      const status =
        err.message === "not authorized" || err.message === "missing bearer token" ? 401 : 400;
      return json({ error: err.message }, headers, status);
    }
  },
};
