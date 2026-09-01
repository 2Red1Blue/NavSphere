import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  GET,
  type DailyArticle,
} from '../src/app/api/feed/daily/route'

const { buildDailyDigest, dailySectionKeys, isValidDailyDate } = GET

function article(overrides: Partial<DailyArticle> = {}): DailyArticle {
  return {
    url_hash: 'a'.repeat(16),
    title: 'AI product update',
    summary: 'Summary',
    takeaway: 'Why it matters',
    source: 'Official Blog',
    category: 'AI工程技术',
    topic: 'AI product',
    type: 'tool',
    score: 20,
    published_at: '2026-08-31T12:00:00Z',
    discovered_at: '2026-08-31T12:00:00Z',
    ...overrides,
  }
}

test('daily date validation accepts only real canonical dates', () => {
  assert.equal(isValidDailyDate('2026-08-31'), true)
  assert.equal(isValidDailyDate('2024-02-29'), true)
  assert.equal(isValidDailyDate('2026-02-29'), false)
  assert.equal(isValidDailyDate('2026-13-01'), false)
  assert.equal(isValidDailyDate('2026-8-31'), false)
  assert.equal(isValidDailyDate("2026-08-31' OR 1=1 --"), false)
})

test('daily selection is score-first, stable, limited, and partitioned once', () => {
  const input = [
    article({ url_hash: 'f'.repeat(16), score: 30, discovered_at: '2026-08-31T08:00:00Z' }),
    article({ url_hash: 'b'.repeat(16), score: 25, discovered_at: '2026-08-31T09:00:00Z' }),
    article({ url_hash: 'a'.repeat(16), score: 25, discovered_at: '2026-08-31T09:00:00Z' }),
    ...Array.from({ length: 7 }, (_, index) => article({
      url_hash: String(index + 1).repeat(16),
      score: 24 - index,
      discovered_at: `2026-08-31T0${index}:00:00Z`,
    })),
  ]

  const digest = buildDailyDigest('2026-08-31', input)
  const selected = dailySectionKeys.flatMap((section) => digest.sections[section])

  assert.equal(digest.total, 8)
  assert.equal(selected.length, 8)
  assert.equal(new Set(selected.map((item) => item.url_hash)).size, 8)
  assert.deepEqual(
    selected.map((item) => item.url_hash).sort(),
    [
      'f'.repeat(16),
      'a'.repeat(16),
      'b'.repeat(16),
      ...Array.from({ length: 5 }, (_, index) => String(index + 1).repeat(16)),
    ].sort(),
  )
  assert.equal(selected.find((item) => item.url_hash === 'f'.repeat(16))?.displayScore, 100)
  assert.equal(digest.estimatedReadMinutes, 3)
})

test('daily API SQL is read-only, approval-filtered, and parameterized', () => {
  const source = readFileSync(new URL('../src/app/api/feed/daily/route.ts', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b\s+(?:INTO\s+)?articles/i)
  assert.ok((source.match(/approved_for_publication\s*=\s*1/g) || []).length >= 4)
  assert.match(source, /date\(datetime\(discovered_at, '\+8 hours'\)\) = \?/)
  assert.doesNotMatch(source, /\$\{date\}/)
})
