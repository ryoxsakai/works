function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-API-Key",
  };
}

function json(data, headers, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// --- ブラウザを介さない授業予定API ---

const SCHEDULE_TIME_ZONE = "Asia/Tokyo";

const SCHEDULE_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let i = 0; i < leftBytes.length; i += 1) {
    difference |= leftBytes[i] ^ rightBytes[i];
  }
  return difference === 0;
}

async function verifyReadApiKey(request, env) {
  if (!env.WORKS_API_KEY) {
    throw httpError(503, "WORKS_API_KEY is not configured");
  }
  const supplied = request.headers.get("X-API-Key") || "";
  if (!supplied || !(await constantTimeEqual(supplied, env.WORKS_API_KEY))) {
    throw httpError(401, "invalid API key");
  }
}

// --- ChatGPT Plugin用のMCP/OAuth ---
// 授業予定は個人情報を含むため、MCPのtools/callはOAuthで発行した短命の
// Bearer tokenでのみ実行できるようにする。OAuthの認可画面では既存の
// WORKS_API_KEYを本人確認用に使い、キー自体はChatGPTへ保存しない。
// schedule:readはこの個人用MCPへの接続権限を表し、取得・更新の両方に使用する。
const MCP_SCOPE = "schedule:read";
const MCP_TOKEN_MAX_AGE_MS = 60 * 60 * 1000;
const MCP_AUTH_CODE_MAX_AGE_MS = 5 * 60 * 1000;

function mcpBaseUrl(url) { return `${url.protocol}//${url.host}`; }
function mcpJson(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders } });
}
function html(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}
async function ensureMcpOAuthSchema(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mcp_oauth_clients (client_id TEXT PRIMARY KEY, redirect_uris TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mcp_oauth_codes (code TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL, scope TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))"),
  ]);
}
async function registerMcpOAuthClient(request, env) {
  await ensureMcpOAuthSchema(env);
  const body = await request.json();
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!redirectUris.length || redirectUris.some((uri) => !uri.startsWith("https://"))) return mcpJson({ error: "invalid_client_metadata" }, 400);
  const clientId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO mcp_oauth_clients (client_id, redirect_uris) VALUES (?, ?)").bind(clientId, JSON.stringify(redirectUris)).run();
  return mcpJson({ client_id: clientId, token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }, 201);
}
async function readMcpOAuthClient(env, clientId) {
  await ensureMcpOAuthSchema(env);
  const client = await env.DB.prepare("SELECT client_id, redirect_uris FROM mcp_oauth_clients WHERE client_id = ?").bind(clientId).first();
  if (!client) return null;
  try { return { ...client, redirect_uris: JSON.parse(client.redirect_uris) }; } catch { return null; }
}
function oauthErrorPage(message) {
  return html(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>WORKS 認証</title><body style="font-family:-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif;max-width:560px;margin:48px auto;padding:0 20px"><h1>WORKS 認証エラー</h1><p>${escapeHtml(message)}</p></body></html>`, 400);
}
function renderMcpAuthorizeForm(params) {
  const fields = ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope"].map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(params.get(name) || "")}">`).join("");
  return html(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WORKS を接続</title><body style="font-family:-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif;max-width:560px;margin:48px auto;padding:0 20px"><h1>WORKS をChatGPTに接続</h1><p>授業予定・確認テスト・宿題・授業メモの読み取りと更新を許可します。</p><form method="post"><label style="display:block;margin:24px 0 8px">WORKS APIキー</label><input name="api_key" type="password" autocomplete="current-password" required style="box-sizing:border-box;width:100%;padding:12px;font-size:16px">${fields}<button type="submit" style="margin-top:24px;padding:12px 18px;font-size:16px">接続を許可</button></form></body></html>`);
}
async function authorizeMcpClient(request, env, url) {
  const params = request.method === "POST" ? new URLSearchParams(await request.text()) : url.searchParams;
  const clientId = params.get("client_id") || "";
  const redirectUri = params.get("redirect_uri") || "";
  const codeChallenge = params.get("code_challenge") || "";
  const scope = params.get("scope") || MCP_SCOPE;
  const client = await readMcpOAuthClient(env, clientId);
  if (params.get("response_type") !== "code" || !client || !client.redirect_uris.includes(redirectUri) || !codeChallenge || params.get("code_challenge_method") !== "S256" || !scope.split(" ").includes(MCP_SCOPE)) return oauthErrorPage("認可リクエストが正しくありません。");
  if (request.method === "GET") return renderMcpAuthorizeForm(params);
  const suppliedKey = params.get("api_key") || "";
  if (!env.WORKS_API_KEY || !suppliedKey || !(await constantTimeEqual(suppliedKey, env.WORKS_API_KEY))) return oauthErrorPage("APIキーが正しくありません。ブラウザの戻るボタンで入力し直してください。");
  const code = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO mcp_oauth_codes (code, client_id, redirect_uri, code_challenge, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(code, clientId, redirectUri, codeChallenge, scope, Date.now() + MCP_AUTH_CODE_MAX_AGE_MS).run();
  const redirect = new URL(redirectUri); redirect.searchParams.set("code", code); if (params.get("state")) redirect.searchParams.set("state", params.get("state"));
  return Response.redirect(redirect.toString(), 302);
}
async function sha256Base64Url(value) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function createMcpAccessToken(env, scope) {
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify({ email: env.ALLOWED_EMAIL, aud: "works-mcp", scope, exp: Date.now() + MCP_TOKEN_MAX_AGE_MS })));
  return `${payloadB64}.${await hmacSign(env, payloadB64)}`;
}
async function exchangeMcpToken(request, env) {
  await ensureMcpOAuthSchema(env);
  const params = new URLSearchParams(await request.text());
  const code = params.get("code") || "";
  const row = await env.DB.prepare("SELECT * FROM mcp_oauth_codes WHERE code = ?").bind(code).first();
  if (!row || row.client_id !== params.get("client_id") || row.redirect_uri !== params.get("redirect_uri") || row.expires_at < Date.now() || !params.get("code_verifier") || !(await constantTimeEqual(await sha256Base64Url(params.get("code_verifier")), row.code_challenge))) return mcpJson({ error: "invalid_grant" }, 400);
  await env.DB.prepare("DELETE FROM mcp_oauth_codes WHERE code = ?").bind(code).run();
  return mcpJson({ access_token: await createMcpAccessToken(env, row.scope), token_type: "Bearer", expires_in: MCP_TOKEN_MAX_AGE_MS / 1000, scope: row.scope });
}
async function verifyMcpAccessToken(request, env) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer (.+)$/);
  if (!match) throw httpError(401, "missing MCP bearer token");
  const [payloadB64, sig] = match[1].split(".");
  if (!payloadB64 || !sig || sig !== await hmacSign(env, payloadB64)) throw httpError(401, "invalid MCP bearer token");
  let payload; try { payload = JSON.parse(fromBase64Url(payloadB64)); } catch { throw httpError(401, "invalid MCP bearer token"); }
  if (payload.aud !== "works-mcp" || payload.exp < Date.now() || payload.email?.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase() || !String(payload.scope || "").split(" ").includes(MCP_SCOPE)) throw httpError(401, "invalid MCP bearer token");
}
function mcpResponse(id, result) {
  return mcpJson({ jsonrpc: "2.0", id, result });
}

function mcpError(id, code, message) {
  return mcpJson({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function mcpToolResult(id, data) {
  return mcpResponse(id, {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    isError: false,
  });
}

function mcpToolFailure(id, err) {
  return mcpResponse(id, {
    content: [{ type: "text", text: err?.message || String(err) }],
    isError: true,
  });
}

const SCHEDULE_TEXT_FIELDS = [
  "lesson_plan",
  "confirmation_test",
  "homework",
  "lesson_memo",
];

const scheduleUpdateProperties = {
  event_id: {
    type: "string",
    description:
      "get_scheduleで取得した予定ID。省略する場合はdateとtitleを指定します。",
  },
  date: {
    type: "string",
    description:
      "YYYY-MM-DD形式。event_idを省略してtitleで予定を特定するときに必要です。",
  },
  title: {
    type: "string",
    description:
      "予定名の完全一致。event_idを省略してdateで予定を特定するときに必要です。",
  },
  completed: {
    type: "boolean",
    description: "授業を完了扱いにする場合はtrue、未完了に戻す場合はfalse。",
  },
  lesson_plan: {
    type: ["string", "null"],
    description: "授業予定。nullまたは空文字列で消去します。",
  },
  confirmation_test: {
    type: ["string", "null"],
    description: "確認テスト。nullまたは空文字列で消去します。",
  },
  homework: {
    type: ["string", "null"],
    description: "宿題。nullまたは空文字列で消去します。",
  },
  lesson_memo: {
    type: ["string", "null"],
    description: "授業メモ。nullまたは空文字列で消去します。",
  },
};

const MCP_SCHEDULE_TOOLS = [
  {
    name: "get_schedule",
    title: "授業予定を取得",
    description:
      "指定日（Asia/Tokyo）のWORKS授業予定、授業計画、確認テスト、宿題、授業メモを取得します。日付を省略すると今日です。",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "YYYY-MM-DD形式。省略時は今日（Asia/Tokyo）。",
        },
        include_excluded: {
          type: "boolean",
          description: "除外設定済みの予定も含める場合はtrue。",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "get_today_briefing",
    title: "今日の授業準備情報を取得",
    description:
      "指定日（省略時は今日）の授業予定に、同じ授業名の直前の授業内容・宿題・確認テスト・授業メモを付けて取得します。",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "YYYY-MM-DD形式。省略時は今日（Asia/Tokyo）。",
        },
        previous_lookback_days: {
          type: "integer",
          minimum: 1,
          maximum: 365,
          description: "前回授業を探す日数。省略時は90日。",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "get_unrecorded_lessons",
    title: "未記録の授業を取得",
    description:
      "指定した終了日までの期間から、終了時刻を過ぎても完了扱いになっていない授業を取得します。入力漏れの確認に使用します。",
    inputSchema: {
      type: "object",
      properties: {
        end_date: {
          type: "string",
          description: "YYYY-MM-DD形式。省略時は今日（Asia/Tokyo）。",
        },
        lookback_days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          description: "確認する日数。終了日を含み、省略時は7日。",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "update_schedule",
    title: "授業予定を更新",
    description:
      "1件の授業について、授業予定・確認テスト・宿題・授業メモ・完了状態を部分更新します。event_id、またはdateとtitleの組み合わせで対象を指定します。指定しなかった項目は変更しません。",
    inputSchema: {
      type: "object",
      properties: scheduleUpdateProperties,
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "update_schedules",
    title: "複数の授業予定を一括更新",
    description:
      "複数の授業予定を一度に部分更新します。各項目はevent_id、またはdateとtitleの組み合わせで対象を指定します。予定名が重複する場合はevent_idを使用してください。",
    inputSchema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: scheduleUpdateProperties,
            additionalProperties: false,
          },
        },
      },
      required: ["updates"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

function schedulePatchFromArguments(args) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(args, "completed")) {
    if (typeof args.completed !== "boolean") {
      throw httpError(400, "completed must be boolean");
    }
    patch.completed = args.completed;
  }
  for (const field of SCHEDULE_TEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(args, field)) continue;
    const value = args[field];
    if (value !== null && typeof value !== "string") {
      throw httpError(400, `${field} must be string or null`);
    }
    if (typeof value === "string" && value.length > 5000) {
      throw httpError(400, `${field} is too long`);
    }
    patch[field] = value === null ? null : value.trim() || null;
  }
  if (Object.keys(patch).length === 0) {
    throw httpError(400, "at least one update field is required");
  }
  return patch;
}

async function resolveScheduleUpdateTarget(env, args) {
  const eventId = String(args.event_id || "").trim();
  if (eventId) {
    return {
      event_id: eventId,
      date: args.date ? String(args.date).trim() : null,
      title: args.title ? String(args.title).trim() : null,
    };
  }

  const date = String(args.date || "").trim();
  const title = String(args.title || "").trim();
  if (!date || !title) {
    throw httpError(400, "event_id, or both date and title, are required");
  }

  const searchParams = new URLSearchParams({
    date,
    include_excluded: "true",
  });
  const schedule = await readSchedule(env, searchParams);
  const matches = schedule.events.filter((event) => event.title === title);
  if (matches.length === 0) {
    throw httpError(404, `schedule not found: ${date} ${title}`);
  }
  if (matches.length > 1) {
    throw httpError(
      409,
      `multiple schedules matched: ${date} ${title}; use event_id`
    );
  }
  return {
    event_id: matches[0].id,
    date,
    title: matches[0].title,
  };
}

async function updateScheduleFromArguments(env, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw httpError(400, "arguments must be an object");
  }
  const patch = schedulePatchFromArguments(args);
  const target = await resolveScheduleUpdateTarget(env, args);
  const entry = await upsertCurriculumEntry(env, target.event_id, patch);
  return {
    event_id: target.event_id,
    date: target.date,
    title: target.title,
    updated_fields: Object.keys(patch),
    entry,
  };
}

async function updateSchedulesFromArguments(env, args) {
  if (!Array.isArray(args?.updates) || args.updates.length === 0) {
    throw httpError(400, "updates[] is required");
  }
  if (args.updates.length > 50) {
    throw httpError(400, "updates[] must contain at most 50 items");
  }

  // 対象特定と入力検証をすべて先に終え、明らかな入力エラーで途中更新しない。
  const prepared = [];
  for (const update of args.updates) {
    if (!update || typeof update !== "object" || Array.isArray(update)) {
      throw httpError(400, "each update must be an object");
    }
    prepared.push({
      target: await resolveScheduleUpdateTarget(env, update),
      patch: schedulePatchFromArguments(update),
    });
  }

  const eventIds = prepared.map(({ target }) => target.event_id);
  if (new Set(eventIds).size !== eventIds.length) {
    throw httpError(409, "updates[] contains duplicate schedules");
  }

  const results = [];
  for (const { target, patch } of prepared) {
    const entry = await upsertCurriculumEntry(env, target.event_id, patch);
    results.push({
      event_id: target.event_id,
      date: target.date,
      title: target.title,
      updated_fields: Object.keys(patch),
      entry,
    });
  }
  return { count: results.length, updates: results };
}

async function handleMcp(request, env, url) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  let message;
  try {
    message = await request.json();
  } catch {
    return mcpError(null, -32700, "Parse error");
  }

  const { id, method, params = {} } = message;
  if (method === "initialize") {
    return mcpResponse(id, {
      protocolVersion: params.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "works-schedule", version: "1.2.0" },
      instructions:
        "Use get_schedule to identify lessons, get_today_briefing to prepare for lessons, and get_unrecorded_lessons to find missing records. Use update_schedule for one lesson and update_schedules for multiple lessons. Dates use Asia/Tokyo. Update tools preserve fields that are not supplied; pass null to clear a text field.",
    });
  }
  if (method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }
  if (method === "tools/list") {
    return mcpResponse(id, { tools: MCP_SCHEDULE_TOOLS });
  }
  if (method !== "tools/call") {
    return mcpError(id, -32601, "Method not found");
  }

  try {
    await verifyMcpAccessToken(request, env);
  } catch (err) {
    if (err.status === 401) {
      return mcpJson(
        { error: "unauthorized" },
        401,
        {
          "WWW-Authenticate": `Bearer resource_metadata="${mcpBaseUrl(
            url
          )}/.well-known/oauth-protected-resource", scope="${MCP_SCOPE}"`,
        }
      );
    }
    throw err;
  }

  try {
    const args = params.arguments || {};
    if (params.name === "get_schedule") {
      const searchParams = new URLSearchParams();
      if (args.date) searchParams.set("date", String(args.date));
      if (args.include_excluded) searchParams.set("include_excluded", "true");
      return mcpToolResult(id, await readSchedule(env, searchParams));
    }
    if (params.name === "get_today_briefing") {
      return mcpToolResult(id, await readTodayBriefing(env, args));
    }
    if (params.name === "get_unrecorded_lessons") {
      return mcpToolResult(id, await readUnrecordedLessons(env, args));
    }
    if (params.name === "update_schedule") {
      return mcpToolResult(id, await updateScheduleFromArguments(env, args));
    }
    if (params.name === "update_schedules") {
      return mcpToolResult(id, await updateSchedulesFromArguments(env, args));
    }
    return mcpError(id, -32602, "Unknown tool");
  } catch (err) {
    return mcpToolFailure(id, err);
  }
}

function todayInScheduleTimeZone(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function scheduleDateRange(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw httpError(400, "date must be YYYY-MM-DD");
  }
  const [year, month, day] = date.split("-").map(Number);
  const midnightUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    midnightUtc.getUTCFullYear() !== year ||
    midnightUtc.getUTCMonth() !== month - 1 ||
    midnightUtc.getUTCDate() !== day
  ) {
    throw httpError(400, "date is invalid");
  }
  const start = new Date(midnightUtc.getTime() - SCHEDULE_UTC_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

function shiftScheduleDate(date, days) {
  scheduleDateRange(date);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function readBoundedInteger(value, fallback, minimum, maximum, fieldName) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw httpError(
      400,
      `${fieldName} must be an integer between ${minimum} and ${maximum}`
    );
  }
  return number;
}

async function fetchCalendarEventsForSchedule(accessToken, calendarId, timeMin, timeMax) {
  const events = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      timeZone: SCHEDULE_TIME_ZONE,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      showDeleted: "false",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      throw httpError(502, `Google Calendar API error (${res.status})`);
    }
    const data = await res.json();
    events.push(...(data.items || []).map((event) => ({ ...event, calendar_id: calendarId })));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return events;
}

async function readScheduleEvents(
  env,
  startDate,
  endDate,
  includeExcluded = false
) {
  const { timeMin } = scheduleDateRange(startDate);
  const { timeMax } = scheduleDateRange(endDate);
  if (timeMin >= timeMax) {
    throw httpError(400, "start_date must be on or before end_date");
  }
  const settings = await readSettings(env);
  const calendarIds = Array.isArray(settings.selected_calendars)
    ? [...new Set(settings.selected_calendars.map(String).filter(Boolean))]
    : [];
  if (calendarIds.length === 0) {
    throw httpError(409, "selected calendars are not configured");
  }
  const token = await mintGoogleAccessToken(env);
  const eventGroups = await Promise.all(
    calendarIds.map((calendarId) =>
      fetchCalendarEventsForSchedule(token.access_token, calendarId, timeMin, timeMax)
    )
  );
  const excludedTitles = new Set(
    Array.isArray(settings.excluded_titles)
      ? settings.excluded_titles.map((title) => String(title).trim())
      : []
  );
  const details = new Map(
    (await readCurriculumEntries(env)).map((entry) => [entry.calendar_event_id, entry])
  );
  return eventGroups
    .flat()
    .filter((event) => event.status !== "cancelled")
    .filter(
      (event) =>
        includeExcluded || !excludedTitles.has(String(event.summary || "").trim())
    )
    .sort((left, right) => {
      const leftStart = left.start?.dateTime || left.start?.date || "";
      const rightStart = right.start?.dateTime || right.start?.date || "";
      return leftStart.localeCompare(rightStart);
    })
    .map((event) => {
      const detail = details.get(event.id) || {};
      return {
        id: event.id,
        calendar_id: event.calendar_id,
        title: String(event.summary || "(無題)").trim(),
        start: event.start?.dateTime || event.start?.date || null,
        end: event.end?.dateTime || event.end?.date || null,
        all_day: Boolean(event.start?.date && !event.start?.dateTime),
        completed: Boolean(detail.completed),
        lesson_plan: detail.lesson_plan || null,
        confirmation_test: detail.confirmation_test || null,
        homework: detail.homework || null,
        lesson_memo: detail.lesson_memo || null,
      };
    });
}

async function readSchedule(env, searchParams) {
  const date = (searchParams.get("date") || todayInScheduleTimeZone()).trim();
  const includeExcluded = ["1", "true"].includes(
    (searchParams.get("include_excluded") || "").toLowerCase()
  );
  const events = await readScheduleEvents(env, date, date, includeExcluded);
  return {
    date,
    time_zone: SCHEDULE_TIME_ZONE,
    count: events.length,
    events,
    generated_at: new Date().toISOString(),
  };
}

function scheduleMissingFields(event) {
  return SCHEDULE_TEXT_FIELDS.filter((field) => !event[field]);
}

async function readTodayBriefing(env, args = {}) {
  const date = String(args.date || todayInScheduleTimeZone()).trim();
  scheduleDateRange(date);
  const previousLookbackDays = readBoundedInteger(
    args.previous_lookback_days,
    90,
    1,
    365,
    "previous_lookback_days"
  );
  const startDate = shiftScheduleDate(date, -previousLookbackDays);
  const events = await readScheduleEvents(env, startDate, date, false);
  const { timeMin, timeMax } = scheduleDateRange(date);
  const dayStart = Date.parse(timeMin);
  const dayEnd = Date.parse(timeMax);
  const currentEvents = events.filter((event) => {
    const start = Date.parse(event.start || "");
    return Number.isFinite(start) && start >= dayStart && start < dayEnd;
  });

  const lessons = currentEvents.map((event) => {
    const currentStart = Date.parse(event.start || "");
    const previousLesson = events
      .filter(
        (candidate) =>
          candidate.id !== event.id &&
          candidate.title === event.title &&
          Date.parse(candidate.start || "") < currentStart
      )
      .sort(
        (left, right) =>
          Date.parse(right.start || "") - Date.parse(left.start || "")
      )[0];

    return {
      ...event,
      missing_fields: scheduleMissingFields(event),
      previous_lesson: previousLesson
        ? {
            id: previousLesson.id,
            start: previousLesson.start,
            completed: previousLesson.completed,
            lesson_plan: previousLesson.lesson_plan,
            confirmation_test: previousLesson.confirmation_test,
            homework: previousLesson.homework,
            lesson_memo: previousLesson.lesson_memo,
          }
        : null,
    };
  });

  return {
    date,
    time_zone: SCHEDULE_TIME_ZONE,
    previous_lookback_days: previousLookbackDays,
    count: lessons.length,
    lessons,
    generated_at: new Date().toISOString(),
  };
}

async function readUnrecordedLessons(env, args = {}) {
  const endDate = String(args.end_date || todayInScheduleTimeZone()).trim();
  scheduleDateRange(endDate);
  const lookbackDays = readBoundedInteger(
    args.lookback_days,
    7,
    1,
    90,
    "lookback_days"
  );
  const startDate = shiftScheduleDate(endDate, -(lookbackDays - 1));
  const events = await readScheduleEvents(env, startDate, endDate, false);
  const now = Date.now();
  const lessons = events
    .filter((event) => {
      const end = Date.parse(event.end || "");
      return !event.all_day && Number.isFinite(end) && end < now && !event.completed;
    })
    .map((event) => ({
      ...event,
      missing_fields: scheduleMissingFields(event),
    }));

  return {
    start_date: startDate,
    end_date: endDate,
    time_zone: SCHEDULE_TIME_ZONE,
    lookback_days: lookbackDays,
    count: lessons.length,
    lessons,
    generated_at: new Date().toISOString(),
  };
}

// --- 認証: Googleの認可コードをリフレッシュトークンに交換してDBに保存し、
// このWorker自身が発行する署名付きセッショントークンでAPIアクセスを認可する。
// ブラウザはGoogleの生アクセストークンを長期間保持しないため、タブの
// バックグラウンド挙動やサードパーティCookie制限に影響されずログイン状態を保てる。

function toBase64Url(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64);
}

async function hmacSign(env, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return toBase64Url(new Uint8Array(sig));
}

const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

async function createSessionToken(env, email) {
  const payload = JSON.stringify({ email, exp: Date.now() + SESSION_MAX_AGE_MS });
  const payloadB64 = toBase64Url(new TextEncoder().encode(payload));
  const sig = await hmacSign(env, payloadB64);
  return `${payloadB64}.${sig}`;
}

async function verifySession(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) throw new Error("missing bearer token");

  const [payloadB64, sig] = match[1].split(".");
  if (!payloadB64 || !sig) throw new Error("invalid session");
  const expectedSig = await hmacSign(env, payloadB64);
  if (sig !== expectedSig) throw new Error("invalid session");

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64));
  } catch {
    throw new Error("invalid session");
  }
  if (!payload.email || !payload.exp || payload.exp < Date.now()) {
    throw new Error("session expired");
  }
  if (payload.email.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) {
    throw new Error("not authorized");
  }
  return payload;
}

async function exchangeAuthCode(env, code, redirectUri) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Googleとのトークン交換に失敗しました: ${await res.text()}`);
  return res.json();
}

function decodeIdToken(idToken) {
  const payloadB64 = idToken.split(".")[1];
  return JSON.parse(fromBase64Url(payloadB64));
}

async function saveRefreshToken(env, refreshToken) {
  await env.DB.prepare(
    `INSERT INTO google_auth (id, refresh_token, updated_at) VALUES (1, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET refresh_token = excluded.refresh_token, updated_at = excluded.updated_at`
  )
    .bind(refreshToken)
    .run();
}

async function loadRefreshToken(env) {
  const row = await env.DB.prepare("SELECT refresh_token FROM google_auth WHERE id = 1").first();
  return row?.refresh_token || null;
}

async function clearRefreshToken(env) {
  const refreshToken = await loadRefreshToken(env);
  if (refreshToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
        method: "POST",
      });
    } catch {
      // revoke失敗はログアウト自体を妨げない(サーバー側の保存分は次で消す)
    }
  }
  await env.DB.prepare("DELETE FROM google_auth WHERE id = 1").run();
}

// 保存済みのリフレッシュトークンから、Googleカレンダー呼び出し用の新しい
// アクセストークンをその都度発行する(ブラウザはこれをキャッシュして使う)。
async function mintGoogleAccessToken(env) {
  const refreshToken = await loadRefreshToken(env);
  if (!refreshToken) {
    throw new Error("Googleカレンダーへの認可がありません。再度ログインしてください。");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`アクセストークンの更新に失敗しました: ${await res.text()}`);
  return res.json();
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
  const existing =
    (await env.DB.prepare(
      "SELECT * FROM curriculum_entries WHERE calendar_event_id = ?"
    )
      .bind(eventId)
      .first()) || {};

  const completed =
    body.completed !== undefined
      ? body.completed
        ? 1
        : 0
      : existing.completed
        ? 1
        : 0;
  const values = {};
  for (const field of SCHEDULE_TEXT_FIELDS) {
    values[field] =
      body[field] !== undefined ? body[field] || null : existing[field] || null;
  }

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
      completed,
      values.lesson_plan,
      values.confirmation_test,
      values.homework,
      values.lesson_memo
    )
    .run();
  return env.DB.prepare(
    "SELECT * FROM curriculum_entries WHERE calendar_event_id = ?"
  )
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
  const existing = await env.DB.prepare("SELECT * FROM student_prefs WHERE name = ?")
    .bind(name)
    .first();
  const printName = body.print_name !== undefined ? body.print_name : existing?.print_name ?? null;
  const memo = body.memo !== undefined ? body.memo : existing?.memo ?? null;
  await env.DB.prepare(
    `INSERT INTO student_prefs (name, print_name, memo, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET print_name = excluded.print_name, memo = excluded.memo, updated_at = excluded.updated_at`
  )
    .bind(name, printName, memo)
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


// 入試管理: 入試日程はD1に保存し、一覧・表・カレンダー・ガントで共通利用する。
let admissionSchemaReady = null;

async function ensureAdmissionSchema(env) {
  if (!admissionSchemaReady) {
    admissionSchemaReady = (async () => {
      await env.DB.batch([
        env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS admission_events (" +
            "id TEXT PRIMARY KEY, university TEXT NOT NULL, selection_type TEXT NOT NULL DEFAULT 'general', " +
            "stage TEXT NOT NULL, schedule_date TEXT NOT NULL, end_date TEXT, notes TEXT, source_url TEXT, " +
            "color TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
        ),
        env.DB.prepare(
          "CREATE INDEX IF NOT EXISTS idx_admission_events_date ON admission_events(schedule_date)"
        ),
        env.DB.prepare(
          "CREATE INDEX IF NOT EXISTS idx_admission_events_stage ON admission_events(stage)"
        ),
      ]);
    })().catch((err) => {
      admissionSchemaReady = null;
      throw err;
    });
  }
  await admissionSchemaReady;
}


const ADMISSION_SOURCE_2027 = "https://medika.jp/free/2027medical-exam-schedule-list";

function scheduleSeed(university, selectionType, stage, dates, notes = "") {
  return dates.map((schedule_date) => ({ university, selectionType, stage, schedule_date, notes }));
}

const INITIAL_ADMISSION_EVENTS_2027 = [
  ...scheduleSeed("産業医科大学医学部（A方式）", "ct", "primary", ["2027-01-16", "2027-01-17", "2027-02-14"], "共通テスト＋個別学力検査"),
  ...scheduleSeed("産業医科大学医学部（A方式）", "ct", "first_result", ["2027-02-26"], "二次受験資格"),
  ...scheduleSeed("産業医科大学医学部（A方式）", "ct", "secondary", ["2027-03-12"], "小論文・面接"),
  ...scheduleSeed("産業医科大学医学部（A方式）", "ct", "final_result", ["2027-03-19"]),
  ...scheduleSeed("産業医科大学医学部（C方式）", "ct", "primary", ["2027-01-16", "2027-01-17"], "共通テスト利用"),
  ...scheduleSeed("産業医科大学医学部（C方式）", "ct", "first_result", ["2027-03-04"], "二次受験資格"),
  ...scheduleSeed("産業医科大学医学部（C方式）", "ct", "secondary", ["2027-03-12"], "小論文・面接"),
  ...scheduleSeed("産業医科大学医学部（C方式）", "ct", "final_result", ["2027-03-19"]),
  ...scheduleSeed("帝京大学医学部", "general", "primary", ["2027-01-21", "2027-01-22", "2027-01-23"], "一般選抜。一次は3日間から選択"),
  ...scheduleSeed("帝京大学医学部", "general", "first_result", ["2027-01-28"]),
  ...scheduleSeed("帝京大学医学部", "general", "secondary", ["2027-02-04", "2027-02-05"], "出願時選択"),
  ...scheduleSeed("帝京大学医学部", "general", "final_result", ["2027-02-13"]),
  ...scheduleSeed("国際医療福祉大学医学部", "general", "primary", ["2027-01-25"]),
  ...scheduleSeed("国際医療福祉大学医学部", "general", "first_result", ["2027-01-29"]),
  ...scheduleSeed("国際医療福祉大学医学部", "general", "secondary", ["2027-02-01", "2027-02-02", "2027-02-03", "2027-02-04", "2027-02-05", "2027-02-06"], "大学指定"),
  ...scheduleSeed("国際医療福祉大学医学部", "general", "final_result", ["2027-02-12"]),
  ...scheduleSeed("自治医科大学医学部", "regional", "primary", ["2027-01-25", "2027-01-26"], "学力試験・面接。出願都道府県で手続"),
  ...scheduleSeed("自治医科大学医学部", "regional", "first_result", ["2027-01-29"]),
  ...scheduleSeed("自治医科大学医学部", "regional", "secondary", ["2027-02-03"]),
  ...scheduleSeed("自治医科大学医学部", "regional", "final_result", ["2027-02-12"]),
  ...scheduleSeed("近畿大学医学部（前期）", "general", "primary", ["2027-01-31"]),
  ...scheduleSeed("近畿大学医学部（前期）", "general", "first_result", ["2027-02-10"]),
  ...scheduleSeed("近畿大学医学部（前期）", "general", "secondary", ["2027-02-14"]),
  ...scheduleSeed("近畿大学医学部（前期）", "general", "final_result", ["2027-02-23"]),
  ...scheduleSeed("川崎医科大学医学部", "regional", "primary", ["2027-02-01"], "岡山県地域枠を含む"),
  ...scheduleSeed("川崎医科大学医学部", "regional", "first_result", ["2027-02-04"]),
  ...scheduleSeed("川崎医科大学医学部", "regional", "secondary", ["2027-02-10", "2027-02-11"], "大学指定日"),
  ...scheduleSeed("川崎医科大学医学部", "regional", "final_result", ["2027-02-13"]),
  ...scheduleSeed("東京女子医科大学医学部", "general", "primary", ["2027-02-01"]),
  ...scheduleSeed("東京女子医科大学医学部", "general", "first_result", ["2027-02-08"]),
  ...scheduleSeed("東京女子医科大学医学部", "general", "secondary", ["2027-02-13", "2027-02-14", "2027-02-15"], "希望日を提出"),
  ...scheduleSeed("東京女子医科大学医学部", "general", "final_result", ["2027-02-19"]),
  ...scheduleSeed("日本医科大学医学部（前期）", "regional", "primary", ["2027-02-01"], "地域枠前期を含む"),
  ...scheduleSeed("日本医科大学医学部（前期）", "regional", "first_result", ["2027-02-08"]),
  ...scheduleSeed("日本医科大学医学部（前期）", "regional", "secondary", ["2027-02-10", "2027-02-12"], "希望日を提出"),
  ...scheduleSeed("日本医科大学医学部（前期）", "regional", "final_result", ["2027-02-16"]),
  ...scheduleSeed("杏林大学医学部", "general", "primary", ["2027-02-02"]),
  ...scheduleSeed("杏林大学医学部", "general", "first_result", ["2027-02-08"]),
  ...scheduleSeed("杏林大学医学部", "general", "secondary", ["2027-02-11", "2027-02-12"], "大学指定日"),
  ...scheduleSeed("杏林大学医学部", "general", "final_result", ["2027-02-17"]),
  ...scheduleSeed("北里大学医学部", "regional", "primary", ["2027-02-02"], "相模原市修学資金枠を含む"),
  ...scheduleSeed("北里大学医学部", "regional", "first_result", ["2027-02-08"]),
  ...scheduleSeed("北里大学医学部", "regional", "secondary", ["2027-02-13", "2027-02-14", "2027-02-15"], "相模原市枠は2/13・14から選択"),
  ...scheduleSeed("北里大学医学部", "regional", "final_result", ["2027-02-17"]),
  ...scheduleSeed("順天堂大学医学部（A方式）", "general", "primary", ["2027-02-03"]),
  ...scheduleSeed("順天堂大学医学部（A方式）", "general", "first_result", ["2027-02-10"]),
  ...scheduleSeed("順天堂大学医学部（A方式）", "general", "secondary", ["2027-02-14", "2027-02-15", "2027-02-16"], "大学指定日"),
  ...scheduleSeed("順天堂大学医学部（A方式）", "general", "final_result", ["2027-02-20"]),
  ...scheduleSeed("岩手医科大学医学部", "regional", "primary", ["2027-02-03"], "一般枠・地域枠C・地域枠D"),
  ...scheduleSeed("岩手医科大学医学部", "regional", "first_result", ["2027-02-09"]),
  ...scheduleSeed("岩手医科大学医学部", "regional", "secondary", ["2027-02-12", "2027-02-13"], "いずれか1日"),
  ...scheduleSeed("岩手医科大学医学部", "regional", "final_result", ["2027-02-18"]),
  ...scheduleSeed("金沢医科大学医学部（前期）", "general", "primary", ["2027-02-03", "2027-02-04"]),
  ...scheduleSeed("金沢医科大学医学部（前期）", "general", "first_result", ["2027-02-10"]),
  ...scheduleSeed("金沢医科大学医学部（前期）", "general", "secondary", ["2027-02-17", "2027-02-18"], "希望する1日"),
  ...scheduleSeed("金沢医科大学医学部（前期）", "general", "final_result", ["2027-02-22"]),
  ...scheduleSeed("東北医科薬科大学医学部", "general", "primary", ["2027-02-04"]),
  ...scheduleSeed("東北医科薬科大学医学部", "general", "first_result", ["2027-02-12"]),
  ...scheduleSeed("東北医科薬科大学医学部", "general", "secondary", ["2027-02-20", "2027-02-21"], "大学指定日"),
  ...scheduleSeed("東北医科薬科大学医学部", "general", "final_result", ["2027-02-25"]),
  ...scheduleSeed("藤田医科大学医学部", "general", "primary", ["2027-02-04"]),
  ...scheduleSeed("藤田医科大学医学部", "general", "first_result", ["2027-02-09"]),
  ...scheduleSeed("藤田医科大学医学部", "general", "secondary", ["2027-02-14", "2027-02-15"], "いずれか1日"),
  ...scheduleSeed("藤田医科大学医学部", "general", "final_result", ["2027-02-18"]),
  ...scheduleSeed("兵庫医科大学医学部（A方式）", "regional", "primary", ["2027-02-04"], "兵庫県推薦入学制度枠を含む"),
  ...scheduleSeed("兵庫医科大学医学部（A方式）", "regional", "first_result", ["2027-02-15"]),
  ...scheduleSeed("兵庫医科大学医学部（A方式）", "regional", "secondary", ["2027-02-17", "2027-02-18"], "出願時選択"),
  ...scheduleSeed("兵庫医科大学医学部（A方式）", "regional", "final_result", ["2027-02-24"]),
  ...scheduleSeed("東京医科大学医学部", "general", "primary", ["2027-02-06"]),
  ...scheduleSeed("東京医科大学医学部", "general", "first_result", ["2027-02-11"]),
  ...scheduleSeed("東京医科大学医学部", "general", "secondary", ["2027-02-13", "2027-02-14"], "出願順に大学指定"),
  ...scheduleSeed("東京医科大学医学部", "general", "final_result", ["2027-02-18"]),
  ...scheduleSeed("愛知医科大学医学部", "general", "primary", ["2027-02-09"]),
  ...scheduleSeed("愛知医科大学医学部", "general", "first_result", ["2027-02-15"]),
  ...scheduleSeed("愛知医科大学医学部", "general", "secondary", ["2027-02-18", "2027-02-19", "2027-02-20"], "希望日選択"),
  ...scheduleSeed("愛知医科大学医学部", "general", "final_result", ["2027-02-24"]),
  ...scheduleSeed("慶應義塾大学医学部", "general", "primary", ["2027-02-09"]),
  ...scheduleSeed("慶應義塾大学医学部", "general", "first_result", ["2027-02-19"]),
  ...scheduleSeed("慶應義塾大学医学部", "general", "secondary", ["2027-03-01"]),
  ...scheduleSeed("慶應義塾大学医学部", "general", "final_result", ["2027-03-05"]),
  ...scheduleSeed("大阪医科薬科大学医学部（前期）", "regional", "primary", ["2027-02-10"], "大阪府地域枠を含む"),
  ...scheduleSeed("大阪医科薬科大学医学部（前期）", "regional", "first_result", ["2027-02-17"]),
  ...scheduleSeed("大阪医科薬科大学医学部（前期）", "regional", "secondary", ["2027-02-19"]),
  ...scheduleSeed("大阪医科薬科大学医学部（前期）", "regional", "final_result", ["2027-02-20"]),
  ...scheduleSeed("東京慈恵会医科大学医学部", "general", "primary", ["2027-02-11"]),
  ...scheduleSeed("東京慈恵会医科大学医学部", "general", "first_result", ["2027-02-17"]),
  ...scheduleSeed("東京慈恵会医科大学医学部", "general", "secondary", ["2027-02-20", "2027-02-21", "2027-02-22"], "大学指定日"),
  ...scheduleSeed("東京慈恵会医科大学医学部", "general", "final_result", ["2027-03-01"]),
  ...scheduleSeed("獨協医科大学医学部（前期）", "regional", "primary", ["2027-02-12", "2027-02-13"], "栃木県・新潟県地域枠を含む"),
  ...scheduleSeed("獨協医科大学医学部（前期）", "regional", "first_result", ["2027-02-16"]),
  ...scheduleSeed("獨協医科大学医学部（前期）", "regional", "secondary", ["2027-02-19", "2027-02-20"]),
  ...scheduleSeed("獨協医科大学医学部（前期）", "regional", "final_result", ["2027-02-26"]),
  ...scheduleSeed("日本医科大学医学部（後期）", "regional", "primary", ["2027-02-28"], "地域枠後期を含む"),
  ...scheduleSeed("日本医科大学医学部（後期）", "regional", "first_result", ["2027-03-06"]),
  ...scheduleSeed("日本医科大学医学部（後期）", "regional", "secondary", ["2027-03-09"]),
  ...scheduleSeed("日本医科大学医学部（後期）", "regional", "final_result", ["2027-03-15"]),
  ...scheduleSeed("東京医科大学医学部（推薦・地域枠）", "recommendation", "primary", ["2026-11-28"], "学校推薦型・地域枠・全国ブロック別。小論文・基礎学力検査"),
  ...scheduleSeed("東京医科大学医学部（推薦・地域枠）", "recommendation", "first_result", ["2026-12-03"], "基礎学力検査合格発表"),
  ...scheduleSeed("東京医科大学医学部（推薦・地域枠）", "recommendation", "secondary", ["2026-12-12"], "面接（MMI）"),
  ...scheduleSeed("東京医科大学医学部（推薦・地域枠）", "recommendation", "final_result", ["2026-12-17"]),
  ...scheduleSeed("東京女子医科大学医学部（総合型）", "comprehensive", "primary", ["2026-10-18"]),
  ...scheduleSeed("東京女子医科大学医学部（総合型）", "comprehensive", "first_result", ["2026-10-27"]),
  ...scheduleSeed("東京女子医科大学医学部（総合型）", "comprehensive", "secondary", ["2026-10-31"]),
  ...scheduleSeed("東京女子医科大学医学部（総合型）", "comprehensive", "final_result", ["2026-11-06"]),
  ...scheduleSeed("東京女子医科大学医学部（一般推薦）", "recommendation", "primary", ["2026-11-21", "2026-11-22"]),
  ...scheduleSeed("東京女子医科大学医学部（一般推薦）", "recommendation", "final_result", ["2026-12-04"]),
  ...scheduleSeed("聖マリアンナ医科大学医学部（推薦・神奈川県地域枠）", "recommendation", "primary", ["2026-11-14"]),
  ...scheduleSeed("聖マリアンナ医科大学医学部（推薦・神奈川県地域枠）", "recommendation", "final_result", ["2026-12-01"]),
  ...scheduleSeed("帝京大学医学部（公募推薦）", "recommendation", "primary", ["2026-11-21"]),
  ...scheduleSeed("帝京大学医学部（公募推薦）", "recommendation", "final_result", ["2026-12-01"]),
  ...scheduleSeed("東北医科薬科大学医学部（総合型・東北地域定着枠）", "regional", "secondary", ["2026-10-24", "2026-10-25"], "一次は書類選考"),
  ...scheduleSeed("東北医科薬科大学医学部（総合型・東北地域定着枠）", "regional", "first_result", ["2026-10-16"]),
  ...scheduleSeed("東北医科薬科大学医学部（総合型・東北地域定着枠）", "regional", "final_result", ["2026-11-02"]),
  ...scheduleSeed("金沢医科大学医学部（総合型・指定地域）", "regional", "primary", ["2026-11-21"]),
  ...scheduleSeed("金沢医科大学医学部（総合型・指定地域）", "regional", "first_result", ["2026-11-26"]),
  ...scheduleSeed("金沢医科大学医学部（総合型・指定地域）", "regional", "secondary", ["2026-12-06"]),
  ...scheduleSeed("金沢医科大学医学部（総合型・指定地域）", "regional", "final_result", ["2026-12-10"]),
  ...scheduleSeed("藤田医科大学医学部（ふじた未来入試）", "comprehensive", "primary", ["2026-11-08"]),
  ...scheduleSeed("藤田医科大学医学部（ふじた未来入試）", "comprehensive", "first_result", ["2026-11-13"]),
  ...scheduleSeed("藤田医科大学医学部（ふじた未来入試）", "comprehensive", "secondary", ["2026-11-22"]),
  ...scheduleSeed("藤田医科大学医学部（ふじた未来入試）", "comprehensive", "final_result", ["2026-11-30"]),
  ...scheduleSeed("愛知医科大学医学部（公募推薦・愛知県地域特別枠）", "regional", "primary", ["2026-11-28"]),
  ...scheduleSeed("愛知医科大学医学部（公募推薦・愛知県地域特別枠）", "regional", "final_result", ["2026-12-10"]),
  ...scheduleSeed("産業医科大学医学部（学校推薦）", "recommendation", "primary", ["2026-12-02"]),
  ...scheduleSeed("産業医科大学医学部（学校推薦）", "recommendation", "final_result", ["2026-12-11"]),
].flat();

async function ensureInitialAdmissionSchedule(env) {
  await ensureAdmissionSchema(env);
  const seeded = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admission_seed_2027'").first();
  if (seeded) return;
  await env.DB.batch(INITIAL_ADMISSION_EVENTS_2027.map((event) =>
    env.DB.prepare(
      "INSERT INTO admission_events (id, university, selection_type, stage, schedule_date, notes, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      crypto.randomUUID(), event.university, event.selectionType, event.stage,
      event.schedule_date, event.notes || null, ADMISSION_SOURCE_2027
    )
  ));
  await writeSetting(env, "admission_seed_2027", { seeded_at: new Date().toISOString(), count: INITIAL_ADMISSION_EVENTS_2027.length });
}

async function readAdmissionEvents(env, year) {
  await ensureInitialAdmissionSchedule(env);
  const query = year
    ? env.DB.prepare("SELECT * FROM admission_events WHERE schedule_date LIKE ? ORDER BY schedule_date, university, stage").bind(String(year) + "-%")
    : env.DB.prepare("SELECT * FROM admission_events ORDER BY schedule_date, university, stage");
  const { results } = await query.all();
  return results;
}

async function createAdmissionEvent(env, body) {
  await ensureAdmissionSchema(env);
  const university = String(body.university || "").trim();
  const selectionType = String(body.selection_type || "general").trim();
  const stage = String(body.stage || "").trim();
  const scheduleDate = String(body.schedule_date || "").trim();
  const endDate = body.end_date ? String(body.end_date).trim() : null;
  if (!university || !stage || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
    throw new Error("university, stage, schedule_date are required");
  }
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("end_date must be YYYY-MM-DD");
  }
  const id = crypto.randomUUID();
  return env.DB.prepare(
    "INSERT INTO admission_events (id, university, selection_type, stage, schedule_date, end_date, notes, source_url, color) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
  ).bind(
    id, university, selectionType, stage, scheduleDate, endDate,
    body.notes ? String(body.notes).trim() : null,
    body.source_url ? String(body.source_url).trim() : null,
    body.color ? String(body.color).trim() : null
  ).first();
}

async function updateAdmissionEvent(env, id, body) {
  await ensureAdmissionSchema(env);
  const current = await env.DB.prepare("SELECT * FROM admission_events WHERE id = ?").bind(id).first();
  if (!current) throw new Error("入試日程が見つかりません");
  const university = body.university === undefined ? current.university : String(body.university || "").trim();
  const selectionType = body.selection_type === undefined ? current.selection_type : String(body.selection_type || "").trim();
  const stage = body.stage === undefined ? current.stage : String(body.stage || "").trim();
  const scheduleDate = body.schedule_date === undefined ? current.schedule_date : String(body.schedule_date || "").trim();
  const endDate = body.end_date === undefined ? current.end_date : (body.end_date ? String(body.end_date).trim() : null);
  if (!university || !stage || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
    throw new Error("university, stage, schedule_date are required");
  }
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("end_date must be YYYY-MM-DD");
  }
  return env.DB.prepare(
    "UPDATE admission_events SET university = ?, selection_type = ?, stage = ?, schedule_date = ?, end_date = ?, notes = ?, source_url = ?, color = ?, updated_at = datetime('now') WHERE id = ? RETURNING *"
  ).bind(
    university, selectionType, stage, scheduleDate, endDate,
    body.notes === undefined ? current.notes : (body.notes ? String(body.notes).trim() : null),
    body.source_url === undefined ? current.source_url : (body.source_url ? String(body.source_url).trim() : null),
    body.color === undefined ? current.color : (body.color ? String(body.color).trim() : null),
    id
  ).first();
}

async function deleteAdmissionEvent(env, id) {
  await ensureAdmissionSchema(env);
  await env.DB.prepare("DELETE FROM admission_events WHERE id = ?").bind(id).run();
}


/* --- 教材ライブラリ: D1にフォルダ/ファイル情報、R2にファイル本体を保存する。 --- */
let materialSchemaReady = null;

function getMaterialDb(env) {
  if (!env.MATERIALS_DB) throw new Error("MATERIALS_DB binding is not configured");
  return env.MATERIALS_DB;
}

function getMaterialBucket(env) {
  if (!env.MATERIALS_BUCKET) throw new Error("MATERIALS_BUCKET binding is not configured");
  return env.MATERIALS_BUCKET;
}

async function ensureMaterialSchema(env) {
  if (!materialSchemaReady) {
    const db = getMaterialDb(env);
    materialSchemaReady = (async () => {
      await db.batch([
        db.prepare(
          "CREATE TABLE IF NOT EXISTS material_folders (" +
            "id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0, " +
            "created_at TEXT NOT NULL DEFAULT (datetime('now')))"
        ),
        db.prepare(
          "CREATE TABLE IF NOT EXISTS material_files (" +
            "id TEXT PRIMARY KEY, folder_id TEXT, name TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, " +
            "mime_type TEXT, size INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, " +
            "created_at TEXT NOT NULL DEFAULT (datetime('now')))"
        ),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_material_folders_parent ON material_folders(parent_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_material_files_folder ON material_files(folder_id)"),
      ]);
      const [folderInfo, fileInfo] = await Promise.all([
        db.prepare("PRAGMA table_info(material_folders)").all(),
        db.prepare("PRAGMA table_info(material_files)").all(),
      ]);
      if (!folderInfo.results.some((column) => column.name === "sort_order")) {
        await db.prepare("ALTER TABLE material_folders ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0").run();
      }
      if (!fileInfo.results.some((column) => column.name === "sort_order")) {
        await db.prepare("ALTER TABLE material_files ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0").run();
      }
    })().catch((err) => {
      materialSchemaReady = null;
      throw err;
    });
  }
  await materialSchemaReady;
}

async function readMaterialFolders(env) {
  await ensureMaterialSchema(env);
  const { results } = await getMaterialDb(env)
    .prepare(
      "SELECT f.*, " +
        "(SELECT COUNT(*) FROM material_folders c WHERE c.parent_id = f.id) AS folder_count, " +
        "(SELECT COUNT(*) FROM material_files m WHERE m.folder_id = f.id) AS file_count " +
        "FROM material_folders f ORDER BY COALESCE(f.parent_id, ''), f.sort_order, f.name COLLATE NOCASE"
    )
    .all();
  return results;
}

async function createMaterialFolder(env, body) {
  await ensureMaterialSchema(env);
  const db = getMaterialDb(env);
  const name = String(body.name || "").trim();
  const parentId = body.parent_id || null;
  if (!name) throw new Error("フォルダ名を入力してください");
  if (name.length > 120) throw new Error("フォルダ名は120文字以内にしてください");

  if (parentId) {
    const parent = await db.prepare("SELECT id FROM material_folders WHERE id = ?").bind(parentId).first();
    if (!parent) throw new Error("保存先フォルダが見つかりません");
  }
  const duplicate = await db
    .prepare("SELECT id FROM material_folders WHERE name = ? AND ((parent_id = ?) OR (parent_id IS NULL AND ? IS NULL))")
    .bind(name, parentId, parentId).first();
  if (duplicate) throw new Error("同じ場所に同名のフォルダがあります");

  const next = await db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM material_folders WHERE ((parent_id = ?) OR (parent_id IS NULL AND ? IS NULL))")
    .bind(parentId, parentId).first();
  const id = crypto.randomUUID();
  return db.prepare(
    "INSERT INTO material_folders (id, name, parent_id, sort_order) VALUES (?, ?, ?, ?) RETURNING *"
  ).bind(id, name, parentId, Number(next.value || 0)).first();
}

async function updateMaterialFolder(env, id, body) {
  await ensureMaterialSchema(env);
  const db = getMaterialDb(env);
  const current = await db.prepare("SELECT * FROM material_folders WHERE id = ?").bind(id).first();
  if (!current) throw new Error("フォルダが見つかりません");

  const name = body.name === undefined ? current.name : String(body.name || "").trim();
  const parentId = body.parent_id === undefined ? (current.parent_id || null) : (body.parent_id || null);
  if (!name) throw new Error("フォルダ名を入力してください");
  if (name.length > 120) throw new Error("フォルダ名は120文字以内にしてください");
  if (parentId === id) throw new Error("フォルダ自身の中には移動できません");

  if (parentId) {
    let cursor = await db.prepare("SELECT id, parent_id FROM material_folders WHERE id = ?").bind(parentId).first();
    if (!cursor) throw new Error("移動先フォルダが見つかりません");
    while (cursor) {
      if (cursor.id === id) throw new Error("子フォルダの中には移動できません");
      cursor = cursor.parent_id
        ? await db.prepare("SELECT id, parent_id FROM material_folders WHERE id = ?").bind(cursor.parent_id).first()
        : null;
    }
  }

  const duplicate = await db.prepare(
    "SELECT id FROM material_folders WHERE id != ? AND name = ? AND ((parent_id = ?) OR (parent_id IS NULL AND ? IS NULL))"
  ).bind(id, name, parentId, parentId).first();
  if (duplicate) throw new Error("同じ場所に同名のフォルダがあります");

  let sortOrder = current.sort_order;
  if ((current.parent_id || null) !== parentId) {
    const next = await db.prepare(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM material_folders WHERE ((parent_id = ?) OR (parent_id IS NULL AND ? IS NULL))"
    ).bind(parentId, parentId).first();
    sortOrder = Number(next.value || 0);
  }
  return db.prepare(
    "UPDATE material_folders SET name = ?, parent_id = ?, sort_order = ? WHERE id = ? RETURNING *"
  ).bind(name, parentId, sortOrder, id).first();
}

async function reorderMaterialFolders(env, body) {
  await ensureMaterialSchema(env);
  const db = getMaterialDb(env);
  const parentId = body.parent_id || null;
  const order = Array.isArray(body.order) ? body.order.map(String) : [];
  const { results } = await db.prepare(
    "SELECT id FROM material_folders WHERE ((parent_id = ?) OR (parent_id IS NULL AND ? IS NULL))"
  ).bind(parentId, parentId).all();
  const existing = new Set(results.map((row) => row.id));
  if (order.length !== existing.size || order.some((id) => !existing.has(id)) || new Set(order).size !== order.length) {
    throw new Error("フォルダの並び順が正しくありません");
  }
  if (order.length) {
    await db.batch(order.map((id, index) =>
      db.prepare("UPDATE material_folders SET sort_order = ? WHERE id = ?").bind(index, id)
    ));
  }
  return { ok: true };
}

async function deleteMaterialFolder(env, id) {
  await ensureMaterialSchema(env);
  const db = getMaterialDb(env);
  const [child, file] = await Promise.all([
    db.prepare("SELECT id FROM material_folders WHERE parent_id = ? LIMIT 1").bind(id).first(),
    db.prepare("SELECT id FROM material_files WHERE folder_id = ? LIMIT 1").bind(id).first(),
  ]);
  if (child || file) throw new Error("中身のあるフォルダは削除できません");
  await db.prepare("DELETE FROM material_folders WHERE id = ?").bind(id).run();
}

async function readMaterialFiles(env, folderId) {
  await ensureMaterialSchema(env);
  const { results } = await getMaterialDb(env)
    .prepare(
      "SELECT * FROM material_files WHERE " +
        "((folder_id = ?) OR (folder_id IS NULL AND ? IS NULL)) " +
        "ORDER BY sort_order, name COLLATE NOCASE"
    )
    .bind(folderId, folderId)
    .all();
  return results;
}

async function readAllMaterialFiles(env) {
  await ensureMaterialSchema(env);
  const { results } = await getMaterialDb(env)
    .prepare("SELECT * FROM material_files ORDER BY COALESCE(folder_id, ''), sort_order, name COLLATE NOCASE")
    .all();
  return results;
}

async function uploadMaterialFile(request, env, url) {
  await ensureMaterialSchema(env);
  const db = getMaterialDb(env);
  const bucket = getMaterialBucket(env);
  const name = String(url.searchParams.get("name") || "").trim();
  const folderId = url.searchParams.get("folder_id") || null;
  const size = Number(url.searchParams.get("size") || 0);
  const mimeType = request.headers.get("Content-Type") || "application/octet-stream";

  if (!name) throw new Error("ファイル名がありません");
  if (!request.body && size > 0) throw new Error("ファイル本体がありません");
  if (folderId) {
    const folder = await db.prepare("SELECT id FROM material_folders WHERE id = ?").bind(folderId).first();
    if (!folder) throw new Error("保存先フォルダが見つかりません");
  }

  const next = await db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM material_files WHERE ((folder_id = ?) OR (folder_id IS NULL AND ? IS NULL))"
  ).bind(folderId, folderId).first();
  const id = crypto.randomUUID();
  const objectKey = "materials/" + id;
  await bucket.put(objectKey, request.body || new Uint8Array(), {
    httpMetadata: { contentType: mimeType },
    customMetadata: { originalName: name },
  });

  try {
    return await db
      .prepare(
        "INSERT INTO material_files (id, folder_id, name, object_key, mime_type, size, sort_order) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *"
      )
      .bind(id, folderId, name, objectKey, mimeType, Number.isFinite(size) ? size : 0, Number(next.value || 0))
      .first();
  } catch (err) {
    await bucket.delete(objectKey);
    throw err;
  }
}

async function downloadMaterialFile(env, id, disposition = "attachment") {
  await ensureMaterialSchema(env);
  const row = await getMaterialDb(env)
    .prepare("SELECT * FROM material_files WHERE id = ?")
    .bind(id)
    .first();
  if (!row) return null;

  const object = await getMaterialBucket(env).get(row.object_key);
  if (!object) return null;

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set(
    "Content-Disposition",
    disposition + "; filename*=UTF-8''" + encodeURIComponent(row.name)
  );
  headers.set("Cache-Control", "private, no-store");
  return new Response(object.body, { headers });
}

async function updateMaterialFile(env, id, body) {
  await ensureMaterialSchema(env);
  const db = getMaterialDb(env);
  const current = await db.prepare("SELECT * FROM material_files WHERE id = ?").bind(id).first();
  if (!current) throw new Error("ファイルが見つかりません");

  const fields = [];
  const values = [];
  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("ファイル名を入力してください");
    if (name.length > 255) throw new Error("ファイル名は255文字以内にしてください");
    fields.push("name = ?");
    values.push(name);
  }
  if (body.folder_id !== undefined) {
    const folderId = body.folder_id || null;
    if (folderId) {
      const folder = await db.prepare("SELECT id FROM material_folders WHERE id = ?").bind(folderId).first();
      if (!folder) throw new Error("移動先フォルダが見つかりません");
    }
    fields.push("folder_id = ?");
    values.push(folderId);
    if ((current.folder_id || null) !== folderId) {
      const next = await db.prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM material_files WHERE ((folder_id = ?) OR (folder_id IS NULL AND ? IS NULL))"
      ).bind(folderId, folderId).first();
      fields.push("sort_order = ?");
      values.push(Number(next.value || 0));
    }
  }
  if (!fields.length) throw new Error("変更内容がありません");
  values.push(id);
  return db.prepare(
    "UPDATE material_files SET " + fields.join(", ") + " WHERE id = ? RETURNING *"
  ).bind(...values).first();
}

async function reorderMaterialFiles(env, body) {
  await ensureMaterialSchema(env);
  const db = getMaterialDb(env);
  const folderId = body.folder_id || null;
  const order = Array.isArray(body.order) ? body.order.map(String) : [];
  const { results } = await db.prepare(
    "SELECT id FROM material_files WHERE ((folder_id = ?) OR (folder_id IS NULL AND ? IS NULL))"
  ).bind(folderId, folderId).all();
  const existing = new Set(results.map((row) => row.id));
  if (order.length !== existing.size || order.some((id) => !existing.has(id)) || new Set(order).size !== order.length) {
    throw new Error("ファイルの並び順が正しくありません");
  }
  if (order.length) {
    await db.batch(order.map((id, index) =>
      db.prepare("UPDATE material_files SET sort_order = ? WHERE id = ?").bind(index, id)
    ));
  }
  return { ok: true };
}

async function deleteMaterialFile(env, id) {
  await ensureMaterialSchema(env);
  const db = getMaterialDb(env);
  const row = await db.prepare("SELECT object_key FROM material_files WHERE id = ?").bind(id).first();
  if (!row) return;
  await getMaterialBucket(env).delete(row.object_key);
  await db.prepare("DELETE FROM material_files WHERE id = ?").bind(id).run();
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
      if (url.pathname === "/.well-known/oauth-protected-resource" && request.method === "GET") {
        const baseUrl = mcpBaseUrl(url);
        return mcpJson({ resource: `${baseUrl}/mcp`, authorization_servers: [baseUrl], scopes_supported: [MCP_SCOPE], resource_documentation: `${baseUrl}/mcp` });
      }
      if (url.pathname === "/.well-known/oauth-authorization-server" && request.method === "GET") {
        const baseUrl = mcpBaseUrl(url);
        return mcpJson({ issuer: baseUrl, authorization_endpoint: `${baseUrl}/oauth/authorize`, token_endpoint: `${baseUrl}/oauth/token`, registration_endpoint: `${baseUrl}/oauth/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: [MCP_SCOPE] });
      }
      if (url.pathname === "/oauth/register" && request.method === "POST") return registerMcpOAuthClient(request, env);
      if (url.pathname === "/oauth/authorize" && ["GET", "POST"].includes(request.method)) return authorizeMcpClient(request, env, url);
      if (url.pathname === "/oauth/token" && request.method === "POST") return exchangeMcpToken(request, env);
      if (url.pathname === "/mcp") return handleMcp(request, env, url);

      // 認可コードの交換はまだセッションが無い状態で呼ばれるため、
      // セッション検証より前に処理する。
      if (url.pathname === "/api/auth/callback" && request.method === "POST") {
        const body = await request.json();
        if (!body.code || !body.redirect_uri) {
          return json({ error: "code, redirect_uri are required" }, headers, 400);
        }
        const tokens = await exchangeAuthCode(env, body.code, body.redirect_uri);
        const idPayload = decodeIdToken(tokens.id_token);
        if (
          idPayload.email?.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase() ||
          String(idPayload.email_verified) !== "true"
        ) {
          return json({ error: `許可されていないアカウントです: ${idPayload.email}` }, headers, 403);
        }
        if (!tokens.refresh_token) {
          return json(
            {
              error:
                "リフレッシュトークンを取得できませんでした。Googleアカウントの「連携済みのアプリ」からこのアプリの連携を一度解除してから、再度ログインしてください。",
            },
            headers,
            400
          );
        }
        await saveRefreshToken(env, tokens.refresh_token);
        const sessionToken = await createSessionToken(env, idPayload.email);
        return json({ session_token: sessionToken }, headers);
      }

      if (url.pathname === "/api/schedule" && request.method === "GET") {
        await verifyReadApiKey(request, env);
        return json(await readSchedule(env, url.searchParams), headers);
      }

      await verifySession(request, env);

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        await clearRefreshToken(env);
        return json({ ok: true }, headers);
      }

      if (url.pathname === "/api/google-token" && request.method === "GET") {
        const tokens = await mintGoogleAccessToken(env);
        return json({ access_token: tokens.access_token, expires_in: tokens.expires_in }, headers);
      }

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
        return json(pref || { name, print_name: null, memo: null }, headers);
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


      if (url.pathname === "/api/admissions" && request.method === "GET") {
        return json(await readAdmissionEvents(env, url.searchParams.get("year")), headers);
      }

      if (url.pathname === "/api/admissions" && request.method === "POST") {
        return json(await createAdmissionEvent(env, await request.json()), headers, 201);
      }

      const admissionMatch = url.pathname.match(/^\/api\/admissions\/([^/]+)$/);
      if (admissionMatch && request.method === "PUT") {
        return json(
          await updateAdmissionEvent(env, decodeURIComponent(admissionMatch[1]), await request.json()),
          headers
        );
      }

      if (admissionMatch && request.method === "DELETE") {
        await deleteAdmissionEvent(env, decodeURIComponent(admissionMatch[1]));
        return json({ ok: true }, headers);
      }

      if (url.pathname === "/api/material-library/folders" && request.method === "GET") {
        return json(await readMaterialFolders(env), headers);
      }

      if (url.pathname === "/api/material-library/folders" && request.method === "POST") {
        const body = await request.json();
        return json(await createMaterialFolder(env, body), headers, 201);
      }

      if (url.pathname === "/api/material-library/folder-order" && request.method === "PUT") {
        return json(await reorderMaterialFolders(env, await request.json()), headers);
      }

      const materialFolderMatch = url.pathname.match(/^\/api\/material-library\/folders\/([^/]+)$/);
      if (materialFolderMatch && request.method === "PUT") {
        const body = await request.json();
        return json(
          await updateMaterialFolder(env, decodeURIComponent(materialFolderMatch[1]), body),
          headers
        );
      }

      if (materialFolderMatch && request.method === "DELETE") {
        await deleteMaterialFolder(env, decodeURIComponent(materialFolderMatch[1]));
        return json({ ok: true }, headers);
      }

      if (url.pathname === "/api/material-library/files" && request.method === "GET") {
        return json(
          url.searchParams.get("all") === "1"
            ? await readAllMaterialFiles(env)
            : await readMaterialFiles(env, url.searchParams.get("folder_id") || null),
          headers
        );
      }

      if (url.pathname === "/api/material-library/files" && request.method === "POST") {
        return json(await uploadMaterialFile(request, env, url), headers, 201);
      }

      if (url.pathname === "/api/material-library/file-order" && request.method === "PUT") {
        return json(await reorderMaterialFiles(env, await request.json()), headers);
      }

      const materialDownloadMatch = url.pathname.match(
        /^\/api\/material-library\/files\/([^/]+)\/download$/
      );
      if (materialDownloadMatch && request.method === "GET") {
        const response = await downloadMaterialFile(
          env,
          decodeURIComponent(materialDownloadMatch[1])
        );
        if (!response) return json({ error: "ファイルが見つかりません" }, headers, 404);
        response.headers.set("Access-Control-Allow-Origin", origin);
        return response;
      }

      const materialViewMatch = url.pathname.match(
        /^\/api\/material-library\/files\/([^/]+)\/view$/
      );
      if (materialViewMatch && request.method === "GET") {
        const response = await downloadMaterialFile(
          env,
          decodeURIComponent(materialViewMatch[1]),
          "inline"
        );
        if (!response) return json({ error: "ファイルが見つかりません" }, headers, 404);
        response.headers.set("Access-Control-Allow-Origin", origin);
        return response;
      }

      const materialFileMatch = url.pathname.match(/^\/api\/material-library\/files\/([^/]+)$/);
      if (materialFileMatch && request.method === "PUT") {
        const body = await request.json();
        return json(
          await updateMaterialFile(env, decodeURIComponent(materialFileMatch[1]), body),
          headers
        );
      }

      if (materialFileMatch && request.method === "DELETE") {
        await deleteMaterialFile(env, decodeURIComponent(materialFileMatch[1]));
        return json({ ok: true }, headers);
      }

      return json({ error: "not found" }, headers, 404);
    } catch (err) {
      const authErrors = [
        "not authorized",
        "missing bearer token",
        "invalid session",
        "session expired",
      ];
      const status = Number.isInteger(err.status) ? err.status : authErrors.includes(err.message) ? 401 : 400;
      return json({ error: err.message }, headers, status);
    }
  },
};
