import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { restoreFeedFullText, revokeFeedFullText } from '../src/lib/feed-revocation'
import { ARCHIVE_COLUMNS, makeArchiveObject } from '../src/lib/content-archive'
import type { ArchiveKV, ArchiveRow } from '../src/lib/content-archive'
import { createSqliteD1 } from './helpers/sqlite-d1'

const ID = '0123456789abcdef'
const BODY = '# Verified original\n\n中文 and exact bytes.  \n'
const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')

async function restoreFixture(cold = false) {
  const database = createSqliteD1(SCHEMA)
  await database.db.prepare(`INSERT INTO articles (
    url_hash, title, summary, source, url, discovered_at, approved_for_publication,
    content, content_format, content_quality, content_chars, content_version,
    fulltext_publication_allowed, fulltext_revoked_at
  ) VALUES (?, 'Article', 'Summary', 'Example', 'https://example.com/article',
    '2026-07-01T00:00:00Z', 1, ?, 'markdown_v1', 'verified_fulltext', ?, 1, 0,
    '2026-09-04T00:00:00Z')`).bind(ID, BODY, [...BODY].length).run()
  const row = database.query<ArchiveRow>(`SELECT ${ARCHIVE_COLUMNS.join(', ')} FROM articles`)[0]
  const object = await makeArchiveObject(row)
  if (cold) {
    await database.db.prepare(`UPDATE articles SET content = NULL,
      content_archive_key = ?, content_archive_sha256 = ?, content_archive_version = 1,
      content_archive_bytes = ?, content_archived_at = '2026-08-01T00:00:00Z'`)
      .bind(object.key, object.sha256, object.bytes).run()
  }
  let reads = 0
  const kv: ArchiveKV = {
    async get(key) {
      reads += 1
      assert.equal(key, object.key)
      return object.value
    },
    async put() { assert.fail('rights restoration must not write to the archive') },
  }
  return { database, kv, object, reads: () => reads }
}

test('revoke and ingest routes use the same Cloudflare API key binding', () => {
  const revokeRoute = readFileSync(new URL('../src/app/api/feed/[id]/revoke/route.ts', import.meta.url), 'utf8')
  const ingestRoute = readFileSync(new URL('../src/app/api/feed/route.ts', import.meta.url), 'utf8')
  assert.match(revokeRoute, /env\.CONTENT_OS_API_KEY/)
  assert.match(ingestRoute, /env\.CONTENT_OS_API_KEY/)
})

function request(apiKey = 'content-key') {
  return new Request('https://example.com/api/feed/0123456789abcdef/revoke', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
}

test('full-text revocation requires the Feed API key and valid article id', async () => {
  let prepares = 0
  const database = {
    prepare() {
      prepares += 1
      throw new Error('must not query before auth/id validation')
    },
  } as unknown as D1Database

  const unauthorized = await revokeFeedFullText(request('wrong-key'), database, 'content-key', '0123456789abcdef')
  assert.equal(unauthorized.status, 401)
  assert.equal(prepares, 0)

  const invalidId = await revokeFeedFullText(request(), database, 'content-key', 'not-a-hash')
  assert.equal(invalidId.status, 400)
  assert.equal(prepares, 0)
})

test('full-text revocation is idempotent and keeps the article row', async () => {
  let allowed = 1
  let query = ''
  let bound = ''
  let runs = 0
  const database = {
    prepare(statement: string) {
      query = statement
      return {
        bind(value: string) {
          bound = value
          return {
            async run() {
              allowed = 0
              runs += 1
              return { success: true, meta: { changes: runs === 1 ? 1 : 0 } }
            },
            async first() {
              return { url_hash: bound }
            },
          }
        },
      }
    },
  } as unknown as D1Database

  const first = await revokeFeedFullText(request(), database, 'content-key', '0123456789ABCDEF')
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), { revoked: true, url_hash: '0123456789abcdef' })
  assert.equal(allowed, 0)
  assert.equal(bound, '0123456789abcdef')
  assert.match(query, /UPDATE articles[\s\S]*fulltext_publication_allowed\s*=\s*0/)
  assert.match(query, /fulltext_revoked_at\s*=\s*strftime\(/)
  assert.doesNotMatch(query, /approved_for_publication/)

  const second = await revokeFeedFullText(request(), database, 'content-key', '0123456789abcdef')
  assert.equal(second.status, 200)
  assert.deepEqual(await second.json(), { revoked: true, url_hash: '0123456789abcdef' })
})

test('full-text revocation reports missing articles and database failures safely', async () => {
  const missing = {
    prepare() {
      return {
        bind: () => ({
          run: async () => ({ success: true, meta: { changes: 0 } }),
          first: async () => null,
        }),
      }
    },
  } as unknown as D1Database
  const notFound = await revokeFeedFullText(request(), missing, 'content-key', '0123456789abcdef')
  assert.equal(notFound.status, 404)
  assert.deepEqual(await notFound.json(), { error: { code: 'NOT_FOUND', message: 'Article not found' } })

  const broken = {
    prepare() {
      throw new Error('database secret should not be returned')
    },
  } as unknown as D1Database
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const failed = await revokeFeedFullText(request(), broken, 'content-key', '0123456789abcdef')
    assert.equal(failed.status, 503)
    const body = await failed.json()
    assert.deepEqual(body, { error: { code: 'REVOCATION_FAILED', message: 'Unable to revoke full-text access' } })
    assert.doesNotMatch(JSON.stringify(body), /database secret|stack|database unavailable/i)
  } finally {
    console.error = originalConsoleError
  }
})

test('restore validates auth and id before D1 or archive access', async () => {
  const database = {
    prepare() { assert.fail('must authenticate before querying D1') },
  } as unknown as D1Database
  const kv: ArchiveKV = {
    async get() { assert.fail('must authenticate before reading KV') },
    async put() { assert.fail('must never write KV') },
  }
  assert.equal((await restoreFeedFullText(request('wrong'), database, 'content-key', ID, kv)).status, 401)
  assert.equal((await restoreFeedFullText(request(), database, 'content-key', 'bad-id', kv)).status, 400)
})

test('restore permits verified hot or cold bodies without replacing content or reapproving rows', async () => {
  for (const cold of [false, true]) {
    const current = await restoreFixture(cold)
    try {
      const before = current.database.query<Record<string, unknown>>('SELECT * FROM articles')[0]
      const restored = await restoreFeedFullText(request(), current.database.db, 'content-key', ID, current.kv)
      assert.equal(restored.status, 200)
      assert.equal(restored.headers.get('Cache-Control'), 'no-store')
      assert.deepEqual(await restored.json(), { restored: true, url_hash: ID })
      assert.equal(current.reads(), cold ? 1 : 0)
      const after = current.database.query<Record<string, unknown>>('SELECT * FROM articles')[0]
      assert.deepEqual(after, {
        ...before,
        fulltext_publication_allowed: 1,
        fulltext_revoked_at: null,
        fulltext_control_version: Number(before.fulltext_control_version) + 1,
      })
    } finally {
      current.database.close()
    }
  }
})

test('restore refuses withdrawn, unverified and absent bodies before KV and preserves every field', async () => {
  for (const update of [
    'approved_for_publication = 0',
    "content_quality = 'legacy_unverified'",
    'content_format = NULL',
    'content = NULL',
  ]) {
    const current = await restoreFixture()
    try {
      current.database.exec(`UPDATE articles SET ${update}`)
      const before = current.database.query('SELECT * FROM articles')[0]
      const response = await restoreFeedFullText(request(), current.database.db, 'content-key', ID, current.kv)
      assert.equal(response.status, 409)
      assert.equal(current.reads(), 0)
      assert.deepEqual(current.database.query('SELECT * FROM articles')[0], before)
    } finally {
      current.database.close()
    }
  }
})

test('cold restore failures keep revocation intact and return sanitized retryable503', async () => {
  for (const result of [null, 'bad-json', 'throw', 'corrupt', undefined]) {
    const current = await restoreFixture(true)
    try {
      const before = current.database.query('SELECT * FROM articles')[0]
      const kv: ArchiveKV | undefined = result === undefined ? undefined : {
        ...current.kv,
        async get() {
          if (result === 'throw') throw new Error('archive secret details')
          if (result === 'corrupt') return current.object.value.replace('Verified original', 'Modified original')
          return result
        },
      }
      const response = await restoreFeedFullText(request(), current.database.db, 'content-key', ID, kv)
      assert.equal(response.status, 503)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
      assert.ok(Number(response.headers.get('Retry-After')) > 0)
      assert.doesNotMatch(await response.text(), /secret|feed-body|Verified original|bad-json/)
      assert.deepEqual(current.database.query('SELECT * FROM articles')[0], before)
    } finally {
      current.database.close()
    }
  }
})

test('same-second repeated revocation defeats an in-flight cold restore CAS', async () => {
  const current = await restoreFixture(true)
  try {
    const before = current.database.query<ArchiveRow>(`SELECT ${ARCHIVE_COLUMNS.join(', ')} FROM articles`)[0]
    const response = await restoreFeedFullText(request(), current.database.db, 'content-key', ID, {
      ...current.kv,
      async get() {
        // Repeating the exact same values models two withdrawals in one second.
        current.database.exec(`UPDATE articles SET fulltext_publication_allowed = 0,
          fulltext_revoked_at = '2026-09-04T00:00:00Z'`)
        return current.object.value
      },
    })
    assert.equal(response.status, 409)
    const after = current.database.query<ArchiveRow>(`SELECT ${ARCHIVE_COLUMNS.join(', ')} FROM articles`)[0]
    assert.deepEqual(after, { ...before, fulltext_control_version: before.fulltext_control_version + 1 })
    assert.equal(after.fulltext_publication_allowed, 0)
  } finally {
    current.database.close()
  }
})

test('cold restore refuses concurrent replacement or withdrawn approval', async () => {
  for (const mutation of [
    `content_version = 2, content = 'replacement', content_archive_key = NULL,
      content_archive_sha256 = NULL, content_archive_version = NULL,
      content_archive_bytes = NULL, content_archived_at = NULL`,
    'approved_for_publication = 0',
  ]) {
    const current = await restoreFixture(true)
    try {
      const response = await restoreFeedFullText(request(), current.database.db, 'content-key', ID, {
        ...current.kv,
        async get() {
          current.database.exec(`UPDATE articles SET ${mutation}`)
          return current.object.value
        },
      })
      assert.equal(response.status, 409)
      const after = current.database.query<ArchiveRow>(`SELECT ${ARCHIVE_COLUMNS.join(', ')} FROM articles`)[0]
      assert.equal(after.fulltext_publication_allowed, 0)
      assert.equal(after.fulltext_revoked_at, '2026-09-04T00:00:00Z')
      assert.equal(after.content, mutation.startsWith('content_version') ? 'replacement' : null)
    } finally {
      current.database.close()
    }
  }
})

test('actual repeated revocations retain cold metadata and monotonically advance control revision', async () => {
  const current = await restoreFixture(true)
  try {
    const before = current.database.query<ArchiveRow>(`SELECT ${ARCHIVE_COLUMNS.join(', ')} FROM articles`)[0]
    for (let count = 1; count <= 2; count += 1) {
      const response = await revokeFeedFullText(request(), current.database.db, 'content-key', ID)
      assert.equal(response.status, 200)
      const after = current.database.query<ArchiveRow>(`SELECT ${ARCHIVE_COLUMNS.join(', ')} FROM articles`)[0]
      assert.equal(after.fulltext_control_version, before.fulltext_control_version + count)
      assert.equal(after.fulltext_publication_allowed, 0)
      assert.ok(after.fulltext_revoked_at)
      assert.equal(after.approved_for_publication, 1)
      assert.equal(after.content_archive_key, before.content_archive_key)
      assert.equal(after.content_version, before.content_version)
    }
  } finally {
    current.database.close()
  }
})

test('restore reports a missing ID without accessing KV', async () => {
  const current = await restoreFixture()
  try {
    const response = await restoreFeedFullText(request(), current.database.db, 'content-key', 'ffffffffffffffff', current.kv)
    assert.equal(response.status, 404)
    assert.equal(current.reads(), 0)
  } finally {
    current.database.close()
  }
})
