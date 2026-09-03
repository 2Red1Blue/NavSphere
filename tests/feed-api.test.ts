import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  FEED_LIST_COLUMNS,
  FEED_RETRY_AFTER_SECONDS,
  secureTokenEquals,
  validateFeedArticle,
  withFeedErrorBoundary,
} from '../src/lib/feed-api'
import {
  createHealthResponse,
  CONTENT_CONTRACT_COLUMNS,
  REQUIRED_FEED_COLUMNS,
  handleHealthRequest,
} from '../src/lib/health-check'

const approvedArticle = {
  url_hash: '0123456789abcdef',
  title: 'A useful article',
  summary: 'A concise summary',
  takeaway: 'A takeaway',
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

test('feed ingestion fails closed without explicit publication approval', async () => {
  const result = await validateFeedArticle({ ...approvedArticle, approved_for_publication: false })
  assert.equal(result.valid, false)
})

test('feed ingestion accepts a bounded summary-only article', async () => {
  const result = await validateFeedArticle(approvedArticle)
  assert.equal(result.valid, true)
  if (result.valid) {
    assert.equal(result.article.approved_for_publication, 1)
    assert.equal(result.article.content, null)
  }
})

test('feed ingestion rejects non-http source URLs', async () => {
  const result = await validateFeedArticle({ ...approvedArticle, url: 'file:///etc/passwd' })
  assert.equal(result.valid, false)
})

test('feed ingestion requires timestamps with an explicit timezone', async () => {
  for (const timestamp of [
    '2026-08-31T00:00:00',
    '2026-08-31 00:00:00',
    '2026-02-31T00:00:00Z',
  ]) {
    assert.equal((await validateFeedArticle({ ...approvedArticle, discovered_at: timestamp })).valid, false)
    assert.equal((await validateFeedArticle({ ...approvedArticle, published_at: timestamp })).valid, false)
  }
  assert.equal((await validateFeedArticle({
    ...approvedArticle,
    discovered_at: '2026-08-31T08:00:00+08:00',
  })).valid, true)
})

test('feed ingestion accepts only verified markdown with matching SHA-256', async () => {
  const body = '# Preserved heading\n\nA paragraph with [a link](https://example.com).'
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  const hashHex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const content = {
    body,
    format: 'markdown_v1',
    quality: 'verified_fulltext',
    hash: hashHex,
    chars: [...body].length,
    quality_score: 91,
    extracted_at: '2026-09-02T08:30:00+08:00',
    source: 'trafilatura',
    fulltext_publication_allowed: true,
  }

  const result = await validateFeedArticle({ ...approvedArticle, content })
  assert.equal(result.valid, true)
  if (result.valid) assert.deepEqual(result.article.content, content)

  for (const invalid of [
    { ...content, body: `${body} changed` },
    { ...content, hash: hashHex.slice(0, 63) },
    { ...content, format: 'html' },
    { ...content, quality: 'summary_only' },
    { ...content, extracted_at: '2026-09-02T08:30:00' },
    { ...content, fulltext_publication_allowed: false },
    { ...content, chars: content.chars + 1 },
    { ...content, body: 'x'.repeat(200_001), chars: 200_001 },
  ]) {
    assert.equal((await validateFeedArticle({ ...approvedArticle, content: invalid })).valid, false)
  }
})

test('health endpoint checks the Feed schema contract and fails degraded with 503', async () => {
  const source = readFileSync(new URL('../src/lib/health-check.ts', import.meta.url), 'utf8')
  const routeSource = readFileSync(new URL('../src/app/api/health/route.ts', import.meta.url), 'utf8')
  assert.match(routeSource, /handleHealthRequest\(getRequestContext\)/)
  assert.match(source, /approved_for_publication\s*=\s*1/)
  assert.match(source, /PRAGMA table_info\('articles'\)/)
  assert.match(source, /'content'/)
  assert.match(source, /schema:\s*'ok'/)
  assert.match(source, /schema:\s*'incomplete'/)
  assert.match(source, /status:\s*'degraded'/)
  assert.match(source, /status:\s*503/)
  for (const column of FEED_LIST_COLUMNS) {
    assert.equal(REQUIRED_FEED_COLUMNS.includes(column), true, `health contract should cover ${column}`)
  }
  for (const column of CONTENT_CONTRACT_COLUMNS) {
    assert.equal(REQUIRED_FEED_COLUMNS.includes(column), true, `health contract should cover ${column}`)
  }

  const allColumns = [...REQUIRED_FEED_COLUMNS]
  const calls: string[] = []
  const database = {
    prepare(query: string) {
      calls.push(query)
      return {
        all: async <T>() => ({ results: allColumns.map((name) => ({ name })) as T[] }),
        first: async <T>() => ({ approved: 7 } as T),
      }
    },
  } as unknown as D1Database
  const healthy = await createHealthResponse(database)
  assert.equal(healthy.status, 200)
  assert.deepEqual((await healthy.json()).checks, {
    database: 'ok', schema: 'ok', approvedArticles: 7,
  })
  assert.equal(calls.length, 2)

  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const incompleteDatabase = {
      prepare(query: string) {
        calls.push(query)
        return {
          all: async <T>() => ({ results: allColumns
            .filter((name) => name !== 'content')
            .map((name) => ({ name })) as T[] }),
          first: async <T>() => ({ approved: 99 } as T),
        }
      },
    } as unknown as D1Database
    const incomplete = await createHealthResponse(incompleteDatabase)
    assert.equal(incomplete.status, 503)
    const incompleteBody = await incomplete.json() as { checks: unknown }
    assert.deepEqual(incompleteBody.checks, {
      database: 'ok', schema: 'incomplete',
    })
    assert.doesNotMatch(JSON.stringify(incompleteBody), /missingColumns|content/)
    assert.equal(calls.length, 3, 'schema failure must skip the count query')

    const brokenDatabase = {
      prepare() {
        throw new Error('database unavailable')
      },
    } as unknown as D1Database
    const degraded = await createHealthResponse(brokenDatabase)
    assert.equal(degraded.status, 503)
    const degradedBody = await degraded.json() as { checks: unknown }
    assert.deepEqual(degradedBody.checks, {
      database: 'failed', schema: 'unknown',
    })
    assert.doesNotMatch(JSON.stringify(degradedBody), /database unavailable|stack|error/i)

    const contextFailure = await handleHealthRequest(() => {
      throw new Error('context unavailable')
    })
    assert.equal(contextFailure.status, 503)
    const contextFailureBody = await contextFailure.json() as { checks: unknown }
    assert.deepEqual(contextFailureBody.checks, {
      database: 'failed', schema: 'unknown',
    })
    assert.doesNotMatch(JSON.stringify(contextFailureBody), /context unavailable|stack|error/i)
  } finally {
    console.error = originalConsoleError
  }
})

test('health schema query executes against the local SQLite schema', () => {
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
  const result = spawnSync('sqlite3', [':memory:'], {
    input: `${schema}\n.mode json\nPRAGMA table_info('articles');\n`,
    encoding: 'utf8',
  })
  if (result.status === null) {
    assert.fail(`sqlite3 CLI is required for the local schema integration test: ${result.error?.message ?? 'not found'}`)
  }
  assert.equal(result.status, 0, result.stderr)
  const rows = JSON.parse(result.stdout.trim()) as Array<{ name: string }>
  const names = new Set(rows.map((row) => row.name))
  for (const required of REQUIRED_FEED_COLUMNS) {
    assert.equal(names.has(required), true, `schema should contain ${required}`)
  }
})

test('feed list projection never includes article content or approval internals', () => {
  assert.equal(FEED_LIST_COLUMNS.includes('content' as never), false)
  assert.equal(FEED_LIST_COLUMNS.includes('approved_for_publication' as never), false)
})

test('feed error boundary converts unexpected failures to a finite retryable response', async () => {
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const response = await withFeedErrorBoundary(async () => {
      throw new Error('no such column: content_quality')
    }, 'detail')

    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(response.headers.get('Retry-After'), String(FEED_RETRY_AFTER_SECONDS))
    const body = await response.json() as { error: { code: string; message: string } }
    assert.deepEqual(body, {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Feed service is temporarily unavailable',
      },
    })
    assert.doesNotMatch(JSON.stringify(body), /content_quality|no such column/i)
  } finally {
    console.error = originalConsoleError
  }
})

test('feed error boundary passes through normal responses unchanged', async () => {
  const expected = new Response('unauthorized', { status: 401 })
  const response = await withFeedErrorBoundary(() => expected, 'list')
  assert.equal(response, expected)
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('Retry-After'), null)
  assert.equal(await response.text(), 'unauthorized')
})

test('feed ingestion preserves existing article content during an upsert', () => {
  const source = readFileSync(new URL('../src/app/api/feed/route.ts', import.meta.url), 'utf8')
  const upsert = source.slice(source.indexOf('ON CONFLICT(url_hash)'))

  assert.doesNotMatch(upsert, /content\s*=\s*NULL/)
})

test('API key comparison is exact and fails closed', async () => {
  assert.equal(await secureTokenEquals('same-secret', 'same-secret'), true)
  assert.equal(await secureTokenEquals('wrong-secret', 'same-secret'), false)
  assert.equal(await secureTokenEquals('', 'same-secret'), false)
  assert.equal(await secureTokenEquals('same-secret', undefined), false)
})

test('every public feed aggregation is publication-approved only', () => {
  for (const relativePath of ['../src/app/api/feed/route.ts', '../src/app/api/hot-topics/route.ts']) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    let offset = 0
    let queryCount = 0
    while ((offset = source.indexOf('FROM articles', offset)) !== -1) {
      queryCount += 1
      assert.match(
        source.slice(offset, offset + 260),
        /approved_for_publication\s*=\s*1|\$\{whereClause\}/,
      )
      offset += 'FROM articles'.length
    }
    assert.ok(queryCount > 0, `${relativePath} should contain article queries`)
  }
})
