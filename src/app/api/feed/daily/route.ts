import { getDailySection, toDisplayScore } from '@/lib/feed-view'

export const runtime = 'edge'

const DEFAULT_DAILY_LIMIT = 8
const ARCHIVE_LIMIT = 14

const DAILY_SECTION_KEYS = ['models', 'products', 'industry', 'insights'] as const

export type DailySectionKey = (typeof DAILY_SECTION_KEYS)[number]

export interface DailyArticle {
  url_hash: string
  title: string
  summary: string | null
  takeaway: string | null
  source: string
  category: string
  topic: string | null
  type: string | null
  score: number
  published_at: string | null
  discovered_at: string
}

export interface DailyArticleView extends DailyArticle {
  displayScore: number
}

export interface DailyDigest {
  date: string
  issue: string
  total: number
  estimatedReadMinutes: number
  sections: Record<DailySectionKey, DailyArticleView[]>
}

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  })
}

function errorResponse(code: string, message: string, status = 400) {
  return jsonResponse({ error: { code, message } }, status)
}

/** Accept canonical Gregorian dates only; the value is always bound as a SQL parameter. */
function isValidDailyDate(value: string): boolean {
  const match = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

/** Stable selection keeps API, website, and delivery surfaces on the same ordering. */
function buildDailyDigest(
  date: string,
  articles: DailyArticle[],
  limit = DEFAULT_DAILY_LIMIT,
): DailyDigest {
  const selected = [...articles]
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      const timeOrder = right.discovered_at.localeCompare(left.discovered_at)
      if (timeOrder !== 0) return timeOrder
      return left.url_hash.localeCompare(right.url_hash)
    })
    .slice(0, Math.max(0, limit))

  const sections: DailyDigest['sections'] = {
    models: [],
    products: [],
    industry: [],
    insights: [],
  }

  for (const article of selected) {
    const view = { ...article, displayScore: toDisplayScore(article.score) }
    const section = getDailySection({
      ...article,
      topic: article.topic ?? undefined,
      type: article.type ?? undefined,
    })
    sections[section].push(view)
  }

  return {
    date,
    issue: date.replaceAll('-', ''),
    total: selected.length,
    estimatedReadMinutes: selected.length === 0 ? 0 : Math.max(1, Math.ceil(selected.length * 0.375)),
    sections,
  }
}

async function archiveResponse(db: D1Database) {
  const result = await db.prepare(`
    SELECT
      date(datetime(discovered_at, '+8 hours')) AS date,
      COUNT(*) AS count
    FROM articles
    WHERE approved_for_publication = 1
    GROUP BY date(datetime(discovered_at, '+8 hours'))
    ORDER BY date DESC
    LIMIT ?
  `).bind(ARCHIVE_LIMIT).all<{ date: string; count: number }>()

  return jsonResponse({
    data: result.results.map((item) => ({
      ...item,
      issue: item.date.replaceAll('-', ''),
      estimatedReadMinutes: Math.max(1, Math.ceil(Math.min(item.count, DEFAULT_DAILY_LIMIT) * 0.375)),
    })),
  }, 200, { 'Cache-Control': 'public, s-maxage=300' })
}

async function digestResponse(db: D1Database, date: string) {
  const articleStatement = db.prepare(`
    SELECT
      url_hash, title, summary, takeaway, source, category, topic, type,
      score, published_at, discovered_at
    FROM articles
    WHERE approved_for_publication = 1
      AND date(datetime(discovered_at, '+8 hours')) = ?
    ORDER BY score DESC, discovered_at DESC, url_hash ASC
    LIMIT 1000
  `).bind(date)

  const previousStatement = db.prepare(`
    SELECT date(datetime(discovered_at, '+8 hours')) AS date
    FROM articles
    WHERE approved_for_publication = 1
      AND date(datetime(discovered_at, '+8 hours')) < ?
    GROUP BY date(datetime(discovered_at, '+8 hours'))
    ORDER BY date DESC
    LIMIT 1
  `).bind(date)

  const nextStatement = db.prepare(`
    SELECT date(datetime(discovered_at, '+8 hours')) AS date
    FROM articles
    WHERE approved_for_publication = 1
      AND date(datetime(discovered_at, '+8 hours')) > ?
    GROUP BY date(datetime(discovered_at, '+8 hours'))
    ORDER BY date ASC
    LIMIT 1
  `).bind(date)

  const [articleResult, previous, next] = await Promise.all([
    articleStatement.all<DailyArticle>(),
    previousStatement.first<{ date: string }>(),
    nextStatement.first<{ date: string }>(),
  ])

  return jsonResponse({
    data: buildDailyDigest(date, articleResult.results),
    navigation: {
      previousDate: previous?.date ?? null,
      nextDate: next?.date ?? null,
    },
  }, 200, { 'Cache-Control': 'public, s-maxage=300' })
}

async function handleGet(request: Request) {
  const { getRequestContext } = await import('@cloudflare/next-on-pages')
  const { env } = getRequestContext()
  const date = new URL(request.url).searchParams.get('date')

  if (date === null) return archiveResponse(env.DB)
  if (!isValidDailyDate(date)) {
    return errorResponse('INVALID_DATE', 'date 必须是有效的 YYYY-MM-DD 日期', 400)
  }

  return digestResponse(env.DB, date)
}

// Properties keep deterministic helpers testable without adding unsupported Next.js route exports.
export const GET = Object.assign(handleGet, {
  buildDailyDigest,
  dailySectionKeys: DAILY_SECTION_KEYS,
  isValidDailyDate,
})
