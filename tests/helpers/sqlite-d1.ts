import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type SqlValue = string | number | null
type SqlRow = Record<string, unknown>
type BoundQuery = { sql: string; values: readonly SqlValue[] }

export interface SqliteD1Fixture {
  db: D1Database
  exec(sql: string): void
  query<T = SqlRow>(sql: string, values?: readonly SqlValue[]): T[]
  close(): void
}

function parameter(value: SqlValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return `"CAST(X'${Buffer.from(value, 'utf8').toString('hex')}' AS TEXT)"`
  throw new Error('Unsupported SQLite D1 test parameter')
}

/**
 * Real SQLite, with D1's pattern cap and foreign keys on every connection.
 * Use json_quote()/hex() for embedded-NUL assertions: sqlite3's CLI JSON renderer
 * truncates NUL-containing strings, although bound/stored TEXT retains all bytes.
 */
export function createSqliteD1(schemaSql: string): SqliteD1Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'navsphere-d1-test-'))
  const databasePath = join(directory, 'fixture.sqlite')
  let closed = false

  function execute(queries: readonly BoundQuery[], transaction = false): D1Result<SqlRow>[] {
    if (closed) throw new Error('SQLite D1 fixture is closed')
    const marker = `D1_${randomUUID()}`
    const script = [
      '.limit like_pattern_length 50', '.timeout 1000', '.parameter init',
      'PRAGMA foreign_keys = ON;', transaction ? 'BEGIN;' : '',
    ]
    for (const [index, query] of queries.entries()) {
      script.push('.parameter clear')
      query.values.forEach((value, offset) => script.push(`.parameter set ?${offset + 1} ${parameter(value)}`))
      script.push(
        `.print ${marker}:${index}:before`, 'SELECT total_changes() AS total;',
        `.print ${marker}:${index}:rows`, `${query.sql}\n;`,
        `.print ${marker}:${index}:meta`, 'SELECT total_changes() AS total;',
        `.print ${marker}:${index}:end`,
      )
    }
    if (transaction) script.push('COMMIT;')
    const result = spawnSync('sqlite3', ['-batch', '-bail', '-json', databasePath], {
      input: `${script.join('\n')}\n`, encoding: 'utf8', timeout: 10_000, maxBuffer: 32 * 1024 * 1024,
    })
    if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.trim() ?? 'SQLite D1 execution failed')
    function section(index: number, start: string, end: string): string {
      const startMarker = `${marker}:${index}:${start}\n`
      const endMarker = `${marker}:${index}:${end}\n`
      const startOffset = result.stdout.indexOf(startMarker)
      const endOffset = result.stdout.indexOf(endMarker, startOffset + startMarker.length)
      if (startOffset < 0 || endOffset < 0) throw new Error('SQLite D1 result marker missing')
      return result.stdout.slice(startOffset + startMarker.length, endOffset).trim()
    }
    return queries.map((_, index) => {
      const before = JSON.parse(section(index, 'before', 'rows'))[0] as { total: number }
      const after = JSON.parse(section(index, 'meta', 'end'))[0] as { total: number }
      const rows = section(index, 'rows', 'meta')
      return {
        success: true, results: rows ? JSON.parse(rows) as SqlRow[] : [],
        // D1 counts trigger writes too. The baseline is taken after binding, so
        // sqlite_parameters writes never turn SELECT into a reported mutation.
        meta: { changes: after.total - before.total },
      }
    })
  }

  class Statement implements D1PreparedStatement {
    constructor(readonly sql: string, readonly values: readonly SqlValue[] = []) {}

    bind(...values: unknown[]): D1PreparedStatement {
      values.forEach((value) => parameter(value as SqlValue))
      return new Statement(this.sql, values as SqlValue[])
    }

    async all<T = unknown>(): Promise<D1Result<T>> {
      return execute([this])[0] as D1Result<T>
    }

    async run(): Promise<D1Result> { return this.all() }

    async first<T = unknown>(colName?: string): Promise<T | null> {
      const first = (await this.all<SqlRow>()).results[0]
      if (!first) return null
      return (colName === undefined ? first : first[colName] ?? null) as T | null
    }

    async raw<T = unknown>(): Promise<T[]> {
      return (await this.all<SqlRow>()).results.map((row) => Object.values(row)) as T[]
    }
  }

  const db: D1Database = {
    prepare: (sql) => new Statement(sql),
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      if (!statements.every((statement) => statement instanceof Statement)) throw new Error('SQLite D1 batch contains a foreign statement')
      return execute(statements as Statement[], true) as D1Result<T>[]
    },
    async exec(sql) { return execute([{ sql, values: [] }])[0] },
  }
  const fixture: SqliteD1Fixture = {
    db,
    exec(sql) { execute([{ sql, values: [] }]) },
    query<T = SqlRow>(sql: string, values: readonly SqlValue[] = []): T[] {
      return execute([{ sql, values }])[0].results as T[]
    },
    close() {
      if (!closed) {
        closed = true
        rmSync(directory, { recursive: true, force: true })
      }
    },
  }
  try {
    if (schemaSql.trim()) fixture.exec(schemaSql)
    return fixture
  } catch (error) {
    fixture.close()
    throw error
  }
}
