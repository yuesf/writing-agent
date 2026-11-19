// 端侧 SQLite DDL（ADR-005）—— 真机建表唯一权威；Web 降级由同字段 JSON 表承担
export const TABLES = ['user_profile', 'llm_config', 'project', 'stage_state', 'stage_event', 'benchmark', 'asset'] as const

export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, profession TEXT,
    background TEXT, platform TEXT, audience TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS llm_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT, base_url TEXT, model TEXT,
    api_key TEXT, updated_at TEXT)`,
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
    created_at TEXT)`
]
