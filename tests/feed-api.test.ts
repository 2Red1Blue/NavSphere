import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { FEED_LIST_COLUMNS, secureTokenEquals, validateFeedArticle } from '../src/lib/feed-api'

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

test('feed ingestion fails closed without explicit publication approval', () => {
  const result = validateFeedArticle({ ...approvedArticle, approved_for_publication: false })
  assert.equal(result.valid, false)
})

test('feed ingestion accepts a bounded summary-only article', () => {
  const result = validateFeedArticle(approvedArticle)
  assert.equal(result.valid, true)
  if (result.valid) {
    assert.equal(result.article.approved_for_publication, 1)
    assert.equal('content' in result.article, false)
  }
})

test('feed ingestion rejects non-http source URLs', () => {
  const result = validateFeedArticle({ ...approvedArticle, url: 'file:///etc/passwd' })
  assert.equal(result.valid, false)
})

test('feed ingestion requires timestamps with an explicit timezone', () => {
  for (const timestamp of [
    '2026-08-31T00:00:00',
    '2026-08-31 00:00:00',
    '2026-02-31T00:00:00Z',
  ]) {
    assert.equal(validateFeedArticle({ ...approvedArticle, discovered_at: timestamp }).valid, false)
    assert.equal(validateFeedArticle({ ...approvedArticle, published_at: timestamp }).valid, false)
  }
  assert.equal(validateFeedArticle({
    ...approvedArticle,
    discovered_at: '2026-08-31T08:00:00+08:00',
  }).valid, true)
})

test('health endpoint checks D1 and fails degraded with 503', () => {
  const source = readFileSync(new URL('../src/app/api/health/route.ts', import.meta.url), 'utf8')
  assert.match(source, /env\.DB\.prepare/)
  assert.match(source, /approved_for_publication\s*=\s*1/)
  assert.match(source, /status:\s*'degraded'/)
  assert.match(source, /status:\s*503/)
})

test('feed list projection never includes article content or approval internals', () => {
  assert.equal(FEED_LIST_COLUMNS.includes('content' as never), false)
  assert.equal(FEED_LIST_COLUMNS.includes('approved_for_publication' as never), false)
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
