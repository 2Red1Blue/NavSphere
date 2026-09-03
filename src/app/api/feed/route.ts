// Content OS Feed API - List & Ingest
// GET /api/feed  - List articles with pagination, filtering, search
// POST /api/feed - Ingest articles from pipeline

import { getRequestContext } from '@cloudflare/next-on-pages'
import { FEED_UPSERT_SQL } from '@/lib/feed-ingest-sql'
import {
  FEED_LIST_COLUMNS,
  secureTokenEquals,
  validateFeedRequest,
} from '@/lib/feed-api'

export const runtime = 'edge'

const ALLOWED_SORT_FIELDS = ['score', 'discovered_at', 'published_at', 'created_at']
const ALLOWED_ORDERS = ['asc', 'desc']
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  })
}

function errorResponse(code: string, message: string, status = 400, details?: string[]) {
  return jsonResponse({ error: { code, message, details } }, status)
}

// GET /api/feed - List articles
async function handleList(request: Request, db: D1Database) {
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT))))
  const category = url.searchParams.get('category') || ''
  const source = url.searchParams.get('source') || ''
  const topic = url.searchParams.get('topic') || ''
  const type = url.searchParams.get('type') || ''
  const featured = url.searchParams.get('featured') === 'true'
  const q = url.searchParams.get('q') || ''
  const minScore = Math.max(0, parseInt(url.searchParams.get('min_score') || '0'))
  const sort = ALLOWED_SORT_FIELDS.includes(url.searchParams.get('sort') || '') ? url.searchParams.get('sort')! : 'discovered_at'
  const order = ALLOWED_ORDERS.includes(url.searchParams.get('order') || '') ? url.searchParams.get('order')! : 'desc'

  const conditions: string[] = ['approved_for_publication = 1']
  const params: unknown[] = []

  if (category && category !== 'all') {
    conditions.push('category = ?')
    params.push(category)
  }

  if (source && source !== 'all') {
    conditions.push('source = ?')
    params.push(source)
  }

  if (topic && topic !== 'all') {
    conditions.push('topic = ?')
    params.push(topic)
  }

  if (type && type !== 'all') {
    conditions.push('type = ?')
    params.push(type)
  }

  if (featured) {
    conditions.push('featured = 1')
  }

  if (minScore > 0) {
    conditions.push('score >= ?')
    params.push(minScore)
  }

  if (q) {
    conditions.push('(title LIKE ? OR summary LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countResult = await db.prepare(`SELECT COUNT(*) as total FROM articles ${whereClause}`)
    .bind(...params)
    .first<{ total: number }>()
  const total = countResult?.total || 0
  const totalPages = Math.ceil(total / limit)

  const offset = (page - 1) * limit
  const dataResult = await db.prepare(
    `SELECT ${FEED_LIST_COLUMNS.join(', ')} FROM articles ${whereClause} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all()

  const categoriesResult = await db.prepare(
    `SELECT category as name, COUNT(*) as count FROM articles WHERE approved_for_publication = 1 GROUP BY category ORDER BY count DESC`
  ).all()

  const typesResult = await db.prepare(
    `SELECT type as name, COUNT(*) as count FROM articles WHERE approved_for_publication = 1 AND type IS NOT NULL GROUP BY type ORDER BY count DESC`
  ).all()

  const topicsResult = await db.prepare(
    `SELECT topic as name, COUNT(*) as count FROM articles WHERE approved_for_publication = 1 AND topic IS NOT NULL GROUP BY topic ORDER BY count DESC LIMIT 20`
  ).all()

  return jsonResponse(
    {
      data: dataResult.results,
      pagination: { page, limit, total, totalPages },
      categories: categoriesResult.results,
      types: typesResult.results,
      topics: topicsResult.results,
    },
    200,
    { 'Cache-Control': 'public, s-maxage=60' }
  )
}

// POST /api/feed - Ingest articles
async function handleIngest(request: Request, db: D1Database, apiKey?: string) {
  const authHeader = request.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!(await secureTokenEquals(token, apiKey))) {
    return errorResponse('UNAUTHORIZED', 'Invalid or missing API key', 401)
  }

  const validated = await validateFeedRequest(request)
  if (!validated.valid) {
    return errorResponse(validated.code, validated.message, validated.status, validated.details)
  }
  const validArticles = validated.articles

  const stmt = db.prepare(FEED_UPSERT_SQL)

  const batchResults = await db.batch(
    validArticles.map((a) =>
      stmt.bind(
        a.url_hash, a.title, a.original_title, a.summary,
        a.takeaway, a.content?.body ?? null, a.content?.format ?? null,
        a.content?.quality ?? 'summary_only', a.content?.hash ?? null,
        a.content?.chars ?? 0, a.content?.quality_score ?? 0,
        a.content?.extracted_at ?? null, a.content?.source ?? null,
        a.content?.fulltext_publication_allowed ? 1 : 0,
        a.source, a.url, a.category, a.topic, a.type, a.featured,
        a.score, a.signal, a.novelty, a.usefulness, a.content_potential,
        a.published_at, a.discovered_at, a.approved_for_publication
      )
    )
  )

  const ingested = batchResults.filter((result) => result.success).length
  if (ingested !== validArticles.length) {
    return errorResponse('INGEST_FAILED', 'D1 did not confirm every article in the batch', 503)
  }

  return jsonResponse({ ingested, total: validArticles.length }, 201)
}

export async function GET(request: Request) {
  const { env } = getRequestContext()
  return handleList(request, env.DB)
}

export async function POST(request: Request) {
  const { env } = getRequestContext()
  return handleIngest(request, env.DB, env.CONTENT_OS_API_KEY)
}
