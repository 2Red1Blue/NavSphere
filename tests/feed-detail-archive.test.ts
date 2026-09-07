import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { ARCHIVE_COLUMNS, makeArchiveObject } from '../src/lib/content-archive'
import type { ArchiveKV, ArchiveRow } from '../src/lib/content-archive'
import { readFeedDetail } from '../src/lib/feed-detail'
import { createSqliteD1 } from './helpers/sqlite-d1'

const ID = '0123456789abcdef'
const BODY = '# Exact body\n\n中文 👩‍💻 with trailing whitespace.  \n'
const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')

async function fixture(cold = false) {
  const database = createSqliteD1(SCHEMA)
  await database.db.prepare(`INSERT INTO articles (
    url_hash, title, summary, source, url, discovered_at, approved_for_publication,
    content, content_format, content_quality, content_chars, content_version,
    fulltext_publication_allowed, original_url, original_url_provenance
  ) VALUES (?, 'Article', 'Summary', 'Example', 'https://example.com/article',
    '2026-07-01T00:00:00Z', 1, ?, 'markdown_v1', 'verified_fulltext', ?, 1, 1,
    'https://original.example/article', 'aihot_rss_description')`)
    .bind(ID, BODY, [...BODY].length).run()
  const row = database.query<ArchiveRow>(`SELECT ${ARCHIVE_COLUMNS.join(', ')} FROM articles`)[0]
  const object = await makeArchiveObject(row)
  if (cold) {
    await database.db.prepare(`UPDATE articles SET content = NULL,
      content_archive_key = ?, content_archive_sha256 = ?, content_archive_version = 1,
      content_archive_bytes = ?, content_archived_at = '2026-08-01T00:00:00Z' WHERE url_hash = ?`)
      .bind(object.key, object.sha256, object.bytes, ID).run()
  }
  let reads = 0
  const kv: ArchiveKV = {
    async get(key, type) {
      reads += 1
      assert.equal(key, object.key)
      assert.equal(type, 'text')
      return object.value
    },
    async put() { assert.fail('public detail must never write to the archive') },
  }
  return { database, kv, object, reads: () => reads }
}

test('same-ID hot and cold detail return identical public data with no archive/control fields', async () => {
  const hot = await fixture()
  const cold = await fixture(true)
  try {
    const hotResponse = await readFeedDetail(hot.database.db, hot.kv, ID)
    const coldResponse = await readFeedDetail(cold.database.db, cold.kv, ID)
    assert.equal(hotResponse.status, 200)
    assert.equal(coldResponse.status, 200)
    const hotData = (await hotResponse.json()).data
    const coldData = (await coldResponse.json()).data
    // Fixtures can cross a wall-clock second; created_at is not body identity.
    assert.deepEqual({ ...hotData, created_at: null }, { ...coldData, created_at: null })
    assert.equal(coldData.content, BODY)
    assert.equal(coldData.original_url, 'https://original.example/article')
    assert.equal(coldData.content_hash, null)
    assert.equal(coldData.content_version, 1)
    assert.equal(hot.reads(), 0)
    assert.equal(cold.reads(), 1)
    for (const response of [hotResponse, coldResponse]) assert.equal(response.headers.get('Cache-Control'), 'no-store')
    for (const key of Object.keys(coldData)) assert.doesNotMatch(key, /archive|control|revoked|approved/)
    assert.equal(cold.database.query<{ content: null }>('SELECT content FROM articles')[0].content, null)
  } finally {
    hot.database.close()
    cold.database.close()
  }
})

test('D1 approval, permission, revocation, quality and format deny before any KV access', async () => {
  for (const update of [
    'approved_for_publication = 0',
    'fulltext_publication_allowed = 0',
    "fulltext_revoked_at = '2026-09-04T00:00:00Z'",
    "content_quality = 'legacy_unverified'",
    'content_format = NULL',
  ]) {
    for (const cold of [false, true]) {
      const current = await fixture(cold)
      try {
        current.database.exec(`UPDATE articles SET ${update}`)
        const response = await readFeedDetail(current.database.db, current.kv, ID)
        assert.equal(response.status, update.startsWith('approved') ? 404 : 200)
        assert.equal(response.headers.get('Cache-Control'), 'no-store')
        const data = await response.json()
        if (response.status === 200) assert.equal(data.data.content, null)
        assert.equal(current.reads(), 0)
        assert.doesNotMatch(JSON.stringify(data), /Exact body|feed-body\//)
      } finally {
        current.database.close()
      }
    }
  }
})

test('cold detail rechecks rights after KV and never leaks a concurrently revoked body', async () => {
  for (const update of [
    "fulltext_publication_allowed = 0, fulltext_revoked_at = '2026-09-04T00:00:00Z'",
    'approved_for_publication = 0',
    "content_quality = 'legacy_unverified'",
  ]) {
    const current = await fixture(true)
    try {
      const kv: ArchiveKV = {
        ...current.kv,
        async get() {
          current.database.exec(`UPDATE articles SET ${update}`)
          return current.object.value
        },
      }
      const response = await readFeedDetail(current.database.db, kv, ID)
      assert.equal(response.status, update.startsWith('approved') ? 404 : 200)
      const body = await response.json()
      if (response.status === 200) assert.equal(body.data.content, null)
      assert.doesNotMatch(JSON.stringify(body), /Exact body|feed-body\//)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
    } finally {
      current.database.close()
    }
  }
})

test('hot detail also rechecks D1 rights before returning body bytes', async () => {
  const current = await fixture()
  try {
    let selects = 0
    const database = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first() {
                const row = await current.database.db.prepare(sql).bind(...values).first()
                selects += 1
                if (selects === 1) {
                  current.database.exec(`UPDATE articles SET fulltext_publication_allowed = 0,
                    fulltext_revoked_at = '2026-09-04T00:00:00Z'`)
                }
                return row
              },
            }
          },
        }
      },
    } as unknown as D1Database
    const response = await readFeedDetail(database, current.kv, ID)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data.content, null)
    assert.equal(selects, 2)
    assert.equal(current.reads(), 0)
  } finally {
    current.database.close()
  }
})

test('approved metadata without any stored body remains readable without KV', async () => {
  const current = await fixture()
  try {
    current.database.exec('UPDATE articles SET content = NULL')
    const response = await readFeedDetail(current.database.db, current.kv, ID)
    assert.equal(response.status, 200)
    const { data } = await response.json()
    assert.equal(data.summary, 'Summary')
    assert.equal(data.content, null)
    assert.equal(current.reads(), 0)
  } finally {
    current.database.close()
  }
})

test('cold detail rejects a changed snapshot and revocation followed by restoration during KV read', async () => {
  for (const mutation of [
    `UPDATE articles SET content_version = 2, content = 'replacement',
      content_archive_key = NULL, content_archive_sha256 = NULL,
      content_archive_version = NULL, content_archive_bytes = NULL, content_archived_at = NULL;`,
    "UPDATE articles SET fulltext_publication_allowed = 0; UPDATE articles SET fulltext_publication_allowed = 1;",
  ]) {
    const current = await fixture(true)
    try {
      const response = await readFeedDetail(current.database.db, {
        ...current.kv,
        async get() {
          current.database.exec(mutation)
          return current.object.value
        },
      }, ID)
      assert.equal(response.status, 503)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
      assert.ok(Number(response.headers.get('Retry-After')) > 0)
      assert.doesNotMatch(await response.text(), /Exact body|feed-body\//)
    } finally {
      current.database.close()
    }
  }
})

test('missing, malformed and unavailable archive objects return sanitized retryable503', async () => {
  for (const result of [null, '{broken', 'throw', undefined]) {
    const current = await fixture(true)
    try {
      const kv: ArchiveKV | undefined = result === undefined ? undefined : {
        ...current.kv,
        async get() {
          if (result === 'throw') throw new Error('private backend token and key')
          return result
        },
      }
      const response = await readFeedDetail(current.database.db, kv, ID)
      assert.equal(response.status, 503)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
      assert.ok(Number(response.headers.get('Retry-After')) > 0)
      assert.doesNotMatch(await response.text(), /private|token|feed-body|Exact body|broken/)
    } finally {
      current.database.close()
    }
  }
})

test('missing detail IDs are non-cacheable404, and D1 failures are sanitized503', async () => {
  const current = await fixture()
  try {
    for (const id of ['', 'ffffffffffffffff']) {
      const response = await readFeedDetail(current.database.db, current.kv, id)
      assert.equal(response.status, 404)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
    }
    const failed = await readFeedDetail({
      prepare() { throw new Error('private database secret') },
    } as unknown as D1Database, current.kv, ID)
    assert.equal(failed.status, 503)
    assert.equal(failed.headers.get('Cache-Control'), 'no-store')
    assert.doesNotMatch(await failed.text(), /private|secret/)
  } finally {
    current.database.close()
  }
})

test('reader fetch opts out of browser HTTP caching', () => {
  const source = readFileSync(new URL('../src/app/feed/[id]/page.tsx', import.meta.url), 'utf8')
  assert.match(source, /fetch\(`\/api\/feed\/\$\{id\}`,\s*\{\s*cache:\s*'no-store',\s*signal:\s*controller\.signal,\s*\}\)/)
})
