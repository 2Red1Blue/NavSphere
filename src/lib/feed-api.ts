const MAX_TITLE_LENGTH = 500
const MAX_SUMMARY_LENGTH = 5_000
const MAX_TAKEAWAY_LENGTH = 500
const MAX_SOURCE_LENGTH = 100
const MAX_URL_LENGTH = 2_048

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
}

type ValidationResult =
  | { valid: true; article: FeedArticleInput }
  | { valid: false; error: string }

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

function validExplicitTimestamp(value: unknown): value is string {
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

export function validateFeedArticle(value: unknown): ValidationResult {
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
    },
  }
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
