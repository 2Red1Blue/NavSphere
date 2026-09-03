import assert from 'node:assert/strict'
import test from 'node:test'

import { readResponseBody, runCommandWithLimits, runProductionGate } from '../scripts/production-gate'

const migrationNames = [
  '000-create-legacy-base.sql',
  '001-add-content.sql',
  '002-add-featured-topic.sql',
  '003-add-type.sql',
  '004-add-publication-approval.sql',
  '005-add-submission-rate-limits.sql',
  '006-add-content-contract.sql',
  '007-add-fulltext-revocation.sql',
]

function wrangler(rows: Record<string, unknown>[]) {
  return JSON.stringify([{ results: rows, success: true }])
}

function healthyFetch(): typeof fetch {
  return async (input) => {
    const path = new URL(input.toString()).pathname
    if (path === '/api/health') {
      return new Response(JSON.stringify({
        app: 'NavSphere',
        status: 'ok',
        checks: { database: 'ok', schema: 'ok' },
      }), { status: 200 })
    }
    if (path === '/api/feed') {
      return new Response(JSON.stringify({
        data: [{ url_hash: '0123456789abcdef' }],
        pagination: { total: 1 },
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ data: { url_hash: '0123456789abcdef' } }), { status: 200 })
  }
}

test('production gate passes only when migrations, schema, health, feed and detail are ready', async () => {
  const commands: string[][] = []
  const columns = [
    'content_format',
    'content_quality',
    'content_hash',
    'content_chars',
    'content_quality_score',
    'content_version',
    'content_extracted_at',
    'content_source',
    'fulltext_publication_allowed',
    'fulltext_revoked_at',
  ]
  const result = await runProductionGate({
    baseUrl: 'https://navsphere.example.test',
    migrationNames,
    commandRunner: async (command, args) => {
      commands.push([command, ...args])
      const query = args.at(-1)
      return {
        code: 0,
        stdout: query?.startsWith('SELECT id')
          ? wrangler(migrationNames.map((name, index) => ({ id: index + 1, name, applied_at: 'now' })))
        : wrangler(columns.map((name) => ({ name }))),
        stderr: '',
      }
    },
    fetchImpl: healthyFetch(),
  })

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.checks.map((item) => item.status), ['passed', 'passed', 'passed', 'passed', 'passed'])
  assert.equal(commands.length, 2)
  assert.ok(commands.every((args) => args.includes('--remote') && args.includes('--env') && args.includes('production')))
  assert.ok(commands.every((args) => args.at(-1)?.startsWith('SELECT')))
})

test('production gate reports a failed readiness result without printing response bodies', async () => {
  const result = await runProductionGate({
    baseUrl: 'https://navsphere.example.test',
    detailId: '0123456789abcdef',
    migrationNames,
    commandRunner: async (_command, args) => ({
      code: 0,
      stdout: args.at(-1)?.startsWith('SELECT id')
        ? wrangler(migrationNames.slice(0, 6).map((name, index) => ({ id: index + 1, name })))
        : wrangler([{ name: 'content_format' }]),
      stderr: 'Authorization: Bearer secret-value',
    }),
    fetchImpl: async (input) => {
      const path = new URL(input.toString()).pathname
      return path === '/api/health'
        ? new Response(JSON.stringify({ app: 'NavSphere', status: 'degraded', secret: 'do-not-print' }), { status: 503 })
        : new Response('upstream failure', { status: 503 })
    },
  })

  assert.equal(result.status, 'failed')
  assert.deepEqual(result.checks.map((item) => item.status), ['failed', 'failed', 'failed', 'failed', 'failed'])
  assert.ok(result.checks.every((item) => !('body' in item)))
})

test('production gate rejects unsafe base URLs and invalid detail IDs', async () => {
  await assert.rejects(() => runProductionGate({ baseUrl: 'https://example.test/?token=secret' }), /INVALID_BASE_URL/)
  const result = await runProductionGate({
    baseUrl: 'https://navsphere.example.test',
    detailId: 'not-a-hash',
    migrationNames,
    commandRunner: async (_command, args) => ({
      code: 0,
      stdout: args.at(-1)?.startsWith('SELECT id') ? wrangler([]) : wrangler([]),
      stderr: '',
    }),
    fetchImpl: healthyFetch(),
  })
  assert.equal(result.checks.find((item) => item.name === 'detail')?.code, 'INVALID_DETAIL_ID')
})

test('production gate rejects malformed migration rows and mismatched detail payloads', async () => {
  const result = await runProductionGate({
    baseUrl: 'https://navsphere.example.test',
    detailId: '0123456789abcdef',
    migrationNames,
    commandRunner: async (_command, args) => ({
      code: 0,
      stdout: args.at(-1)?.startsWith('SELECT id')
        ? wrangler([{ id: 1, name: migrationNames[0] }])
        : wrangler(REQUIRED_COLUMNS_FIXTURE.map((name) => ({ name }))),
      stderr: '',
    }),
    fetchImpl: async (input) => {
      const path = new URL(input.toString()).pathname
      if (path === '/api/health') {
        return new Response(JSON.stringify({ app: 'NavSphere', status: 'ok', checks: { database: 'ok', schema: 'ok' } }), { status: 200 })
      }
      if (path === '/api/feed') {
        return new Response(JSON.stringify({ data: [{ url_hash: '0123456789abcdef' }], pagination: { total: 1 } }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: { url_hash: 'fedcba9876543210' } }), { status: 200 })
    },
  })
  assert.equal(result.checks.find((item) => item.name === 'migrations')?.code, 'MIGRATION_INVALID_JSON')
  assert.equal(result.checks.find((item) => item.name === 'detail')?.code, 'DETAIL_HTTP_200')
  assert.equal(result.status, 'failed')
})

test('command runner enforces timeout and output ceilings', async () => {
  const timeout = await runCommandWithLimits(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], 20)
  assert.equal(timeout.code, 124)
  const oversized = await runCommandWithLimits(process.execPath, ['-e', "process.stdout.write('x'.repeat(200000))"], 1_000)
  assert.equal(oversized.code, 1)
})

test('response reader bounds chunked bodies without relying on content-length', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(300_000))
      controller.close()
    },
  })
  const response = new Response(stream)
  assert.equal(await readResponseBody(response), null)
})

test('wrangler success=false envelopes cannot satisfy migration readiness', async () => {
  const result = await runProductionGate({
    baseUrl: 'https://navsphere.example.test',
    migrationNames,
    commandRunner: async (_command, args) => ({
      code: 0,
      stdout: JSON.stringify([{ success: false, results: args.at(-1)?.startsWith('SELECT id') ? [] : [] }]),
      stderr: '',
    }),
    fetchImpl: healthyFetch(),
  })
  assert.equal(result.checks.find((item) => item.name === 'migrations')?.code, 'MIGRATION_INVALID_JSON')
})

const REQUIRED_COLUMNS_FIXTURE = [
  'content_format',
  'content_quality',
  'content_hash',
  'content_chars',
  'content_quality_score',
  'content_version',
  'content_extracted_at',
  'content_source',
  'fulltext_publication_allowed',
  'fulltext_revoked_at',
]
