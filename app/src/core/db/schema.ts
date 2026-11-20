// 端侧 SQLite DDL（ADR-005）—— 真机建表唯一权威；Web 降级由同字段 JSON 表承担
export const TABLES = ['user_profile', 'llm_config', 'project', 'stage_state', 'stage_event', 'benchmark', 'asset', 'profile_proposal', 'profile_history'] as const

export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, profession TEXT,
    background TEXT, platform TEXT, audience TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS llm_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT DEFAULT '', base_url TEXT,
    model TEXT, api_key TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS project (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, topic_brief TEXT,
    requirements TEXT, status TEXT DEFAULT 'writing',
    created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS stage_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, stage TEXT,
    status TEXT DEFAULT 'pending', draft TEXT DEFAULT '', directive TEXT DEFAULT '',
    updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS stage_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, stage TEXT,
    event TEXT, payload TEXT DEFAULT '', created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS benchmark (
    id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, title TEXT, url TEXT,
    author TEXT, published_at TEXT, excerpt TEXT, tags TEXT,
    metrics TEXT DEFAULT '', rubric TEXT DEFAULT '', created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS asset (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, source TEXT, content TEXT,
    tags TEXT DEFAULT '', quality REAL DEFAULT 0, sensitive INTEGER DEFAULT 0,
    created_at TEXT)`,
  // 档案演化（ADR-015）：候选事实先进待确认表，人工采纳后才合并进 user_profile
  `CREATE TABLE IF NOT EXISTS profile_proposal (
    id INTEGER PRIMARY KEY AUTOINCREMENT, field TEXT, current_value TEXT DEFAULT '',
    proposed_value TEXT, reason TEXT DEFAULT '', confidence REAL DEFAULT 0,
    source TEXT DEFAULT '', project_id INTEGER DEFAULT 0, status TEXT DEFAULT 'pending',
    created_at TEXT, resolved_at TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS profile_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot TEXT, reason TEXT DEFAULT '', created_at TEXT)`
]

// 列级迁移：老版本数据库里表已存在，CREATE TABLE IF NOT EXISTS 不会补列，必须显式 ALTER。
// 用户升级 APK 时走这里，不丢已有配置。
export const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  {
    table: 'llm_config',
    column: 'provider',
    ddl: `ALTER TABLE llm_config ADD COLUMN provider TEXT DEFAULT ''`
  }
]
