import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { restoreFeedFullText, revokeFeedFullText } from '../src/lib/feed-revocation'

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

test('restore requires verified approved content and clears the revocation marker', async () => {
  let query = ''
  const database = {
    prepare(statement: string) {
      query = statement
      return {
        bind: () => ({ run: async () => ({ success: true, meta: { changes: 1 } }) }),
      }
    },
  } as unknown as D1Database
  const restored = await restoreFeedFullText(request(), database, 'content-key', '0123456789abcdef')
  assert.equal(restored.status, 200)
  assert.deepEqual(await restored.json(), { restored: true, url_hash: '0123456789abcdef' })
  assert.match(query, /fulltext_publication_allowed\s*=\s*1/)
  assert.match(query, /fulltext_revoked_at\s*=\s*NULL/)
  assert.match(query, /content_quality\s*=\s*'verified_fulltext'/)
})
