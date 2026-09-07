import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { EditorialBrief } from '../src/components/feed/editorial-brief'
import { readFeedDetail } from '../src/lib/feed-detail'
import { makeArchiveObject, ARCHIVE_COLUMNS } from '../src/lib/content-archive'
import type { ArchiveRow } from '../src/lib/content-archive'
import type { PublicEditorial } from '../src/types/feed'
import { createSqliteD1 } from './helpers/sqlite-d1'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/editorial-publication-v1.json', import.meta.url), 'utf8'))
const publication = fixture.manifest.publication
const ID = publication.article_id
const DATE = '2026-09-04T00:00:00Z'
const ORIGINAL = '# Original body\n\nOriginal body must have independent permission.\n'

async function database(version: 9 | 10 = 10) {
  const migrations = new URL('../migrations/', import.meta.url)
  const schema = version === 10 ? readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
    : readdirSync(migrations).filter(name => /^\d{3}-.*\.sql$/.test(name) && Number(name.slice(0, 3)) < 10)
      .sort().map(name => readFileSync(new URL(name, migrations), 'utf8')).join('\n')
  const result = createSqliteD1(schema)
  await result.db.prepare(`INSERT INTO articles (
    url_hash,title,source,url,original_url,original_url_provenance,discovered_at,
    approved_for_publication,content,content_format,content_quality,content_version,
    fulltext_publication_allowed,summary,score,signal,novelty,usefulness
  ) VALUES (?, 'Original collection title', 'AIHOT', ?, ?, ?, ?, 1, ?,
    'markdown_v1','verified_fulltext',1,0,'Unchanged summary',24,8,8,8)`)
    .bind(ID, publication.source.url, publication.source.original_url,
      publication.source.original_url_provenance, DATE, ORIGINAL).run()
  return result
}

async function insertEditorial(db: D1Database) {
  await db.prepare(`INSERT INTO article_editorials (
    url_hash,revision,state,publication_json,manifest_sha256,approval_digest,review_sha256,
    approved_by,approved_at,published_at
  ) VALUES (?,1,'published',?,?,?,?,?,?,?)`)
    .bind(ID, fixture.expected.publication_json, fixture.expected.manifest_sha256,
      fixture.expected.approval_digest, fixture.expected.review_sha256,
      'private-test-reviewer', DATE, DATE).run()
}

test('schema9 detail keeps hot original allowed/denied behavior with editorial null', async () => {
  for (const allowed of [0, 1]) {
    const current = await database(9)
    try {
      assert.equal(current.query<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations')[0].version, 9)
      current.query('UPDATE articles SET fulltext_publication_allowed=?', [allowed])
      const before = current.query('SELECT * FROM articles')
      const response = await readFeedDetail(current.db, undefined, ID)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
      const { data } = await response.json()
      assert.equal(data.editorial, null)
      assert.equal(data.content, allowed ? ORIGINAL : null)
      assert.equal(data.fulltext_publication_allowed, allowed)
      assert.equal(data.summary, 'Unchanged summary')
      assert.deepEqual(current.query('SELECT * FROM articles'), before)
    } finally { current.close() }
  }
})

test('schema9 cold read repeats authoritative fallback and honors concurrent original revocation', async () => {
  for (const revoke of [false, true]) {
    const current = await database(9)
    try {
      current.exec('UPDATE articles SET fulltext_publication_allowed=1')
      const row = current.query<ArchiveRow>(`SELECT ${ARCHIVE_COLUMNS.join(',')} FROM articles`)[0]
      const object = await makeArchiveObject(row)
      current.query(`UPDATE articles SET content=NULL,content_archive_key=?,content_archive_sha256=?,
        content_archive_version=1,content_archive_bytes=?,content_archived_at=?`, [object.key, object.sha256, object.bytes, DATE])
      let joinedReads = 0
      const db: D1Database = { ...current.db, prepare(sql) {
        if (sql.includes('LEFT JOIN article_editorials')) joinedReads++
        return current.db.prepare(sql)
      } }
      const response = await readFeedDetail(db, {
        async get() {
          if (revoke) current.exec(`UPDATE articles SET fulltext_publication_allowed=0,fulltext_revoked_at='${DATE}'`)
          return object.value
        },
        async put() { assert.fail('reader must not write') },
      }, ID)
      assert.equal(response.status, 200)
      const { data } = await response.json()
      assert.equal(data.editorial, null)
      assert.equal(data.content, revoke ? null : ORIGINAL)
      assert.equal(joinedReads, 2)
    } finally { current.close() }
  }
})

test('missing editorial table is not cached across requests or an awaited cold read', async () => {
  for (const duringColdRead of [false, true]) {
    const current = await database(9)
    try {
      const installEditorial = async () => {
        current.exec(readFileSync(new URL('../migrations/010-add-article-editorials.sql', import.meta.url), 'utf8'))
        await insertEditorial(current.db)
      }
      let response: Response
      if (duringColdRead) {
        current.exec('UPDATE articles SET fulltext_publication_allowed=1')
        const row = current.query<ArchiveRow>(`SELECT ${ARCHIVE_COLUMNS.join(',')} FROM articles`)[0]
        const object = await makeArchiveObject(row)
        current.query(`UPDATE articles SET content=NULL,content_archive_key=?,content_archive_sha256=?,
          content_archive_version=1,content_archive_bytes=?,content_archived_at=?`, [object.key, object.sha256, object.bytes, DATE])
        response = await readFeedDetail(current.db, {
          async get() { await installEditorial(); return object.value },
          async put() { assert.fail('reader must not write') },
        }, ID)
      } else {
        const legacy = await readFeedDetail(current.db, undefined, ID)
        assert.equal(legacy.status, 200)
        assert.equal((await legacy.json()).data.editorial, null)
        await installEditorial()
        response = await readFeedDetail(current.db, undefined, ID)
      }
      assert.equal(response.status, 200)
      const { data } = await response.json()
      assert.equal(data.editorial.brief.headline.text, publication.brief.headline.text)
      assert.equal(data.content, duringColdRead ? ORIGINAL : null)
    } finally { current.close() }
  }
})

test('detail only falls back for an explicit missing editorial table, not unrelated database errors', async () => {
  const current = await database()
  try {
    for (const message of [
      'D1_ERROR: no such table: other_table: SQLITE_ERROR',
      'D1_ERROR: no such table: article_editorials_backup: SQLITE_ERROR',
      'D1_ERROR: no such column: e.state: SQLITE_ERROR',
      'D1_ERROR: database disk image is malformed: SQLITE_CORRUPT',
      'D1_ERROR: database request timed out',
    ]) {
      let attempts = 0
      const db: D1Database = { ...current.db, prepare() { attempts++; throw new Error(message) } }
      const response = await readFeedDetail(db, undefined, ID)
      assert.equal(response.status, 503)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
      assert.equal(attempts, 1)
      assert.doesNotMatch(await response.text(), /SQLITE|other_table|timed out|malformed/)
    }
    for (const message of ['no such table: article_editorials', 'D1_ERROR: no such table: article_editorials: SQLITE_ERROR']) {
      const db: D1Database = { ...current.db, prepare(sql) {
        if (sql.includes('LEFT JOIN article_editorials')) throw new Error(message)
        return current.db.prepare(sql)
      } }
      const response = await readFeedDetail(db, undefined, ID)
      assert.equal(response.status, 200)
      assert.equal((await response.json()).data.editorial, null)
    }
  } finally { current.close() }
})

test('independent editorial is readable while original fulltext is denied, without changing articles', async () => {
  const current = await database()
  try {
    const before = current.query('SELECT * FROM articles')
    await insertEditorial(current.db)
    const response = await readFeedDetail(current.db, undefined, ID)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    const { data } = await response.json()
    assert.equal(data.content, null)
    assert.equal(data.fulltext_publication_allowed, 0)
    assert.equal(data.editorial.brief.headline.text, publication.brief.headline.text)
    assert.equal(data.editorial.revision, 1)
    assert.equal(data.title, 'Original collection title')
    assert.equal(data.score, 24)
    assert.doesNotMatch(JSON.stringify(data), /private-test-reviewer|review_sha256|approval_digest|manifest_sha256|Original body must/)
    assert.deepEqual(current.query('SELECT * FROM articles'), before)
  } finally { current.close() }
})

test('missing, withdrawn, source-stale and malformed editorials fail closed without breaking the summary', async () => {
  const mutations = [
    null,
    `UPDATE article_editorials SET state='withdrawn', revision=2, withdrawn_at='${DATE}', withdrawal_reason='explicit test revoke'`,
    "UPDATE articles SET original_url='https://papers.example.test/replaced'",
    "UPDATE articles SET url='https://aihot.virxact.com/items/replaced'",
    `UPDATE article_editorials SET publication_json=json_set(publication_json, '$.brief.headline.text', '<script>alert(1)</script>')`,
    `UPDATE article_editorials SET publication_json=json_set(publication_json, '$.article_id', 'ffffffffffffffff')`,
  ]
  for (const mutation of mutations) {
    const current = await database()
    try {
      if (mutation !== null) {
        await insertEditorial(current.db)
        current.exec(mutation)
      }
      const response = await readFeedDetail(current.db, undefined, ID)
      assert.equal(response.status, 200)
      const { data } = await response.json()
      assert.equal(data.editorial, null)
      assert.equal(data.summary, 'Unchanged summary')
      assert.equal(data.content, null)
    } finally { current.close() }
  }
})

test('global withdrawal hides the whole article including an approved editorial', async () => {
  const current = await database()
  try {
    await insertEditorial(current.db)
    current.exec('UPDATE articles SET approved_for_publication=0')
    const response = await readFeedDetail(current.db, undefined, ID)
    assert.equal(response.status, 404)
    assert.doesNotMatch(await response.text(), /editorial-v1|Original collection title/)
  } finally { current.close() }
})

test('cold original retrieval rechecks editorial withdrawal in the joined current snapshot', async () => {
  const current = await database()
  try {
    await insertEditorial(current.db)
    current.exec('UPDATE articles SET fulltext_publication_allowed=1')
    const row = current.query<ArchiveRow>(`SELECT ${ARCHIVE_COLUMNS.join(',')} FROM articles`)[0]
    const object = await makeArchiveObject(row)
    await current.db.prepare(`UPDATE articles SET content=NULL,content_archive_key=?,
      content_archive_sha256=?,content_archive_version=1,content_archive_bytes=?,content_archived_at=?`)
      .bind(object.key, object.sha256, object.bytes, DATE).run()
    const response = await readFeedDetail(current.db, {
      async get() {
        current.exec(`UPDATE article_editorials SET state='withdrawn', revision=2,
          withdrawn_at='${DATE}',withdrawal_reason='concurrent withdrawal'`)
        return object.value
      },
      async put() { assert.fail('reader must not write') },
    }, ID)
    assert.equal(response.status, 200)
    const { data } = await response.json()
    assert.equal(data.content, ORIGINAL)
    assert.equal(data.editorial, null)
  } finally { current.close() }
})

test('cold archive failure returns only a current strictly published editorial', async () => {
  const cases: Array<{
    name: string
    setup?: (current: Awaited<ReturnType<typeof database>>) => Promise<void> | void
    status: number
    hasEditorial: boolean
  }> = [
    { name: 'published editorial', status: 200, hasEditorial: true },
    { name: 'no editorial', setup: () => undefined, status: 503, hasEditorial: false },
    {
      name: 'withdrawn editorial',
      setup: (current) => current.exec(`UPDATE article_editorials SET state='withdrawn', revision=2,
        withdrawn_at='${DATE}', withdrawal_reason='cold archive fallback test'`),
      status: 503,
      hasEditorial: false,
    },
    {
      name: 'malformed editorial',
      setup: (current) => current.exec(`UPDATE article_editorials SET publication_json=json_set(
        publication_json, '$.brief.headline.text', '<script>alert(1)</script>')`),
      status: 503,
      hasEditorial: false,
    },
    {
      name: 'source-inconsistent editorial',
      setup: (current) => current.exec("UPDATE articles SET original_url='https://papers.example.test/replaced'"),
      status: 503,
      hasEditorial: false,
    },
  ]

  for (const scenario of cases) {
    const current = await database()
    try {
      if (scenario.name !== 'no editorial') await insertEditorial(current.db)
      current.exec('UPDATE articles SET fulltext_publication_allowed=1')
      const row = current.query<ArchiveRow>(`SELECT ${ARCHIVE_COLUMNS.join(',')} FROM articles`)[0]
      const object = await makeArchiveObject(row)
      current.query(`UPDATE articles SET content=NULL,content_archive_key=?,content_archive_sha256=?,
        content_archive_version=1,content_archive_bytes=?,content_archived_at=?`,
      [object.key, object.sha256, object.bytes, DATE])
      await scenario.setup?.(current)

      const response = await readFeedDetail(current.db, {
        async get() { throw new Error('private cold archive failure') },
        async put() { assert.fail('reader must not write') },
      }, ID)
      assert.equal(response.status, scenario.status, scenario.name)
      assert.doesNotMatch(await response.clone().text(), /private|cold archive|Original body/)
      if (scenario.hasEditorial) {
        const { data } = await response.json()
        assert.equal(data.content, null)
        assert.equal(data.editorial.brief.headline.text, publication.brief.headline.text)
      }
    } finally { current.close() }
  }
})

test('cold archive editorial fallback rechecks global withdrawal and fails closed when D1 reread fails', async () => {
  for (const outcome of ['withdraw', 'd1-failure'] as const) {
    const current = await database()
    try {
      await insertEditorial(current.db)
      current.exec('UPDATE articles SET fulltext_publication_allowed=1')
      const row = current.query<ArchiveRow>(`SELECT ${ARCHIVE_COLUMNS.join(',')} FROM articles`)[0]
      const object = await makeArchiveObject(row)
      current.query(`UPDATE articles SET content=NULL,content_archive_key=?,content_archive_sha256=?,
        content_archive_version=1,content_archive_bytes=?,content_archived_at=?`,
      [object.key, object.sha256, object.bytes, DATE])
      let joinedReads = 0
      const db: D1Database = { ...current.db, prepare(sql) {
        if (sql.includes('LEFT JOIN article_editorials')) {
          joinedReads++
          if (outcome === 'd1-failure' && joinedReads === 2) throw new Error('private D1 reread failure')
        }
        return current.db.prepare(sql)
      } }
      const response = await readFeedDetail(db, {
        async get() {
          if (outcome === 'withdraw') current.exec('UPDATE articles SET approved_for_publication=0')
          throw new Error('private cold archive failure')
        },
        async put() { assert.fail('reader must not write') },
      }, ID)
      assert.equal(response.status, outcome === 'withdraw' ? 404 : 503)
      assert.equal(joinedReads, 2)
      assert.doesNotMatch(await response.text(), /private|failure|editorial-v1|Original collection title/)
    } finally { current.close() }
  }
})

test('structured reader labels attribution and uncertainty with safe exact source links', () => {
  const editorial: PublicEditorial = { ...publication, revision: 1, published_at: DATE }
  const html = renderToStaticMarkup(createElement(EditorialBrief, { editorial }))
  assert.match(html, /本站整理/)
  assert.match(html, /独立新闻短稿/)
  assert.match(html, /分析与判断/)
  assert.match(html, /不确定性与局限/)
  assert.match(html, /不代表独立复核/)
  assert.ok(html.includes('https://papers.example.test/study?x=1&amp;y=(2)#part'))
  assert.match(html, /rel="noopener noreferrer"/)
  assert.doesNotMatch(html, /<script|<iframe|<img|needs_human_review|private-test-reviewer|dangerouslySetInnerHTML/)
})

test('reader component rejects malformed content instead of interpreting arbitrary HTML or links', () => {
  for (const mutate of [
    (value: PublicEditorial) => { value.brief.headline.text = '<img src=x onerror=alert(1)>' },
    (value: PublicEditorial) => { value.evidence[0].url = 'javascript:alert(1)' },
    (value: PublicEditorial) => { value.renderer_version = 'unknown' as 'editorial-v1' },
  ]) {
    const editorial: PublicEditorial = { ...structuredClone(publication), revision: 1, published_at: DATE }
    mutate(editorial)
    assert.equal(renderToStaticMarkup(createElement(EditorialBrief, { editorial })), '')
  }
})
