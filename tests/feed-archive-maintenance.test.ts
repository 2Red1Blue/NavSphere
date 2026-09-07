import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ArchiveKV } from '../src/lib/content-archive'
import { maintainArchive, archiveCandidates, makeCapacityPolicySnapshot } from '../src/lib/feed-archive-maintenance'
import { handleArchiveRequest } from '../src/lib/feed-archive-http'
import { createSqliteD1 } from './helpers/sqlite-d1'

const ID = '0123456789abcdef'
const NOW = new Date('2026-09-04T12:00:00Z')
const BODY = '旧正文\n引号\'与中文，不代表已获得全文发布许可。'
const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')

function compactPolicy(auditedAt = NOW) {
  return makeCapacityPolicySnapshot(350_000_000, auditedAt)
}

test('maintenance HTTP authenticates before any DB or KV access and defaults disabled', async () => {
  const env = { DB: { prepare() { throw new Error('must not query') } },
    CONTENT_OS_API_KEY: 'test-key' } as unknown as CloudflareEnv
  const unauthorized = await handleArchiveRequest(new Request('https://example.com/api/feed/archive'), () => env)
  assert.equal(unauthorized.status, 401)
  assert.equal(unauthorized.headers.get('cache-control'), 'no-store')
  const disabled = await handleArchiveRequest(new Request(`https://example.com/api/feed/archive?action=stage&id=${ID}`, {
    method: 'POST', headers: { Authorization: 'Bearer test-key' },
  }), () => env)
  assert.equal(disabled.status, 409)
  assert.equal((await disabled.json()).code, 'ARCHIVE_DISABLED')
})

function fixture() {
  const sql = createSqliteD1(schema)
  sql.exec(`INSERT INTO articles(url_hash,title,source,url,discovered_at,published_at,
    content,content_quality,content_format,content_version,approved_for_publication)
    VALUES('${ID}','Archive fixture','AIHOT','https://aihot.virxact.com/items/test',
    '2026-07-01T00:00:00Z','2026-07-01T00:00:00Z',
    '${BODY.replaceAll("'", "''")}','legacy_unverified',NULL,1,1)`)
  const objects = new Map<string, string>()
  let writes = 0
  const kv: ArchiveKV = {
    async get(key) { return objects.get(key) ?? null },
    async put(key, value) { writes++; objects.set(key, value) },
  }
  const row = () => sql.query<Record<string, unknown>>('SELECT * FROM articles')[0]
  return { ...sql, objects, kv, row, writes: () => writes }
}

test('maintenance disabled and candidate audit never write bodies, rights or KV', async () => {
  const f = fixture()
  try {
    const before = f.row()
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'stage', { now: NOW })).code, 'ARCHIVE_DISABLED')
    const audit = await archiveCandidates(f.db, { now: NOW })
    assert.equal(audit.candidates.length, 1)
    assert.doesNotMatch(JSON.stringify(audit), /旧正文|archive_key|https:/)
    assert.equal(f.writes(), 0)
    assert.deepEqual(f.row(), before)
  } finally { f.close() }
})

function inventoryFixture(rows: Array<{ date: string; staged?: boolean; noBody?: boolean }>) {
  const sql = createSqliteD1(schema)
  if (rows.length) {
    const values = rows.map(({ date, staged, noBody }, index) => {
      const id = index.toString(16).padStart(16, '0')
      const pointer = staged ? `'private-${id}','${'a'.repeat(64)}',1,1,'2026-09-01T00:00:00Z'` : 'NULL,NULL,NULL,NULL,NULL'
      return `('${id}','fixture','fixture','https://fixture.invalid/${id}',
        '${date.replaceAll("'", "''")}',${noBody ? 'NULL' : "'body'"},1,${pointer})`
    })
    sql.exec(`INSERT INTO articles(url_hash,title,source,url,discovered_at,content,content_version,
      content_archive_key,content_archive_sha256,content_archive_version,content_archive_bytes,content_archived_at)
      VALUES ${values.join(',')}`)
  }
  return sql
}

test('inventory counts invalid dates across all hot and staged bodies independently of candidates', async () => {
  const invalid = ['not-a-date', '2026-99-99', '2026-02-30T00:00:00Z', '2460000.5']
  const f = inventoryFixture([
    ...invalid.map(date => ({ date })),
    { date: 'not-a-date', staged: true },
    { date: 'not-a-date', noBody: true },
    { date: 'not-a-date', staged: true, noBody: true },
    { date: '2026-07-01T00:00:00Z' },
    { date: '2026-09-04T00:00:00Z' },
    { date: '2027-01-01T00:00:00Z', staged: true },
  ])
  try {
    const audit = await archiveCandidates(f.db, { now: NOW })
    assert.equal(audit.invalidDates, 5)
    assert.equal(audit.scanned, 1)
    assert.equal(audit.truncated, false)
    assert.deepEqual(audit.candidates, [{ url_hash: '0000000000000007', state: 'hot', bytes: 4 }])
    assert.doesNotMatch(JSON.stringify(audit), /not-a-date|2460000|body|private-/)
  } finally { f.close() }
})

test('101 recent rows in each state do not fill or truncate the eligible candidate window', async () => {
  const f = inventoryFixture([false, true].flatMap(staged =>
    Array.from({ length: 101 }, () => ({ date: '2026-09-01T00:00:00Z', staged }))))
  try {
    const audit = await archiveCandidates(f.db, { now: NOW })
    assert.equal(audit.scanned, 0)
    assert.equal(audit.invalidDates, 0)
    assert.equal(audit.truncated, false)
    assert.deepEqual(audit.candidates, [])
  } finally { f.close() }
})

test('101 old rows per state return 100 per state and mark the candidate inventory truncated', async () => {
  const f = inventoryFixture([false, true].flatMap(staged =>
    Array.from({ length: 101 }, () => ({ date: '2026-07-01T00:00:00Z', staged }))))
  try {
    const audit = await archiveCandidates(f.db, { now: NOW })
    assert.equal(audit.scanned, 200)
    assert.equal(audit.invalidDates, 0)
    assert.equal(audit.truncated, true)
    assert.equal(audit.candidates.filter(row => row.state === 'hot').length, 100)
    assert.equal(audit.candidates.filter(row => row.state === 'staged').length, 100)
  } finally { f.close() }
})

test('invalid rows cannot starve old candidates or create a false truncation warning', async () => {
  const f = inventoryFixture([false, true].flatMap(staged => [
    ...Array.from({ length: 101 }, () => ({ date: '2026-02-30T00:00:00Z', staged })),
    { date: '2026-07-01T00:00:00Z', staged },
  ]))
  try {
    const audit = await archiveCandidates(f.db, { now: NOW })
    assert.equal(audit.invalidDates, 202)
    assert.equal(audit.scanned, 2)
    assert.equal(audit.truncated, false)
    assert.deepEqual(audit.candidates.map(row => row.state), ['hot', 'staged'])
  } finally { f.close() }
})

test('inventory preserves strict ISO validation and millisecond cutoff without fractional rounding', async () => {
  const eligible = [
    '2026-08-05T12:34:56.788999Z', '2026-08-05T20:34:56.788999+08:00',
    '2026-08-05T08:34:56.788999-04:00', '2024-02-29T00:00:00Z',
  ]
  const validRecent = [
    '2026-08-05T12:34:56.789Z', '2026-08-05T12:34:56.789001Z',
    '2026-08-05T20:34:56.789000+08:00', '2026-08-05T08:34:56.789000-04:00',
  ]
  const invalid = [
    '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-01-01T24:00:00Z',
    '2026-01-01T00:00:00', '2026-01-01 00:00:00Z', '2026-01-01T00:00:00.Z',
    '2026-01-01T00:00:00.1xZ', '2026-01-01T00:00:00+15:00', '2026-01-01T00:00:00+14:01',
  ]
  const f = inventoryFixture([...eligible, ...validRecent, ...invalid].map(date => ({ date })))
  try {
    const audit = await archiveCandidates(f.db, { now: new Date('2026-09-04T12:34:56.789Z') })
    assert.equal(audit.invalidDates, invalid.length)
    assert.equal(audit.scanned, eligible.length)
    assert.equal(audit.candidates.length, eligible.length)
    assert.equal(audit.truncated, false)
  } finally { f.close() }
})

test('invalid-date aggregation fails closed on query failures and malformed counts', async () => {
  const responses: unknown[] = [
    undefined, null, {}, { success: false, results: [{ invalidDates: 0 }] },
    { success: 1, results: [{ invalidDates: 0 }] },
    { success: true, results: [] }, { success: true, results: [{ invalidDates: 0 }, { invalidDates: 0 }] },
    { success: true, results: [null] }, { success: true, results: [[]] }, { success: true, results: [{}] },
    ...[undefined, null, '0', true, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]
      .map(invalidDates => ({ success: true, results: [{ invalidDates }] })),
  ]
  for (const response of responses) {
    const db = { prepare: () => ({ bind() { return this }, all: async () => response }) } as unknown as D1Database
    await assert.rejects(archiveCandidates(db, { now: NOW }), { message: 'ARCHIVE_UNAVAILABLE' })
  }
  const db = { prepare() { throw new Error('private query details') } } as unknown as D1Database
  await assert.rejects(archiveCandidates(db, { now: NOW }), { message: 'ARCHIVE_UNAVAILABLE' })
  const rejected = { prepare: () => ({ all: async () => { throw new Error('private query details') } }) } as unknown as D1Database
  await assert.rejects(archiveCandidates(rejected, { now: NOW }), { message: 'ARCHIVE_UNAVAILABLE' })
})

test('empty candidate inventory reports a valid zero aggregate', async () => {
  const f = inventoryFixture([])
  try {
    const audit = await archiveCandidates(f.db, { now: NOW })
    assert.equal(audit.scanned, 0)
    assert.equal(audit.invalidDates, 0)
    assert.equal(audit.truncated, false)
    assert.deepEqual(audit.candidates, [])
  } finally { f.close() }
})

test('per-ID maintenance rechecks eligibility after candidate inventory', async () => {
  const f = fixture()
  try {
    assert.equal((await archiveCandidates(f.db, { now: NOW })).candidates.length, 1)
    for (const date of ['not-a-date', '2026-99-99', '2026-02-30T00:00:00Z', '2460000.5', NOW.toISOString()]) {
      f.query('UPDATE articles SET discovered_at=?1 WHERE url_hash=?2', [date, ID])
      assert.equal((await maintainArchive(f.db, f.kv, ID, 'stage', { enabled: true, now: NOW })).code, 'NOT_ELIGIBLE')
    }
    assert.equal(f.writes(), 0)
    assert.equal(f.row().content_archive_key, null)
    assert.equal(f.row().content, BODY)
  } finally { f.close() }
})

test('stage, delayed compact and rehydrate retain identity, quality and denied rights', async () => {
  const f = fixture()
  try {
    const staged = await maintainArchive(f.db, f.kv, ID, 'stage', { enabled: true, now: NOW })
    assert.equal(staged.code, 'STAGED')
    assert.equal(f.row().content, BODY)
    assert.equal(f.writes(), 1)
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'stage', { enabled: true, now: NOW })).code, 'ALREADY_STAGED')
    assert.equal(f.writes(), 1)
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'compact', { enabled: true, now: NOW })).code, 'COMPACTION_DISABLED')
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'compact', { enabled: true, compactEnabled: true, now: NOW })).code, 'STAGING_TOO_RECENT')
    const later = new Date(NOW.getTime() + 86_400_001)
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'compact', {
      enabled: true, compactEnabled: true, now: later, capacityPolicy: compactPolicy(later),
    })).code, 'COMPACTED')
    assert.equal(f.row().content, null)
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'rehydrate', { enabled: true, now: later })).code, 'REHYDRATED')
    assert.equal(f.row().content, BODY)
    assert.equal(f.row().content_hash, null)
    assert.equal(f.row().content_quality, 'legacy_unverified')
    assert.equal(f.row().content_version, 1)
    assert.equal(f.row().fulltext_publication_allowed, 0)
    assert.equal(f.row().url_hash, ID)
  } finally { f.close() }
})

test('KV failures and changed row after upload never clear content or publish a pointer', async () => {
  for (const mode of ['failure', 'race'] as const) {
    const f = fixture()
    try {
      const kv: ArchiveKV = {
        get: f.kv.get,
        async put(key, value) {
          if (mode === 'failure') throw new Error('private storage error')
          await f.kv.put(key, value)
          f.exec(`UPDATE articles SET fulltext_revoked_at='2026-09-04T12:00:00Z' WHERE url_hash='${ID}'`)
        },
      }
      const result = await maintainArchive(f.db, kv, ID, 'stage', { enabled: true, now: NOW })
      assert.equal(result.code, mode === 'failure' ? 'ARCHIVE_UNAVAILABLE' : 'STATE_CHANGED')
      assert.equal(f.row().content, BODY)
      assert.equal(f.row().content_archive_key, null)
      assert.doesNotMatch(JSON.stringify(result), /private storage error|旧正文/)
    } finally { f.close() }
  }
})

test('daily write cap counts reservations, and malformed dates cannot be archived', async () => {
  const f = fixture()
  try {
    f.exec("INSERT INTO feed_archive_daily_budget(day,writes) VALUES('2026-09-04',100)")
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'stage', { enabled: true, now: NOW })).code, 'WRITE_BUDGET_EXHAUSTED')
    assert.equal(f.writes(), 0)
    f.exec(`UPDATE articles SET discovered_at='2026-02-30T00:00:00Z' WHERE url_hash='${ID}'`)
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'stage', { enabled: true, now: NOW })).code, 'NOT_ELIGIBLE')
    assert.equal(f.row().content_archive_key, null)
  } finally { f.close() }
})

test('corrupt archived object prevents compaction and rehydration', async () => {
  const f = fixture()
  try {
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'stage', { enabled: true, now: NOW })).code, 'STAGED')
    const key = String(f.row().content_archive_key)
    f.objects.set(key, '{}')
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'compact', {
      enabled: true, compactEnabled: true, now: new Date(NOW.getTime() + 86_400_001), capacityPolicy: compactPolicy(new Date(NOW.getTime() + 86_400_001)),
    })).code, 'ARCHIVE_UNAVAILABLE')
    assert.equal(f.row().content, BODY)
    assert.equal(f.objects.get(key), '{}')
  } finally { f.close() }
})

test('compaction requires a fresh exact capacity-policy snapshot, not age alone', async () => {
  const f = fixture()
  try {
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'stage', { enabled: true, now: NOW })).code, 'STAGED')
    const later = new Date(NOW.getTime() + 86_400_001)
    const options = { enabled: true, compactEnabled: true, now: later }
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'compact', options)).code, 'CAPACITY_POLICY_REQUIRED')
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'compact', {
      ...options, capacityPolicy: { ...compactPolicy(NOW), targetBytes: 299_999_999 },
    })).code, 'INVALID_CAPACITY_POLICY')
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'compact', {
      ...options, capacityPolicy: makeCapacityPolicySnapshot(349_999_999, later),
    })).code, 'CAPACITY_COMPACTION_NOT_REQUIRED')
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'compact', {
      ...options, capacityPolicy: compactPolicy(new Date(NOW.getTime() - 86_400_001)),
    })).code, 'INVALID_CAPACITY_POLICY')
    assert.equal((await maintainArchive(f.db, f.kv, ID, 'compact', {
      ...options, capacityPolicy: compactPolicy(later),
    })).code, 'COMPACTED')
  } finally { f.close() }
})
