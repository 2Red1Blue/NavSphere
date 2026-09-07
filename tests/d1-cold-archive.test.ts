import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseArchiveCli, runArchiveCli, PROJECT_ENV_FILE } from '../scripts/d1-cold-archive'

const config = { feedUrl: 'https://example.com/api/feed', apiKey: 'fixture-key' }
const ID = '0123456789abcdef'

test('CLI reads the parent Content OS project .env, not a nested NavSphere credential copy', () => {
  assert.equal(PROJECT_ENV_FILE, fileURLToPath(new URL('../../.env', import.meta.url)))
  assert.notEqual(PROJECT_ENV_FILE, fileURLToPath(new URL('../.env', import.meta.url)))
})

test('archive CLI defaults read-only and compaction requires separate confirmations', () => {
  assert.deepEqual(parseArchiveCli([]), { mode: 'audit', limit: 20 })
  assert.throws(() => parseArchiveCli(['--mode', 'compact']), /CONFIRMATION_REQUIRED/)
  assert.equal(parseArchiveCli(['--mode', 'compact', '--confirmed-recovery', '--confirmed-cold-reader']).mode, 'compact')
  for (const args of [['--limit', '21'], ['--mode', 'delete'], ['--id', 'bad'], ['--mode', 'stage', '--mode', 'compact']]) {
    assert.throws(() => parseArchiveCli(args))
  }
})

test('audit sends no POST and redacts unknown response fields', async () => {
  const calls: RequestInit[] = []
  const report = await runArchiveCli(parseArchiveCli([]), config, async (_url, init) => {
    calls.push(init ?? {})
    return new Response(JSON.stringify({ code: 'AUDIT_COMPLETED', secret: 'do-not-print',
      candidates: [{ url_hash: ID, state: 'hot', bytes: 20 }], scanned: 1, invalidDates: 5, truncated: false }))
  })
  assert.equal(report.status, 'completed')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'GET')
  assert.equal(calls[0].redirect, 'error')
  assert.equal(report.scanned, 1)
  assert.equal(report.invalidDates, 5)
  assert.equal(report.truncated, false)
  assert.doesNotMatch(JSON.stringify(report), /do-not-print|fixture-key/)
})

test('stage is bounded, stops on budget/storage failure, and does not retry POST', async () => {
  let posts = 0
  const report = await runArchiveCli(parseArchiveCli(['--mode', 'stage']), config, async (_url, init) => {
    if (init?.method === 'GET') return new Response(JSON.stringify({ code: 'AUDIT_COMPLETED', candidates: [
      { url_hash: ID, state: 'hot', bytes: 20 }, { url_hash: 'abcdef0123456789', state: 'hot', bytes: 20 },
    ], scanned: 2, invalidDates: 3, truncated: false }))
    posts++
    return new Response(JSON.stringify({ code: 'WRITE_BUDGET_EXHAUSTED' }), { status: 429 })
  })
  assert.equal(report.status, 'failed')
  assert.equal(posts, 1)
  assert.equal(report.items[0].code, 'WRITE_BUDGET_EXHAUSTED')
  assert.equal(report.invalidDates, 3)
  assert.equal(report.scanned, 2)
})

test('inventory requires valid audit counters and never invents zero for missing metadata', async () => {
  const inventory = { code: 'AUDIT_COMPLETED', candidates: [], scanned: 0, invalidDates: 0, truncated: false }
  for (const override of [
    { invalidDates: undefined }, { invalidDates: -1 }, { invalidDates: '0' }, { invalidDates: 0.5 },
    { invalidDates: Number.MAX_SAFE_INTEGER + 1 }, { scanned: undefined }, { scanned: 201 },
    { scanned: -1 }, { scanned: '0' }, { truncated: undefined }, { truncated: 'false' },
    { candidates: [{ url_hash: ID, state: 'hot', bytes: 20 }] },
  ]) {
    const result = await runArchiveCli(parseArchiveCli([]), config,
      async () => new Response(JSON.stringify({ ...inventory, ...override })))
    assert.equal(result.code, 'INVALID_RESPONSE')
    assert.equal(result.status, 'failed')
  }
})

test('invalid-date counts are visible but do not imply more actionable candidates', async () => {
  let calls = 0
  const result = await runArchiveCli(parseArchiveCli(['--mode', 'stage']), config, async (_url, init) => {
    calls++
    assert.equal(init?.method, 'GET')
    return new Response(JSON.stringify({ code: 'AUDIT_COMPLETED', candidates: [],
      scanned: 0, invalidDates: 101, truncated: false }))
  })
  assert.equal(calls, 1)
  assert.equal(result.code, 'BATCH_COMPLETED')
  assert.equal(result.moreCandidates, false)
  assert.equal(result.invalidDates, 101)
  assert.equal(result.scanned, 0)
})

test('transport failure after inventory keeps its validated audit metadata', async () => {
  const result = await runArchiveCli(parseArchiveCli(['--mode', 'stage']), config, async (_url, init) => {
    if (init?.method === 'GET') return new Response(JSON.stringify({ code: 'AUDIT_COMPLETED',
      candidates: [{ url_hash: ID, state: 'hot', bytes: 20 }], scanned: 1, invalidDates: 4, truncated: true }))
    throw new Error('fixture-key must not escape')
  })
  assert.equal(result.code, 'REQUEST_FAILED')
  assert.equal(result.invalidDates, 4)
  assert.equal(result.truncated, true)
  assert.doesNotMatch(JSON.stringify(result), /fixture-key/)
})

test('invalid URLs, transport failures and oversized replies do not expose credentials', async () => {
  let calls = 0
  const transport: typeof fetch = async () => { calls++; throw new Error('fixture-key in transport') }
  assert.equal((await runArchiveCli(parseArchiveCli([]), { ...config, feedUrl: 'http://example.com/api/feed' }, transport)).code, 'INVALID_CONFIGURATION')
  assert.equal(calls, 0)
  const failed = await runArchiveCli(parseArchiveCli([]), config, transport)
  assert.equal(failed.code, 'REQUEST_FAILED')
  assert.doesNotMatch(JSON.stringify(failed), /fixture-key/)
  const oversized = await runArchiveCli(parseArchiveCli([]), config, async () => new Response('x'.repeat(70_000)))
  assert.equal(oversized.code, 'INVALID_RESPONSE')
})

test('HTTP200 is not success without an exact article and action receipt', async () => {
  for (const receipt of [
    { code: 'COMPACTED', url_hash: ID }, { code: 'STAGED', url_hash: 'abcdef0123456789' },
    { code: 'STAGED' }, { code: 'COMPACTION_DISABLED' },
  ]) {
    const result = await runArchiveCli(parseArchiveCli(['--mode', 'stage', '--id', ID]), config,
      async () => new Response(JSON.stringify(receipt)))
    assert.equal(result.status, 'failed')
    assert.equal(result.code, 'INVALID_RESPONSE')
  }
  const valid = await runArchiveCli(parseArchiveCli(['--mode', 'stage', '--id', ID]), config,
    async () => new Response(JSON.stringify({ code: 'STAGED', url_hash: ID })))
  assert.equal(valid.status, 'completed')
})

test('failed HTTP receipts cannot claim another article, action or success code', async () => {
  for (const [status, receipt] of [
    [409, { code: 'STATE_CHANGED', url_hash: 'abcdef0123456789' }],
    [409, { code: 'COMPACTION_DISABLED', url_hash: ID }],
    [503, { code: 'STAGED', url_hash: ID }],
    [500, { code: 'ARCHIVE_UNAVAILABLE' }],
  ] as const) {
    const outcome = await runArchiveCli(parseArchiveCli(['--mode', 'stage', '--id', ID]), config,
      async () => new Response(JSON.stringify(receipt), { status }))
    assert.equal(outcome.code, 'INVALID_RESPONSE')
  }
})
