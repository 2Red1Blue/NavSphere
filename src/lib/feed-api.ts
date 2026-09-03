const MAX_TITLE_LENGTH = 500
const MAX_SUMMARY_LENGTH = 5_000
const MAX_TAKEAWAY_LENGTH = 500
const MAX_SOURCE_LENGTH = 100
const MAX_URL_LENGTH = 2_048
export const MAX_CONTENT_CHARS = 200_000
export const MAX_FEED_REQUEST_BYTES = 1024 * 1024
export const MAX_FEED_BATCH_SIZE = 50
export const MAX_CONTENT_BATCH_SIZE = 10
export const FEED_RETRY_AFTER_SECONDS = 300
export type FeedErrorOperation = 'list' | 'ingest' | 'detail' | 'revoke' | 'restore'

/**
 * Convert unexpected D1/schema failures into a retryable, non-cacheable response.
 * Route handlers pass a constant operation label so server logs stay actionable
 * without exposing driver errors, SQL, or schema details to public callers.
 */
export async function withFeedErrorBoundary(
  handler: () => Response | Promise<Response>,
  operation: FeedErrorOperation,
): Promise<Response> {
  try {
    return await handler()
  } catch (error) {
    console.error(`NavSphere Feed ${operation} failed`, error)
    return new Response(JSON.stringify({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Feed service is temporarily unavailable',
      },
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': String(FEED_RETRY_AFTER_SECONDS),
      },
    })
  }
}

export const FEED_LIST_COLUMNS = [
  'url_hash',
  'title',
  'original_title',
  'summary',
  'takeaway',
  'source',
  'url',
  'category',
  'topic',
  'type',
  'featured',
  'score',
  'signal',
  'novelty',
  'usefulness',
  'content_potential',
  'published_at',
  'discovered_at',
  'created_at',
] as const

export interface FeedArticleInput {
  url_hash: string
  title: string
  original_title: string | null
  summary: string | null
  takeaway: string | null
  source: string
  url: string
  category: string
  topic: string | null
  type: string | null
  featured: number
  score: number
  signal: number
  novelty: number
  usefulness: number
  content_potential: 'High' | 'Medium' | 'Low' | null
  published_at: string
  discovered_at: string
  approved_for_publication: 1
  content: VerifiedContentInput | null
}

export interface VerifiedContentInput {
  body: string
  format: 'markdown_v1'
  quality: 'verified_fulltext'
  hash: string
  chars: number
  quality_score: number
  extracted_at: string
  source: string
  fulltext_publication_allowed: true
}

type ValidationResult =
  | { valid: true; article: FeedArticleInput }
  | { valid: false; error: string }

export type FeedRequestValidation =
  | { valid: true; articles: FeedArticleInput[] }
  | { valid: false; code: string; message: string; status: number; details?: string[] }

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim()
}

function boundedString(
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
): { value: string | null } | { error: string } {
  if (value == null || value === '') {
    return required ? { error: `${field} is required` } : { value: null }
  }
  if (typeof value !== 'string') return { error: `${field} must be a string` }
  const sanitized = stripHtml(value)
  if (!sanitized && required) return { error: `${field} is required` }
  if (sanitized.length > maxLength) return { error: `${field} exceeds ${maxLength} characters` }
  return { value: sanitized || null }
}

function boundedScore(value: unknown, max: number): number | null {
  const score = value == null ? 0 : value
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > max) return null
  return score
}

function validPublicUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function validExplicitTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match || Number.isNaN(Date.parse(value))) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day
  )
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function validateContent(value: unknown): Promise<
  { value: VerifiedContentInput | null } | { error: string }
> {
  if (value == null) return { value: null }
  if (typeof value !== 'object' || Array.isArray(value)) return { error: 'content must be an object' }
  const content = value as Record<string, unknown>
  if (typeof content.body !== 'string' || content.body.length === 0) {
    return { error: 'content.body is required' }
  }
  const characterCount = [...content.body].length
  if (characterCount > MAX_CONTENT_CHARS) {
    return { error: `content.body exceeds ${MAX_CONTENT_CHARS} characters` }
  }
  if (content.format !== 'markdown_v1') return { error: 'content.format must be markdown_v1' }
  if (content.quality !== 'verified_fulltext') {
    return { error: 'content.quality must be verified_fulltext' }
  }
  if (content.fulltext_publication_allowed !== true) {
    return { error: 'content.fulltext_publication_allowed must be true' }
  }
  if (typeof content.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(content.hash)) {
    return { error: 'content.hash must be a 64-character SHA-256 digest' }
  }
  if ((await sha256Hex(content.body)) !== content.hash.toLowerCase()) {
    return { error: 'content.hash does not match content.body' }
  }
  if (!Number.isInteger(content.chars) || content.chars !== characterCount) {
    return { error: 'content.chars must match the body character count' }
  }
  if (
    !Number.isInteger(content.quality_score)
    || (content.quality_score as number) < 0
    || (content.quality_score as number) > 100
  ) {
    return { error: 'content.quality_score must be an integer from 0 to 100' }
  }
  if (!validExplicitTimestamp(content.extracted_at)) {
    return { error: 'content.extracted_at must be an ISO date with an explicit timezone' }
  }
  const source = boundedString(content.source, 'content.source', MAX_SOURCE_LENGTH, true)
  if ('error' in source) return { error: source.error }

  return {
    value: {
      body: content.body,
      format: 'markdown_v1',
      quality: 'verified_fulltext',
      hash: content.hash.toLowerCase(),
      chars: characterCount,
      quality_score: content.quality_score as number,
      extracted_at: content.extracted_at,
      source: source.value!,
      fulltext_publication_allowed: true,
    },
  }
}

export async function validateFeedArticle(value: unknown): Promise<ValidationResult> {
  if (!value || typeof value !== 'object') return { valid: false, error: 'article must be an object' }
  const article = value as Record<string, unknown>

  if (article.approved_for_publication !== true) {
    return { valid: false, error: 'approved_for_publication must be true' }
  }
  if (typeof article.url_hash !== 'string' || !/^[a-f0-9]{16,64}$/i.test(article.url_hash)) {
    return { valid: false, error: 'url_hash must be a 16-64 character hexadecimal digest' }
  }
  if (!validPublicUrl(article.url)) return { valid: false, error: 'url must be a public HTTP(S) URL' }

  const title = boundedString(article.title, 'title', MAX_TITLE_LENGTH, true)
  const source = boundedString(article.source, 'source', MAX_SOURCE_LENGTH, true)
  const originalTitle = boundedString(article.original_title, 'original_title', MAX_TITLE_LENGTH)
  const summary = boundedString(article.summary, 'summary', MAX_SUMMARY_LENGTH)
  const takeaway = boundedString(article.takeaway, 'takeaway', MAX_TAKEAWAY_LENGTH)
  if ('error' in title) return { valid: false, error: title.error }
  if ('error' in source) return { valid: false, error: source.error }
  if ('error' in originalTitle) return { valid: false, error: originalTitle.error }
  if ('error' in summary) return { valid: false, error: summary.error }
  if ('error' in takeaway) return { valid: false, error: takeaway.error }

  const score = boundedScore(article.score, 30)
  const signal = boundedScore(article.signal, 10)
  const novelty = boundedScore(article.novelty, 10)
  const usefulness = boundedScore(article.usefulness, 10)
  if ([score, signal, novelty, usefulness].some((item) => item == null)) {
    return { valid: false, error: 'score fields must be integers within their allowed range' }
  }

  if (!validExplicitTimestamp(article.discovered_at)) {
    return { valid: false, error: 'discovered_at must be an ISO date with an explicit timezone' }
  }
  if (!validExplicitTimestamp(article.published_at)) {
    return { valid: false, error: 'published_at must be an ISO date with an explicit timezone' }
  }

  const potential = article.content_potential
  if (potential != null && potential !== 'High' && potential !== 'Medium' && potential !== 'Low') {
    return { valid: false, error: 'content_potential is invalid' }
  }

  const content = await validateContent(article.content)
  if ('error' in content) return { valid: false, error: content.error }

  return {
    valid: true,
    article: {
      url_hash: article.url_hash.toLowerCase(),
      title: title.value!,
      original_title: originalTitle.value,
      summary: summary.value,
      takeaway: takeaway.value,
      source: source.value!,
      url: article.url,
      category: typeof article.category === 'string' && article.category.length <= 100 ? stripHtml(article.category) || 'general' : 'general',
      topic: typeof article.topic === 'string' && article.topic.length <= 100 ? stripHtml(article.topic) || null : null,
      type: typeof article.type === 'string' && article.type.length <= 50 ? stripHtml(article.type) || null : null,
      featured: article.featured === true ? 1 : 0,
      score: score!,
      signal: signal!,
      novelty: novelty!,
      usefulness: usefulness!,
      content_potential: potential as FeedArticleInput['content_potential'],
      published_at: article.published_at,
      discovered_at: article.discovered_at,
      approved_for_publication: 1,
      content: content.value,
    },
  }
}

export async function validateFeedRequest(request: Request): Promise<FeedRequestValidation> {
  const contentType = request.headers.get('Content-Type') || ''
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'application/json') {
    return { valid: false, code: 'INVALID_CONTENT_TYPE', message: 'Expected application/json', status: 415 }
  }

  const contentLength = request.headers.get('Content-Length')
  if (contentLength != null) {
    const declaredBytes = Number(contentLength)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      return {
        valid: false,
        code: 'INVALID_CONTENT_LENGTH',
        message: 'Content-Length must be a non-negative integer',
        status: 400,
      }
    }
    if (declaredBytes > MAX_FEED_REQUEST_BYTES) {
      return { valid: false, code: 'REQUEST_TOO_LARGE', message: 'Request body exceeds 1 MiB', status: 413 }
    }
  }

  let body: unknown
  try {
    if (!request.body) {
      return { valid: false, code: 'INVALID_JSON', message: 'Request body is not valid JSON', status: 400 }
    }
    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_FEED_REQUEST_BYTES) {
        await reader.cancel('request body exceeds limit')
        return { valid: false, code: 'REQUEST_TOO_LARGE', message: 'Request body exceeds 1 MiB', status: 413 }
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const rawBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    body = JSON.parse(rawBody)
  } catch {
    return { valid: false, code: 'INVALID_JSON', message: 'Request body is not valid JSON', status: 400 }
  }

  if (!body || typeof body !== 'object' || !Array.isArray((body as Record<string, unknown>).articles)) {
    return { valid: false, code: 'VALIDATION_ERROR', message: 'Expected { articles: [...] }', status: 422 }
  }
  const { articles } = body as { articles: unknown[] }
  if (articles.length === 0) {
    return { valid: false, code: 'VALIDATION_ERROR', message: 'articles array is empty', status: 422 }
  }
  if (articles.length > MAX_FEED_BATCH_SIZE) {
    return {
      valid: false,
      code: 'VALIDATION_ERROR',
      message: `Batch size exceeds maximum of ${MAX_FEED_BATCH_SIZE}`,
      status: 422,
    }
  }
  if (
    articles.length > MAX_CONTENT_BATCH_SIZE
    && articles.some((article) => (
      typeof article === 'object'
      && article !== null
      && (article as Record<string, unknown>).content != null
    ))
  ) {
    return {
      valid: false,
      code: 'VALIDATION_ERROR',
      message: `Content-bearing batch size exceeds maximum of ${MAX_CONTENT_BATCH_SIZE}`,
      status: 422,
    }
  }

  const validArticles: FeedArticleInput[] = []
  const errors: string[] = []
  for (let index = 0; index < articles.length; index += 1) {
    const result = await validateFeedArticle(articles[index])
    if (result.valid) validArticles.push(result.article)
    else errors.push(`Article ${index}: ${result.error}`)
  }
  if (errors.length > 0) {
    return {
      valid: false,
      code: 'VALIDATION_ERROR',
      message: 'Some articles failed validation',
      status: 422,
      details: errors,
    }
  }
  return { valid: true, articles: validArticles }
}

export async function secureTokenEquals(actual: string, expected?: string): Promise<boolean> {
  if (!expected || !actual) return false
  const encoder = new TextEncoder()
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const left = new Uint8Array(actualDigest)
  const right = new Uint8Array(expectedDigest)
  let difference = left.length ^ right.length
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}
