// 存储原语抽象：领域层只依赖此接口；真机走 Capacitor SQLite，Web 开发走 localStorage 降级
export interface Row {
  id: number
  [k: string]: any
}

export interface StorageBackend {
  init(): Promise<void>
  list(table: string): Promise<Row[]>
  insert(table: string, row: Omit<Row, 'id'>): Promise<number>
  update(table: string, id: number, patch: Record<string, any>): Promise<void>
  remove(table: string, id: number): Promise<void>
}

// ---------- 真机：Capacitor SQLite ----------
export class SqliteBackend implements StorageBackend {
  private db: any = null

  async init() {
    const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite')
    const conn = new SQLiteConnection(CapacitorSQLite)
    this.db = await conn.createConnection('writing_agent', false, 'no-encryption', 1, false)
    await this.db.open()
    const { COLUMN_MIGRATIONS, DDL } = await import('./schema')
    for (const sql of DDL) await this.db.execute(sql)
    for (const m of COLUMN_MIGRATIONS) {
      if (await this.hasColumn(m.table, m.column)) continue
      await this.db.execute(m.ddl)
    }
  }

  private async hasColumn(table: string, column: string): Promise<boolean> {
    const res = await this.db.query(`PRAGMA table_info(${table})`)
    return (res.values ?? []).some((r: any) => r.name === column)
  }

  async list(table: string): Promise<Row[]> {
    const res = await this.db.query(`SELECT * FROM ${table}`)
    return res.values ?? []
  }

  async insert(table: string, row: Omit<Row, 'id'>): Promise<number> {
    const keys = Object.keys(row)
    const ph = keys.map(() => '?').join(',')
    const res = await this.db.run(
      `INSERT INTO ${table} (${keys.join(',')}) VALUES (${ph})`,
      keys.map(k => (row as any)[k])
    )
    return res.changes?.lastId ?? 0
  }

  async update(table: string, id: number, patch: Record<string, any>): Promise<void> {
    const keys = Object.keys(patch)
    if (!keys.length) return
    const set = keys.map(k => `${k}=?`).join(',')
    await this.db.run(`UPDATE ${table} SET ${set} WHERE id=?`, [...keys.map(k => patch[k]), id])
  }

  async remove(table: string, id: number): Promise<void> {
    await this.db.run(`DELETE FROM ${table} WHERE id=?`, [id])
  }
}

// ---------- Web 开发降级：localStorage JSON ----------
const LS_KEY = 'wa:store'

export class WebBackend implements StorageBackend {
  private store: Record<string, Row[]> = {}
  private seq: Record<string, number> = {}

  async init() {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      this.store = JSON.parse(raw)
      // seq 不落盘：重启后必须按各表现有最大 id 恢复，否则新插入的 id 会与旧行冲突并覆盖数据
      for (const [table, rows] of Object.entries(this.store)) {
        this.seq[table] = (rows as Row[]).reduce((max, r) => Math.max(max, Number(r.id) || 0), 0)
      }
    } else {
      this.store = {}
      await this.persist()
    }
  }

  private async persist() {
    localStorage.setItem(LS_KEY, JSON.stringify(this.store))
  }

  private table(name: string): Row[] {
    if (!this.store[name]) this.store[name] = []
    return this.store[name]
  }

  async list(table: string): Promise<Row[]> {
    return [...this.table(table)]
  }

  async insert(table: string, row: Omit<Row, 'id'>): Promise<number> {
    const id = (this.seq[table] ?? 0) + 1
    this.seq[table] = id
    this.table(table).push({ ...row, id })
    await this.persist()
    return id
  }

  async update(table: string, id: number, patch: Record<string, any>): Promise<void> {
    const t = this.table(table)
    const idx = t.findIndex(r => r.id === id)
    if (idx >= 0) t[idx] = { ...t[idx], ...patch }
    await this.persist()
  }

  async remove(table: string, id: number): Promise<void> {
    this.store[table] = this.table(table).filter(r => r.id !== id)
    await this.persist()
  }
}
