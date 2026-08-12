// Content OS Feed API - List & Ingest
// GET /api/feed  - List articles with pagination, filtering, search
// POST /api/feed - Ingest articles from pipeline

const ALLOWED_SORT_FIELDS = ['score', 'discovered_at', 'published_at', 'created_at']
const ALLOWED_ORDERS = ['asc', 'desc']
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MAX_BATCH_SIZE = 50
const MAX_TITLE_LENGTH = 500
const MAX_SUMMARY_LENGTH = 5000
const MAX_TAKEAWAY_LENGTH = 500

interface ArticleInput {
  url_hash: string
  title: string
  original_title?: string
  summary?: string
  takeaway?: string
  source: string
  url: string
  category?: string
  score?: number
  signal?: number
  novelty?: number
  usefulness?: number
  content_potential?: string
  published_at?: string
  discovered_at: string
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '')
}

function validateArticle(a: unknown): { valid: true; article: ArticleInput } | { valid: false; error: string } {
  if (!a || typeof a !== 'object') return { valid: false, error: 'Article must be an object' }
  const art = a as Record<string, unknown>

  if (typeof art.url_hash !== 'string' || art.url_hash.length === 0 || art.url_hash.length > 64)
    return { valid: false, error: 'url_hash is required (max 64 chars)' }
  if (typeof art.title !== 'string' || art.title.length === 0 || art.title.length > MAX_TITLE_LENGTH)
    return { valid: false, error: 'title is required (max 500 chars)' }
  if (typeof art.source !== 'string' || art.source.length === 0 || art.source.length > 100)
    return { valid: false, error: 'source is required (max 100 chars)' }
  if (typeof art.url !== 'string' || art.url.length === 0 || art.url.length > 2048)
    return { valid: false, error: 'url is required (max 2048 chars)' }
  if (typeof art.discovered_at !== 'string' || art.discovered_at.length === 0)
    return { valid: false, error: 'discovered_at is required' }

  if (art.summary && typeof art.summary === 'string' && art.summary.length > MAX_SUMMARY_LENGTH)
    return { valid: false, error: 'summary too long (max 5000 chars)' }
  if (art.takeaway && typeof art.takeaway === 'string' && art.takeaway.length > MAX_TAKEAWAY_LENGTH)
    return { valid: false, error: 'takeaway too long (max 500 chars)' }

  const score = typeof art.score === 'number' ? art.score : 0
  if (score < 0 || score > 30) return { valid: false, error: 'score must be 0-30' }

  return {
    valid: true,
    article: {
      url_hash: art.url_hash as string,
      title: stripHtml(art.title as string),
      original_title: art.original_title ? stripHtml(art.original_title as string) : undefined,
      summary: art.summary ? stripHtml(art.summary as string) : undefined,
      takeaway: art.takeaway ? stripHtml(art.takeaway as string) : undefined,
      source: art.source as string,
      url: art.url as string,
      category: (art.category as string) || 'general',
      score,
      signal: typeof art.signal === 'number' ? Math.max(0, Math.min(10, art.signal)) : 0,
      novelty: typeof art.novelty === 'number' ? Math.max(0, Math.min(10, art.novelty)) : 0,
      usefulness: typeof art.usefulness === 'number' ? Math.max(0, Math.min(10, art.usefulness)) : 0,
      content_potential: art.content_potential as string | undefined,
      published_at: art.published_at as string | undefined,
      discovered_at: art.discovered_at as string,
    },
  }
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

function errorResponse(code: string, message: string, status = 400, details?: string[]) {
  return jsonResponse({ error: { code, message, details } }, status)
}

// GET /api/feed - List articles
async function handleList(request: Request, env: { DB: D1Database }) {
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT))))
  const category = url.searchParams.get('category') || ''
  const source = url.searchParams.get('source') || ''
  const q = url.searchParams.get('q') || ''
  const minScore = Math.max(0, parseInt(url.searchParams.get('min_score') || '0'))
  const sort = ALLOWED_SORT_FIELDS.includes(url.searchParams.get('sort') || '') ? url.searchParams.get('sort')! : 'discovered_at'
  const order = ALLOWED_ORDERS.includes(url.searchParams.get('order') || '') ? url.searchParams.get('order')! : 'desc'

  const conditions: string[] = []
  const params: unknown[] = []

  if (category && category !== 'all') {
    conditions.push('category = ?')
    params.push(category)
  }

  if (source && source !== 'all') {
    conditions.push('source = ?')
    params.push(source)
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

  // Count total
  const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM articles ${whereClause}`)
    .bind(...params)
    .first<{ total: number }>()
  const total = countResult?.total || 0
  const totalPages = Math.ceil(total / limit)

  // Fetch page
  const offset = (page - 1) * limit
  const dataResult = await env.DB.prepare(
    `SELECT * FROM articles ${whereClause} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all<ArticleInput>()

  // Get categories with counts
  const categoriesResult = await env.DB.prepare(
    `SELECT category as name, COUNT(*) as count FROM articles GROUP BY category ORDER BY count DESC`
  ).all<{ name: string; count: number }>()

  return jsonResponse(
    {
      data: dataResult.results,
      pagination: { page, limit, total, totalPages },
      categories: categoriesResult.results,
    },
    200,
    { 'Cache-Control': 'public, s-maxage=60' }
  )
}

// POST /api/feed - Ingest articles
async function handleIngest(request: Request, env: { DB: D1Database; CONTENT_OS_API_KEY?: string }) {
  // Auth check
  const authHeader = request.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  const expectedKey = env.CONTENT_OS_API_KEY

  if (!expectedKey || token !== expectedKey) {
    return errorResponse('UNAUTHORIZED', `Invalid or missing API key (env has key: ${!!expectedKey}, token len: ${token.length})`, 401)
  }

  // Content-Type check
  const contentType = request.headers.get('Content-Type') || ''
  if (!contentType.includes('application/json')) {
    return errorResponse('INVALID_CONTENT_TYPE', 'Expected application/json', 415)
  }

  // Parse and validate body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('INVALID_JSON', 'Request body is not valid JSON', 400)
  }

  if (!body || typeof body !== 'object' || !Array.isArray((body as Record<string, unknown>).articles)) {
    return errorResponse('VALIDATION_ERROR', 'Expected { articles: [...] }', 422)
  }

  const { articles } = body as { articles: unknown[] }

  if (articles.length === 0) {
    return errorResponse('VALIDATION_ERROR', 'articles array is empty', 422)
  }

  if (articles.length > MAX_BATCH_SIZE) {
    return errorResponse('VALIDATION_ERROR', `Batch size exceeds maximum of ${MAX_BATCH_SIZE}`, 422)
  }

  // Validate each article
  const validArticles: ArticleInput[] = []
  const errors: string[] = []
  for (let i = 0; i < articles.length; i++) {
    const result = validateArticle(articles[i])
    if (result.valid) {
      validArticles.push(result.article)
    } else {
      errors.push(`Article ${i}: ${result.error}`)
    }
  }

  if (errors.length > 0) {
    return errorResponse('VALIDATION_ERROR', 'Some articles failed validation', 422, errors)
  }

  // Batch upsert
  const stmt = env.DB.prepare(`
    INSERT INTO articles (url_hash, title, original_title, summary, takeaway, source, url, category, score, signal, novelty, usefulness, content_potential, published_at, discovered_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
    ON CONFLICT(url_hash) DO UPDATE SET
      title = excluded.title,
      original_title = excluded.original_title,
      summary = excluded.summary,
      takeaway = excluded.takeaway,
      source = excluded.source,
      url = excluded.url,
      category = excluded.category,
      score = excluded.score,
      signal = excluded.signal,
      novelty = excluded.novelty,
      usefulness = excluded.usefulness,
      content_potential = excluded.content_potential,
      published_at = excluded.published_at,
      discovered_at = excluded.discovered_at
  `)

  const results = await env.DB.batch(
    validArticles.map((a) =>
      stmt.bind(
        a.url_hash, a.title, a.original_title || null, a.summary || null,
        a.takeaway || null, a.source, a.url, a.category, a.score,
        a.signal, a.novelty, a.usefulness, a.content_potential || null,
        a.published_at || null, a.discovered_at
      )
    )
  )

  const ingested = results.filter((r) => r.success).length

  return jsonResponse({ ingested, total: validArticles.length }, 201)
}

// Main handler
export async function onRequest(context: { request: Request; env: { DB: D1Database; CONTENT_OS_API_KEY?: string } }) {
  const { request, env } = context

  switch (request.method) {
    case 'GET':
      return handleList(request, env)
    case 'POST':
      return handleIngest(request, env)
    default:
      return errorResponse('METHOD_NOT_ALLOWED', 'Only GET and POST are allowed', 405)
  }
}