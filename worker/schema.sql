CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  calendar_tag TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lesson_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  calendar_event_id TEXT,
  lesson_date TEXT,
  note TEXT,
  score TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS academic_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year_id INTEGER REFERENCES academic_years(id),
  label TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS curriculum_entries (
  calendar_event_id TEXT PRIMARY KEY,
  completed INTEGER DEFAULT 0,
  lesson_plan TEXT,
  confirmation_test TEXT,
  homework TEXT,
  lesson_memo TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  text TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS candidate_schools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  school_name TEXT NOT NULL,
  school_type TEXT NOT NULL,
  rank INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goal_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  text TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS student_prefs (
  name TEXT PRIMARY KEY,
  print_name TEXT,
  memo TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  start_time TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS student_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  material_id INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapter_progress (
  name TEXT NOT NULL,
  chapter_id INTEGER NOT NULL,
  completed INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (name, chapter_id)
);

-- Googleのリフレッシュトークンを保存する単一行テーブル(単一ユーザー運用のためid=1固定)。
-- サーバー(Worker)側でこれを使ってアクセストークンを都度発行するため、
-- ブラウザ側のタブ状態やサードパーティCookie制限に左右されずログイン状態を維持できる。
CREATE TABLE IF NOT EXISTS google_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ChatGPT Plugin（MCP）のOAuth認可に使う登録済みクライアントと短命の認可コード。
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  redirect_uris TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- MCPからの授業記録変更履歴。取り消し時は現在値との競合を確認する。
CREATE TABLE IF NOT EXISTS mcp_schedule_changes (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changed_fields TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  undone_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_schedule_changes_event
  ON mcp_schedule_changes(event_id, created_at DESC);

-- MCPからの生徒メモ・印刷用氏名の変更履歴。取り消し時は現在値との競合を確認する。
CREATE TABLE IF NOT EXISTS mcp_student_profile_changes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  action TEXT NOT NULL,
  changed_fields TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  undone_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_student_profile_changes_name
  ON mcp_student_profile_changes(name, created_at DESC);

-- 教材ライブラリのファイルとGoogleカレンダー予定の対応。
CREATE TABLE IF NOT EXISTS schedule_material_links (
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  material_file_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (calendar_id, event_id, material_file_id)
);


-- 入試管理: 大学・方式・試験段階ごとの日程。複数日程は1日ごとに1行で保存する。
CREATE TABLE IF NOT EXISTS admission_events (
  id TEXT PRIMARY KEY,
  university TEXT NOT NULL,
  selection_type TEXT NOT NULL DEFAULT 'general',
  stage TEXT NOT NULL,
  schedule_date TEXT NOT NULL,
  end_date TEXT,
  notes TEXT,
  source_url TEXT,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admission_events_date ON admission_events(schedule_date);
CREATE INDEX IF NOT EXISTS idx_admission_events_stage ON admission_events(stage);
