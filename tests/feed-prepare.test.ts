import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { MAX_FEED_REQUEST_BYTES, withFeedErrorBoundary } from '../src/lib/feed-api'
import { FEED_PREPARE_SQL, FEED_UPSERT_SQL } from '../src/lib/feed-ingest-sql'
import { prepareFeedArticle } from '../src/lib/feed-prepare'

const API_KEY = 'prepare-test-key'
const article = {
  url_hash: '0123456789abcdef',
  title: "Editor's selected article",
  original_title: 'Original title',
  summary: 'Useful summary',
  takeaway: 'A practical takeaway',
  source: 'Example',
  url: 'https://example.com/article',
  category: 'general',
  topic: 'agents',
  type: 'deep',
  featured: true,
  score: 24,
  signal: 9,
  novelty: 7,
  usefulness: 8,
  content_potential: 'High',
  published_at: '2026-09-01T00:00:00Z',
  discovered_at: '2026-09-02T01:00:00Z',
  approved_for_publication: true,
}

function requestFor(payload: unknown = { articles: [article] }, headers: Record<string, string> = {}) {
  return new Request('https://example.com/api/feed/prepare', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      ...headers,
    },
    body: JSON.stringify(payload),
  })
}

function prepare(request: Request, db: D1Database, key: string | undefined = API_KEY) {
  return withFeedErrorBoundary(() => prepareFeedArticle(request, db, key), 'prepare')
}

function verifiedContent(body = 'Audited public Markdown body') {
  return {
    body,
    format: 'markdown_v1',
    quality: 'verified_fulltext',
    hash: createHash('sha256').update(body).digest('hex'),
    chars: [...body].length,
    quality_score: 94,
    extracted_at: '2026-09-02T02:00:00Z',
    source: 'trafilatura',
    fulltext_publication_allowed: true,
  }
}

function sqliteDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'navsphere-prepare-'))
  const databasePath = join(directory, 'feed.sqlite')
  const execute = (sql: string) => {
    const result = spawnSync('sqlite3', ['-json', databasePath], { input: sql, encoding: 'utf8' })
    assert.equal(result.status, 0, result.error?.message ?? result.stderr)
    return result.stdout.trim() ? JSON.parse(result.stdout.trim()) : []
  }
  execute(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: Array<string | number | null>) {
          const boundSql = sql.replace(/\?(\d+)/g, (_match, position: string) => {
            const value = values[Number(position) - 1]
            if (value === null) return 'NULL'
            if (typeof value === 'number') return String(value)
            assert.equal(typeof value, 'string', `invalid binding at ${position}`)
            return `'${value.replaceAll("'", "''")}'`
          })
          return {
            async run() {
              execute(`${boundSql};`)
              return { success: true }
            },
          }
        },
      }
    },
  } as unknown as D1Database
  return { database, execute, close: () => rmSync(directory, { recursive: true, force: true }) }
}

test('prepare authenticates before validation or database access', async () => {
  let calls = 0
  const database = { prepare() { calls += 1; throw new Error('unexpected DB access') } } as unknown as D1Database
  for (const authorization of ['', 'Bearer wrong-key', `Basic ${API_KEY}`]) {
    const response = await prepare(requestFor(null, { Authorization: authorization }), database)
    assert.equal(response.status, 401)
    assert.equal((await response.json()).error.code, 'UNAUTHORIZED')
  }
  const missingBinding = await withFeedErrorBoundary(
    () => prepareFeedArticle(requestFor(), database, undefined), 'prepare',
  )
  assert.equal(missingBinding.status, 401)
  assert.equal(calls, 0)
})

test('prepare requires exactly one article and reuses bounded Feed validation', async () => {
  const database = { prepare() { assert.fail('invalid input must not reach D1') } } as unknown as D1Database
  const invalidPayloads = [
    null, {}, { articles: [] }, { articles: [article, article] },
    { articles: [{ ...article, approved_for_publication: false }] },
    { articles: [{ ...article, score: 31 }] },
    { articles: [{ ...article, content: verifiedContent(), url_hash: 'invalid' }] },
    { articles: [{ ...article, content: { ...verifiedContent(), hash: '0'.repeat(64) } }] },
  ]
  for (const payload of invalidPayloads) {
    assert.equal((await prepare(requestFor(payload), database)).status, 422)
  }
  const malformed = requestFor()
  const malformedRequest = new Request(malformed.url, {
    method: 'POST', headers: malformed.headers, body: '{broken',
  })
  assert.equal((await prepare(malformedRequest, database)).status, 400)
  assert.equal((await prepare(requestFor({}, { 'Content-Type': 'text/plain' }), database)).status, 415)
  assert.equal((await prepare(requestFor({}, {
    'Content-Length': String(MAX_FEED_REQUEST_BYTES + 1),
  }), database)).status, 413)
  assert.equal((await prepare(requestFor({ padding: 'x'.repeat(MAX_FEED_REQUEST_BYTES) }), database)).status, 413)
})

test('prepare uses canonical bindings and acknowledges only after D1 completes', async () => {
  let complete!: (result: { success: boolean }) => void
  let started!: () => void
  const startedRun = new Promise<void>((resolve) => { started = resolve })
  const result = new Promise<{ success: boolean }>((resolve) => { complete = resolve })
  const database = {
    prepare(sql: string) {
      assert.equal(sql, FEED_PREPARE_SQL)
      return {
        bind(...values: unknown[]) {
          assert.deepEqual(values, [
            article.url_hash, article.title, article.original_title, article.summary, article.takeaway,
            null, null, 'summary_only', null, 0, 0, null, null, 0,
            article.source, article.url, article.category, article.topic, article.type, 1,
            24, 9, 7, 8, 'High', article.published_at, article.discovered_at, 1,
          ])
          return { run() { started(); return result } }
        },
      }
    },
  } as unknown as D1Database
  let settled = false
  const pending = prepare(requestFor(), database).then((response) => { settled = true; return response })
  await startedRun
  assert.equal(settled, false)
  complete({ success: true })
  const response = await pending
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await response.json(), { prepared: 1 })
})

test('prepare inserts summary and verified content through the real SQLite schema', async () => {
  const sqlite = sqliteDatabase()
  try {
    const response = await prepare(requestFor(), sqlite.database)
    assert.equal(response.status, 200)
    const [inserted] = sqlite.execute('SELECT * FROM articles;')
    for (const [key, value] of Object.entries(article)) {
      assert.equal(inserted[key], typeof value === 'boolean' ? Number(value) : value, key)
    }
    assert.equal(inserted.content, null)
    assert.equal(inserted.content_version, 0)
    assert.equal(inserted.content_quality, 'summary_only')

    const content = verifiedContent("Author's audited body 🌱")
    const fulltext = { ...article, url_hash: 'f'.repeat(16), content }
    assert.equal((await prepare(requestFor({ articles: [fulltext] }), sqlite.database)).status, 200)
    const [stored] = sqlite.execute("SELECT * FROM articles WHERE url_hash='ffffffffffffffff';")
    assert.equal(stored.content, content.body)
    assert.equal(stored.content_hash, content.hash)
    assert.equal(stored.content_chars, content.chars)
    assert.equal(stored.content_format, content.format)
    assert.equal(stored.content_quality, content.quality)
    assert.equal(stored.content_quality_score, content.quality_score)
    assert.equal(stored.content_extracted_at, content.extracted_at)
    assert.equal(stored.content_source, content.source)
    assert.equal(stored.fulltext_publication_allowed, 1)
    assert.equal(stored.content_version, 1)
  } finally {
    sqlite.close()
  }
})

test('prepare never overwrites curated, revoked or unapproved conflicting rows', async () => {
  const sqlite = sqliteDatabase()
  try {
    await prepare(requestFor({ articles: [{ ...article, content: verifiedContent() }] }), sqlite.database)
    const changed = {
      ...article, title: 'Replacement', original_title: 'Changed', summary: 'Changed', takeaway: 'Changed',
      source: 'Other', url: 'https://example.net/different-source', category: 'research', topic: 'new',
      type: 'tool', featured: false, score: 30, signal: 10, novelty: 10, usefulness: 10,
      content_potential: 'Low', published_at: '2026-09-04T00:00:00Z', discovered_at: '2026-09-04T01:00:00Z',
      content: verifiedContent('New replacement body'),
    }
    for (const approved of [1, 0]) {
      sqlite.execute(`UPDATE articles SET approved_for_publication = ${approved},
        fulltext_publication_allowed = 0, fulltext_revoked_at = '2026-09-03T00:00:00Z';`)
      const before = sqlite.execute('SELECT * FROM articles;')
      for (let replay = 0; replay < 2; replay += 1) {
        const response = await prepare(requestFor({ articles: [changed] }), sqlite.database)
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { prepared: 1 })
        assert.deepEqual(sqlite.execute('SELECT * FROM articles;'), before)
      }
      assert.equal(sqlite.execute('SELECT url_hash FROM articles WHERE approved_for_publication = 1;').length, approved)
    }
  } finally {
    sqlite.close()
  }
})

test('prepare binds omitted optional metadata as SQL NULL', async () => {
  const sqlite = sqliteDatabase()
  try {
    const minimal = {
      url_hash: article.url_hash, title: article.title, source: article.source, url: article.url,
      published_at: article.published_at, discovered_at: article.discovered_at,
      approved_for_publication: true,
    }
    const response = await prepare(requestFor({ articles: [minimal] }), sqlite.database)
    assert.equal(response.status, 200)
    const [stored] = sqlite.execute('SELECT * FROM articles;')
    for (const field of ['original_title', 'summary', 'takeaway', 'content_potential', 'topic', 'type']) {
      assert.equal(stored[field], null, field)
    }
    assert.equal(stored.category, 'general')
    for (const field of ['score', 'signal', 'novelty', 'usefulness', 'featured']) {
      assert.equal(stored[field], 0, field)
    }
  } finally {
    sqlite.close()
  }
})

test('prepare failures are retryable and expose no raw database contents in responses or logs', async () => {
  const logs: unknown[][] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => { logs.push(args) }
  const sensitive = 'database-secret raw-upstream-body SELECT private_column'
  try {
    for (const stage of ['prepare', 'bind', 'run', 'unconfirmed']) {
      const database = {
        prepare() {
          if (stage === 'prepare') throw new Error(sensitive)
          return {
            bind() {
              if (stage === 'bind') throw new Error(sensitive)
              return { async run() {
                if (stage === 'run') throw new Error(sensitive)
                return { success: false, error: sensitive }
              } }
            },
          }
        },
      } as unknown as D1Database
      const response = await prepare(requestFor(), database)
      assert.equal(response.status, 503)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
      assert.equal(response.headers.get('Retry-After'), '300')
      assert.deepEqual(await response.json(), {
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Feed service is temporarily unavailable' },
      })
    }
    assert.equal(logs.length, 4)
    assert.deepEqual(logs, Array.from({ length: 4 }, () => ['NavSphere Feed prepare failed']))
  } finally {
    console.error = originalConsoleError
  }
})

test('prepare route shares bindings and error boundary without changing bulk UPSERT policy', () => {
  assert.equal(FEED_PREPARE_SQL.split('ON CONFLICT')[0], FEED_UPSERT_SQL.split('ON CONFLICT')[0])
  assert.match(FEED_PREPARE_SQL, /ON CONFLICT\(url_hash\) DO NOTHING\s*$/)
  assert.doesNotMatch(FEED_PREPARE_SQL, /DO UPDATE|REPLACE/)
  assert.match(FEED_UPSERT_SQL, /ON CONFLICT\(url_hash\) DO UPDATE SET/)
  const route = readFileSync(new URL('../src/app/api/feed/prepare/route.ts', import.meta.url), 'utf8')
  assert.match(route, /return withFeedErrorBoundary\(async \(\) => \{/)
  assert.match(route, /prepareFeedArticle\(request, env\.DB, env\.CONTENT_OS_API_KEY\)/)
  assert.match(route, /\}, 'prepare'\)/)
  const ingest = readFileSync(new URL('../src/app/api/feed/route.ts', import.meta.url), 'utf8')
  assert.match(ingest, /stmt\.bind\(\.\.\.feedArticleBindings\(a\)\)/)
})
