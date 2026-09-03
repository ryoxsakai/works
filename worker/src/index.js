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
  calendar_id: {
    type: "string",
    description:
      "event_idで指定する予定のカレンダーID。省略時は選択済みカレンダーから一意に照合します。",
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

const SS_PROJECT_STATUSES = [
  "原稿待ち",
  "素材案作成中",
  "素材案確認待ち",
  "問題作成中",
  "完了",
];

const ssSourceEmailProperties = {
  source_email_id: {
    type: "string",
    description: "更新根拠となったメールのmessage_id。Gmailで取得できた場合は正確な値を指定します。",
  },
  source_email_subject: {
    type: "string",
    description: "更新根拠となったメールの件名。監査用に保存し、SS管理画面には表示しません。",
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
    name: "search_schedules",
    title: "授業予定を期間検索",
    description:
      "指定期間の授業予定を予定名の部分一致、完了状態、入力漏れで絞り込みます。更新対象の予定IDとカレンダーIDを探すときに使用します。",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD形式。省略時は今日。" },
        end_date: { type: "string", description: "YYYY-MM-DD形式。省略時は開始日から30日後。" },
        query: { type: "string", description: "予定名の部分一致検索語。" },
        completed: { type: "boolean", description: "完了状態で絞り込む場合に指定。" },
        missing_only: { type: "boolean", description: "授業予定・確認テスト・宿題・授業メモのいずれかが未入力の予定だけを返す場合はtrue。" },
        include_excluded: { type: "boolean", description: "除外設定済みの予定も含める場合はtrue。" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "最大件数。省略時は50件。" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      destructiveHint: true,
      idempotentHint: false,
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
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "get_student_profile",
    title: "生徒プロフィールを取得",
    description: "生徒メモと印刷用氏名を取得します。未登録の場合もnullを含むプロフィールを返します。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "生徒名。" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "update_student_profile",
    title: "生徒プロフィールを更新",
    description: "生徒メモと印刷用氏名を部分更新します。省略した項目は保持し、nullまたは空文字列で消去します。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "生徒名。" },
        memo: { type: ["string", "null"], description: "生徒メモ。nullまたは空文字列で消去します。" },
        print_name: { type: ["string", "null"], description: "印刷用氏名。nullまたは空文字列で消去します。" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_student_profile_change_history",
    title: "生徒プロフィールの変更履歴を取得",
    description: "MCPから行った生徒メモ・印刷用氏名の変更と取り消し履歴を新しい順に取得します。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "生徒名。" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "最大件数。省略時は20件。" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "undo_student_profile_update",
    title: "生徒プロフィールの変更を取り消す",
    description: "指定した変更履歴を1件取り消します。変更後に別の編集がある場合は競合として停止します。",
    inputSchema: {
      type: "object",
      properties: {
        change_id: { type: "string", description: "get_student_profile_change_historyで取得した変更ID。" },
      },
      required: ["change_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "get_student_overview",
    title: "生徒の概要を取得",
    description: "生徒の目標、志望校、教材進捗、メモ、直近・今後の授業をまとめて取得します。予定名は生徒名またはcalendar_tagと完全一致で照合します。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "生徒名。" },
        history_days: { type: "integer", minimum: 1, maximum: 365, description: "過去授業を探す日数。省略時は90日。" },
        upcoming_days: { type: "integer", minimum: 1, maximum: 180, description: "今後の授業を探す日数。省略時は30日。" },
        lesson_limit: { type: "integer", minimum: 1, maximum: 50, description: "直近・今後それぞれの最大件数。省略時は10件。" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_curriculum_progress",
    title: "カリキュラム進捗を取得",
    description: "生徒ごとの授業完了率、未記録・今後の授業、教材チャプター進捗を取得します。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "生徒名。" },
        lookback_days: { type: "integer", minimum: 1, maximum: 365, description: "集計する過去日数。省略時は180日。" },
        upcoming_days: { type: "integer", minimum: 0, maximum: 180, description: "集計する未来日数。省略時は90日。" },
        lesson_limit: { type: "integer", minimum: 1, maximum: 100, description: "状態別に返す授業の最大件数。省略時は20件。" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_schedule_change_history",
    title: "授業記録の変更履歴を取得",
    description: "MCPから行った授業記録の変更と取り消し履歴を新しい順に取得します。",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "特定の予定だけに絞る場合の予定ID。" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "最大件数。省略時は20件。" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "undo_schedule_update",
    title: "授業記録の変更を取り消す",
    description: "指定した変更履歴を1件取り消します。変更後に別の編集がある場合は競合として停止します。",
    inputSchema: {
      type: "object",
      properties: { change_id: { type: "string", description: "get_schedule_change_historyで取得した変更ID。" } },
      required: ["change_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },

  {
    name: "list_material_categories",
    title: "教材カテゴリを一覧取得",
    description: "登録済みの教材カテゴリを表示順で取得します。各カテゴリの教材件数も返します。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "create_material_category",
    title: "教材カテゴリを登録",
    description: "教材の親となるカテゴリを登録します。同名カテゴリがある場合は既存カテゴリを返します。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "カテゴリ名。" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "update_material_category",
    title: "教材カテゴリ名を変更",
    description: "登録済み教材カテゴリの名称を変更します。同名カテゴリがある場合は停止します。",
    inputSchema: {
      type: "object",
      properties: {
        category_id: { type: "integer", minimum: 1, description: "list_material_categoriesで取得したカテゴリID。" },
        name: { type: "string", description: "変更後のカテゴリ名。" },
      },
      required: ["category_id", "name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "reorder_material_categories",
    title: "教材カテゴリを並べ替え",
    description: "全教材カテゴリIDを希望順に並べ替えます。欠落・重複・未登録IDがある場合は停止します。",
    inputSchema: {
      type: "object",
      properties: {
        category_ids: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: { type: "integer", minimum: 1 },
          description: "全カテゴリIDを希望する順番で指定。",
        },
      },
      required: ["category_ids"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_curriculum_materials",
    title: "カリキュラム教材を一覧取得",
    description: "登録済みの教材をカテゴリ順で取得し、カテゴリ情報と各教材のチャプターを返します。教材登録・移動・チャプター登録・生徒への紐付け前のID確認に使用します。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "教材名またはチャプター名の部分一致検索語。" },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "返す教材の最大件数。省略時は100件。" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "create_curriculum_material",
    title: "カリキュラム教材を登録",
    description: "生徒のカリキュラムで使用する教材を登録します。同名教材がある場合はカテゴリを変更せず既存教材を返します。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "教材名。" },
        category_id: {
          type: ["integer", "null"],
          minimum: 1,
          description: "追加先カテゴリID。未分類にする場合または省略時はnull。",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "move_curriculum_material_to_category",
    title: "教材を別カテゴリへ移動",
    description: "教材を指定カテゴリへ移動します。未分類へ移す場合はcategory_idにnullを指定します。移動先では末尾に配置されます。",
    inputSchema: {
      type: "object",
      properties: {
        material_id: { type: "integer", minimum: 1, description: "list_curriculum_materialsで取得した教材ID。" },
        category_id: {
          type: ["integer", "null"],
          minimum: 1,
          description: "list_material_categoriesで取得した移動先カテゴリID。未分類はnull。",
        },
      },
      required: ["material_id", "category_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "reorder_curriculum_materials_in_category",
    title: "カテゴリ内の教材を並べ替え",
    description: "指定カテゴリに属する全教材IDを希望順に並べ替えます。未分類の場合はcategory_idにnullを指定します。欠落・重複・別カテゴリのIDがある場合は停止します。",
    inputSchema: {
      type: "object",
      properties: {
        category_id: {
          type: ["integer", "null"],
          minimum: 1,
          description: "list_material_categoriesで取得したカテゴリID。未分類はnull。",
        },
        material_ids: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: { type: "integer", minimum: 1 },
          description: "このカテゴリの全教材IDを希望する順番で指定。",
        },
      },
      required: ["category_id", "material_ids"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "create_material_chapters",
    title: "教材チャプターを登録",
    description: "指定教材に1件以上のチャプターをまとめて登録します。同名チャプターがある場合は重複登録しません。",
    inputSchema: {
      type: "object",
      properties: {
        material_id: { type: "integer", minimum: 1, description: "list_curriculum_materialsまたはcreate_curriculum_materialで取得した教材ID。" },
        chapter_names: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "string" },
          description: "登録するチャプター名の配列。入力順で並びます。",
        },
      },
      required: ["material_id", "chapter_names"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "update_curriculum_material",
    title: "カリキュラム教材名を変更",
    description: "登録済み教材の名称を変更します。同名教材がある場合は停止します。",
    inputSchema: {
      type: "object",
      properties: {
        material_id: { type: "integer", minimum: 1, description: "list_curriculum_materialsで取得した教材ID。" },
        name: { type: "string", description: "変更後の教材名。" },
      },
      required: ["material_id", "name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "update_material_chapter",
    title: "教材チャプター名を変更",
    description: "指定チャプターの名称を変更します。同じ教材内に同名チャプターがある場合は停止します。",
    inputSchema: {
      type: "object",
      properties: {
        chapter_id: { type: "integer", minimum: 1, description: "list_curriculum_materialsで取得したチャプターID。" },
        name: { type: "string", description: "変更後のチャプター名。" },
      },
      required: ["chapter_id", "name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "reorder_material_chapters",
    title: "教材チャプターを並べ替え",
    description: "指定教材の全チャプターIDを希望順に並べ替えます。欠落・重複・別教材のIDがある場合は停止します。",
    inputSchema: {
      type: "object",
      properties: {
        material_id: { type: "integer", minimum: 1, description: "list_curriculum_materialsで取得した教材ID。" },
        chapter_ids: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: { type: "integer", minimum: 1 },
          description: "この教材の全チャプターIDを希望する順番で指定。",
        },
      },
      required: ["material_id", "chapter_ids"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "merge_material_chapters",
    title: "重複チャプターを統合",
    description: "統合元の進捗を統合先へ移し、完了状態を保持してから統合元を削除します。両者が同じ教材に属さない場合は停止します。",
    inputSchema: {
      type: "object",
      properties: {
        source_chapter_id: { type: "integer", minimum: 1, description: "削除する統合元チャプターID。" },
        target_chapter_id: { type: "integer", minimum: 1, description: "残す統合先チャプターID。" },
        expected_source_name: { type: "string", description: "誤削除防止のための統合元チャプター名。現在値と一致しない場合は停止します。" },
      },
      required: ["source_chapter_id", "target_chapter_id", "expected_source_name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "delete_material_chapter",
    title: "教材チャプターを削除",
    description: "指定チャプターを削除します。生徒の進捗が存在する場合は削除せず、merge_material_chaptersの使用を求めます。",
    inputSchema: {
      type: "object",
      properties: {
        chapter_id: { type: "integer", minimum: 1, description: "削除するチャプターID。" },
        expected_name: { type: "string", description: "誤削除防止のためのチャプター名。現在値と一致しない場合は停止します。" },
      },
      required: ["chapter_id", "expected_name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "get_student_materials",
    title: "生徒の教材と進捗を取得",
    description: "生徒に紐付いた教材、チャプター、各チャプターの完了状態を取得します。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "生徒名。" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "assign_material_to_student",
    title: "教材を生徒に紐付け",
    description: "登録済みの教材を生徒に紐付けます。同じ紐付けを再実行しても重複しません。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "生徒名。" },
        material_id: { type: "integer", minimum: 1, description: "list_curriculum_materialsで取得した教材ID。" },
      },
      required: ["name", "material_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "set_chapter_completion",
    title: "チャプター完了状態を更新",
    description: "生徒に紐付いた教材のチャプターを完了または未完了に更新します。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "生徒名。" },
        chapter_id: { type: "integer", minimum: 1, description: "get_student_materialsで取得したチャプターID。" },
        completed: { type: "boolean", description: "完了にする場合はtrue、未完了に戻す場合はfalse。" },
      },
      required: ["name", "chapter_id", "completed"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "search_materials",
    title: "教材を検索",
    description: "教材ライブラリのファイル名とフォルダ名を部分一致で検索します。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "検索語。" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "最大件数。省略時は20件。" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "link_material_to_schedule",
    title: "教材を授業に紐付け",
    description: "教材ライブラリのファイルを授業予定に紐付けます。同じ組み合わせを再実行するとメモを更新します。",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "get_scheduleで取得した予定ID。" },
        calendar_id: { type: "string", description: "get_scheduleで取得したカレンダーID。" },
        material_file_id: { type: "string", description: "search_materialsで取得した教材ファイルID。" },
        note: { type: ["string", "null"], description: "授業での使い方などのメモ。" },
      },
      required: ["event_id", "calendar_id", "material_file_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "unlink_material_from_schedule",
    title: "授業から教材リンクを解除",
    description: "予定ID・カレンダーID・教材ファイルIDが完全一致する教材リンクを解除します。教材ファイル自体は削除しません。",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "get_scheduleまたはsearch_schedulesで取得した予定ID。" },
        calendar_id: { type: "string", description: "対象予定のカレンダーID。" },
        material_file_id: { type: "string", description: "解除する教材ファイルID。" },
      },
      required: ["event_id", "calendar_id", "material_file_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "preview_reschedule",
    title: "授業日程変更を確認",
    description: "Googleカレンダーの授業予定を変更せず、現在日時と変更後日時を確認して10分間有効な確認トークンを発行します。",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "get_scheduleで取得したカレンダーID。" },
        event_id: { type: "string", description: "get_scheduleで取得した予定ID。" },
        new_start: { type: "string", description: "タイムゾーンオフセット付きRFC3339開始日時。" },
        new_end: { type: "string", description: "タイムゾーンオフセット付きRFC3339終了日時。" },
      },
      required: ["calendar_id", "event_id", "new_start", "new_end"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "apply_reschedule",
    title: "授業日程変更を適用",
    description: "preview_rescheduleの確認トークンを使ってGoogleカレンダーの日時変更を適用します。元予定が変わっていた場合は停止します。",
    inputSchema: {
      type: "object",
      properties: { confirmation_token: { type: "string", description: "preview_rescheduleが発行した確認トークン。" } },
      required: ["confirmation_token"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "list_ss_projects",
    title: "SS案件を一覧取得",
    description:
      "SS管理の案件を締切順で取得します。メールをもとに登録・更新する前に、同じ案件がないか確認し、更新対象のproject_idを取得するときに使用します。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "プロジェクト名の部分一致検索語。" },
        status: {
          type: "string",
          enum: SS_PROJECT_STATUSES,
          description: "ステータスで絞り込む場合に指定します。",
        },
        include_completed: {
          type: "boolean",
          description: "完了案件を含めるか。省略時はtrue。",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "create_ss_project",
    title: "SS案件を登録",
    description:
      "メールなどで確認したSS案件を登録します。同名かつ同内容の案件がある場合は既存案件を返し、内容が異なる場合はupdate_ss_projectの使用を求めて停止します。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "プロジェクト名。" },
        status: {
          type: "string",
          enum: SS_PROJECT_STATUSES,
          description: "現在のステータス。",
        },
        deadline: { type: "string", description: "締切日。YYYY-MM-DD形式。" },
        memo: {
          type: ["string", "null"],
          description: "案件の注意事項や作業内容を記録するメモ。空文字列またはnullで空欄にします。",
        },
        ...ssSourceEmailProperties,
      },
      required: ["name", "status", "deadline"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "update_ss_project",
    title: "SS案件を更新",
    description:
      "既存のSS案件を部分更新します。メールを根拠に更新する場合はsource_email_idとsource_email_subjectも指定します。省略した項目は変更しません。",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "list_ss_projectsで取得した案件ID。" },
        name: { type: "string", description: "変更後のプロジェクト名。" },
        status: {
          type: "string",
          enum: SS_PROJECT_STATUSES,
          description: "変更後のステータス。",
        },
        deadline: { type: "string", description: "変更後の締切日。YYYY-MM-DD形式。" },
        memo: {
          type: ["string", "null"],
          description: "変更後のメモ。空文字列またはnullで消去します。",
        },
        ...ssSourceEmailProperties,
      },
      required: ["project_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_monthly_report",
    title: "月次授業レポートを取得",
    description: "指定月の授業数、完了率、未記録数、入力漏れ、生徒別集計を取得します。",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM形式。省略時は今月（Asia/Tokyo）。" },
        name: { type: "string", description: "特定の生徒名または予定名だけに絞る場合に指定。" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_schedule_data_health",
    title: "授業予定データの健全性を診断",
    description: "カレンダー設定、生徒名・calendar_tagの重複、教材リンク切れ、旧形式リンクを読み取り専用で診断します。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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

async function resolveScheduleUpdateTarget(env, args, lookupContext = null) {
  const eventId = String(args.event_id || "").trim();
  if (eventId) {
    const calendarId = String(args.calendar_id || "").trim();
    const resolved = await resolveCalendarEventById(
      env,
      eventId,
      calendarId || null,
      lookupContext
    );
    return {
      event_id: eventId,
      calendar_id: resolved.calendar_id,
      date: args.date ? String(args.date).trim() : null,
      title: String(resolved.event.summary || args.title || "(無題)").trim(),
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
    calendar_id: matches[0].calendar_id,
    date,
    title: matches[0].title,
  };
}

async function selectedScheduleCalendarIds(env) {
  const settings = await readSettings(env);
  const calendarIds = Array.isArray(settings.selected_calendars)
    ? [...new Set(settings.selected_calendars.map(String).filter(Boolean))]
    : [];
  if (!calendarIds.length) throw httpError(409, "selected calendars are not configured");
  return calendarIds;
}

async function fetchCalendarEventWithToken(accessToken, calendarId, eventId) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw httpError(502, `Google Calendar API error (${res.status})`);
  return res.json();
}

async function createCalendarLookupContext(env) {
  const calendarIds = await selectedScheduleCalendarIds(env);
  const token = await mintGoogleAccessToken(env);
  return { calendar_ids: calendarIds, access_token: token.access_token };
}

async function resolveCalendarEventById(
  env,
  eventId,
  requestedCalendarId = null,
  lookupContext = null
) {
  if (!eventId) throw httpError(400, "event_id is required");
  const context = lookupContext || (await createCalendarLookupContext(env));
  const calendarIds = context.calendar_ids;
  if (requestedCalendarId && !calendarIds.includes(requestedCalendarId)) {
    throw httpError(403, "calendar is not selected in WORKS settings");
  }
  const candidates = requestedCalendarId ? [requestedCalendarId] : calendarIds;
  const matches = [];
  for (const calendarId of candidates) {
    const event = await fetchCalendarEventWithToken(context.access_token, calendarId, eventId);
    if (event && event.status !== "cancelled") matches.push({ calendar_id: calendarId, event });
  }
  if (!matches.length) throw httpError(404, `schedule not found: ${eventId}`);
  if (matches.length > 1) throw httpError(409, `multiple calendars contain event_id ${eventId}; specify calendar_id`);
  return matches[0];
}

let mcpFeatureSchemaReady = null;

async function ensureMcpFeatureSchema(env) {
  if (!mcpFeatureSchemaReady) {
    mcpFeatureSchemaReady = (async () => {
      await env.DB.batch([
        env.DB.prepare("CREATE TABLE IF NOT EXISTS mcp_schedule_changes (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, action TEXT NOT NULL, changed_fields TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, undone_by TEXT, created_at TEXT DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_mcp_schedule_changes_event ON mcp_schedule_changes(event_id, created_at DESC)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS mcp_student_profile_changes (id TEXT PRIMARY KEY, name TEXT NOT NULL, action TEXT NOT NULL, changed_fields TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, undone_by TEXT, created_at TEXT DEFAULT (datetime('now')))"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_mcp_student_profile_changes_name ON mcp_student_profile_changes(name, created_at DESC)"),
        env.DB.prepare("CREATE TABLE IF NOT EXISTS schedule_material_links (calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, material_file_id TEXT NOT NULL, note TEXT, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (calendar_id, event_id, material_file_id))"),
      ]);
      const { results: columns } = await env.DB.prepare("PRAGMA table_info(schedule_material_links)").all();
      if (!columns.some((column) => column.name === "calendar_id")) {
        await env.DB.batch([
          env.DB.prepare("ALTER TABLE schedule_material_links RENAME TO schedule_material_links_legacy"),
          env.DB.prepare("CREATE TABLE schedule_material_links (calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, material_file_id TEXT NOT NULL, note TEXT, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (calendar_id, event_id, material_file_id))"),
          env.DB.prepare("INSERT INTO schedule_material_links (calendar_id, event_id, material_file_id, note, created_at) SELECT '', event_id, material_file_id, note, created_at FROM schedule_material_links_legacy"),
          env.DB.prepare("DROP TABLE schedule_material_links_legacy"),
        ]);
      }
    })().catch((err) => {
      mcpFeatureSchemaReady = null;
      throw err;
    });
  }
  await mcpFeatureSchemaReady;
}

let ssProjectSchemaReady = null;

async function ensureSsProjectSchema(env) {
  if (!ssProjectSchemaReady) {
    ssProjectSchemaReady = (async () => {
      await env.DB.batch([
        env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS ss_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('原稿待ち', '素材案作成中', '素材案確認待ち', '問題作成中', '完了')), deadline TEXT NOT NULL, memo TEXT, last_source_email_id TEXT, last_source_email_subject TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
        ),
        env.DB.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS idx_ss_projects_unique_name ON ss_projects(lower(trim(name)))"
        ),
        env.DB.prepare(
          "CREATE INDEX IF NOT EXISTS idx_ss_projects_deadline ON ss_projects(status, deadline)"
        ),
        env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS mcp_ss_project_changes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, action TEXT NOT NULL, changed_fields TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, source_email_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
        ),
        env.DB.prepare(
          "CREATE INDEX IF NOT EXISTS idx_mcp_ss_project_changes_project ON mcp_ss_project_changes(project_id, created_at DESC)"
        ),
      ]);
      const { results: columns } = await env.DB.prepare("PRAGMA table_info(ss_projects)").all();
      if (!columns.some((column) => column.name === "memo")) {
        await env.DB.prepare("ALTER TABLE ss_projects ADD COLUMN memo TEXT").run();
      }
    })().catch((err) => {
      ssProjectSchemaReady = null;
      throw err;
    });
  }
  await ssProjectSchemaReady;
}

function normalizeSsProjectName(value) {
  const name = String(value || "").trim();
  if (!name) throw httpError(400, "name is required");
  if (name.length > 200) throw httpError(400, "name is too long");
  return name;
}

function normalizeSsProjectStatus(value) {
  const status = String(value || "").trim();
  if (!SS_PROJECT_STATUSES.includes(status)) {
    throw httpError(400, `status must be one of: ${SS_PROJECT_STATUSES.join("・")}`);
  }
  return status;
}

function normalizeSsProjectDeadline(value) {
  const deadline = String(value || "").trim();
  const match = deadline.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw httpError(400, "deadline must be YYYY-MM-DD");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw httpError(400, "deadline is not a valid date");
  }
  return deadline;
}

function normalizeSsProjectMemo(value) {
  if (value === undefined || value === null) return null;
  const memo = String(value).trim();
  if (memo.length > 5000) throw httpError(400, "memo is too long");
  return memo || null;
}

function normalizeSsSourceEmail(value, field, maxLength) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (normalized.length > maxLength) throw httpError(400, `${field} is too long`);
  return normalized || null;
}

function ssProjectRemainingDays(deadline, today = todayInScheduleTimeZone()) {
  const toUtc = (value) => {
    const [year, month, day] = String(value).split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(deadline) - toUtc(today)) / 86_400_000);
}

function withSsProjectRemainingDays(project, today) {
  return {
    ...project,
    remaining_days: ssProjectRemainingDays(project.deadline, today),
  };
}

async function readSsProjects(env, args = {}) {
  await ensureSsProjectSchema(env);
  const clauses = [];
  const values = [];
  const query = String(args.query || "").trim();
  if (query) {
    clauses.push("instr(lower(name), lower(?)) > 0");
    values.push(query);
  }
  if (args.status !== undefined) {
    clauses.push("status = ?");
    values.push(normalizeSsProjectStatus(args.status));
  }
  if (args.include_completed === false) {
    clauses.push("status <> '完了'");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const statement = env.DB.prepare(
    `SELECT * FROM ss_projects ${where}
     ORDER BY CASE WHEN status = '完了' THEN 1 ELSE 0 END,
              CASE WHEN status <> '完了' THEN deadline END ASC,
              CASE WHEN status = '完了' THEN deadline END DESC,
              name ASC`
  );
  const { results } = values.length ? await statement.bind(...values).all() : await statement.all();
  const today = todayInScheduleTimeZone();
  return results.map((project) => withSsProjectRemainingDays(project, today));
}

async function createSsProject(env, args = {}) {
  await ensureSsProjectSchema(env);
  const name = normalizeSsProjectName(args.name);
  const status = normalizeSsProjectStatus(args.status);
  const deadline = normalizeSsProjectDeadline(args.deadline);
  const memo = normalizeSsProjectMemo(args.memo);
  const sourceEmailId = normalizeSsSourceEmail(args.source_email_id, "source_email_id", 255);
  const sourceEmailSubject = normalizeSsSourceEmail(
    args.source_email_subject,
    "source_email_subject",
    500
  );
  const existing = await env.DB.prepare(
    "SELECT * FROM ss_projects WHERE lower(trim(name)) = lower(trim(?)) LIMIT 1"
  ).bind(name).first();
  if (existing) {
    const memoMatches = args.memo === undefined || (existing.memo ?? null) === memo;
    if (existing.status === status && existing.deadline === deadline && memoMatches) {
      return { created: false, project: withSsProjectRemainingDays(existing) };
    }
    throw httpError(
      409,
      `project already exists with different values: ${existing.id}; use update_ss_project`
    );
  }

  const id = crypto.randomUUID();
  const changeId = crypto.randomUUID();
  const now = new Date().toISOString();
  const project = {
    id,
    name,
    status,
    deadline,
    memo,
    last_source_email_id: sourceEmailId,
    last_source_email_subject: sourceEmailSubject,
    created_at: now,
    updated_at: now,
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO ss_projects (id, name, status, deadline, memo, last_source_email_id, last_source_email_subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, name, status, deadline, memo, sourceEmailId, sourceEmailSubject, now, now),
    env.DB.prepare(
      "INSERT INTO mcp_ss_project_changes (id, project_id, action, changed_fields, before_json, after_json, source_email_id, created_at) VALUES (?, ?, 'create', ?, '{}', ?, ?, ?)"
    ).bind(
      changeId,
      id,
      JSON.stringify(["name", "status", "deadline", ...(memo === null ? [] : ["memo"])]),
      JSON.stringify(project),
      sourceEmailId,
      now
    ),
  ]);
  return { created: true, project: withSsProjectRemainingDays(project) };
}

async function updateSsProject(env, args = {}) {
  await ensureSsProjectSchema(env);
  const projectId = String(args.project_id || "").trim();
  if (!projectId) throw httpError(400, "project_id is required");
  const before = await env.DB.prepare("SELECT * FROM ss_projects WHERE id = ?")
    .bind(projectId)
    .first();
  if (!before) throw httpError(404, `SS project not found: ${projectId}`);

  const requested = {};
  if (Object.prototype.hasOwnProperty.call(args, "name")) {
    requested.name = normalizeSsProjectName(args.name);
  }
  if (Object.prototype.hasOwnProperty.call(args, "status")) {
    requested.status = normalizeSsProjectStatus(args.status);
  }
  if (Object.prototype.hasOwnProperty.call(args, "deadline")) {
    requested.deadline = normalizeSsProjectDeadline(args.deadline);
  }
  if (Object.prototype.hasOwnProperty.call(args, "memo")) {
    requested.memo = normalizeSsProjectMemo(args.memo);
  }
  if (!Object.keys(requested).length) {
    throw httpError(400, "at least one of name, status, deadline, or memo is required");
  }

  if (requested.name && requested.name !== before.name) {
    const duplicate = await env.DB.prepare(
      "SELECT id FROM ss_projects WHERE id <> ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1"
    ).bind(projectId, requested.name).first();
    if (duplicate) throw httpError(409, `another project already uses this name: ${duplicate.id}`);
  }

  const changedFields = Object.keys(requested).filter((field) => requested[field] !== before[field]);
  if (!changedFields.length) {
    return { updated: false, changed_fields: [], project: withSsProjectRemainingDays(before) };
  }

  const sourceEmailId = normalizeSsSourceEmail(args.source_email_id, "source_email_id", 255);
  const sourceEmailSubject = normalizeSsSourceEmail(
    args.source_email_subject,
    "source_email_subject",
    500
  );
  const now = new Date().toISOString();
  const after = {
    ...before,
    ...requested,
    last_source_email_id: sourceEmailId ?? before.last_source_email_id,
    last_source_email_subject: sourceEmailSubject ?? before.last_source_email_subject,
    updated_at: now,
  };
  const assignments = changedFields.map((field) => `${field} = ?`);
  const values = changedFields.map((field) => requested[field]);
  if (sourceEmailId !== null) {
    assignments.push("last_source_email_id = ?");
    values.push(sourceEmailId);
  }
  if (sourceEmailSubject !== null) {
    assignments.push("last_source_email_subject = ?");
    values.push(sourceEmailSubject);
  }
  assignments.push("updated_at = ?");
  values.push(now, projectId);

  await env.DB.batch([
    env.DB.prepare(`UPDATE ss_projects SET ${assignments.join(", ")} WHERE id = ?`).bind(...values),
    env.DB.prepare(
      "INSERT INTO mcp_ss_project_changes (id, project_id, action, changed_fields, before_json, after_json, source_email_id, created_at) VALUES (?, ?, 'update', ?, ?, ?, ?, ?)"
    ).bind(
      crypto.randomUUID(),
      projectId,
      JSON.stringify(changedFields),
      JSON.stringify(before),
      JSON.stringify(after),
      sourceEmailId,
      now
    ),
  ]);
  return {
    updated: true,
    changed_fields: changedFields,
    before: withSsProjectRemainingDays(before),
    project: withSsProjectRemainingDays(after),
  };
}

async function listMcpSsProjects(env, args = {}) {
  const projects = await readSsProjects(env, args);
  return { count: projects.length, projects };
}

let curriculumIntegrityReady = null;

let materialCategorySchemaReady = null;

async function ensureMaterialCategorySchema(env) {
  if (!materialCategorySchemaReady) {
    materialCategorySchemaReady = (async () => {
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS material_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))"
      ).run();
      await env.DB.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_material_categories_unique_name ON material_categories(lower(trim(name)))"
      ).run();
      const { results: columns } = await env.DB.prepare("PRAGMA table_info(materials)").all();
      if (!columns.some((column) => column.name === "category_id")) {
        await env.DB.prepare("ALTER TABLE materials ADD COLUMN category_id INTEGER").run();
      }
      await env.DB.prepare(
        "CREATE INDEX IF NOT EXISTS idx_materials_category_order ON materials(category_id, sort_order, id)"
      ).run();
    })().catch((err) => {
      materialCategorySchemaReady = null;
      throw err;
    });
  }
  return materialCategorySchemaReady;
}

async function runDbStatements(env, statements, chunkSize = 50) {
  for (let index = 0; index < statements.length; index += chunkSize) {
    await env.DB.batch(statements.slice(index, index + chunkSize));
  }
}

async function resequenceMaterialChapters(env, materialId) {
  const { results } = await env.DB.prepare(
    "SELECT id FROM material_chapters WHERE material_id = ? ORDER BY sort_order, id"
  )
    .bind(materialId)
    .all();
  await runDbStatements(
    env,
    results.map((chapter, index) =>
      env.DB.prepare("UPDATE material_chapters SET sort_order = ? WHERE id = ?")
        .bind(index, chapter.id)
    )
  );
}

async function ensureCurriculumIntegrity(env) {
  if (!curriculumIntegrityReady) {
    curriculumIntegrityReady = (async () => {
      const { results: duplicateGroups } = await env.DB.prepare(
        `SELECT material_id, lower(trim(name)) AS normalized_name, MIN(id) AS keep_id, COUNT(*) AS duplicate_count
         FROM material_chapters
         GROUP BY material_id, lower(trim(name))
         HAVING COUNT(*) > 1`
      ).all();
      const mergedChapters = [];

      for (const group of duplicateGroups) {
        const { results: duplicates } = await env.DB.prepare(
          `SELECT id, name, sort_order
           FROM material_chapters
           WHERE material_id = ? AND lower(trim(name)) = ?
           ORDER BY id`
        )
          .bind(group.material_id, group.normalized_name)
          .all();
        const target = duplicates.find((chapter) => chapter.id === group.keep_id) || duplicates[0];
        if (!target) continue;

        for (const source of duplicates.filter((chapter) => chapter.id !== target.id)) {
          const { results: progressRows } = await env.DB.prepare(
            "SELECT name, completed, updated_at FROM chapter_progress WHERE chapter_id = ?"
          )
            .bind(source.id)
            .all();
          const statements = progressRows.map((progress) =>
            env.DB.prepare(
              `INSERT INTO chapter_progress (name, chapter_id, completed, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(name, chapter_id) DO UPDATE SET
                 completed = CASE
                   WHEN chapter_progress.completed = 1 OR excluded.completed = 1 THEN 1
                   ELSE 0
                 END,
                 updated_at = CASE
                   WHEN COALESCE(chapter_progress.updated_at, '') >= COALESCE(excluded.updated_at, '')
                     THEN chapter_progress.updated_at
                   ELSE excluded.updated_at
                 END`
            ).bind(progress.name, target.id, progress.completed ? 1 : 0, progress.updated_at)
          );
          statements.push(
            env.DB.prepare("DELETE FROM chapter_progress WHERE chapter_id = ?").bind(source.id),
            env.DB.prepare("DELETE FROM material_chapters WHERE id = ?").bind(source.id)
          );
          await runDbStatements(env, statements);
          mergedChapters.push({
            material_id: group.material_id,
            source_chapter_id: source.id,
            target_chapter_id: target.id,
            name: target.name,
            migrated_progress_count: progressRows.length,
          });
        }
      }

      await env.DB.prepare("UPDATE material_chapters SET name = trim(name) WHERE name <> trim(name)").run();
      const { results: materials } = await env.DB.prepare(
        "SELECT DISTINCT material_id FROM material_chapters"
      ).all();
      for (const material of materials) {
        await resequenceMaterialChapters(env, material.material_id);
      }
      await env.DB.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_material_chapters_unique_name ON material_chapters(material_id, lower(trim(name)))"
      ).run();
      return { merged_chapters: mergedChapters };
    })().catch((err) => {
      curriculumIntegrityReady = null;
      throw err;
    });
  }
  return curriculumIntegrityReady;
}

function curriculumSnapshot(row) {
  return {
    exists: Boolean(row?.calendar_event_id),
    completed: Boolean(row?.completed),
    ...Object.fromEntries(SCHEDULE_TEXT_FIELDS.map((field) => [field, row?.[field] || null])),
  };
}

async function readCurriculumEntry(env, eventId) {
  return env.DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id = ?")
    .bind(eventId)
    .first();
}

function curriculumAfterPatch(before, patch) {
  return {
    exists: true,
    completed: patch.completed !== undefined ? patch.completed : before.completed,
    ...Object.fromEntries(
      SCHEDULE_TEXT_FIELDS.map((field) => [
        field,
        patch[field] !== undefined ? patch[field] : before[field],
      ])
    ),
  };
}

async function prepareAuditedScheduleUpdate(env, target, patch) {
  const before = curriculumSnapshot(await readCurriculumEntry(env, target.event_id));
  const after = curriculumAfterPatch(before, patch);
  const changeId = crypto.randomUUID();
  return {
    target,
    patch,
    before,
    after,
    change_id: changeId,
    statements: [
      env.DB.prepare(`INSERT INTO curriculum_entries (calendar_event_id, completed, lesson_plan, confirmation_test, homework, lesson_memo, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(calendar_event_id) DO UPDATE SET completed = excluded.completed, lesson_plan = excluded.lesson_plan,
          confirmation_test = excluded.confirmation_test, homework = excluded.homework,
          lesson_memo = excluded.lesson_memo, updated_at = excluded.updated_at`)
        .bind(target.event_id, after.completed ? 1 : 0, after.lesson_plan, after.confirmation_test, after.homework, after.lesson_memo),
      env.DB.prepare("INSERT INTO mcp_schedule_changes (id, event_id, action, changed_fields, before_json, after_json) VALUES (?, ?, 'update', ?, ?, ?)")
        .bind(changeId, target.event_id, JSON.stringify(Object.keys(patch)), JSON.stringify(before), JSON.stringify(after)),
    ],
  };
}

async function auditedScheduleUpdate(env, target, patch) {
  await ensureMcpFeatureSchema(env);
  const prepared = await prepareAuditedScheduleUpdate(env, target, patch);
  await env.DB.batch(prepared.statements);
  return { entry: await readCurriculumEntry(env, target.event_id), change_id: prepared.change_id };
}

async function updateScheduleFromArguments(env, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw httpError(400, "arguments must be an object");
  }
  const patch = schedulePatchFromArguments(args);
  const target = await resolveScheduleUpdateTarget(env, args);
  const { entry, change_id: changeId } = await auditedScheduleUpdate(env, target, patch);
  return {
    change_id: changeId,
    event_id: target.event_id,
    calendar_id: target.calendar_id,
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
  const lookupContext = args.updates.some((update) => update?.event_id)
    ? await createCalendarLookupContext(env)
    : null;
  for (const update of args.updates) {
    if (!update || typeof update !== "object" || Array.isArray(update)) {
      throw httpError(400, "each update must be an object");
    }
    prepared.push({
      target: await resolveScheduleUpdateTarget(env, update, lookupContext),
      patch: schedulePatchFromArguments(update),
    });
  }

  const eventIds = prepared.map(({ target }) => target.event_id);
  if (new Set(eventIds).size !== eventIds.length) {
    throw httpError(409, "updates[] contains duplicate schedules");
  }

  await ensureMcpFeatureSchema(env);
  const atomicUpdates = [];
  for (const { target, patch } of prepared) {
    atomicUpdates.push(await prepareAuditedScheduleUpdate(env, target, patch));
  }
  await env.DB.batch(atomicUpdates.flatMap((update) => update.statements));

  const results = [];
  for (const update of atomicUpdates) {
    const { target, patch, change_id: changeId } = update;
    const entry = await readCurriculumEntry(env, target.event_id);
    results.push({
      change_id: changeId,
      event_id: target.event_id,
      calendar_id: target.calendar_id,
      date: target.date,
      title: target.title,
      updated_fields: Object.keys(patch),
      entry,
    });
  }
  return { count: results.length, updates: results };
}


function normalizeCurriculumText(value, field) {
  const text = String(value || "").trim();
  if (!text) throw httpError(400, field + " is required");
  if (text.length > 200) throw httpError(400, field + " is too long");
  return text;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw httpError(400, field + " must be a positive integer");
  }
  return number;
}

async function listMcpMaterialCategories(env) {
  const categories = await readMaterialCategories(env);
  return { count: categories.length, categories };
}

async function createMcpMaterialCategory(env, args) {
  await ensureMaterialCategorySchema(env);
  const name = normalizeCurriculumText(args.name, "name");
  const existing = await env.DB.prepare(
    "SELECT id FROM material_categories WHERE lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1"
  )
    .bind(name)
    .first();
  if (existing) {
    const categories = await readMaterialCategories(env);
    return {
      created: false,
      category: categories.find((category) => category.id === existing.id),
    };
  }
  return { created: true, category: await createMaterialCategory(env, { name }) };
}

async function updateMcpMaterialCategory(env, args) {
  await ensureMaterialCategorySchema(env);
  const categoryId = positiveInteger(args.category_id, "category_id");
  const name = normalizeCurriculumText(args.name, "name");
  const before = await env.DB.prepare("SELECT * FROM material_categories WHERE id = ?")
    .bind(categoryId)
    .first();
  if (!before) throw httpError(404, "material category not found");
  const category = await updateMaterialCategory(env, categoryId, { name });
  return { before, category };
}

async function reorderMcpMaterialCategories(env, args) {
  if (!Array.isArray(args.category_ids) || args.category_ids.length < 1 || args.category_ids.length > 200) {
    throw httpError(400, "category_ids must contain between 1 and 200 items");
  }
  const categories = await reorderMaterialCategories(env, {
    category_ids: args.category_ids.map((value) => positiveInteger(value, "category_id")),
  });
  return { count: categories.length, categories };
}

async function listMcpCurriculumMaterials(env, args = {}) {
  await ensureCurriculumIntegrity(env);
  const query = String(args.query || "").trim().toLocaleLowerCase("ja");
  const limitValue = args.limit === undefined ? 100 : Number(args.limit);
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 200) {
    throw httpError(400, "limit must be an integer between 1 and 200");
  }

  const materials = await readMaterials(env);
  const output = [];
  for (const material of materials) {
    const chapters = await readChapters(env, material.id);
    const matches =
      !query ||
      String(material.name).toLocaleLowerCase("ja").includes(query) ||
      String(material.category_name || "").toLocaleLowerCase("ja").includes(query) ||
      chapters.some((chapter) =>
        String(chapter.name).toLocaleLowerCase("ja").includes(query)
      );
    if (!matches) continue;
    output.push({ ...material, chapters });
    if (output.length >= limitValue) break;
  }
  return { count: output.length, materials: output };
}

async function createMcpCurriculumMaterial(env, args) {
  const name = normalizeCurriculumText(args.name, "name");
  const categoryId = args.category_id === undefined
    ? null
    : parseMaterialCategoryId(args.category_id);
  await ensureMaterialCategorySchema(env);
  await assertMaterialCategoryExists(env, categoryId);
  const existing = await env.DB.prepare(
    "SELECT * FROM materials WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1"
  )
    .bind(name)
    .first();
  if (existing) {
    const listedMaterial = (await readMaterials(env)).find((material) => material.id === existing.id);
    return {
      created: false,
      material: { ...(listedMaterial || existing), chapters: await readChapters(env, existing.id) },
    };
  }
  const material = await createMaterial(env, { name, category_id: categoryId });
  return { created: true, material: { ...material, chapters: [] } };
}

async function moveMcpCurriculumMaterialToCategory(env, args) {
  await ensureMaterialCategorySchema(env);
  const materialId = positiveInteger(args.material_id, "material_id");
  if (args.category_id === undefined) throw httpError(400, "category_id is required");
  const categoryId = parseMaterialCategoryId(args.category_id);
  await assertMaterialCategoryExists(env, categoryId);
  const before = (await readMaterials(env)).find((material) => material.id === materialId);
  if (!before) throw httpError(404, "material not found");
  const beforeCategoryId = before.category_id === null ? null : Number(before.category_id);
  if (beforeCategoryId === categoryId) {
    return { moved: false, before, material: before };
  }
  await updateMaterial(env, materialId, { category_id: categoryId });
  const material = (await readMaterials(env)).find((item) => item.id === materialId);
  return { moved: true, before, material };
}

async function reorderMcpCurriculumMaterialsInCategory(env, args) {
  if (args.category_id === undefined) throw httpError(400, "category_id is required");
  const categoryId = parseMaterialCategoryId(args.category_id);
  if (!Array.isArray(args.material_ids) || args.material_ids.length < 1 || args.material_ids.length > 500) {
    throw httpError(400, "material_ids must contain between 1 and 500 items");
  }
  const materialIds = args.material_ids.map((value) => positiveInteger(value, "material_id"));
  await reorderMaterialsInCategory(env, { category_id: categoryId, material_ids: materialIds });
  const materials = (await readMaterials(env)).filter(
    (material) => (material.category_id === null ? null : Number(material.category_id)) === categoryId
  );
  const category = categoryId === null
    ? { id: null, name: "未分類" }
    : (await readMaterialCategories(env)).find((item) => item.id === categoryId);
  return { category, count: materials.length, materials };
}

async function createMcpMaterialChapters(env, args) {
  await ensureCurriculumIntegrity(env);
  const materialId = positiveInteger(args.material_id, "material_id");
  if (!Array.isArray(args.chapter_names) || args.chapter_names.length < 1 || args.chapter_names.length > 100) {
    throw httpError(400, "chapter_names must contain between 1 and 100 items");
  }
  const material = await env.DB.prepare("SELECT * FROM materials WHERE id = ?")
    .bind(materialId)
    .first();
  if (!material) throw httpError(404, "material not found");

  const names = [];
  const seen = new Set();
  for (const value of args.chapter_names) {
    const name = normalizeCurriculumText(value, "chapter_name");
    const key = name.toLocaleLowerCase("ja");
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  const chapters = [];
  let createdCount = 0;
  for (const name of names) {
    let chapter = await env.DB.prepare(
      "SELECT * FROM material_chapters WHERE material_id = ? AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1"
    )
      .bind(materialId, name)
      .first();
    let created = false;
    if (!chapter) {
      chapter = await createChapter(env, materialId, { name });
      created = true;
      createdCount += 1;
    }
    chapters.push({ ...chapter, created });
  }
  return {
    material: { id: material.id, name: material.name },
    created_count: createdCount,
    existing_count: chapters.length - createdCount,
    chapters,
  };
}

async function updateMcpCurriculumMaterial(env, args) {
  const materialId = positiveInteger(args.material_id, "material_id");
  const name = normalizeCurriculumText(args.name, "name");
  const before = await env.DB.prepare("SELECT * FROM materials WHERE id = ?")
    .bind(materialId)
    .first();
  if (!before) throw httpError(404, "material not found");
  const duplicate = await env.DB.prepare(
    "SELECT id FROM materials WHERE id <> ? AND lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1"
  )
    .bind(materialId, name)
    .first();
  if (duplicate) throw httpError(409, "another material already uses this name");
  const material = await updateMaterial(env, materialId, { name });
  return { before, material };
}

async function readMcpMaterialChapter(env, chapterId) {
  return env.DB.prepare(
    `SELECT c.*, m.name AS material_name
     FROM material_chapters c
     JOIN materials m ON m.id = c.material_id
     WHERE c.id = ?`
  )
    .bind(chapterId)
    .first();
}

async function updateMcpMaterialChapter(env, args) {
  await ensureCurriculumIntegrity(env);
  const chapterId = positiveInteger(args.chapter_id, "chapter_id");
  const name = normalizeCurriculumText(args.name, "name");
  const before = await readMcpMaterialChapter(env, chapterId);
  if (!before) throw httpError(404, "chapter not found");
  const duplicate = await env.DB.prepare(
    `SELECT id FROM material_chapters
     WHERE material_id = ? AND id <> ? AND lower(trim(name)) = lower(trim(?))
     ORDER BY id LIMIT 1`
  )
    .bind(before.material_id, chapterId, name)
    .first();
  if (duplicate) throw httpError(409, "another chapter in this material already uses this name");
  let chapter;
  try {
    chapter = await updateChapter(env, chapterId, { name });
  } catch (err) {
    if (String(err?.message || "").toLowerCase().includes("unique")) {
      throw httpError(409, "another chapter in this material already uses this name");
    }
    throw err;
  }
  return { before, chapter: { ...chapter, material_name: before.material_name } };
}

async function reorderMcpMaterialChapters(env, args) {
  await ensureCurriculumIntegrity(env);
  const materialId = positiveInteger(args.material_id, "material_id");
  if (!Array.isArray(args.chapter_ids) || args.chapter_ids.length < 1 || args.chapter_ids.length > 500) {
    throw httpError(400, "chapter_ids must contain between 1 and 500 items");
  }
  const requestedIds = args.chapter_ids.map((value) => positiveInteger(value, "chapter_id"));
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw httpError(400, "chapter_ids must not contain duplicates");
  }
  const material = await env.DB.prepare("SELECT id, name FROM materials WHERE id = ?")
    .bind(materialId)
    .first();
  if (!material) throw httpError(404, "material not found");
  const { results: current } = await env.DB.prepare(
    "SELECT id FROM material_chapters WHERE material_id = ? ORDER BY sort_order, id"
  )
    .bind(materialId)
    .all();
  const currentIds = current.map((chapter) => Number(chapter.id));
  if (
    currentIds.length !== requestedIds.length ||
    currentIds.some((chapterId) => !requestedIds.includes(chapterId))
  ) {
    throw httpError(409, "chapter_ids must contain every current chapter in this material exactly once");
  }
  await runDbStatements(
    env,
    requestedIds.map((chapterId, index) =>
      env.DB.prepare("UPDATE material_chapters SET sort_order = ? WHERE id = ? AND material_id = ?")
        .bind(index, chapterId, materialId)
    )
  );
  return { material, chapters: await readChapters(env, materialId) };
}

function assertExpectedChapterName(chapter, expectedName, fieldName) {
  const expected = normalizeCurriculumText(expectedName, fieldName);
  if (String(chapter.name).trim().toLocaleLowerCase("ja") !== expected.toLocaleLowerCase("ja")) {
    throw httpError(409, `${fieldName} does not match the current chapter name`);
  }
}

async function mergeMcpMaterialChapters(env, args) {
  await ensureCurriculumIntegrity(env);
  const sourceChapterId = positiveInteger(args.source_chapter_id, "source_chapter_id");
  const targetChapterId = positiveInteger(args.target_chapter_id, "target_chapter_id");
  if (sourceChapterId === targetChapterId) {
    throw httpError(400, "source_chapter_id and target_chapter_id must be different");
  }
  const [source, target] = await Promise.all([
    readMcpMaterialChapter(env, sourceChapterId),
    readMcpMaterialChapter(env, targetChapterId),
  ]);
  if (!source) throw httpError(404, "source chapter not found");
  if (!target) throw httpError(404, "target chapter not found");
  assertExpectedChapterName(source, args.expected_source_name, "expected_source_name");
  if (source.material_id !== target.material_id) {
    throw httpError(409, "source and target chapters must belong to the same material");
  }

  const { results: progressRows } = await env.DB.prepare(
    "SELECT name, completed, updated_at FROM chapter_progress WHERE chapter_id = ?"
  )
    .bind(sourceChapterId)
    .all();
  const statements = progressRows.map((progress) =>
    env.DB.prepare(
      `INSERT INTO chapter_progress (name, chapter_id, completed, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(name, chapter_id) DO UPDATE SET
         completed = CASE
           WHEN chapter_progress.completed = 1 OR excluded.completed = 1 THEN 1
           ELSE 0
         END,
         updated_at = CASE
           WHEN COALESCE(chapter_progress.updated_at, '') >= COALESCE(excluded.updated_at, '')
             THEN chapter_progress.updated_at
           ELSE excluded.updated_at
         END`
    ).bind(progress.name, targetChapterId, progress.completed ? 1 : 0, progress.updated_at)
  );
  statements.push(
    env.DB.prepare("DELETE FROM chapter_progress WHERE chapter_id = ?").bind(sourceChapterId),
    env.DB.prepare("DELETE FROM material_chapters WHERE id = ?").bind(sourceChapterId)
  );
  await runDbStatements(env, statements);
  await resequenceMaterialChapters(env, source.material_id);
  return {
    merged: true,
    source_chapter: source,
    target_chapter: await readMcpMaterialChapter(env, targetChapterId),
    migrated_progress_count: progressRows.length,
  };
}

async function deleteMcpMaterialChapter(env, args) {
  await ensureCurriculumIntegrity(env);
  const chapterId = positiveInteger(args.chapter_id, "chapter_id");
  const chapter = await readMcpMaterialChapter(env, chapterId);
  if (!chapter) throw httpError(404, "chapter not found");
  assertExpectedChapterName(chapter, args.expected_name, "expected_name");
  const progress = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM chapter_progress WHERE chapter_id = ?"
  )
    .bind(chapterId)
    .first();
  const progressCount = Number(progress?.count || 0);
  if (progressCount > 0) {
    throw httpError(409, "chapter has student progress; merge it into another chapter before deletion");
  }
  await env.DB.prepare("DELETE FROM material_chapters WHERE id = ?").bind(chapterId).run();
  await resequenceMaterialChapters(env, chapter.material_id);
  return { deleted: true, chapter, deleted_progress_count: 0 };
}

async function readMcpStudentMaterials(env, args) {
  const name = normalizeCurriculumText(args.name, "name");
  const materials = await readStudentMaterials(env, name);
  let completedChapters = 0;
  let totalChapters = 0;
  for (const material of materials) {
    totalChapters += material.chapters.length;
    completedChapters += material.chapters.filter((chapter) => Boolean(chapter.completed)).length;
  }
  return {
    name,
    material_count: materials.length,
    completed_chapters: completedChapters,
    total_chapters: totalChapters,
    materials,
  };
}

async function assignMcpMaterialToStudent(env, args) {
  const name = normalizeCurriculumText(args.name, "name");
  const materialId = positiveInteger(args.material_id, "material_id");
  const material = await env.DB.prepare("SELECT * FROM materials WHERE id = ?")
    .bind(materialId)
    .first();
  if (!material) throw httpError(404, "material not found");

  const existing = await env.DB.prepare(
    "SELECT * FROM student_materials WHERE name = ? AND material_id = ?"
  )
    .bind(name, materialId)
    .first();
  const link = existing || (await addStudentMaterial(env, { name, material_id: materialId }));
  const chapters = await readChapters(env, materialId);
  return {
    created: !existing,
    link: {
      ...link,
      name,
      material_id: materialId,
      material_name: material.name,
      chapter_count: chapters.length,
    },
  };
}

async function setMcpChapterCompletion(env, args) {
  const name = normalizeCurriculumText(args.name, "name");
  const chapterId = positiveInteger(args.chapter_id, "chapter_id");
  if (typeof args.completed !== "boolean") {
    throw httpError(400, "completed must be boolean");
  }
  const chapter = await env.DB.prepare(
    "SELECT c.id, c.name, c.material_id, m.name AS material_name FROM material_chapters c JOIN materials m ON m.id = c.material_id WHERE c.id = ?"
  )
    .bind(chapterId)
    .first();
  if (!chapter) throw httpError(404, "chapter not found");

  const assignment = await env.DB.prepare(
    "SELECT id FROM student_materials WHERE name = ? AND material_id = ?"
  )
    .bind(name, chapter.material_id)
    .first();
  if (!assignment) {
    throw httpError(409, "material is not assigned to this student");
  }

  await setChapterProgress(env, name, chapterId, args.completed);
  return {
    name,
    chapter_id: chapter.id,
    chapter_name: chapter.name,
    material_id: chapter.material_id,
    material_name: chapter.material_name,
    completed: args.completed,
  };
}

function studentProfileSnapshot(row) {
  return {
    exists: Boolean(row?.name),
    print_name: row?.print_name ?? null,
    memo: row?.memo ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

function equalStudentProfileSnapshots(left, right) {
  const normalize = (value) =>
    value && Object.prototype.hasOwnProperty.call(value, "exists")
      ? {
          exists: Boolean(value.exists),
          print_name: value.print_name ?? null,
          memo: value.memo ?? null,
          updated_at: value.updated_at ?? null,
        }
      : studentProfileSnapshot(value);
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function studentProfileField(args, field, maxLength) {
  if (!Object.prototype.hasOwnProperty.call(args, field)) {
    return { provided: false, value: undefined };
  }
  const value = args[field];
  if (value !== null && typeof value !== "string") {
    throw httpError(400, field + " must be string or null");
  }
  if (typeof value === "string" && value.length > maxLength) {
    throw httpError(400, field + " is too long");
  }
  if (value === null || !value.trim()) return { provided: true, value: null };
  return {
    provided: true,
    value: field === "print_name" ? value.trim() : value,
  };
}

async function readMcpStudentProfile(env, args = {}) {
  const name = normalizeCurriculumText(args.name, "name");
  const profile = await readStudentPref(env, name);
  return { name, ...studentProfileSnapshot(profile) };
}

async function updateMcpStudentProfile(env, args = {}) {
  await ensureMcpFeatureSchema(env);
  const name = normalizeCurriculumText(args.name, "name");
  const memo = studentProfileField(args, "memo", 20000);
  const printName = studentProfileField(args, "print_name", 200);
  if (!memo.provided && !printName.provided) {
    throw httpError(400, "memo or print_name is required");
  }

  const beforeRow = await readStudentPref(env, name);
  const before = studentProfileSnapshot(beforeRow);
  const nextPrintName = printName.provided ? printName.value : before.print_name;
  const nextMemo = memo.provided ? memo.value : before.memo;
  if (nextPrintName === before.print_name && nextMemo === before.memo) {
    return { updated: false, change_id: null, profile: { name, ...before } };
  }

  const updatedAt = new Date().toISOString();
  const after = {
    exists: true,
    print_name: nextPrintName,
    memo: nextMemo,
    updated_at: updatedAt,
  };
  const changedFields = [
    ...(nextPrintName !== before.print_name ? ["print_name"] : []),
    ...(nextMemo !== before.memo ? ["memo"] : []),
  ];
  const changeId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO student_prefs (name, print_name, memo, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET print_name = excluded.print_name,
        memo = excluded.memo, updated_at = excluded.updated_at`)
      .bind(name, nextPrintName, nextMemo, updatedAt),
    env.DB.prepare(`INSERT INTO mcp_student_profile_changes
      (id, name, action, changed_fields, before_json, after_json)
      VALUES (?, ?, 'update', ?, ?, ?)`)
      .bind(changeId, name, JSON.stringify(changedFields), JSON.stringify(before), JSON.stringify(after)),
  ]);
  return { updated: true, change_id: changeId, changed_fields: changedFields, profile: { name, ...after } };
}

async function readStudentProfileChangeHistory(env, args = {}) {
  await ensureMcpFeatureSchema(env);
  const name = normalizeCurriculumText(args.name, "name");
  const limit = readBoundedInteger(args.limit, 20, 1, 100, "limit");
  const { results } = await env.DB.prepare(
    "SELECT * FROM mcp_student_profile_changes WHERE name = ? ORDER BY created_at DESC, rowid DESC LIMIT ?"
  )
    .bind(name, limit)
    .all();
  const changes = results.map((row) => ({
    ...row,
    changed_fields: parseJsonColumn(row.changed_fields, []),
    before: parseJsonColumn(row.before_json, null),
    after: parseJsonColumn(row.after_json, null),
    before_json: undefined,
    after_json: undefined,
  }));
  return { name, count: changes.length, changes };
}

async function undoStudentProfileUpdate(env, args = {}) {
  await ensureMcpFeatureSchema(env);
  const changeId = String(args.change_id || "").trim();
  if (!changeId) throw httpError(400, "change_id is required");
  const change = await env.DB.prepare(
    "SELECT * FROM mcp_student_profile_changes WHERE id = ?"
  )
    .bind(changeId)
    .first();
  if (!change) throw httpError(404, "student profile change not found");
  if (change.action !== "update") throw httpError(409, "only update changes can be undone");
  if (change.undone_by) throw httpError(409, "student profile change was already undone");

  const before = parseJsonColumn(change.before_json, null);
  const after = parseJsonColumn(change.after_json, null);
  const current = studentProfileSnapshot(await readStudentPref(env, change.name));
  if (!equalStudentProfileSnapshots(current, after)) {
    throw httpError(409, "student profile changed after this history entry; undo stopped");
  }

  const restoredAt = new Date().toISOString();
  const restoredSnapshot = before.exists
    ? { ...before, updated_at: restoredAt }
    : studentProfileSnapshot(null);
  const restoreStatement = before.exists
    ? env.DB.prepare(`INSERT INTO student_prefs (name, print_name, memo, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET print_name = excluded.print_name,
          memo = excluded.memo, updated_at = excluded.updated_at`)
        .bind(change.name, before.print_name, before.memo, restoredAt)
    : env.DB.prepare("DELETE FROM student_prefs WHERE name = ?").bind(change.name);
  const undoId = crypto.randomUUID();
  await env.DB.batch([
    restoreStatement,
    env.DB.prepare(`INSERT INTO mcp_student_profile_changes
      (id, name, action, changed_fields, before_json, after_json)
      VALUES (?, ?, 'undo', ?, ?, ?)`)
      .bind(undoId, change.name, change.changed_fields, JSON.stringify(current), JSON.stringify(restoredSnapshot)),
    env.DB.prepare("UPDATE mcp_student_profile_changes SET undone_by = ? WHERE id = ?")
      .bind(undoId, changeId),
  ]);
  const restored = studentProfileSnapshot(await readStudentPref(env, change.name));
  return {
    name: change.name,
    undone_change_id: changeId,
    undo_change_id: undoId,
    restored: { name: change.name, ...restored },
  };
}

function normalizeMcpToolName(value) {
  return String(value || "")
    .trim()
    .replace(/^works[./_]/, "");
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
      serverInfo: { name: "works-schedule", version: "1.10.0" },
      instructions:
        "Use search_schedules to find exact event_id and calendar_id values before schedule writes. Use get_student_profile before updating a student memo or print name, and get_student_profile_change_history before undoing a profile update. Use list_material_categories before creating, renaming, reordering, or moving material categories, and list_curriculum_materials before creating, moving, renaming, reordering, merging, or deleting curriculum materials and chapters. Use get_student_materials before updating chapter completion. For SS project changes based on email, read the relevant email, call list_ss_projects before every write, then call create_ss_project or update_ss_project with the exact Gmail message_id and subject when available. Do not infer a deadline or status that the email does not establish. Merge duplicate chapters to preserve student progress; delete_material_chapter refuses to remove a chapter that has progress. Use briefing and progress tools to prepare and report, history before undoing changes, search_materials before linking a file, and preview_reschedule before apply_reschedule. Dates use Asia/Tokyo. Update tools preserve fields that are not supplied; pass null to clear a text field where supported.",
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
    const toolName = normalizeMcpToolName(params.name);
    if (toolName === "get_schedule") {
      const searchParams = new URLSearchParams();
      if (args.date) searchParams.set("date", String(args.date));
      if (args.include_excluded) searchParams.set("include_excluded", "true");
      return mcpToolResult(id, await readSchedule(env, searchParams));
    }
    if (toolName === "search_schedules") {
      return mcpToolResult(id, await searchSchedules(env, args));
    }
    if (toolName === "get_today_briefing") {
      return mcpToolResult(id, await readTodayBriefing(env, args));
    }
    if (toolName === "get_unrecorded_lessons") {
      return mcpToolResult(id, await readUnrecordedLessons(env, args));
    }
    if (toolName === "update_schedule") {
      return mcpToolResult(id, await updateScheduleFromArguments(env, args));
    }
    if (toolName === "update_schedules") {
      return mcpToolResult(id, await updateSchedulesFromArguments(env, args));
    }
    if (toolName === "get_student_profile") {
      return mcpToolResult(id, await readMcpStudentProfile(env, args));
    }
    if (toolName === "update_student_profile") {
      return mcpToolResult(id, await updateMcpStudentProfile(env, args));
    }
    if (toolName === "get_student_profile_change_history") {
      return mcpToolResult(id, await readStudentProfileChangeHistory(env, args));
    }
    if (toolName === "undo_student_profile_update") {
      return mcpToolResult(id, await undoStudentProfileUpdate(env, args));
    }
    if (toolName === "get_student_overview") {
      return mcpToolResult(id, await readStudentOverview(env, args));
    }
    if (toolName === "get_curriculum_progress") {
      return mcpToolResult(id, await readCurriculumProgress(env, args));
    }
    if (toolName === "get_schedule_change_history") {
      return mcpToolResult(id, await readScheduleChangeHistory(env, args));
    }
    if (toolName === "undo_schedule_update") {
      return mcpToolResult(id, await undoScheduleUpdate(env, args));
    }
    if (toolName === "list_material_categories") {
      return mcpToolResult(id, await listMcpMaterialCategories(env));
    }
    if (toolName === "create_material_category") {
      return mcpToolResult(id, await createMcpMaterialCategory(env, args));
    }
    if (toolName === "update_material_category") {
      return mcpToolResult(id, await updateMcpMaterialCategory(env, args));
    }
    if (toolName === "reorder_material_categories") {
      return mcpToolResult(id, await reorderMcpMaterialCategories(env, args));
    }
    if (toolName === "list_curriculum_materials") {
      return mcpToolResult(id, await listMcpCurriculumMaterials(env, args));
    }
    if (toolName === "create_curriculum_material") {
      return mcpToolResult(id, await createMcpCurriculumMaterial(env, args));
    }
    if (toolName === "create_material_chapters") {
      return mcpToolResult(id, await createMcpMaterialChapters(env, args));
    }
    if (toolName === "update_curriculum_material") {
      return mcpToolResult(id, await updateMcpCurriculumMaterial(env, args));
    }
    if (toolName === "move_curriculum_material_to_category") {
      return mcpToolResult(id, await moveMcpCurriculumMaterialToCategory(env, args));
    }
    if (toolName === "reorder_curriculum_materials_in_category") {
      return mcpToolResult(id, await reorderMcpCurriculumMaterialsInCategory(env, args));
    }
    if (toolName === "update_material_chapter") {
      return mcpToolResult(id, await updateMcpMaterialChapter(env, args));
    }
    if (toolName === "reorder_material_chapters") {
      return mcpToolResult(id, await reorderMcpMaterialChapters(env, args));
    }
    if (toolName === "merge_material_chapters") {
      return mcpToolResult(id, await mergeMcpMaterialChapters(env, args));
    }
    if (toolName === "delete_material_chapter") {
      return mcpToolResult(id, await deleteMcpMaterialChapter(env, args));
    }
    if (toolName === "get_student_materials") {
      return mcpToolResult(id, await readMcpStudentMaterials(env, args));
    }
    if (toolName === "assign_material_to_student") {
      return mcpToolResult(id, await assignMcpMaterialToStudent(env, args));
    }
    if (toolName === "set_chapter_completion") {
      return mcpToolResult(id, await setMcpChapterCompletion(env, args));
    }
    if (toolName === "list_ss_projects") {
      return mcpToolResult(id, await listMcpSsProjects(env, args));
    }
    if (toolName === "create_ss_project") {
      return mcpToolResult(id, await createSsProject(env, args));
    }
    if (toolName === "update_ss_project") {
      return mcpToolResult(id, await updateSsProject(env, args));
    }
    if (toolName === "search_materials") {
      return mcpToolResult(id, await searchMcpMaterials(env, args));
    }
    if (toolName === "link_material_to_schedule") {
      return mcpToolResult(id, await linkMaterialToSchedule(env, args));
    }
    if (toolName === "unlink_material_from_schedule") {
      return mcpToolResult(id, await unlinkMaterialFromSchedule(env, args));
    }
    if (toolName === "preview_reschedule") {
      return mcpToolResult(id, await previewReschedule(env, args));
    }
    if (toolName === "apply_reschedule") {
      return mcpToolResult(id, await applyReschedule(env, args));
    }
    if (toolName === "get_monthly_report") {
      return mcpToolResult(id, await readMonthlyReport(env, args));
    }
    if (toolName === "get_schedule_data_health") {
      return mcpToolResult(id, await readScheduleDataHealth(env));
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
  const filteredEvents = eventGroups
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
    });
  const materialLinks = await readScheduleMaterialLinks(
    env,
    filteredEvents.map((event) => ({
      calendar_id: event.calendar_id,
      event_id: event.id,
    }))
  );
  return filteredEvents.map((event) => {
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
        materials:
          materialLinks.get(scheduleEventKey(event.calendar_id, event.id)) || [],
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

async function searchSchedules(env, args = {}) {
  const startDate = String(args.start_date || todayInScheduleTimeZone()).trim();
  scheduleDateRange(startDate);
  const endDate = String(args.end_date || shiftScheduleDate(startDate, 30)).trim();
  scheduleDateRange(endDate);
  const spanDays = Math.round(
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) /
      (24 * 60 * 60 * 1000)
  );
  if (spanDays < 0) throw httpError(400, "start_date must be on or before end_date");
  if (spanDays > 366) throw httpError(400, "search period must be 366 days or shorter");
  if (args.completed !== undefined && typeof args.completed !== "boolean") {
    throw httpError(400, "completed must be boolean");
  }
  const query = String(args.query || "").trim().toLocaleLowerCase("ja");
  if (query.length > 200) throw httpError(400, "query is too long");
  const limit = readBoundedInteger(args.limit, 50, 1, 200, "limit");
  const events = await readScheduleEvents(env, startDate, endDate, Boolean(args.include_excluded));
  const matches = events
    .filter((event) => !query || event.title.toLocaleLowerCase("ja").includes(query))
    .filter((event) => args.completed === undefined || event.completed === args.completed)
    .map((event) => ({ ...event, missing_fields: scheduleMissingFields(event) }))
    .filter((event) => !args.missing_only || event.missing_fields.length > 0);
  return {
    start_date: startDate,
    end_date: endDate,
    time_zone: SCHEDULE_TIME_ZONE,
    query: query || null,
    total_matches: matches.length,
    count: Math.min(matches.length, limit),
    truncated: matches.length > limit,
    events: matches.slice(0, limit),
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

function requiredStudentName(args) {
  const name = String(args?.name || "").trim();
  if (!name) throw httpError(400, "name is required");
  if (name.length > 200) throw httpError(400, "name is too long");
  return name;
}

async function resolveStudentIdentity(env, name) {
  const students = await readStudents(env);
  const student = students.find(
    (item) => String(item.name || "").trim() === name
  ) || null;
  const scheduleTitle = String(student?.calendar_tag || student?.name || name).trim();
  return { student, schedule_title: scheduleTitle };
}

function percent(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function summarizeMaterialProgress(materials) {
  const items = materials.map((material) => {
    const total = material.chapters.length;
    const completed = material.chapters.filter((chapter) => Boolean(chapter.completed)).length;
    return {
      ...material,
      progress: { total, completed, completion_rate: percent(completed, total) },
    };
  });
  const total = items.reduce((sum, item) => sum + item.progress.total, 0);
  const completed = items.reduce((sum, item) => sum + item.progress.completed, 0);
  return { total, completed, completion_rate: percent(completed, total), items };
}

async function readStudentOverview(env, args = {}) {
  const name = requiredStudentName(args);
  const historyDays = readBoundedInteger(args.history_days, 90, 1, 365, "history_days");
  const upcomingDays = readBoundedInteger(args.upcoming_days, 30, 1, 180, "upcoming_days");
  const lessonLimit = readBoundedInteger(args.lesson_limit, 10, 1, 50, "lesson_limit");
  const today = todayInScheduleTimeZone();
  const startDate = shiftScheduleDate(today, -historyDays);
  const endDate = shiftScheduleDate(today, upcomingDays);
  const identity = await resolveStudentIdentity(env, name);
  const [goals, materials, preference, candidateSchools, events] = await Promise.all([
    readGoals(env, name),
    readStudentMaterials(env, name),
    readStudentPref(env, name),
    readCandidateSchools(env, name),
    readScheduleEvents(env, startDate, endDate, false),
  ]);
  const matching = events.filter((event) => event.title === identity.schedule_title);
  const now = Date.now();
  const recentLessons = matching
    .filter((event) => Date.parse(event.start || "") < now)
    .sort((left, right) => Date.parse(right.start || "") - Date.parse(left.start || ""))
    .slice(0, lessonLimit);
  const upcomingLessons = matching
    .filter((event) => Date.parse(event.start || "") >= now)
    .slice(0, lessonLimit);
  return {
    name,
    student: identity.student,
    schedule_title: identity.schedule_title,
    preference,
    goals,
    candidate_schools: candidateSchools,
    materials: summarizeMaterialProgress(materials),
    lessons: {
      recent_count: recentLessons.length,
      upcoming_count: upcomingLessons.length,
      recent: recentLessons,
      upcoming: upcomingLessons,
    },
    generated_at: new Date().toISOString(),
  };
}

async function readCurriculumProgress(env, args = {}) {
  const name = requiredStudentName(args);
  const lookbackDays = readBoundedInteger(args.lookback_days, 180, 1, 365, "lookback_days");
  const upcomingDays = readBoundedInteger(args.upcoming_days, 90, 0, 180, "upcoming_days");
  const lessonLimit = readBoundedInteger(args.lesson_limit, 20, 1, 100, "lesson_limit");
  const today = todayInScheduleTimeZone();
  const startDate = shiftScheduleDate(today, -lookbackDays);
  const endDate = shiftScheduleDate(today, upcomingDays);
  const identity = await resolveStudentIdentity(env, name);
  const [events, materials] = await Promise.all([
    readScheduleEvents(env, startDate, endDate, false),
    readStudentMaterials(env, name),
  ]);
  const now = Date.now();
  const matching = events.filter((event) => event.title === identity.schedule_title && !event.all_day);
  const completed = matching.filter((event) => event.completed);
  const pastDue = matching.filter((event) => !event.completed && Date.parse(event.end || "") < now);
  const inProgress = matching.filter((event) => !event.completed && Date.parse(event.start || "") <= now && Date.parse(event.end || "") >= now);
  const upcoming = matching.filter((event) => !event.completed && Date.parse(event.start || "") > now);
  const elapsedTotal = completed.filter((event) => Date.parse(event.end || "") < now).length + pastDue.length;
  const elapsedCompleted = completed.filter((event) => Date.parse(event.end || "") < now).length;
  return {
    name,
    schedule_title: identity.schedule_title,
    period: { start_date: startDate, end_date: endDate },
    lesson_progress: {
      total: matching.length,
      elapsed_total: elapsedTotal,
      completed: completed.length,
      past_due: pastDue.length,
      in_progress: inProgress.length,
      upcoming: upcoming.length,
      elapsed_completion_rate: percent(elapsedCompleted, elapsedTotal),
      completed_lessons: completed.slice(-lessonLimit).reverse(),
      past_due_lessons: pastDue.slice(-lessonLimit).reverse(),
      upcoming_lessons: upcoming.slice(0, lessonLimit),
    },
    material_progress: summarizeMaterialProgress(materials),
    generated_at: new Date().toISOString(),
  };
}

function parseJsonColumn(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

async function readScheduleChangeHistory(env, args = {}) {
  await ensureMcpFeatureSchema(env);
  const limit = readBoundedInteger(args.limit, 20, 1, 100, "limit");
  const eventId = String(args.event_id || "").trim();
  const query = eventId
    ? env.DB.prepare("SELECT * FROM mcp_schedule_changes WHERE event_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").bind(eventId, limit)
    : env.DB.prepare("SELECT * FROM mcp_schedule_changes ORDER BY created_at DESC, rowid DESC LIMIT ?").bind(limit);
  const { results } = await query.all();
  const changes = results.map((row) => ({
    ...row,
    changed_fields: parseJsonColumn(row.changed_fields, []),
    before: parseJsonColumn(row.before_json, null),
    after: parseJsonColumn(row.after_json, null),
    before_json: undefined,
    after_json: undefined,
  }));
  return { count: changes.length, changes };
}

function equalCurriculumSnapshots(left, right) {
  const normalize = (value) =>
    value && Object.prototype.hasOwnProperty.call(value, "exists")
      ? {
          exists: Boolean(value.exists),
          completed: Boolean(value.completed),
          ...Object.fromEntries(
            SCHEDULE_TEXT_FIELDS.map((field) => [field, value[field] || null])
          ),
        }
      : curriculumSnapshot(value);
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

async function undoScheduleUpdate(env, args = {}) {
  await ensureMcpFeatureSchema(env);
  const changeId = String(args.change_id || "").trim();
  if (!changeId) throw httpError(400, "change_id is required");
  const change = await env.DB.prepare("SELECT * FROM mcp_schedule_changes WHERE id = ?").bind(changeId).first();
  if (!change) throw httpError(404, "schedule change not found");
  if (change.action !== "update") throw httpError(409, "only update changes can be undone");
  if (change.undone_by) throw httpError(409, "schedule change was already undone");
  const before = parseJsonColumn(change.before_json, null);
  const after = parseJsonColumn(change.after_json, null);
  const current = curriculumSnapshot(await readCurriculumEntry(env, change.event_id));
  if (!equalCurriculumSnapshots(current, after)) {
    throw httpError(409, "schedule changed after this history entry; undo stopped");
  }
  const restoreStatement = before.exists
    ? env.DB.prepare(`INSERT INTO curriculum_entries (calendar_event_id, completed, lesson_plan, confirmation_test, homework, lesson_memo, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(calendar_event_id) DO UPDATE SET completed = excluded.completed, lesson_plan = excluded.lesson_plan,
          confirmation_test = excluded.confirmation_test, homework = excluded.homework,
          lesson_memo = excluded.lesson_memo, updated_at = excluded.updated_at`)
        .bind(change.event_id, before.completed ? 1 : 0, before.lesson_plan, before.confirmation_test, before.homework, before.lesson_memo)
    : env.DB.prepare("DELETE FROM curriculum_entries WHERE calendar_event_id = ?").bind(change.event_id);
  const undoId = crypto.randomUUID();
  await env.DB.batch([
    restoreStatement,
    env.DB.prepare("INSERT INTO mcp_schedule_changes (id, event_id, action, changed_fields, before_json, after_json) VALUES (?, ?, 'undo', ?, ?, ?)")
      .bind(undoId, change.event_id, change.changed_fields, JSON.stringify(current), JSON.stringify(before)),
    env.DB.prepare("UPDATE mcp_schedule_changes SET undone_by = ? WHERE id = ?")
      .bind(undoId, changeId),
  ]);
  const restored = curriculumSnapshot(await readCurriculumEntry(env, change.event_id));
  return { undone_change_id: changeId, undo_change_id: undoId, event_id: change.event_id, restored };
}

async function searchMcpMaterials(env, args = {}) {
  const query = String(args.query || "").trim();
  if (!query) throw httpError(400, "query is required");
  if (query.length > 200) throw httpError(400, "query is too long");
  const limit = readBoundedInteger(args.limit, 20, 1, 100, "limit");
  const [files, folders] = await Promise.all([readAllMaterialFiles(env), readMaterialFolders(env)]);
  const normalized = query.toLocaleLowerCase("ja");
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  const pathFor = (folderId) => {
    const names = [];
    const visited = new Set();
    let current = folderId ? folderMap.get(folderId) : null;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      names.unshift(current.name);
      current = current.parent_id ? folderMap.get(current.parent_id) : null;
    }
    return names.join(" / ") || null;
  };
  const fileResults = files
    .filter((file) => String(file.name || "").toLocaleLowerCase("ja").includes(normalized))
    .slice(0, limit)
    .map((file) => ({ ...file, folder_path: pathFor(file.folder_id) }));
  const folderResults = folders
    .filter((folder) => String(folder.name || "").toLocaleLowerCase("ja").includes(normalized))
    .slice(0, limit)
    .map((folder) => ({ ...folder, folder_path: pathFor(folder.parent_id) }));
  return { query, file_count: fileResults.length, folder_count: folderResults.length, files: fileResults, folders: folderResults };
}

async function linkMaterialToSchedule(env, args = {}) {
  await ensureMcpFeatureSchema(env);
  const eventId = String(args.event_id || "").trim();
  const calendarId = String(args.calendar_id || "").trim();
  const materialFileId = String(args.material_file_id || "").trim();
  if (!eventId || !calendarId || !materialFileId) throw httpError(400, "event_id, calendar_id and material_file_id are required");
  const note = args.note == null ? null : String(args.note).trim() || null;
  if (note && note.length > 1000) throw httpError(400, "note is too long");
  await ensureMaterialSchema(env);
  const file = await getMaterialDb(env).prepare("SELECT id, folder_id, name, mime_type, size FROM material_files WHERE id = ?").bind(materialFileId).first();
  if (!file) throw httpError(404, "material file not found");
  const { event } = await resolveCalendarEventById(env, eventId, calendarId);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO schedule_material_links (calendar_id, event_id, material_file_id, note) VALUES (?, ?, ?, ?) ON CONFLICT(calendar_id, event_id, material_file_id) DO UPDATE SET note = excluded.note")
      .bind(calendarId, eventId, materialFileId, note),
    env.DB.prepare("DELETE FROM schedule_material_links WHERE calendar_id = '' AND event_id = ? AND material_file_id = ?")
      .bind(eventId, materialFileId),
  ]);
  return { event_id: eventId, calendar_id: calendarId, title: String(event.summary || "(無題)").trim(), material: file, note };
}

async function unlinkMaterialFromSchedule(env, args = {}) {
  await ensureMcpFeatureSchema(env);
  const eventId = String(args.event_id || "").trim();
  const calendarId = String(args.calendar_id || "").trim();
  const materialFileId = String(args.material_file_id || "").trim();
  if (!eventId || !calendarId || !materialFileId) {
    throw httpError(400, "event_id, calendar_id and material_file_id are required");
  }
  const selectedCalendars = await selectedScheduleCalendarIds(env);
  if (!selectedCalendars.includes(calendarId)) {
    throw httpError(403, "calendar is not selected in WORKS settings");
  }
  const existing = await env.DB.prepare("SELECT * FROM schedule_material_links WHERE calendar_id = ? AND event_id = ? AND material_file_id = ?")
    .bind(calendarId, eventId, materialFileId)
    .first();
  if (!existing) throw httpError(404, "material link not found");
  await env.DB.prepare("DELETE FROM schedule_material_links WHERE calendar_id = ? AND event_id = ? AND material_file_id = ?")
    .bind(calendarId, eventId, materialFileId)
    .run();
  return {
    calendar_id: calendarId,
    event_id: eventId,
    material_file_id: materialFileId,
    unlinked: true,
  };
}

function scheduleEventKey(calendarId, eventId) {
  return `${calendarId}\u0000${eventId}`;
}

async function readScheduleMaterialLinks(env, events) {
  const result = new Map();
  if (!events.length) return result;
  await ensureMcpFeatureSchema(env);
  const wanted = new Set(
    events.map((event) => scheduleEventKey(event.calendar_id, event.event_id))
  );
  const { results: links } = await env.DB.prepare("SELECT * FROM schedule_material_links").all();
  const relevant = links.filter((link) =>
    wanted.has(scheduleEventKey(link.calendar_id, link.event_id))
  );
  if (!relevant.length) return result;
  const files = await readAllMaterialFiles(env);
  const fileMap = new Map(files.map((file) => [file.id, file]));
  for (const link of relevant) {
    const file = fileMap.get(link.material_file_id);
    if (!file) continue;
    const key = scheduleEventKey(link.calendar_id, link.event_id);
    const items = result.get(key) || [];
    items.push({ ...file, note: link.note || null, linked_at: link.created_at });
    result.set(key, items);
  }
  return result;
}

function requireRfc3339DateTime(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || !Number.isFinite(Date.parse(text))) {
    throw httpError(400, `${fieldName} must be RFC3339 with a timezone offset`);
  }
  return text;
}

async function fetchCalendarEvent(env, calendarId, eventId) {
  const token = await mintGoogleAccessToken(env);
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (res.status === 404) throw httpError(404, "calendar event not found");
  if (!res.ok) throw httpError(502, `Google Calendar API error (${res.status})`);
  return { event: await res.json(), access_token: token.access_token };
}

async function previewReschedule(env, args = {}) {
  const calendarId = String(args.calendar_id || "").trim();
  const eventId = String(args.event_id || "").trim();
  if (!calendarId || !eventId) throw httpError(400, "calendar_id and event_id are required");
  const settings = await readSettings(env);
  const selectedCalendars = Array.isArray(settings.selected_calendars)
    ? settings.selected_calendars.map(String)
    : [];
  if (!selectedCalendars.includes(calendarId)) throw httpError(403, "calendar is not selected in WORKS settings");
  const newStart = requireRfc3339DateTime(args.new_start, "new_start");
  const newEnd = requireRfc3339DateTime(args.new_end, "new_end");
  if (Date.parse(newEnd) <= Date.parse(newStart)) throw httpError(400, "new_end must be after new_start");
  if (Date.parse(newEnd) - Date.parse(newStart) > 24 * 60 * 60 * 1000) throw httpError(400, "rescheduled lesson must be 24 hours or shorter");
  const { event } = await fetchCalendarEvent(env, calendarId, eventId);
  if (!event.start?.dateTime || !event.end?.dateTime) throw httpError(409, "all-day events cannot be rescheduled by this tool");
  const payload = {
    aud: "works-reschedule",
    exp: Date.now() + 10 * 60 * 1000,
    calendar_id: calendarId,
    event_id: eventId,
    title: String(event.summary || "(無題)").trim(),
    current_start: event.start.dateTime,
    current_end: event.end.dateTime,
    new_start: newStart,
    new_end: newEnd,
  };
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const confirmationToken = `${encoded}.${await hmacSign(env, encoded)}`;
  return { title: payload.title, current: { start: payload.current_start, end: payload.current_end }, proposed: { start: newStart, end: newEnd }, confirmation_token: confirmationToken, expires_at: new Date(payload.exp).toISOString() };
}

async function applyReschedule(env, args = {}) {
  const token = String(args.confirmation_token || "").trim();
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || !(await constantTimeEqual(signature, await hmacSign(env, encoded)))) throw httpError(400, "invalid confirmation_token");
  let payload;
  try { payload = JSON.parse(fromBase64Url(encoded)); } catch { throw httpError(400, "invalid confirmation_token"); }
  if (payload.aud !== "works-reschedule" || !payload.exp || payload.exp < Date.now()) throw httpError(409, "confirmation_token expired; preview again");
  const { event, access_token: accessToken } = await fetchCalendarEvent(env, payload.calendar_id, payload.event_id);
  if (event.start?.dateTime !== payload.current_start || event.end?.dateTime !== payload.current_end) throw httpError(409, "calendar event changed after preview; preview again");
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(payload.calendar_id)}/events/${encodeURIComponent(payload.event_id)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ start: { dateTime: payload.new_start, timeZone: SCHEDULE_TIME_ZONE }, end: { dateTime: payload.new_end, timeZone: SCHEDULE_TIME_ZONE } }),
  });
  if (res.status === 401 || res.status === 403) throw httpError(403, "Google Calendar edit permission is required; sign in to WORKS again to grant it");
  if (!res.ok) throw httpError(502, `Google Calendar API error (${res.status})`);
  const updated = await res.json();
  return { calendar_id: payload.calendar_id, event_id: payload.event_id, title: String(updated.summary || payload.title).trim(), start: updated.start?.dateTime || null, end: updated.end?.dateTime || null, updated_at: updated.updated || new Date().toISOString() };
}

function scheduleMonthRange(value) {
  const month = String(value || todayInScheduleTimeZone().slice(0, 7)).trim();
  if (!/^\d{4}-\d{2}$/.test(month)) throw httpError(400, "month must be YYYY-MM");
  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber < 1 || monthNumber > 12) throw httpError(400, "month is invalid");
  const startDate = `${month}-01`;
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  const endDate = shiftScheduleDate(nextMonth, -1);
  return { month, startDate, endDate };
}

async function readMonthlyReport(env, args = {}) {
  const { month, startDate, endDate } = scheduleMonthRange(args.month);
  const name = String(args.name || "").trim();
  const identity = name ? await resolveStudentIdentity(env, name) : null;
  const scheduleTitle = identity?.schedule_title || null;
  const events = (await readScheduleEvents(env, startDate, endDate, false))
    .filter((event) => !event.all_day && (!scheduleTitle || event.title === scheduleTitle));
  const now = Date.now();
  const elapsed = events.filter((event) => Date.parse(event.end || "") < now);
  const completed = elapsed.filter((event) => event.completed);
  const unrecorded = elapsed.filter((event) => !event.completed);
  const missingFields = Object.fromEntries(SCHEDULE_TEXT_FIELDS.map((field) => [field, events.filter((event) => !event[field]).length]));
  const grouped = new Map();
  for (const event of events) {
    const summary = grouped.get(event.title) || { title: event.title, total: 0, elapsed: 0, completed: 0, unrecorded: 0 };
    summary.total += 1;
    if (Date.parse(event.end || "") < now) {
      summary.elapsed += 1;
      if (event.completed) summary.completed += 1;
      else summary.unrecorded += 1;
    }
    grouped.set(event.title, summary);
  }
  const byTitle = [...grouped.values()].map((item) => ({ ...item, completion_rate: percent(item.completed, item.elapsed) })).sort((left, right) => left.title.localeCompare(right.title, "ja"));
  return {
    month,
    name: name || null,
    schedule_title: scheduleTitle,
    time_zone: SCHEDULE_TIME_ZONE,
    totals: { lessons: events.length, elapsed: elapsed.length, completed: completed.length, unrecorded: unrecorded.length, completion_rate: percent(completed.length, elapsed.length) },
    missing_fields: missingFields,
    by_title: byTitle,
    unrecorded_lessons: unrecorded,
    generated_at: new Date().toISOString(),
  };
}

function duplicateValues(rows, field) {
  const grouped = new Map();
  for (const row of rows) {
    const value = String(row[field] || "").trim();
    if (!value) continue;
    const items = grouped.get(value) || [];
    items.push(row.id ?? row.name);
    grouped.set(value, items);
  }
  return [...grouped.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([value, items]) => ({ value, records: items }));
}

function duplicateCurriculumMaterials(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const normalized = String(row.name || "").trim().toLocaleLowerCase("ja");
    if (!normalized) continue;
    const group = grouped.get(normalized) || { value: String(row.name).trim(), records: [] };
    group.records.push(row.id);
    grouped.set(normalized, group);
  }
  return [...grouped.values()].filter((group) => group.records.length > 1);
}

function duplicateCurriculumChapters(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const normalized = String(row.name || "").trim().toLocaleLowerCase("ja");
    if (!normalized) continue;
    const key = `${row.material_id}:${normalized}`;
    const group = grouped.get(key) || {
      material_id: row.material_id,
      material_name: row.material_name,
      value: String(row.name).trim(),
      records: [],
    };
    group.records.push(row.id);
    grouped.set(key, group);
  }
  return [...grouped.values()].filter((group) => group.records.length > 1);
}

async function readScheduleDataHealth(env) {
  await Promise.all([
    ensureMcpFeatureSchema(env),
    ensureCurriculumIntegrity(env),
    ensureMaterialCategorySchema(env),
  ]);
  const [settings, students, links, files, orphanStudentMaterials, orphanChapterProgress, materialCategories, curriculumMaterials, curriculumChapters] = await Promise.all([
    readSettings(env),
    readStudents(env),
    env.DB.prepare("SELECT * FROM schedule_material_links").all(),
    readAllMaterialFiles(env),
    env.DB.prepare("SELECT sm.id, sm.name, sm.material_id FROM student_materials sm LEFT JOIN materials m ON m.id = sm.material_id WHERE m.id IS NULL").all(),
    env.DB.prepare("SELECT p.name, p.chapter_id FROM chapter_progress p LEFT JOIN material_chapters c ON c.id = p.chapter_id WHERE c.id IS NULL").all(),
    readMaterialCategories(env),
    env.DB.prepare("SELECT id, name FROM materials ORDER BY sort_order, id").all(),
    env.DB.prepare("SELECT c.id, c.material_id, c.name, m.name AS material_name FROM material_chapters c JOIN materials m ON m.id = c.material_id ORDER BY c.material_id, c.sort_order, c.id").all(),
  ]);
  const selectedCalendars = Array.isArray(settings.selected_calendars)
    ? [...new Set(settings.selected_calendars.map(String).filter(Boolean))]
    : [];
  const fileIds = new Set(files.map((file) => file.id));
  const legacyMaterialLinks = links.results.filter((link) => !link.calendar_id);
  const missingMaterialFiles = links.results.filter(
    (link) => !fileIds.has(link.material_file_id)
  );
  const unselectedCalendarLinks = links.results.filter(
    (link) => link.calendar_id && !selectedCalendars.includes(link.calendar_id)
  );
  const missingCalendarEvents = [];
  let calendarValidationError = null;
  let calendarValidationChecked = 0;
  let calendarValidationTruncated = false;
  if (selectedCalendars.length) {
    try {
      const lookupContext = await createCalendarLookupContext(env);
      const linksToValidate = links.results.filter(
        (link) => link.calendar_id && selectedCalendars.includes(link.calendar_id)
      );
      calendarValidationTruncated = linksToValidate.length > 40;
      for (const link of linksToValidate.slice(0, 40)) {
        const event = await fetchCalendarEventWithToken(
          lookupContext.access_token,
          link.calendar_id,
          link.event_id
        );
        calendarValidationChecked += 1;
        if (!event || event.status === "cancelled") missingCalendarEvents.push(link);
      }
    } catch (err) {
      calendarValidationError = err?.message || String(err);
    }
  }
  const duplicateStudentNames = duplicateValues(students, "name");
  const duplicateCalendarTags = duplicateValues(students, "calendar_tag");
  const duplicateMaterials = duplicateCurriculumMaterials(curriculumMaterials.results);
  const duplicateChapters = duplicateCurriculumChapters(curriculumChapters.results);
  const issues = {
    missing_selected_calendars: selectedCalendars.length === 0,
    duplicate_student_names: duplicateStudentNames,
    duplicate_calendar_tags: duplicateCalendarTags,
    duplicate_curriculum_materials: duplicateMaterials,
    duplicate_material_chapters: duplicateChapters,
    legacy_material_links: legacyMaterialLinks,
    missing_material_files: missingMaterialFiles,
    unselected_calendar_links: unselectedCalendarLinks,
    missing_calendar_events: missingCalendarEvents,
    orphan_student_materials: orphanStudentMaterials.results,
    orphan_chapter_progress: orphanChapterProgress.results,
    calendar_validation_error: calendarValidationError,
  };
  const issueCount =
    (issues.missing_selected_calendars ? 1 : 0) +
    (calendarValidationError ? 1 : 0) +
    Object.values(issues)
      .filter(Array.isArray)
      .reduce((sum, items) => sum + items.length, 0);
  return {
    healthy: issueCount === 0,
    issue_count: issueCount,
    selected_calendars: selectedCalendars,
    counts: {
      students: students.length,
      material_files: files.length,
      material_links: links.results.length,
      material_categories: materialCategories.length,
      curriculum_materials: curriculumMaterials.results.length,
      material_chapters: curriculumChapters.results.length,
      calendar_links_checked: calendarValidationChecked,
    },
    calendar_validation_truncated: calendarValidationTruncated,
    issues,
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

// 教材カテゴリ。教材の親として表示順を持ち、教材が0件でも登録できる。
async function readMaterialCategories(env) {
  await ensureMaterialCategorySchema(env);
  const { results } = await env.DB.prepare(
    `SELECT c.*, COUNT(m.id) AS material_count
     FROM material_categories c
     LEFT JOIN materials m ON m.category_id = c.id
     GROUP BY c.id
     ORDER BY c.sort_order, c.id`
  ).all();
  return results;
}

async function createMaterialCategory(env, body) {
  await ensureMaterialCategorySchema(env);
  const name = normalizeCurriculumText(body.name, "name");
  const existing = await env.DB.prepare(
    "SELECT id FROM material_categories WHERE lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1"
  )
    .bind(name)
    .first();
  if (existing) throw httpError(409, "another material category already uses this name");
  const order = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM material_categories"
  ).first();
  return env.DB.prepare(
    "INSERT INTO material_categories (name, sort_order) VALUES (?, ?) RETURNING *, 0 AS material_count"
  )
    .bind(name, Number(order?.max_order ?? -1) + 1)
    .first();
}

async function updateMaterialCategory(env, id, body) {
  await ensureMaterialCategorySchema(env);
  const categoryId = positiveInteger(id, "category_id");
  const before = await env.DB.prepare("SELECT id FROM material_categories WHERE id = ?")
    .bind(categoryId)
    .first();
  if (!before) throw httpError(404, "material category not found");
  if (body.name === undefined) throw httpError(400, "name is required");
  const name = normalizeCurriculumText(body.name, "name");
  const duplicate = await env.DB.prepare(
    "SELECT id FROM material_categories WHERE id <> ? AND lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1"
  )
    .bind(categoryId, name)
    .first();
  if (duplicate) throw httpError(409, "another material category already uses this name");
  await env.DB.prepare("UPDATE material_categories SET name = ? WHERE id = ?")
    .bind(name, categoryId)
    .run();
  return env.DB.prepare(
    `SELECT c.*, COUNT(m.id) AS material_count
     FROM material_categories c
     LEFT JOIN materials m ON m.category_id = c.id
     WHERE c.id = ?
     GROUP BY c.id`
  )
    .bind(categoryId)
    .first();
}

async function reorderMaterialCategories(env, body) {
  await ensureMaterialCategorySchema(env);
  const orderedIds = body.category_ids;
  if (!Array.isArray(orderedIds)) throw httpError(400, "category_ids is required");
  const categoryIds = orderedIds.map((id) => positiveInteger(id, "category_id"));
  if (new Set(categoryIds).size !== categoryIds.length) {
    throw httpError(400, "category_ids must not contain duplicates");
  }
  const categories = await readMaterialCategories(env);
  const currentIds = categories.map((category) => category.id).sort((a, b) => a - b);
  const requestedIds = [...categoryIds].sort((a, b) => a - b);
  if (currentIds.length !== requestedIds.length || currentIds.some((id, index) => id !== requestedIds[index])) {
    throw httpError(409, "category_ids must contain every current category exactly once");
  }
  await runDbStatements(
    env,
    categoryIds.map((categoryId, index) =>
      env.DB.prepare("UPDATE material_categories SET sort_order = ? WHERE id = ?")
        .bind(index, categoryId)
    )
  );
  return readMaterialCategories(env);
}

function parseMaterialCategoryId(value, field = "category_id") {
  if (value === null || value === "") return null;
  return positiveInteger(value, field);
}

async function assertMaterialCategoryExists(env, categoryId) {
  if (categoryId === null) return;
  const category = await env.DB.prepare("SELECT id FROM material_categories WHERE id = ?")
    .bind(categoryId)
    .first();
  if (!category) throw httpError(404, "material category not found");
}

async function readMaterialIdsInCategory(env, categoryId) {
  const query = categoryId === null
    ? "SELECT id FROM materials WHERE category_id IS NULL ORDER BY sort_order, id"
    : "SELECT id FROM materials WHERE category_id = ? ORDER BY sort_order, id";
  const statement = env.DB.prepare(query);
  const { results } = categoryId === null
    ? await statement.all()
    : await statement.bind(categoryId).all();
  return results.map((material) => material.id);
}

async function resequenceMaterialsInCategory(env, categoryId) {
  const ids = await readMaterialIdsInCategory(env, categoryId);
  await runDbStatements(
    env,
    ids.map((materialId, index) =>
      env.DB.prepare("UPDATE materials SET sort_order = ? WHERE id = ?")
        .bind(index, materialId)
    )
  );
}

// 教材(materials)。カテゴリ順、その中のsort_order順で並べ替える。
async function readMaterials(env) {
  await ensureMaterialCategorySchema(env);
  const { results } = await env.DB.prepare(
    `SELECT m.*, c.name AS category_name
     FROM materials m
     LEFT JOIN material_categories c ON c.id = m.category_id
     ORDER BY CASE WHEN c.id IS NULL THEN 1 ELSE 0 END, c.sort_order, c.id, m.sort_order, m.id`
  ).all();
  return results;
}

async function createMaterial(env, body) {
  await ensureMaterialCategorySchema(env);
  const name = normalizeCurriculumText(body.name, "name");
  const categoryId = parseMaterialCategoryId(body.category_id ?? null);
  await assertMaterialCategoryExists(env, categoryId);
  const query = categoryId === null
    ? "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM materials WHERE category_id IS NULL"
    : "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM materials WHERE category_id = ?";
  const statement = env.DB.prepare(query);
  const order = categoryId === null
    ? await statement.first()
    : await statement.bind(categoryId).first();
  return env.DB.prepare(
    "INSERT INTO materials (name, category_id, sort_order) VALUES (?, ?, ?) RETURNING *"
  )
    .bind(name, categoryId, Number(order?.max_order ?? -1) + 1)
    .first();
}

async function updateMaterial(env, id, body) {
  await ensureMaterialCategorySchema(env);
  const materialId = positiveInteger(id, "material_id");
  const before = await env.DB.prepare("SELECT * FROM materials WHERE id = ?")
    .bind(materialId)
    .first();
  if (!before) throw httpError(404, "material not found");

  const fields = [];
  const values = [];
  let movedFromCategory;
  if (body.name !== undefined) {
    fields.push("name = ?");
    values.push(normalizeCurriculumText(body.name, "name"));
  }
  if (body.category_id !== undefined) {
    const categoryId = parseMaterialCategoryId(body.category_id);
    await assertMaterialCategoryExists(env, categoryId);
    const beforeCategoryId = before.category_id === null ? null : Number(before.category_id);
    if (categoryId !== beforeCategoryId) {
      const query = categoryId === null
        ? "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM materials WHERE category_id IS NULL"
        : "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM materials WHERE category_id = ?";
      const statement = env.DB.prepare(query);
      const order = categoryId === null
        ? await statement.first()
        : await statement.bind(categoryId).first();
      fields.push("category_id = ?", "sort_order = ?");
      values.push(categoryId, Number(order?.max_order ?? -1) + 1);
      movedFromCategory = beforeCategoryId;
    }
  }
  if (body.sort_order !== undefined && movedFromCategory === undefined) {
    const sortOrder = Number(body.sort_order);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      throw httpError(400, "sort_order must be a non-negative integer");
    }
    fields.push("sort_order = ?");
    values.push(sortOrder);
  }
  if (fields.length === 0) throw httpError(400, "nothing to update");
  values.push(materialId);
  const material = await env.DB.prepare(
    `UPDATE materials SET ${fields.join(", ")} WHERE id = ? RETURNING *`
  )
    .bind(...values)
    .first();
  if (movedFromCategory !== undefined) await resequenceMaterialsInCategory(env, movedFromCategory);
  return material;
}

async function reorderMaterialsInCategory(env, body) {
  await ensureMaterialCategorySchema(env);
  const categoryId = parseMaterialCategoryId(body.category_id ?? null);
  await assertMaterialCategoryExists(env, categoryId);
  if (!Array.isArray(body.material_ids)) throw httpError(400, "material_ids is required");
  const materialIds = body.material_ids.map((id) => positiveInteger(id, "material_id"));
  if (new Set(materialIds).size !== materialIds.length) {
    throw httpError(400, "material_ids must not contain duplicates");
  }
  const currentIds = await readMaterialIdsInCategory(env, categoryId);
  const sortedCurrent = [...currentIds].sort((a, b) => a - b);
  const sortedRequested = [...materialIds].sort((a, b) => a - b);
  if (sortedCurrent.length !== sortedRequested.length || sortedCurrent.some((id, index) => id !== sortedRequested[index])) {
    throw httpError(409, "material_ids must contain every current material in this category exactly once");
  }
  await runDbStatements(
    env,
    materialIds.map((materialId, index) =>
      env.DB.prepare("UPDATE materials SET sort_order = ? WHERE id = ?")
        .bind(index, materialId)
    )
  );
  return readMaterials(env);
}

async function deleteMaterial(env, id) {
  await ensureMaterialCategorySchema(env);
  const material = await env.DB.prepare("SELECT category_id FROM materials WHERE id = ?")
    .bind(id)
    .first();
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
  if (material) {
    await resequenceMaterialsInCategory(
      env,
      material.category_id === null ? null : Number(material.category_id)
    );
  }
}

// 教材のチャプター(章)。教材(material_id)に紐付き、sort_orderで並べ替える。
async function readChapters(env, materialId) {
  await ensureCurriculumIntegrity(env);
  const { results } = await env.DB.prepare(
    "SELECT * FROM material_chapters WHERE material_id = ? ORDER BY sort_order"
  )
    .bind(materialId)
    .all();
  return results;
}

async function createChapter(env, materialId, body) {
  await ensureCurriculumIntegrity(env);
  const name = (body.name || "").trim();
  if (!name) throw new Error("name is required");
  const existing = await env.DB.prepare(
    "SELECT * FROM material_chapters WHERE material_id = ? AND lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1"
  )
    .bind(materialId, name)
    .first();
  if (existing) return existing;
  const { results } = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM material_chapters WHERE material_id = ?"
  )
    .bind(materialId)
    .all();
  const nextOrder = (results[0]?.maxOrder ?? -1) + 1;
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO material_chapters (material_id, name, sort_order) VALUES (?, ?, ?) RETURNING *"
  )
    .bind(materialId, name, nextOrder)
    .first();
  if (inserted) return inserted;
  return env.DB.prepare(
    "SELECT * FROM material_chapters WHERE material_id = ? AND lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1"
  )
    .bind(materialId, name)
    .first();
}

async function updateChapter(env, id, body) {
  await ensureCurriculumIntegrity(env);
  const fields = [];
  const values = [];
  if (body.name !== undefined) {
    fields.push("name = ?");
    values.push(String(body.name).trim());
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
  await ensureCurriculumIntegrity(env);
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

      if (url.pathname === "/api/material-categories" && request.method === "GET") {
        return json(await readMaterialCategories(env), headers);
      }

      if (url.pathname === "/api/material-categories" && request.method === "POST") {
        const body = await request.json();
        return json(await createMaterialCategory(env, body), headers, 201);
      }

      if (url.pathname === "/api/material-categories/reorder" && request.method === "PUT") {
        return json(await reorderMaterialCategories(env, await request.json()), headers);
      }

      const materialCategoryMatch = url.pathname.match(/^\/api\/material-categories\/(\d+)$/);
      if (materialCategoryMatch && request.method === "PUT") {
        const body = await request.json();
        return json(await updateMaterialCategory(env, materialCategoryMatch[1], body), headers);
      }

      if (url.pathname === "/api/materials" && request.method === "GET") {
        return json(await readMaterials(env), headers);
      }

      if (url.pathname === "/api/materials" && request.method === "POST") {
        const body = await request.json();
        return json(await createMaterial(env, body), headers, 201);
      }

      if (url.pathname === "/api/materials/reorder" && request.method === "PUT") {
        return json(await reorderMaterialsInCategory(env, await request.json()), headers);
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

      if (url.pathname === "/api/ss-projects" && request.method === "GET") {
        return json(await readSsProjects(env), headers);
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
