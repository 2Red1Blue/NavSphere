import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

import { feedIngestOutcome, validateFeedArticle } from '../src/lib/feed-api'
import { FEED_PREPARE_SQL, FEED_UPSERT_SQL, feedArticleBindings } from '../src/lib/feed-ingest-sql'
import { REQUIRED_FEED_COLUMNS } from '../src/lib/health-check'
import { createSqliteD1, type SqliteD1Fixture } from './helpers/sqlite-d1'

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
const migrationDirectory = new URL('../migrations/', import.meta.url)
const POINTER_COLUMNS = [
  'content_archive_key', 'content_archive_sha256', 'content_archive_version',
  'content_archive_bytes', 'content_archived_at',
] as const
const BODY_COLUMNS = [
  'content', 'content_format', 'content_quality', 'content_hash', 'content_chars',
  'content_quality_score', 'content_version', 'content_extracted_at', 'content_source',
  'fulltext_publication_allowed', 'fulltext_revoked_at', ...POINTER_COLUMNS,
] as const
const article = {
  url_hash: '0123456789abcdef', title: 'Curated archive', source: 'AIHOT',
  url: 'https://aihot.virxact.com/news/archive',
  original_url: 'https://example.com/original', original_url_provenance: 'aihot_api_v1',
  discovered_at: '2026-01-01T00:00:00Z', published_at: '2025-12-31T00:00:00Z',
  approved_for_publication: true, score: 24, signal: 8, novelty: 8, usefulness: 8,
}
const BODY = "An author's retained body 中文 🌱\n\n## Exact bytes\r\n"

function content(body = BODY, qualityScore = 90, extractedAt = '2026-01-02T00:00:00Z') {
  return {
    body, format: 'markdown_v1', quality: 'verified_fulltext',
    hash: createHash('sha256').update(body).digest('hex'), chars: [...body].length,
    quality_score: qualityScore, extracted_at: extractedAt, source: 'trafilatura',
    fulltext_publication_allowed: true,
  }
}

function migrationsThrough(version: number): string {
  return readdirSync(migrationDirectory)
    .filter((name) => /^\d{3}-.+\.sql$/.test(name) && Number(name.slice(0, 3)) <= version)
    .sort().map((name) => readFileSync(new URL(name, migrationDirectory), 'utf8')).join('\n')
}

function row(fixture: SqliteD1Fixture): Record<string, unknown> {
  return fixture.query('SELECT * FROM articles WHERE url_hash = ?1', [article.url_hash])[0]
}

function bodyContract(value: Record<string, unknown>) {
  return Object.fromEntries(BODY_COLUMNS.map((column) => [column, value[column]]))
}

async function write(fixture: SqliteD1Fixture, overrides: Record<string, unknown> = {}, sql = FEED_UPSERT_SQL) {
  const validation = await validateFeedArticle({ ...article, ...overrides })
  if (!validation.valid) assert.fail(validation.error)
  return fixture.db.prepare(sql).bind(...feedArticleBindings(validation.article)).run()
}

async function seedCold(fixture: SqliteD1Fixture, legacy = false) {
  await write(fixture, { content: content() })
  const digest = content().hash
  await fixture.db.prepare(`UPDATE articles SET content = NULL,
    content_hash = ?1, content_quality = ?2,
    content_archive_key = ?3, content_archive_sha256 = ?4,
    content_archive_version = content_version, content_archive_bytes = ?5,
    content_archived_at = '2026-07-01T00:00:00.000Z',
    fulltext_publication_allowed = 0, fulltext_revoked_at = '2026-07-02T00:00:00Z'
    WHERE url_hash = ?6`).bind(
    legacy ? null : digest, legacy ? 'legacy_unverified' : 'verified_fulltext',
    `feed-body/v1/${article.url_hash}/1/${digest}`, digest, Buffer.byteLength(BODY), article.url_hash,
  ).run()
}

test('archive contract is available through the current snapshot and schema 9 upgrade paths', () => {
  const legacy = readFileSync(new URL('fixtures/d1-legacy-schema.sql', import.meta.url), 'utf8')
  for (const [name, sql, expectedVersion] of [
    ['snapshot', schema, 10], ['migration-only', migrationsThrough(9), 9], ['legacy', `${legacy}\n${migrationsThrough(9)}`, 9],
  ] as const) {
    const fixture = createSqliteD1(sql)
    try {
      assert.equal(fixture.query<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations')[0].version, expectedVersion, name)
      const present = fixture.query<{ name: string }>("PRAGMA table_info('articles')").map((column) => column.name)
      for (const column of [...POINTER_COLUMNS, 'fulltext_control_version']) {
        assert.ok(present.includes(column), `${name}: ${column}`)
        assert.ok(REQUIRED_FEED_COLUMNS.includes(column as never), `readiness: ${column}`)
      }
      assert.equal(fixture.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'feed_archive_daily_budget'").length, 1)
      assert.deepEqual(fixture.query('PRAGMA foreign_key_check'), [])
    } finally { fixture.close() }
  }
})

test('migration 009 preserves all legacy metadata, NULL editorial hashes, rights and topic joins', async () => {
  const fixture = createSqliteD1(migrationsThrough(8))
  try {
    await write(fixture, {}, FEED_PREPARE_SQL)
    await fixture.db.prepare(`UPDATE articles SET content = ?1, content_hash = NULL,
      content_quality = 'legacy_unverified', content_version = 7,
      approved_for_publication = 0, fulltext_publication_allowed = 0,
      fulltext_revoked_at = '2026-01-03T00:00:00Z'`).bind(BODY).run()
    fixture.exec("INSERT INTO hot_topics(id, topic, count) VALUES (7, 'Preserved topic', 3); INSERT INTO article_topics VALUES ('0123456789abcdef', 7); INSERT INTO submission_rate_limits VALUES ('opaque-client', 123, 2);")
    const before = row(fixture)
    const related = ['hot_topics', 'article_topics', 'submission_rate_limits'].map((table) => fixture.query(`SELECT * FROM ${table}`))
    fixture.exec(readFileSync(new URL('009-add-content-archive.sql', migrationDirectory), 'utf8'))
    assert.deepEqual(row(fixture), {
      ...before, ...Object.fromEntries(POINTER_COLUMNS.map((column) => [column, null])), fulltext_control_version: 0,
    })
    assert.deepEqual(['hot_topics', 'article_topics', 'submission_rate_limits'].map((table) => fixture.query(`SELECT * FROM ${table}`)), related)
    assert.deepEqual(fixture.query('PRAGMA foreign_key_check'), [])
  } finally { fixture.close() }
})

test('both schema paths reject partial pointers and invalid numeric/archive contracts atomically', async () => {
  for (const sql of [schema, migrationsThrough(9)]) {
    const fixture = createSqliteD1(sql)
    try {
      await seedCold(fixture)
      const before = row(fixture)
      for (const invalid of [
        ...POINTER_COLUMNS.map((column) => `${column} = NULL`),
        "content_archive_key = ''", "content_archive_sha256 = 'bad'",
        `content_archive_sha256 = '${'A'.repeat(64)}'`,
        'content_archive_version = -1', 'content_archive_version = 1.5',
        'content_archive_version = 9007199254740992', 'content_archive_version = 2',
        'content_archive_bytes = 0', 'content_archive_bytes = 800001', 'content_archive_bytes = 1.5',
        "content_archived_at = ''", 'fulltext_control_version = -1',
        'fulltext_control_version = 1.5', 'fulltext_control_version = 9007199254740992',
      ]) {
        assert.throws(() => fixture.exec(`UPDATE articles SET ${invalid}`), Error, invalid)
        assert.deepEqual(row(fixture), before, invalid)
      }
      fixture.exec(`UPDATE articles SET ${POINTER_COLUMNS.map((column) => `${column} = NULL`).join(', ')}`)
      for (const column of POINTER_COLUMNS) assert.equal(row(fixture)[column], null)
      fixture.exec("INSERT INTO feed_archive_daily_budget(day, writes) VALUES ('2026-09-04', 0), ('2026-09-05', 100)")
      for (const value of [-1, 101, 1.5]) {
        assert.throws(() => fixture.exec(`UPDATE feed_archive_daily_budget SET writes = ${value}`))
      }
      assert.deepEqual(fixture.query('SELECT writes FROM feed_archive_daily_budget ORDER BY day'), [{ writes: 0 }, { writes: 100 }])
    } finally { fixture.close() }
  }
})

test('rights revision advances on repeated same-second revokes, but not storage-only writes', async () => {
  const fixture = createSqliteD1(schema)
  try {
    await write(fixture, { content: content() })
    assert.equal(row(fixture).fulltext_control_version, 0)
    for (const expected of [1, 2]) {
      const result = await fixture.db.prepare(`UPDATE articles SET fulltext_publication_allowed = 0,
        fulltext_revoked_at = '2026-09-04T10:00:00Z' WHERE url_hash = ?1`).bind(article.url_hash).run()
      assert.equal(result.meta.changes, 2)
      assert.equal(row(fixture).fulltext_control_version, expected)
    }
    fixture.exec("UPDATE articles SET title = 'Metadata edit', content = NULL")
    assert.equal(row(fixture).fulltext_control_version, 2)
    fixture.exec('UPDATE articles SET approved_for_publication = approved_for_publication')
    assert.equal(row(fixture).fulltext_control_version, 3)
    fixture.exec('UPDATE articles SET fulltext_publication_allowed = 1, fulltext_revoked_at = NULL, approved_for_publication = 1')
    assert.equal(row(fixture).fulltext_control_version, 4)
  } finally { fixture.close() }
})

test('cold bodies survive metadata, same-hash, lower-score and older same-quality ingests', async () => {
  const fixture = createSqliteD1(schema)
  try {
    await seedCold(fixture)
    const before = bodyContract(row(fixture))
    for (const incoming of [
      undefined, content(BODY, 100, '2026-09-03T00:00:00Z'),
      content('Lower score incoming body', 20, '2026-09-03T00:00:00Z'),
      content('Older incoming body', 90, '2025-12-01T00:00:00Z'),
    ]) {
      assert.equal((await write(fixture, { title: 'Metadata replay', content: incoming })).meta.changes, 2)
      assert.equal(row(fixture).title, 'Metadata replay')
      assert.deepEqual(bodyContract(row(fixture)), before)
    }
    const validation = await validateFeedArticle({ ...article, content: content('Legacy lower tier body', 100) })
    if (!validation.valid) assert.fail(validation.error)
    const lowerTierBindings = feedArticleBindings(validation.article)
    lowerTierBindings[7] = 'legacy_unverified'
    await fixture.db.prepare(FEED_UPSERT_SQL).bind(...lowerTierBindings).run()
    assert.deepEqual(bodyContract(row(fixture)), before)
  } finally { fixture.close() }
})

test('accepted cold-body replacement atomically clears every pointer and retains sticky revocation', async () => {
  for (const legacy of [false, true]) {
    const fixture = createSqliteD1(schema)
    try {
      await seedCold(fixture, legacy)
      const incoming = content('New accepted audited body 中文', legacy ? 1 : 95)
      await write(fixture, { content: incoming })
      const stored = row(fixture)
      assert.equal(stored.content, incoming.body)
      assert.equal(stored.content_hash, incoming.hash)
      assert.equal(stored.content_version, 2)
      assert.equal(stored.content_quality, 'verified_fulltext')
      assert.equal(stored.content_quality_score, incoming.quality_score)
      assert.equal(stored.fulltext_publication_allowed, 0)
      assert.equal(stored.fulltext_revoked_at, '2026-07-02T00:00:00Z')
      for (const column of POINTER_COLUMNS) assert.equal(stored[column], null, column)
    } finally { fixture.close() }
  }
})

test('legacy NULL hashes have equivalent verified upgrade behavior for hot and cold bodies', async () => {
  const outcomes: ReturnType<typeof bodyContract>[] = []
  for (const hot of [false, true]) {
    const fixture = createSqliteD1(schema)
    try {
      await seedCold(fixture, true)
      if (hot) await fixture.db.prepare('UPDATE articles SET content = ?1').bind(BODY).run()
      await write(fixture)
      assert.equal(row(fixture).content_hash, null, 'metadata ingestion must preserve the legacy hash')
      assert.equal(row(fixture).content_quality, 'legacy_unverified')
      await write(fixture, { content: content(BODY, 100, '2026-09-03T00:00:00Z') })
      assert.equal(row(fixture).content_hash, content().hash)
      assert.equal(row(fixture).content_quality, 'verified_fulltext')
      assert.equal(row(fixture).content_version, 2)
      for (const column of POINTER_COLUMNS) assert.equal(row(fixture)[column], null, column)
      outcomes.push(bodyContract(row(fixture)))
    } finally { fixture.close() }
  }
  assert.deepEqual(outcomes[0], outcomes[1])
})

test('prepare is a complete no-op for withdrawn cold rows including rights revisions and pointers', async () => {
  const fixture = createSqliteD1(schema)
  try {
    await seedCold(fixture)
    fixture.exec('UPDATE articles SET approved_for_publication = 0')
    const before = row(fixture)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await write(fixture, { title: 'Must not replace', content: content('Higher quality new body', 100) }, FEED_PREPARE_SQL)
      assert.equal(result.meta.changes, 0)
      assert.deepEqual(row(fixture), before)
    }
  } finally { fixture.close() }
})

test('real SQLite ingest receipts distinguish inserts, triggered replays and provenance conflicts', async () => {
  const fixture = createSqliteD1(schema)
  try {
    const inserted = await write(fixture)
    assert.equal(inserted.meta.changes, 1)
    assert.deepEqual(inserted.results, [{ url_hash: article.url_hash }])
    assert.deepEqual(feedIngestOutcome([inserted], [article.url_hash]), { status: 201, ingested: 1, conflicts: 0 })
    const replay = await write(fixture)
    assert.equal(replay.meta.changes, 2, 'D1 counts the article update plus its rights revision trigger')
    assert.deepEqual(replay.results, [{ url_hash: article.url_hash }])
    assert.deepEqual(feedIngestOutcome([replay], [article.url_hash]), { status: 201, ingested: 1, conflicts: 0 })
    const before = row(fixture)
    const conflict = await write(fixture, { original_url: 'https://example.com/conflicting-original' })
    assert.equal(conflict.meta.changes, 0)
    assert.deepEqual(conflict.results, [])
    assert.deepEqual(feedIngestOutcome([conflict], [article.url_hash]), { status: 409, ingested: 0, conflicts: 1 })
    assert.deepEqual(row(fixture), before)
  } finally { fixture.close() }
})
