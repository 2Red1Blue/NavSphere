import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { MAX_FEED_REQUEST_BYTES, validateFeedRequest } from '../src/lib/feed-api'
import { FEED_UPSERT_SQL } from '../src/lib/feed-ingest-sql'

const article = {
  url_hash: '0123456789abcdef',
  title: 'A useful article',
  source: 'Example',
  url: 'https://example.com/article',
  category: 'general',
  score: 24,
  signal: 8,
  novelty: 8,
  usefulness: 8,
  content_potential: 'High',
  published_at: '2026-08-31T00:00:00Z',
  discovered_at: '2026-08-31T00:00:00Z',
  approved_for_publication: true,
}

function requestFor(payload: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.com/api/feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  })
}

function routeHandlerBlock(source: string, signature: string): string {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `missing route handler: ${signature}`)
  const end = source.indexOf('\n}\n', start)
  assert.notEqual(end, -1, `unterminated route handler: ${signature}`)
  return source.slice(start, end + 2)
}

test('feed request rejects oversized Content-Length before parsing JSON', async () => {
  const request = requestFor({}, { 'Content-Length': String(MAX_FEED_REQUEST_BYTES + 1) })
  const result = await validateFeedRequest(request)
  assert.equal(result.valid, false)
  if (!result.valid) {
    assert.equal(result.status, 413)
    assert.equal(result.code, 'REQUEST_TOO_LARGE')
  }
})

test('feed request streams and rejects an oversized actual body without trusting Content-Length', async () => {
  const oversized = JSON.stringify({ padding: 'x'.repeat(MAX_FEED_REQUEST_BYTES) })
  const missingLength = new Request('https://example.com/api/feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: oversized,
  })
  const falsifiedLength = new Request('https://example.com/api/feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '12' },
    body: oversized,
  })

  for (const request of [missingLength, falsifiedLength]) {
    const result = await validateFeedRequest(request)
    assert.equal(result.valid, false)
    if (!result.valid) assert.equal(result.code, 'REQUEST_TOO_LARGE')
  }
})

test('feed request requires an exact JSON media type', async () => {
  for (const contentType of ['text/application/jsonfoo', 'application/json-patch+json']) {
    const result = await validateFeedRequest(requestFor({ articles: [article] }, {
      'Content-Type': contentType,
    }))
    assert.equal(result.valid, false)
    if (!result.valid) assert.equal(result.code, 'INVALID_CONTENT_TYPE')
  }
  assert.equal((await validateFeedRequest(requestFor({ articles: [article] }, {
    'Content-Type': 'Application/JSON; Charset=UTF-8',
  }))).valid, true)
})

test('feed request caps content-bearing batches at ten and preserves metadata batches', async () => {
  const contentBearing = Array.from({ length: 11 }, (_, index) => ({
    ...article,
    url_hash: index.toString(16).padStart(16, '0'),
    content: { body: 'full text' },
  }))
  const rejected = await validateFeedRequest(requestFor({ articles: contentBearing }))
  assert.equal(rejected.valid, false)
  if (!rejected.valid) assert.match(rejected.message, /10/)

  const metadataOnly = contentBearing.map(({ content, ...metadata }) => {
    void content
    return metadata
  })
  const accepted = await validateFeedRequest(requestFor({ articles: metadataOnly }))
  assert.equal(accepted.valid, true)
  if (accepted.valid) assert.equal(accepted.articles.length, 11)
})

test('D1 upsert and detail route enforce the verified content gate', () => {
  const ingestSource = readFileSync(new URL('../src/app/api/feed/route.ts', import.meta.url), 'utf8')
  const listHandler = routeHandlerBlock(ingestSource, 'export async function GET(request: Request)')
  const ingestHandler = routeHandlerBlock(ingestSource, 'export async function POST(request: Request)')
  assert.match(listHandler, /^export async function GET\(request: Request\) \{\n  return withFeedErrorBoundary\(async \(\) => \{/)
  assert.match(listHandler, /\n  \}, ['"]list['"]\)\n\}$/)
  assert.match(ingestHandler, /^export async function POST\(request: Request\) \{\n  return withFeedErrorBoundary\(async \(\) => \{/)
  assert.match(ingestHandler, /\n  \}, ['"]ingest['"]\)\n\}$/)
  assert.match(ingestSource, /db\.prepare\(FEED_UPSERT_SQL\)/)
  assert.match(FEED_UPSERT_SQL, /content_version/)
  assert.match(FEED_UPSERT_SQL, /content_hash\s+IS NOT\s+excluded\.content_hash/)
  assert.match(FEED_UPSERT_SQL, /content_quality_score/)
  assert.match(FEED_UPSERT_SQL, /julianday\(excluded\.content_extracted_at\)/)

  const detailSource = readFileSync(new URL('../src/app/api/feed/[id]/route.ts', import.meta.url), 'utf8')
  const detailHandler = routeHandlerBlock(detailSource, 'export async function GET(')
  assert.match(detailHandler, /\) \{\n  return withFeedErrorBoundary\(async \(\) => \{/)
  assert.match(detailHandler, /\n  \}, ['"]detail['"]\)\n\}$/)
  assert.doesNotMatch(detailSource, /SELECT\s+\*/)
  assert.match(detailSource, /content_quality\s*=\s*'verified_fulltext'/)
  assert.match(detailSource, /content_format\s*=\s*'markdown_v1'/)
  assert.match(detailSource, /fulltext_publication_allowed\s*=\s*1/)

  for (const relativePath of [
    '../src/app/api/feed/[id]/revoke/route.ts',
    '../src/app/api/feed/[id]/restore/route.ts',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    const operation = relativePath.includes('/revoke/') ? 'revoke' : 'restore'
    const handler = routeHandlerBlock(source, 'export async function POST(')
    assert.match(handler, /\) \{\n  return withFeedErrorBoundary\(async \(\) => \{/)
    assert.match(handler, new RegExp(`\\n  \\}, ['"]${operation}['"]\\)\\n\\}$`))
  }
})

test('canonical D1 upsert executes idempotent and quality-aware content transitions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'navsphere-upsert-'))
  const database = join(directory, 'feed.sqlite')
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')

  const sqlValue = (value: string | number | null) => {
    if (value === null) return 'null'
    if (typeof value === 'number') return String(value)
    return `'${value.replaceAll("'", "''")}'`
  }
  const valuesFor = ({
    body,
    hash,
    qualityScore,
    extractedAt,
  }: {
    body: string | null
    hash: string | null
    qualityScore: number
    extractedAt: string | null
  }): Array<string | number | null> => [
    '0123456789abcdef', 'Article', null, 'Summary', 'Takeaway', body,
    body ? 'markdown_v1' : null, body ? 'verified_fulltext' : 'summary_only', hash,
    body?.length ?? 0, qualityScore, extractedAt, body ? 'trafilatura' : null,
    body ? 1 : 0, 'Example', 'https://example.com/article', 'general', null,
    'deep', 0, 24, 8, 8, 8, 'High', '2026-09-01T00:00:00Z',
    '2026-09-01T00:00:00Z', 1,
  ]
  const executeUpsert = (values: Array<string | number | null>) => {
    const parameters = values.map((value, index) => (
      `.parameter set ?${index + 1} ${sqlValue(value)}`
    ))
    const script = [
      '.parameter init',
      ...parameters,
      `${FEED_UPSERT_SQL};`,
      "SELECT json_object('hash',content_hash,'body',content,'score',content_quality_score,'version',content_version) FROM articles WHERE url_hash='0123456789abcdef';",
    ].join('\n')
    const result = spawnSync('sqlite3', [database], {
      input: script,
      encoding: 'utf8',
    })
    if (result.status === null) {
      assert.fail(`sqlite3 CLI is required for the upsert integration test: ${result.error?.message ?? 'not found'}`)
    }
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout.trim()) as {
      hash: string | null
      body: string | null
      score: number
      version: number
    }
  }

  try {
    const initialized = spawnSync('sqlite3', [database], { input: schema, encoding: 'utf8' })
    if (initialized.status === null) {
      assert.fail(`sqlite3 CLI is required for the upsert integration test: ${initialized.error?.message ?? 'not found'}`)
    }
    assert.equal(initialized.status, 0, initialized.stderr)

    const first = executeUpsert(valuesFor({
      body: 'body-v1', hash: 'a'.repeat(64), qualityScore: 90,
      extractedAt: '2026-09-02T00:00:00Z',
    }))
    assert.deepEqual(first, { hash: 'a'.repeat(64), body: 'body-v1', score: 90, version: 1 })

    const replay = executeUpsert(valuesFor({
      body: 'body-v1', hash: 'a'.repeat(64), qualityScore: 99,
      extractedAt: '2026-09-03T00:00:00Z',
    }))
    assert.deepEqual(replay, first)

    const lowerQuality = executeUpsert(valuesFor({
      body: 'body-low', hash: 'b'.repeat(64), qualityScore: 80,
      extractedAt: '2026-09-04T00:00:00Z',
    }))
    assert.deepEqual(lowerQuality, first)

    const newerPeer = executeUpsert(valuesFor({
      body: 'body-v2', hash: 'c'.repeat(64), qualityScore: 90,
      extractedAt: '2026-09-05T00:00:00Z',
    }))
    assert.deepEqual(newerPeer, { hash: 'c'.repeat(64), body: 'body-v2', score: 90, version: 2 })

    const summaryReplay = executeUpsert(valuesFor({
      body: null, hash: null, qualityScore: 0, extractedAt: null,
    }))
    assert.deepEqual(summaryReplay, newerPeer)

    const revoked = spawnSync('sqlite3', [database], {
      input: "UPDATE articles SET fulltext_publication_allowed = 0, fulltext_revoked_at = '2026-09-06T00:00:00Z' WHERE url_hash = '0123456789abcdef';",
      encoding: 'utf8',
    })
    assert.equal(revoked.status, 0, revoked.stderr)
    executeUpsert(valuesFor({
      body: 'body-v3', hash: 'd'.repeat(64), qualityScore: 100,
      extractedAt: '2026-09-07T00:00:00Z',
    }))
    const permission = spawnSync('sqlite3', [database], {
      input: "SELECT json_object('allowed', fulltext_publication_allowed, 'revoked_at', fulltext_revoked_at, 'body', content) FROM articles WHERE url_hash='0123456789abcdef';",
      encoding: 'utf8',
    })
    assert.equal(permission.status, 0, permission.stderr)
    assert.deepEqual(JSON.parse(permission.stdout.trim()), {
      allowed: 0,
      revoked_at: '2026-09-06T00:00:00Z',
      body: 'body-v3',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
