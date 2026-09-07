import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  buildD1RetentionAuditQuery,
  parseD1RetentionAuditCli,
  runD1RetentionAudit,
} from '../scripts/d1-retention-audit'

const NOW = new Date('2026-09-04T12:34:56.789Z')
const CUTOFF = '2026-08-05T12:34:56.789Z'
const COUNTS = {
  total: 10,
  eligible: 6,
  invalidDate: 1,
  approved: 8,
  unapproved: 2,
  fulltextPermission: 3,
  revoked: 2,
  eligibleApproved: 5,
  eligibleUnapproved: 1,
  eligibleFulltextPermission: 2,
  eligibleRevoked: 1,
}
const META = { size_after: 6_234_112, rows_read: 10, rows_written: 0, changed_db: false }

function envelope(counts: Record<string, unknown> = COUNTS, meta: Record<string, unknown> = META) {
  return { success: true, results: [counts], meta }
}

async function auditResponse(response: unknown, code = 0) {
  return runD1RetentionAudit({
    now: NOW,
    commandRunner: async () => ({ code, stdout: JSON.stringify(response), stderr: 'SECRET-RAW-OUTPUT' }),
  })
}

test('retention audit executes one fixed production SELECT and returns only allowlisted aggregates', async () => {
  const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = []
  const result = await runD1RetentionAudit({
    now: NOW,
    commandRunner: async (command, args, timeoutMs) => {
      calls.push({ command, args, timeoutMs })
      return { code: 0, stdout: JSON.stringify([envelope({ ...COUNTS, content: 'SECRET-RAW-OUTPUT' })]), stderr: '' }
    },
  })
  assert.equal(result.status, 'completed')
  if (result.status !== 'completed') assert.fail('Expected a completed audit')
  assert.equal(result.cutoff, CUTOFF)
  assert.equal(result.retentionDays, 30)
  assert.deepEqual(result.counts, COUNTS)
  assert.equal(result.capacity.bytes, META.size_after)
  assert.equal(result.capacity.ceilingBytes, 500_000_000)
  assert.equal(result.capacity.status, 'normal')
  assert.deepEqual(result.query, { rowsRead: 10, rowsWritten: 0, changedDb: false })
  assert.equal(result.archiveEnabled, false)
  assert.equal(result.deletionEnabled, false)
  assert.equal(result.candidateCountsAuthorizeDeletion, false)
  assert.doesNotMatch(JSON.stringify(result), /SECRET-RAW-OUTPUT|content/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, join(fileURLToPath(new URL('..', import.meta.url)), 'node_modules', '.bin', 'wrangler'))
  assert.deepEqual(calls[0].args.slice(0, -1), [
    'd1', 'execute', 'content-os-feed', '--remote', '--env', 'production', '--json', '--command',
  ])
  assert.equal(calls[0].args.at(-1), buildD1RetentionAuditQuery(NOW))
  assert.equal(calls[0].timeoutMs, 30_000)
  assert.doesNotMatch(calls[0].args.at(-1)!, /\b(DELETE|UPDATE|INSERT|REPLACE|CREATE|DROP|ALTER|PRAGMA)\b/i)
})

test('capacity thresholds use physical bytes and never enable deletion', async () => {
  for (const [bytes, status] of [
    [0, 'normal'], [349_999_999, 'normal'], [350_000_000, 'warning'],
    [424_999_999, 'warning'], [425_000_000, 'critical'],
    [499_999_999, 'critical'], [500_000_000, 'limit'], [600_000_000, 'limit'],
  ] as const) {
    const result = await auditResponse([envelope(COUNTS, { ...META, size_after: bytes })])
    assert.equal(result.status, 'completed')
    if (result.status !== 'completed') assert.fail('Expected a completed audit')
    assert.equal(result.capacity.status, status)
    assert.equal(result.capacity.utilizationPercent, bytes / 500_000_000 * 100)
    assert.equal(result.deletionEnabled, false)
  }
})

test('audit time and cutoff are frozen before awaiting the command', async () => {
  const now = new Date(NOW)
  const result = await runD1RetentionAudit({
    now,
    commandRunner: async () => {
      now.setTime(NaN)
      return { code: 0, stdout: JSON.stringify([envelope()]), stderr: '' }
    },
  })
  assert.equal(result.status, 'completed')
  if (result.status !== 'completed') assert.fail('Expected a completed audit')
  assert.equal(result.auditedAt, NOW.toISOString())
  assert.equal(result.cutoff, CUTOFF)
})

test('query rejects malformed envelopes and never reflects raw response fields', async () => {
  for (const response of [
    null, {}, [], [envelope(), envelope()], envelope(),
    [{ ...envelope(), success: false }],
    [{ ...envelope(), results: [] }], [{ ...envelope(), results: [COUNTS, COUNTS] }],
    [{ ...envelope(), results: [null] }], [{ ...envelope(), results: [[]] }],
    [{ success: true, results: [COUNTS] }],
    [{ ...envelope(), meta: [] }],
  ]) {
    const result = await auditResponse(response)
    assert.equal(result.status, 'failed', JSON.stringify(response))
    assert.equal(result.code, 'INVALID_RESPONSE')
    assert.doesNotMatch(JSON.stringify(result), /SECRET-RAW-OUTPUT/)
    assert.equal(result.archiveEnabled, false)
    assert.equal(result.deletionEnabled, false)
  }
})

test('all count fields must be present nonnegative safe integers with consistent partitions', async () => {
  for (const key of Object.keys(COUNTS)) {
    for (const invalid of [undefined, null, -1, 0.5, '1', true, Number.MAX_SAFE_INTEGER + 1]) {
      const result = await auditResponse([envelope({ ...COUNTS, [key]: invalid })])
      assert.equal(result.status, 'failed', `${key}: ${String(invalid)}`)
    }
  }
  for (const changed of [
    { approved: 9 }, { unapproved: 3 }, { eligible: 10 }, { invalidDate: 5 },
    { fulltextPermission: 11 }, { revoked: 11 },
    { eligibleApproved: 4 }, { eligibleUnapproved: 3 },
    { eligibleFulltextPermission: 4 }, { eligibleRevoked: 3 },
    { eligibleFulltextPermission: 7 }, { eligibleRevoked: 7 },
    { fulltextPermission: 8, eligibleFulltextPermission: 0 },
    { revoked: 8, eligibleRevoked: 0 },
  ]) {
    assert.equal((await auditResponse([envelope({ ...COUNTS, ...changed })])).status, 'failed')
  }
})

test('query metadata must prove a non-mutating read and a physical size', async () => {
  for (const key of ['size_after', 'rows_read']) {
    for (const invalid of [undefined, null, -1, 0.5, '1', true, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal((await auditResponse([envelope(COUNTS, { ...META, [key]: invalid })])).status, 'failed')
    }
  }
  for (const changed of [
    { rows_written: undefined }, { rows_written: '0' }, { rows_written: 1 },
    { changed_db: undefined }, { changed_db: 0 }, { changed_db: 'false' }, { changed_db: true },
  ]) {
    assert.equal((await auditResponse([envelope(COUNTS, { ...META, ...changed })])).status, 'failed')
  }
})

test('failed, rejected, malformed and oversized command output stays redacted', async () => {
  for (const commandRunner of [
    async () => ({ code: 124, stdout: 'SECRET-RAW-OUTPUT', stderr: 'SECRET-RAW-OUTPUT' }),
    async () => { throw new Error('SECRET-RAW-OUTPUT') },
    async () => ({ code: 0, stdout: 'SECRET-RAW-OUTPUT', stderr: '' }),
    async () => ({ code: 0, stdout: JSON.stringify([envelope({ ...COUNTS, secret: 'x'.repeat(128 * 1024) })]), stderr: '' }),
    async () => ({ code: 0, stdout: JSON.stringify([envelope()]), stderr: 'x'.repeat(128 * 1024) }),
  ]) {
    const result = await runD1RetentionAudit({ now: NOW, commandRunner })
    assert.equal(result.status, 'failed')
    assert.doesNotMatch(JSON.stringify(result), /SECRET-RAW-OUTPUT|xxxx/)
  }
})

test('options are bounded and invalid options fail before command invocation', async () => {
  let calls = 0
  const commandRunner = async () => {
    calls += 1
    return { code: 0, stdout: JSON.stringify([envelope()]), stderr: '' }
  }
  for (const options of [
    ...[0, -1, 1.1, 3651, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '30'].map((retentionDays) => ({ retentionDays })),
    ...[0, 99, 120_001, 100.5, NaN, Infinity, '30000'].map((timeoutMs) => ({ timeoutMs })),
    { now: new Date('invalid') }, { now: '2026-09-04' }, { now: new Date('0000-01-01T00:00:00Z') },
  ]) {
    const result = await runD1RetentionAudit({ ...options, commandRunner } as Parameters<typeof runD1RetentionAudit>[0])
    assert.equal(result.status, 'failed')
    assert.equal(result.code, 'INVALID_OPTIONS')
  }
  assert.equal(calls, 0)
  for (const [retentionDays, timeoutMs] of [[1, 100], [3650, 120_000]]) {
    assert.equal((await runD1RetentionAudit({ now: NOW, retentionDays, timeoutMs, commandRunner })).status, 'completed')
  }
})

test('CLI accepts only days and timeout positive integer arguments', () => {
  assert.deepEqual(parseD1RetentionAuditCli([]), {})
  assert.deepEqual(parseD1RetentionAuditCli(['--', '--days', '60', '--timeout-ms', '45000']), { retentionDays: 60, timeoutMs: 45000 })
  for (const argv of [
    ['--days'], ['--days', '0'], ['--days', '3651'], ['--days', '1e2'], ['--days', '0x1'],
    ['--days', '1.0'], ['--days', '+1'], ['--days', ' 1'], ['--days', '1', '--days', '2'],
    ['--timeout-ms', '99'], ['--timeout-ms', '120001'], ['--timeout-ms', 'NaN'],
    ['--command', 'SELECT 1'], ['--now', NOW.toISOString()], ['--database', 'other'],
  ]) assert.throws(() => parseD1RetentionAuditCli(argv), /INVALID_OPTIONS/)
})

test('CLI emits redacted failure JSON and exits 2 for invalid arguments without querying', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/d1-retention-audit.ts', '--command', 'SECRET-RAW-OUTPUT'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30_000,
  })
  assert.equal(result.status, 2, result.stderr)
  assert.equal(JSON.parse(result.stdout).code, 'INVALID_OPTIONS')
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET-RAW-OUTPUT/)
})

function executeAggregate(dates: Array<string | null>) {
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
  const rows = dates.map((date, index) => `('${index}', 'fixture', 'fixture', 'https://fixture.invalid/${index}', ${date === null ? 'NULL' : `'${date.replaceAll("'", "''")}'`}, ${index % 2}, ${index % 3 === 0 ? 1 : 0}, ${index % 4 === 0 ? "'revoked'" : 'NULL'})`)
  const inserts = rows.length ? `INSERT INTO articles(url_hash, title, source, url, discovered_at, approved_for_publication, fulltext_publication_allowed, fulltext_revoked_at) VALUES ${rows.join(',')};` : ''
  const result = spawnSync('sqlite3', ['-json', ':memory:'], {
    input: `.limit like_pattern_length 50\n${schema}\n${inserts}\nPRAGMA query_only = ON;\n${buildD1RetentionAuditQuery(NOW)};`,
    encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  // SQLite reports the changed limit before JSON; all query fixtures enforce D1's cap.
  const json = result.stdout.replace(/^\s*like_pattern_length\s+50\r?\n/, '')
  return JSON.parse(json)[0] as typeof COUNTS
}

test('actual read-only SQL compares UTC dates exactly without rounding fractional seconds', () => {
  const eligible = [
    '2026-08-05T12:34:56.788999Z', '2026-08-05T12:34:56.788Z', '2026-08-05T12:34:56Z',
    '2026-08-05T12:34:56.7Z', '2026-08-05T12:34:56.78Z', '2026-08-05T20:34:56.788999+08:00',
    '2026-08-05T08:34:56.788999-04:00', '2024-02-29T00:00:00Z',
  ]
  const notEligible = [
    CUTOFF, '2026-08-05T12:34:56.789000Z', '2026-08-05T12:34:56.789001Z',
    '2026-08-05T20:34:56.789000+08:00', '2026-08-05T08:34:56.789000-04:00',
    '2026-08-05T12:34:56.790Z', '2026-09-05T00:00:00Z',
  ]
  const counts = executeAggregate([...eligible, ...notEligible])
  assert.equal(counts.total, eligible.length + notEligible.length)
  assert.equal(counts.eligible, eligible.length)
  assert.equal(counts.invalidDate, 0)
  assert.equal(counts.approved + counts.unapproved, counts.total)
  assert.equal(counts.eligibleApproved + counts.eligibleUnapproved, eligible.length)
  assert.equal(counts.fulltextPermission, 5)
  assert.equal(counts.revoked, 4)
  assert.equal(counts.eligibleFulltextPermission, 3)
  assert.equal(counts.eligibleRevoked, 2)
})

test('actual SQL marks malformed and impossible ISO dates invalid instead of retention candidates', () => {
  const invalid = [
    '', '0', '2460000', '2460000.5', 'not-a-date', '2026-99-99',
    '2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z',
    '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z',
    '2026-01-01T24:00:00Z', '2026-01-01T23:60:00Z', '2026-01-01T23:59:60Z',
    '2026-01-01T00:00:00', '2026-01-01 00:00:00Z', '2026-01-01t00:00:00z',
    '2026-01-01T00:00:00.Z', '2026-01-01T00:00:00.1xZ', '2026-01-01T00:00:00.123Zsuffix',
    '2026-01-01T00:00:00Z ', ' 2026-01-01T00:00:00Z', '2026-01-01T00:00:00+0800',
    '2026-01-01T00:00:00+15:00', '2026-01-01T00:00:00+14:01', '2026-01-01T00:00:00+08:60',
    '2026-01-01T00:00:00+aa:bb', '2026-01-01T00:00:00.1.2Z',
  ]
  const counts = executeAggregate(invalid)
  assert.equal(counts.total, invalid.length)
  assert.equal(counts.invalidDate, invalid.length)
  assert.equal(counts.eligible, 0)
})

test('empty database has zero integer counts, not null sums', async () => {
  const counts = executeAggregate([])
  assert.deepEqual(counts, Object.fromEntries(Object.keys(COUNTS).map((key) => [key, 0])))
  assert.equal((await auditResponse([envelope(counts, { ...META, rows_read: 0 })])).status, 'completed')
})
