import { validExplicitTimestamp } from './feed-api'
import {
  ARCHIVE_COLUMNS, ARCHIVE_POINTER_COLUMNS, archivePointer, archiveSnapshotGuard,
  makeArchiveObject, readArchiveBody, readArchiveObject, writeArchiveObject,
} from './content-archive'
import type { ArchiveKV, ArchiveRow } from './content-archive'
import { D1_RETENTION_TIMESTAMP_CTES } from './d1-retention-sql'

const DAY_MS = 86_400_000
const ID_PATTERN = /^[a-f0-9]{16,64}$/
const MAX_DAILY_WRITES = 100
export type ArchiveAction = 'stage' | 'compact' | 'rehydrate'
export type ArchiveOptions = { enabled?: boolean; compactEnabled?: boolean; now?: Date; retentionDays?: number }
export type ArchiveResult = { code: string; status: number; url_hash?: string }

function result(code: string, status = 200, id?: string): ArchiveResult {
  return { code, status, ...(id ? { url_hash: id } : {}) }
}

function timing(options: ArchiveOptions) {
  const now = options.now ?? new Date()
  const days = options.retentionDays ?? 30
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())
    || !Number.isSafeInteger(days) || days < 1 || days > 3650) throw new Error('INVALID_OPTIONS')
  const cutoff = new Date(now.getTime() - days * DAY_MS)
  if (!/^\d{4}-/.test(now.toISOString()) || !/^\d{4}-/.test(cutoff.toISOString())) throw new Error('INVALID_OPTIONS')
  return { now, days, cutoff }
}

/** Date.parse accepts 24:00 and some out-of-range offsets; retention must not. */
function timestamp(value: string): number | null {
  if (!validExplicitTimestamp(value)) return null
  const match = /T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3]) > 59) return null
  if (match[4] !== 'Z' && (Number(match[6]) > 14 || Number(match[7]) > 59
    || (Number(match[6]) === 14 && Number(match[7]) !== 0))) return null
  return Date.parse(value)
}

function eligible(row: Pick<ArchiveRow, 'discovered_at'>, cutoff: Date): boolean {
  const discovered = timestamp(row.discovered_at)
  return discovered !== null && discovered < cutoff.getTime()
}

async function loadRow(db: D1Database, id: string): Promise<ArchiveRow | null> {
  return db.prepare(`SELECT ${ARCHIVE_COLUMNS.join(',')} FROM articles WHERE url_hash = ?`)
    .bind(id).first<ArchiveRow>()
}

async function guardedUpdate(db: D1Database, row: ArchiveRow, assignments: string,
  values: Array<string | number | null>): Promise<boolean> {
  const guard = archiveSnapshotGuard(row, values.length + 1)
  const write = await db.prepare(`UPDATE articles SET ${assignments} WHERE ${guard.sql}`)
    .bind(...values, ...guard.values).run()
  if (!write.success || !Number.isSafeInteger(write.meta.changes)
    || Number(write.meta.changes) < 0 || Number(write.meta.changes) > 1) throw new Error('ARCHIVE_UNAVAILABLE')
  return write.meta.changes === 1
}

async function reserveWrite(db: D1Database, day: string): Promise<boolean> {
  const budget = await db.prepare(`INSERT INTO feed_archive_daily_budget(day,writes) VALUES(?1,1)
    ON CONFLICT(day) DO UPDATE SET writes = writes + 1 WHERE writes < ${MAX_DAILY_WRITES}
    RETURNING writes`).bind(day).first<{ writes: number }>()
  if (budget === null) return false
  if (!Number.isSafeInteger(budget.writes) || budget.writes < 1 || budget.writes > MAX_DAILY_WRITES) {
    throw new Error('ARCHIVE_UNAVAILABLE')
  }
  return true
}

async function stage(db: D1Database, kv: ArchiveKV | undefined, row: ArchiveRow, now: Date): Promise<ArchiveResult> {
  if (row.content === null) return result(archivePointer(row) ? 'ALREADY_COLD' : 'NO_CONTENT', 409, row.url_hash)
  const object = await makeArchiveObject(row)
  const staged: ArchiveRow = {
    ...row, content_archive_key: object.key, content_archive_sha256: object.sha256,
    content_archive_bytes: object.bytes, content_archive_version: row.content_version,
    content_archived_at: now.toISOString(),
  }
  if (ARCHIVE_POINTER_COLUMNS.some(column => row[column] !== null)) {
    if (!archivePointer(row) || row.content_archive_key !== object.key) return result('STATE_CHANGED', 409)
    if (await readArchiveBody(kv, row) !== row.content) throw new Error('ARCHIVE_UNAVAILABLE')
    return result('ALREADY_STAGED', 200, row.url_hash)
  }
  // Never overwrite an existing immutable key, even if its bytes are corrupt.
  if (await readArchiveObject(kv, object.key) === null) {
    if (!(await reserveWrite(db, now.toISOString().slice(0, 10)))) return result('WRITE_BUDGET_EXHAUSTED', 429)
    // An uncertain or failed put still consumes its reserved attempt.
    await writeArchiveObject(kv, object.key, object.value)
  }
  if (await readArchiveBody(kv, staged) !== row.content) throw new Error('ARCHIVE_UNAVAILABLE')
  const committed = await guardedUpdate(db, row,
    'content_archive_key=?1,content_archive_sha256=?2,content_archive_version=?3,content_archive_bytes=?4,content_archived_at=?5',
    [object.key, object.sha256, row.content_version, object.bytes, now.toISOString()])
  return committed ? result('STAGED', 200, row.url_hash) : result('STATE_CHANGED', 409)
}

async function compact(db: D1Database, kv: ArchiveKV | undefined, row: ArchiveRow, now: Date): Promise<ArchiveResult> {
  if (!archivePointer(row)) return result('NOT_STAGED', 409)
  const archivedAt = timestamp(row.content_archived_at ?? '')
  if (archivedAt === null || now.getTime() - archivedAt < DAY_MS) return result('STAGING_TOO_RECENT', 409)
  if (row.content === null) return result('ALREADY_COLD', 200, row.url_hash)
  // Uses the same integrity reader as public same-ID detail and recovery.
  const body = await readArchiveBody(kv, row)
  if (body !== row.content) throw new Error('ARCHIVE_UNAVAILABLE')
  const committed = await guardedUpdate(db, row, 'content=NULL', [])
  return committed ? result('COMPACTED', 200, row.url_hash) : result('STATE_CHANGED', 409)
}

async function rehydrate(db: D1Database, kv: ArchiveKV | undefined, row: ArchiveRow): Promise<ArchiveResult> {
  if (row.content !== null) return result('ALREADY_HOT', 200, row.url_hash)
  if (!archivePointer(row)) return result('NOT_STAGED', 409)
  const body = await readArchiveBody(kv, row)
  // Storage recovery is deliberately separate from permission restoration.
  const committed = await guardedUpdate(db, row, 'content=?1', [body])
  return committed ? result('REHYDRATED', 200, row.url_hash) : result('STATE_CHANGED', 409)
}

/** Called only after HTTP authorization; no remote resources are created here. */
export async function maintainArchive(db: D1Database, kv: ArchiveKV | undefined, id: string,
  action: ArchiveAction, options: ArchiveOptions = {}): Promise<ArchiveResult> {
  if (options.enabled !== true) return result('ARCHIVE_DISABLED', 409)
  if (!ID_PATTERN.test(id) || !['stage', 'compact', 'rehydrate'].includes(action)) return result('INVALID_REQUEST', 400)
  if (action === 'compact' && options.compactEnabled !== true) return result('COMPACTION_DISABLED', 409)
  let clock: ReturnType<typeof timing>
  try { clock = timing(options) } catch { return result('INVALID_OPTIONS', 400) }
  try {
    const row = await loadRow(db, id)
    if (!row) return result('NOT_FOUND', 404)
    if (action !== 'rehydrate' && !eligible(row, clock.cutoff)) return result('NOT_ELIGIBLE', 409)
    if (action === 'stage') return await stage(db, kv, row, clock.now)
    if (action === 'compact') return await compact(db, kv, row, clock.now)
    return await rehydrate(db, kv, row)
  } catch {
    return result('ARCHIVE_UNAVAILABLE', 503)
  }
}

async function countInvalidDates(db: D1Database): Promise<number> {
  try {
    const aggregate = await db.prepare(`WITH retention_source AS (
      SELECT discovered_at AS ts FROM articles WHERE content IS NOT NULL
    ), ${D1_RETENTION_TIMESTAMP_CTES}
    SELECT COUNT(*) AS invalidDates FROM normalized WHERE utc_timestamp IS NULL`)
      .all<{ invalidDates: number }>()
    const row = aggregate?.results?.[0]
    if (aggregate?.success !== true || !Array.isArray(aggregate.results) || aggregate.results.length !== 1
      || !row || Array.isArray(row) || !Number.isSafeInteger(row.invalidDates) || row.invalidDates < 0) {
      throw new Error('ARCHIVE_UNAVAILABLE')
    }
    return row.invalidDates
  } catch { throw new Error('ARCHIVE_UNAVAILABLE') }
}

/**
 * Authenticated inventory; no body, source URL, raw key or permission export.
 * scanned/truncated describe only the bounded eligible candidate window.
 * invalidDates counts ALL hot/staged bodies, independently of that window, so
 * it may exceed scanned. Rows with content=NULL are outside this aggregate.
 */
export async function archiveCandidates(db: D1Database, options: ArchiveOptions = {}) {
  const { now, cutoff, days } = timing(options)
  const candidates: Array<{ url_hash: string; state: 'hot' | 'staged'; bytes: number }> = []
  let scanned = 0
  const invalidDates = await countInvalidDates(db)
  let truncated = false
  for (const staged of [false, true]) {
    const rows = await db.prepare(`WITH retention_source AS (
      SELECT url_hash,discovered_at AS ts,length(CAST(content AS BLOB)) AS bytes
      FROM articles WHERE content IS NOT NULL AND content_archive_key IS ${staged ? 'NOT ' : ''}NULL
    ), ${D1_RETENTION_TIMESTAMP_CTES}
    SELECT url_hash,ts AS discovered_at,bytes FROM normalized WHERE utc_timestamp < ?1
      ORDER BY utc_timestamp,url_hash LIMIT 101`).bind(cutoff.toISOString())
      .all<{ url_hash: string; discovered_at: string; bytes: number }>()
    if (!rows.success || !Array.isArray(rows.results)) throw new Error('ARCHIVE_UNAVAILABLE')
    truncated ||= rows.results.length > 100
    for (const row of rows.results.slice(0, 100)) {
      scanned++
      if (eligible(row, cutoff)) candidates.push({ url_hash: row.url_hash, state: staged ? 'staged' : 'hot', bytes: row.bytes })
    }
  }
  return { code: 'AUDIT_COMPLETED', auditedAt: now.toISOString(), cutoff: cutoff.toISOString(), retentionDays: days,
    scanned, invalidDates, truncated, candidates }
}
