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

// 時限(○限)。開始時刻(HH:MM)だけを登録し、次の時限の開始時刻の直前までを
// その時限とみなして、授業記録などで時刻の代わりに時限名を表示するために使う。
// sort_orderは設定画面での並び順(表示専用)で、時刻とのマッチングには使わない。
async function readPeriods(env) {
  const { results } = await env.DB.prepare("SELECT * FROM periods ORDER BY sort_order").all();
  return results;
}

async function createPeriod(env, body) {
  const label = (body.label || "").trim();
  const startTime = body.start_time;
  if (!label || !startTime) {
    throw new Error("label, start_time are required");
  }
  const { results } = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM periods"
  ).all();
  const nextOrder = (results[0]?.maxOrder ?? -1) + 1;
  return env.DB.prepare(
    "INSERT INTO periods (label, start_time, sort_order) VALUES (?, ?, ?) RETURNING *"
  )
    .bind(label, startTime, nextOrder)
    .first();
}

async function updatePeriod(env, id, body) {
  const fields = [];
  const values = [];
  if (body.label !== undefined) {
    fields.push("label = ?");
    values.push(body.label);
  }
  if (body.start_time !== undefined) {
    fields.push("start_time = ?");
    values.push(body.start_time);
  }
  if (body.sort_order !== undefined) {
    fields.push("sort_order = ?");
    values.push(body.sort_order);
  }
  if (fields.length === 0) throw new Error("nothing to update");
  values.push(id);
  return env.DB.prepare(`UPDATE periods SET ${fields.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...values)
    .first();
}

async function deletePeriod(env, id) {
  await env.DB.prepare("DELETE FROM periods WHERE id = ?").bind(id).run();
}

// 教材(materials)。生徒に紐付かないグローバルな一覧。sort_orderで並べ替える。
async function readMaterials(env) {
  const { results } = await env.DB.prepare("SELECT * FROM materials ORDER BY sort_order").all();
  return results;
}

async function createMaterial(env, body) {
  const name = (body.name || "").trim();
  if (!name) throw new Error("name is required");
  const { results } = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM materials"
  ).all();
  const nextOrder = (results[0]?.maxOrder ?? -1) + 1;
  return env.DB.prepare("INSERT INTO materials (name, sort_order) VALUES (?, ?) RETURNING *")
    .bind(name, nextOrder)
    .first();
}

async function updateMaterial(env, id, body) {
  const fields = [];
  const values = [];
  if (body.name !== undefined) {
    fields.push("name = ?");
    values.push(body.name);
  }
  if (body.sort_order !== undefined) {
    fields.push("sort_order = ?");
    values.push(body.sort_order);
  }
  if (fields.length === 0) throw new Error("nothing to update");
  values.push(id);
  return env.DB.prepare(`UPDATE materials SET ${fields.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...values)
    .first();
}

async function deleteMaterial(env, id) {
  const { results: chapters } = await env.DB.prepare(
    "SELECT id FROM material_chapters WHERE material_id = ?"
  )
    .bind(id)
    .all();
  for (const chapter of chapters) {
    await env.DB.prepare("DELETE FROM chapter_progress WHERE chapter_id = ?").bind(chapter.id).run();
  }
  await env.DB.prepare("DELETE FROM material_chapters WHERE material_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM student_materials WHERE material_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM materials WHERE id = ?").bind(id).run();
}

// 教材のチャプター(章)。教材(material_id)に紐付き、sort_orderで並べ替える。
async function readChapters(env, materialId) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM material_chapters WHERE material_id = ? ORDER BY sort_order"
  )
    .bind(materialId)
    .all();
  return results;
}

async function createChapter(env, materialId, body) {
  const name = (body.name || "").trim();
  if (!name) throw new Error("name is required");
  const { results } = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM material_chapters WHERE material_id = ?"
  )
    .bind(materialId)
    .all();
  const nextOrder = (results[0]?.maxOrder ?? -1) + 1;
  return env.DB.prepare(
    "INSERT INTO material_chapters (material_id, name, sort_order) VALUES (?, ?, ?) RETURNING *"
  )
    .bind(materialId, name, nextOrder)
    .first();
}

async function updateChapter(env, id, body) {
  const fields = [];
  const values = [];
  if (body.name !== undefined) {
    fields.push("name = ?");
    values.push(body.name);
  }
  if (body.sort_order !== undefined) {
    fields.push("sort_order = ?");
    values.push(body.sort_order);
  }
  if (fields.length === 0) throw new Error("nothing to update");
  values.push(id);
  return env.DB.prepare(`UPDATE material_chapters SET ${fields.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...values)
    .first();
}

async function deleteChapter(env, id) {
  await env.DB.prepare("DELETE FROM chapter_progress WHERE chapter_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM material_chapters WHERE id = ?").bind(id).run();
}

// 生徒(name)ごとの使用教材登録(サブヘッダー)+チャプターごとの進捗チェック。
async function readStudentMaterials(env, name) {
  const { results: links } = await env.DB.prepare(
    `SELECT sm.id, sm.material_id, sm.sort_order, m.name AS material_name
     FROM student_materials sm
     JOIN materials m ON m.id = sm.material_id
     WHERE sm.name = ?
     ORDER BY sm.sort_order`
  )
    .bind(name)
    .all();

  const out = [];
  for (const link of links) {
    const { results: chapters } = await env.DB.prepare(
      `SELECT c.id, c.name, c.sort_order, COALESCE(p.completed, 0) AS completed
       FROM material_chapters c
       LEFT JOIN chapter_progress p ON p.chapter_id = c.id AND p.name = ?
       WHERE c.material_id = ?
       ORDER BY c.sort_order`
    )
      .bind(name, link.material_id)
      .all();
    out.push({ ...link, chapters });
  }
  return out;
}

async function addStudentMaterial(env, body) {
  const name = (body.name || "").trim();
  const materialId = body.material_id;
  if (!name || !materialId) throw new Error("name, material_id are required");
  const existing = await env.DB.prepare(
    "SELECT id FROM student_materials WHERE name = ? AND material_id = ?"
  )
    .bind(name, materialId)
    .first();
  if (existing) return existing;
  const { results } = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM student_materials WHERE name = ?"
  )
    .bind(name)
    .all();
  const nextOrder = (results[0]?.maxOrder ?? -1) + 1;
  return env.DB.prepare(
    "INSERT INTO student_materials (name, material_id, sort_order) VALUES (?, ?, ?) RETURNING *"
  )
    .bind(name, materialId, nextOrder)
    .first();
}

async function reorderStudentMaterials(env, name, orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    await env.DB.prepare("UPDATE student_materials SET sort_order = ? WHERE id = ? AND name = ?")
      .bind(i, orderedIds[i], name)
      .run();
  }
}

async function removeStudentMaterial(env, id) {
  await env.DB.prepare("DELETE FROM student_materials WHERE id = ?").bind(id).run();
}

async function setChapterProgress(env, name, chapterId, completed) {
  await env.DB.prepare(
    `INSERT INTO chapter_progress (name, chapter_id, completed, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(name, chapter_id) DO UPDATE SET completed = excluded.completed, updated_at = excluded.updated_at`
  )
    .bind(name, chapterId, completed ? 1 : 0)
    .run();
}

// カリキュラム表の1行(=1つのGoogleカレンダー予定)ごとの入力内容。
// 予定そのものはGoogle Calendar側にあるため、ここではcalendar_event_idをキーに
// 完了チェック・授業予定・確認テスト・授業メモだけを保存する。
async function readCurriculumEntries(env) {
  const { results } = await env.DB.prepare("SELECT * FROM curriculum_entries").all();
  return results;
}

async function upsertCurriculumEntry(env, eventId, body) {
  if (!eventId) throw new Error("event id is required");
  await env.DB.prepare(
    `INSERT INTO curriculum_entries (calendar_event_id, completed, lesson_plan, confirmation_test, homework, lesson_memo, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(calendar_event_id) DO UPDATE SET
       completed = excluded.completed,
       lesson_plan = excluded.lesson_plan,
       confirmation_test = excluded.confirmation_test,
       homework = excluded.homework,
       lesson_memo = excluded.lesson_memo,
       updated_at = excluded.updated_at`
  )
    .bind(
      eventId,
      body.completed ? 1 : 0,
      body.lesson_plan || null,
      body.confirmation_test || null,
      body.homework || null,
      body.lesson_memo || null
    )
    .run();
  return env.DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id = ?")
    .bind(eventId)
    .first();
}

// 生徒(name)ごとの短期・中期・長期目標。sort_orderで並べ替えを保持する。
async function readGoals(env, name) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM goals WHERE name = ? ORDER BY category, sort_order"
  )
    .bind(name)
    .all();
  return results;
}

async function createGoal(env, body) {
  const name = (body.name || "").trim();
  const category = body.category;
  const text = (body.text || "").trim();
  if (!name || !["short", "mid", "long"].includes(category) || !text) {
    throw new Error("name, category(short/mid/long), text are required");
  }
  const { results } = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM goals WHERE name = ? AND category = ?"
  )
    .bind(name, category)
    .all();
  const nextOrder = (results[0]?.maxOrder ?? -1) + 1;
  return env.DB.prepare(
    "INSERT INTO goals (name, category, text, sort_order) VALUES (?, ?, ?, ?) RETURNING *"
  )
    .bind(name, category, text, nextOrder)
    .first();
}

async function updateGoal(env, id, body) {
  const fields = [];
  const values = [];
  if (body.text !== undefined) {
    fields.push("text = ?");
    values.push(body.text);
  }
  if (body.completed !== undefined) {
    fields.push("completed = ?");
    values.push(body.completed ? 1 : 0);
  }
  if (body.sort_order !== undefined) {
    fields.push("sort_order = ?");
    values.push(body.sort_order);
  }
  if (fields.length === 0) throw new Error("nothing to update");
  values.push(id);
  return env.DB.prepare(`UPDATE goals SET ${fields.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...values)
    .first();
}

async function deleteGoal(env, id) {
  await env.DB.prepare("DELETE FROM goals WHERE id = ?").bind(id).run();
}

// 目標のテンプレート。生徒(name)に紐付かず、短期・中期・長期ごとに使い回す文言集。
async function readGoalTemplates(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM goal_templates ORDER BY category, sort_order"
  ).all();
  return results;
}

async function createGoalTemplate(env, body) {
  const category = body.category;
  const text = (body.text || "").trim();
  if (!["short", "mid", "long"].includes(category) || !text) {
    throw new Error("category(short/mid/long), text are required");
  }
  const { results } = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM goal_templates WHERE category = ?"
  )
    .bind(category)
    .all();
  const nextOrder = (results[0]?.maxOrder ?? -1) + 1;
  return env.DB.prepare(
    "INSERT INTO goal_templates (category, text, sort_order) VALUES (?, ?, ?) RETURNING *"
  )
    .bind(category, text, nextOrder)
    .first();
}

async function updateGoalTemplate(env, id, body) {
  const fields = [];
  const values = [];
  if (body.text !== undefined) {
    fields.push("text = ?");
    values.push(body.text);
  }
  if (body.sort_order !== undefined) {
    fields.push("sort_order = ?");
    values.push(body.sort_order);
  }
  if (fields.length === 0) throw new Error("nothing to update");
  values.push(id);
  return env.DB.prepare(`UPDATE goal_templates SET ${fields.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...values)
    .first();
}

async function deleteGoalTemplate(env, id) {
  await env.DB.prepare("DELETE FROM goal_templates WHERE id = ?").bind(id).run();
}

// 生徒(name)ごとの表示設定(印刷時に使う名前)。
async function readStudentPref(env, name) {
  return env.DB.prepare("SELECT * FROM student_prefs WHERE name = ?").bind(name).first();
}

async function upsertStudentPref(env, name, body) {
  const printName = body.print_name === undefined ? null : body.print_name;
  await env.DB.prepare(
    `INSERT INTO student_prefs (name, print_name, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET print_name = excluded.print_name, updated_at = excluded.updated_at`
  )
    .bind(name, printName)
    .run();
  return env.DB.prepare("SELECT * FROM student_prefs WHERE name = ?").bind(name).first();
}

// 生徒(name)ごとの受験校候補(私立の選択 / 国公立の自由入力)と志望順位。
async function readCandidateSchools(env, name) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM candidate_schools WHERE name = ? ORDER BY school_type, school_name"
  )
    .bind(name)
    .all();
  return results;
}

async function createCandidateSchool(env, body) {
  const name = (body.name || "").trim();
  const schoolName = (body.school_name || "").trim();
  const schoolType = body.school_type;
  if (!name || !schoolName || !["private", "national"].includes(schoolType)) {
    throw new Error("name, school_name, school_type(private/national) are required");
  }
  return env.DB.prepare(
    "INSERT INTO candidate_schools (name, school_name, school_type) VALUES (?, ?, ?) RETURNING *"
  )
    .bind(name, schoolName, schoolType)
    .first();
}

async function updateCandidateSchool(env, id, body) {
  return env.DB.prepare("UPDATE candidate_schools SET rank = ? WHERE id = ? RETURNING *")
    .bind(body.rank === undefined || body.rank === null ? null : body.rank, id)
    .first();
}

async function deleteCandidateSchool(env, id) {
  await env.DB.prepare("DELETE FROM candidate_schools WHERE id = ?").bind(id).run();
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
        if (Array.isArray(body.excluded_titles)) {
          await writeSetting(env, "excluded_titles", body.excluded_titles);
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

      if (url.pathname === "/api/periods" && request.method === "GET") {
        return json(await readPeriods(env), headers);
      }

      if (url.pathname === "/api/periods" && request.method === "POST") {
        const body = await request.json();
        return json(await createPeriod(env, body), headers, 201);
      }

      const periodMatch = url.pathname.match(/^\/api\/periods\/(\d+)$/);
      if (periodMatch && request.method === "PUT") {
        const body = await request.json();
        return json(await updatePeriod(env, periodMatch[1], body), headers);
      }

      if (periodMatch && request.method === "DELETE") {
        await deletePeriod(env, periodMatch[1]);
        return json({ ok: true }, headers);
      }

      if (url.pathname === "/api/materials" && request.method === "GET") {
        return json(await readMaterials(env), headers);
      }

      if (url.pathname === "/api/materials" && request.method === "POST") {
        const body = await request.json();
        return json(await createMaterial(env, body), headers, 201);
      }

      const materialMatch = url.pathname.match(/^\/api\/materials\/(\d+)$/);
      if (materialMatch && request.method === "PUT") {
        const body = await request.json();
        return json(await updateMaterial(env, materialMatch[1], body), headers);
      }

      if (materialMatch && request.method === "DELETE") {
        await deleteMaterial(env, materialMatch[1]);
        return json({ ok: true }, headers);
      }

      const chaptersListMatch = url.pathname.match(/^\/api\/materials\/(\d+)\/chapters$/);
      if (chaptersListMatch && request.method === "GET") {
        return json(await readChapters(env, chaptersListMatch[1]), headers);
      }

      if (chaptersListMatch && request.method === "POST") {
        const body = await request.json();
        return json(await createChapter(env, chaptersListMatch[1], body), headers, 201);
      }

      const chapterMatch = url.pathname.match(/^\/api\/chapters\/(\d+)$/);
      if (chapterMatch && request.method === "PUT") {
        const body = await request.json();
        return json(await updateChapter(env, chapterMatch[1], body), headers);
      }

      if (chapterMatch && request.method === "DELETE") {
        await deleteChapter(env, chapterMatch[1]);
        return json({ ok: true }, headers);
      }

      if (url.pathname === "/api/student-materials" && request.method === "GET") {
        const name = url.searchParams.get("name");
        if (!name) return json({ error: "name is required" }, headers, 400);
        return json(await readStudentMaterials(env, name), headers);
      }

      if (url.pathname === "/api/student-materials" && request.method === "POST") {
        const body = await request.json();
        return json(await addStudentMaterial(env, body), headers, 201);
      }

      if (url.pathname === "/api/student-materials/reorder" && request.method === "PUT") {
        const body = await request.json();
        const name = (body.name || "").trim();
        if (!name || !Array.isArray(body.order)) {
          return json({ error: "name, order[] are required" }, headers, 400);
        }
        await reorderStudentMaterials(env, name, body.order);
        return json({ ok: true }, headers);
      }

      const studentMaterialMatch = url.pathname.match(/^\/api\/student-materials\/(\d+)$/);
      if (studentMaterialMatch && request.method === "DELETE") {
        await removeStudentMaterial(env, studentMaterialMatch[1]);
        return json({ ok: true }, headers);
      }

      const chapterProgressMatch = url.pathname.match(/^\/api\/chapter-progress\/(\d+)$/);
      if (chapterProgressMatch && request.method === "PUT") {
        const body = await request.json();
        const name = (body.name || "").trim();
        if (!name) return json({ error: "name is required" }, headers, 400);
        await setChapterProgress(env, name, chapterProgressMatch[1], body.completed);
        return json({ ok: true }, headers);
      }

      if (url.pathname === "/api/curriculum" && request.method === "GET") {
        return json(await readCurriculumEntries(env), headers);
      }

      const curriculumMatch = url.pathname.match(/^\/api\/curriculum\/(.+)$/);
      if (curriculumMatch && request.method === "PUT") {
        const body = await request.json();
        const eventId = decodeURIComponent(curriculumMatch[1]);
        return json(await upsertCurriculumEntry(env, eventId, body), headers);
      }

      if (url.pathname === "/api/goals" && request.method === "GET") {
        const name = url.searchParams.get("name");
        if (!name) return json({ error: "name is required" }, headers, 400);
        return json(await readGoals(env, name), headers);
      }

      if (url.pathname === "/api/goals" && request.method === "POST") {
        const body = await request.json();
        return json(await createGoal(env, body), headers, 201);
      }

      const goalMatch = url.pathname.match(/^\/api\/goals\/(\d+)$/);
      if (goalMatch && request.method === "PUT") {
        const body = await request.json();
        return json(await updateGoal(env, goalMatch[1], body), headers);
      }

      if (goalMatch && request.method === "DELETE") {
        await deleteGoal(env, goalMatch[1]);
        return json({ ok: true }, headers);
      }

      if (url.pathname === "/api/goal-templates" && request.method === "GET") {
        return json(await readGoalTemplates(env), headers);
      }

      if (url.pathname === "/api/goal-templates" && request.method === "POST") {
        const body = await request.json();
        return json(await createGoalTemplate(env, body), headers, 201);
      }

      const templateMatch = url.pathname.match(/^\/api\/goal-templates\/(\d+)$/);
      if (templateMatch && request.method === "PUT") {
        const body = await request.json();
        return json(await updateGoalTemplate(env, templateMatch[1], body), headers);
      }

      if (templateMatch && request.method === "DELETE") {
        await deleteGoalTemplate(env, templateMatch[1]);
        return json({ ok: true }, headers);
      }

      if (url.pathname === "/api/student-prefs" && request.method === "GET") {
        const name = url.searchParams.get("name");
        if (!name) return json({ error: "name is required" }, headers, 400);
        const pref = await readStudentPref(env, name);
        return json(pref || { name, honorific: null }, headers);
      }

      if (url.pathname === "/api/student-prefs" && request.method === "PUT") {
        const body = await request.json();
        const name = (body.name || "").trim();
        if (!name) return json({ error: "name is required" }, headers, 400);
        return json(await upsertStudentPref(env, name, body), headers);
      }

      if (url.pathname === "/api/schools" && request.method === "GET") {
        const name = url.searchParams.get("name");
        if (!name) return json({ error: "name is required" }, headers, 400);
        return json(await readCandidateSchools(env, name), headers);
      }

      if (url.pathname === "/api/schools" && request.method === "POST") {
        const body = await request.json();
        return json(await createCandidateSchool(env, body), headers, 201);
      }

      const schoolMatch = url.pathname.match(/^\/api\/schools\/(\d+)$/);
      if (schoolMatch && request.method === "PUT") {
        const body = await request.json();
        return json(await updateCandidateSchool(env, schoolMatch[1], body), headers);
      }

      if (schoolMatch && request.method === "DELETE") {
        await deleteCandidateSchool(env, schoolMatch[1]);
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
