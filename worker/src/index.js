function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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

      return json({ error: "not found" }, headers, 404);
    } catch (err) {
      const status =
        err.message === "not authorized" || err.message === "missing bearer token" ? 401 : 400;
      return json({ error: err.message }, headers, status);
    }
  },
};
