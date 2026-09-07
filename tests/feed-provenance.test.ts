import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { FEED_LIST_COLUMNS, validateFeedArticle, feedIngestOutcome } from '../src/lib/feed-api'
import { FEED_PREPARE_SQL, FEED_UPSERT_SQL, feedArticleBindings } from '../src/lib/feed-ingest-sql'
import { getSourceLink } from '../src/lib/feed-view'
import { isAihotUrl, validateOriginalUrl } from '../src/lib/source-provenance'

const identity = 'https://aihot.virxact.com/news/item-123'
const upstream = 'https://example.com/report?sig=a%2Fb&part=2&part=1#read'
const article = {
  url_hash: '0123456789abcdef', title: 'Curated title', source: 'AIHOT', url: identity,
  published_at: '2026-09-01T00:00:00Z', discovered_at: '2026-09-02T00:00:00Z',
  approved_for_publication: true, score: 24, signal: 8, novelty: 8, usefulness: 8,
}
const metadata = { original_url: upstream, original_url_provenance: 'aihot_api_v1' }

test('original URLs use strict lexical public HTTP(S) validation without rewriting signed queries', () => {
  assert.equal(validateOriginalUrl(upstream), upstream)
  assert.equal(validateOriginalUrl('http://www.example.com/article'), 'http://www.example.com/article')
  assert.equal(validateOriginalUrl('https://例子.中国/文章?签名=保留'), 'https://例子.中国/文章?签名=保留')
  for (const unsafe of [
    '', null, 42, 'javascript:alert(1)', 'file:///etc/passwd', '//example.com/path',
    ' https://example.com/', 'https://example.com/ ', 'https://example.com/a\nb',
    'https://example.com/\u0000', 'https://example.com/a\\b',
    'https://example.com/a\u200bb', 'https://host.localdomain/a',
    'https://user:password@example.com/', 'https://@example.com/',
    'https://localhost/a', 'https://foo.local/a', 'https://intranet/a',
    'https://host.internal/a', 'https://host.localhost/a', 'https://host.lan/a',
    'https://127.0.0.1/a', 'https://10.0.0.1/a', 'https://169.254.169.254/',
    'https://192.168.1.1/', 'https://172.16.0.1/', 'https://100.64.0.1/',
    'https://2130706433/', 'https://0177.0.0.1/', 'https://0x7f000001/',
    'https://127.1/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/',
    'https://%31%32%37.0.0.1/', 'https://example.com:/', 'https://example.com:0/',
    `https://example.com/${'x'.repeat(2048)}`,
  ]) assert.equal(validateOriginalUrl(unsafe), null, String(unsafe))
})

test('AIHOT identity must use the exact host, not a source label or deceptive suffix', () => {
  assert.equal(isAihotUrl(identity), true)
  for (const url of [
    'https://aihot.virxact.com.evil.example/item', 'https://evil.aihot.virxact.com/item',
    'https://aihot.virxact.com@evil.example/item', 'https://example.com/aihot.virxact.com',
    'https://ａｉｈｏｔ.virxact.com/item',
  ]) assert.equal(isAihotUrl(url), false, url)
})

test('ingestion validates paired evidence and preserves empty metadata as absent', async () => {
  for (const provenance of ['aihot_rss_description', 'aihot_api_v1', 'legacy_flash']) {
    const valid = await validateFeedArticle({ ...article, ...metadata, original_url_provenance: provenance })
    assert.equal(valid.valid, true)
    if (valid.valid) assert.equal(valid.article.original_url, upstream)
  }
  for (const empty of [{}, { original_url: null }, { original_url: '', original_url_provenance: '' }]) {
    const result = await validateFeedArticle({ ...article, ...empty })
    assert.equal(result.valid, true)
    if (result.valid) {
      assert.equal(result.article.original_url, null)
      assert.equal(result.article.original_url_provenance, null)
    }
  }
  for (const invalid of [
    { original_url: upstream }, { original_url_provenance: 'aihot_api_v1' },
    { ...metadata, original_url_provenance: 'inferred' },
    { ...metadata, original_url: identity }, { ...metadata, original_url: 'http://127.1/' },
    { ...metadata, original_url: 'https://ａｉｈｏｔ.virxact.com/item' },
    { ...metadata, url: 'https://example.com/not-aihot' },
    { ...metadata, url: 'https://aihot.virxact.com.evil.example/item' },
  ]) assert.equal((await validateFeedArticle({ ...article, ...invalid })).valid, false)
})

test('reader source links distinguish original, AIHOT collection, ordinary source and invalid URL', () => {
  assert.deepEqual(getSourceLink({ url: identity, ...metadata }), { url: upstream, label: '查看原文' })
  assert.deepEqual(getSourceLink({ url: identity }), { url: identity, label: 'AIHOT收录页' })
  assert.deepEqual(getSourceLink({ url: identity, original_url: 'javascript:alert(1)', original_url_provenance: 'aihot_api_v1' }), { url: identity, label: 'AIHOT收录页' })
  assert.deepEqual(getSourceLink({ url: 'https://example.com/source', ...metadata }), { url: 'https://example.com/source', label: '查看原文' })
  assert.equal(getSourceLink({ url: 'https://localhost/private', ...metadata }), null)
})

test('SQL guards conflicts as whole-row no-ops while empty metadata preserves provenance', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'navsphere-provenance-'))
  const database = join(directory, 'feed.sqlite')
  const execute = (sql: string) => {
    const result = spawnSync('sqlite3', ['-json', database], { input: sql, encoding: 'utf8' })
    assert.equal(result.status, 0, result.error?.message ?? result.stderr)
    return result.stdout.trim() ? JSON.parse(result.stdout.trim()) : []
  }
  const write = async (input: Record<string, unknown>, statement = FEED_UPSERT_SQL) => {
    const validation = await validateFeedArticle(input)
    if (!validation.valid) assert.fail(validation.error)
    const bindings = feedArticleBindings(validation.article)
    assert.ok(bindings.length < 100)
    const sql = statement.replace(/\?(\d+)/g, (_match, position: string) => {
      const value = bindings[Number(position) - 1]
      return value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${value.replaceAll("'", "''")}'`
    })
    if (statement === FEED_PREPARE_SQL) return execute(`${sql}; SELECT changes() AS changed;`)[0].changed
    const returned = execute(`${sql};`)
    assert.ok(returned.length <= 1)
    if (returned.length === 1) assert.equal(returned[0].url_hash, validation.article.url_hash)
    return returned.length
  }
  try {
    execute(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
    assert.equal(await write({ ...article, ...metadata }), 1)
    execute("UPDATE articles SET content='audited body', content_quality='verified_fulltext', content_format='markdown_v1', content_hash='retained-hash', content_version=7, fulltext_publication_allowed=0, fulltext_revoked_at='2026-09-03T00:00:00Z', approved_for_publication=0;")
    const before = execute('SELECT * FROM articles;')
    for (const conflicting of [
      { ...article, ...metadata, original_url: 'https://other.example.com/conflict', title: 'Replacement' },
      { ...article, url: 'https://example.com/different-identity', title: 'Replacement' },
    ]) {
      assert.equal(await write(conflicting), 0)
      assert.deepEqual(execute('SELECT * FROM articles;'), before)
    }
    assert.equal(await write({ ...article, ...metadata, title: 'Prepare replacement' }, FEED_PREPARE_SQL), 0)
    assert.deepEqual(execute('SELECT * FROM articles;'), before)
    for (const replayMetadata of [
      {}, { original_url: null, original_url_provenance: null }, { original_url: '', original_url_provenance: '' },
      { ...metadata, original_url_provenance: 'aihot_rss_description' },
      { ...metadata, original_url_provenance: 'legacy_flash' },
    ]) {
      assert.equal(await write({ ...article, ...replayMetadata }), 1)
      const [stored] = execute('SELECT * FROM articles;')
      assert.equal(stored.original_url, upstream)
      assert.equal(stored.original_url_provenance, metadata.original_url_provenance)
      assert.equal(stored.content, 'audited body')
      assert.equal(stored.content_version, 7)
      assert.equal(stored.fulltext_revoked_at, '2026-09-03T00:00:00Z')
      assert.equal(stored.fulltext_publication_allowed, 0)
    }
    const withoutOriginal = { ...article, url_hash: 'f'.repeat(16) }
    assert.equal(await write(withoutOriginal), 1)
    assert.equal(await write({ ...withoutOriginal, ...metadata }), 1)
    assert.equal(execute("SELECT original_url FROM articles WHERE url_hash='ffffffffffffffff';")[0].original_url, upstream)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('ingestion requires exact RETURNING receipts, independent of trigger-inclusive D1 write counts', () => {
  const id = article.url_hash
  const otherId = 'f'.repeat(16)
  for (const changes of [1, 2]) {
    assert.deepEqual(feedIngestOutcome([{ success: true, results: [{ url_hash: id }], meta: { changes } }], [id]),
      { status: 201, ingested: 1, conflicts: 0 })
  }
  assert.deepEqual(feedIngestOutcome([{ success: true, results: [{ url_hash: id }] }], [id]),
    { status: 201, ingested: 1, conflicts: 0 })
  assert.deepEqual(feedIngestOutcome([{ success: true, results: [], meta: { changes: 0 } }], [id]),
    { status: 409, ingested: 0, conflicts: 1 })
  assert.deepEqual(feedIngestOutcome([
    { success: true, results: [{ url_hash: id }], meta: { changes: 2 } },
    { success: true, results: [], meta: { changes: 0 } },
  ], [id, otherId]), { status: 409, ingested: 1, conflicts: 1 })
  for (const results of [
    [{ success: true }], [{ success: false, results: [{ url_hash: id }] }], [],
    [{ success: true, meta: { changes: 2 } }],
    [{ success: true, results: [{ url_hash: otherId }], meta: { changes: 2 } }],
    [{ success: true, results: [{ url_hash: id }, { url_hash: id }] }],
    [{ success: true, results: [{}] }], [{ success: true, results: [null] }],
    [{ success: true, results: null }], [{ success: true, results: { url_hash: id } }],
  ]) {
    assert.equal(feedIngestOutcome(results, [id]).status, 503)
  }
  assert.equal(feedIngestOutcome([
    { success: true, results: [{ url_hash: otherId }] },
    { success: true, results: [{ url_hash: id }] },
  ], [id, otherId]).status, 503, 'statement receipts must preserve expected order')
  const route = readFileSync(new URL('../src/app/api/feed/route.ts', import.meta.url), 'utf8')
  assert.match(route, /feedIngestOutcome\(batchResults, validArticles\.map\(\(article\) => article\.url_hash\)\)/)
  assert.match(route, /INGEST_CONFLICT/)
})

test('source metadata is projected in list, detail and daily without exposing full text', () => {
  for (const field of ['original_url', 'original_url_provenance']) {
    assert.ok(FEED_LIST_COLUMNS.includes(field as never))
    assert.match(readFileSync(new URL('../src/app/api/feed/daily/route.ts', import.meta.url), 'utf8'), new RegExp(`\\b${field}\\b`))
  }
  const detailRoute = readFileSync(new URL('../src/app/api/feed/[id]/route.ts', import.meta.url), 'utf8')
  const detailService = readFileSync(new URL('../src/lib/feed-detail.ts', import.meta.url), 'utf8')
  assert.match(detailRoute, /readFeedDetail\(env\.DB, env\.CONTENT_ARCHIVE, id\)/)
  assert.match(detailService, /\.\.\.FEED_LIST_COLUMNS/)
  const reader = readFileSync(new URL('../src/app/feed/[id]/page.tsx', import.meta.url), 'utf8')
  assert.match(reader, /getSourceLink\(article\)/)
  assert.match(reader, /href=\{sourceLink.url\}/)
  assert.match(reader, /\{sourceLink.label\}/)
})

test('migration 008 preserves historical rows and enforces the same pair constraint as the snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'navsphere-provenance-migration-'))
  const execute = (database: string, sql: string) => spawnSync('sqlite3', ['-json', database], { input: sql, encoding: 'utf8' })
  const readRows = (database: string) => {
    const result = execute(database, 'SELECT * FROM articles;')
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout.trim())
  }
  const seed = "INSERT INTO articles(url_hash,title,source,url,discovered_at,approved_for_publication,content,content_version,fulltext_publication_allowed,fulltext_revoked_at) VALUES('0123456789abcdef','Historical','AIHOT','https://aihot.virxact.com/news/item-123','2026-01-01T00:00:00Z',0,'retained full body',4,0,'2026-02-01T00:00:00Z');"
  try {
    for (const mode of ['snapshot', 'migrations']) {
      const database = join(directory, `${mode}.sqlite`)
      if (mode === 'snapshot') {
        assert.equal(execute(database, readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')).status, 0)
        assert.equal(execute(database, seed).status, 0)
      } else {
        const migrationDirectory = new URL('../migrations/', import.meta.url)
        const prior = readdirSync(migrationDirectory).filter((name) => /^00[0-7]-.*\.sql$/.test(name)).sort()
        assert.equal(prior.length, 8)
        for (const name of prior) {
          const result = execute(database, readFileSync(new URL(name, migrationDirectory), 'utf8'))
          assert.equal(result.status, 0, result.stderr)
        }
        assert.equal(execute(database, seed).status, 0)
        const [before] = readRows(database)
        const migration = execute(database, readFileSync(new URL('008-add-original-url.sql', migrationDirectory), 'utf8'))
        assert.equal(migration.status, 0, migration.stderr)
        const [after] = readRows(database)
        assert.deepEqual(after, { ...before, original_url: null, original_url_provenance: null })
      }
      assert.equal(JSON.parse(execute(database, 'SELECT MAX(version) AS version FROM schema_migrations;').stdout)[0].version, mode === 'snapshot' ? 10 : 8)
      const before = readRows(database)
      for (const invalidUpdate of [
        "original_url='https://example.com/one'",
        "original_url_provenance='aihot_api_v1'",
        "original_url='https://example.com/one',original_url_provenance='guessed'",
        "original_url='',original_url_provenance='aihot_api_v1'",
      ]) {
        assert.notEqual(execute(database, `UPDATE articles SET ${invalidUpdate};`).status, 0)
        assert.deepEqual(readRows(database), before)
      }
      assert.equal(execute(database, "UPDATE articles SET original_url='https://example.com/report',original_url_provenance='legacy_flash';").status, 0)
      assert.equal(readRows(database)[0].original_url_provenance, 'legacy_flash')
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
