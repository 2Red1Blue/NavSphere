import type { Article } from '@/types/feed'

export const INTERNAL_SCORE_MAX = 30
export const DISPLAY_SCORE_MAX = 100
export const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'

export type ScoreTier = 'must-read' | 'recommended' | 'notable' | 'standard'

export interface ScoreTierMeta {
  key: ScoreTier
  label: string
}

export const SCORE_TIERS: Record<ScoreTier, ScoreTierMeta> = {
  'must-read': { key: 'must-read', label: '必读' },
  recommended: { key: 'recommended', label: '推荐' },
  notable: { key: 'notable', label: '值得关注' },
  standard: { key: 'standard', label: '常规' },
}

/** Convert the internal 30-point score for display without mutating stored data. */
export function toDisplayScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  const boundedScore = Math.min(INTERNAL_SCORE_MAX, Math.max(0, score))
  return Math.round((boundedScore * DISPLAY_SCORE_MAX) / INTERNAL_SCORE_MAX)
}

export function getScoreTier(score: number): ScoreTierMeta {
  const boundedScore = Number.isFinite(score) ? Math.min(INTERNAL_SCORE_MAX, Math.max(0, score)) : 0
  if (boundedScore >= 27) return SCORE_TIERS['must-read']
  if (boundedScore >= 24) return SCORE_TIERS.recommended
  if (boundedScore >= 18) return SCORE_TIERS.notable
  return SCORE_TIERS.standard
}

const CATEGORY_LABELS: Record<string, string> = {
  'ai-engineering': 'AI 工程',
  'ai-safety': 'AI 安全',
  'cognitive-science': '认知科学',
  'decision-method': '决策方法',
  'health-science': '健康科学',
  'social-observation': '社会观察',
  'tech-industry': '技术产业',
  general: '综合',
  model: '模型',
  models: '模型',
  product: '产品',
  products: '产品',
  industry: '行业',
  tutorial: '技巧',
  opinion: '观点',
}

export function getCategoryLabel(category?: string | null): string {
  const normalized = category?.trim()
  if (!normalized) return CATEGORY_LABELS.general
  return CATEGORY_LABELS[normalized.toLowerCase()] ?? normalized
}

export type SourceTypeKey = 'official' | 'research' | 'code' | 'media' | 'community' | 'aggregator' | 'unknown'

export interface SourceTypeMeta {
  key: SourceTypeKey
  label: string
}

const SOURCE_TYPES: Record<SourceTypeKey, SourceTypeMeta> = {
  official: { key: 'official', label: '官方来源' },
  research: { key: 'research', label: '研究论文' },
  code: { key: 'code', label: '代码仓库' },
  media: { key: 'media', label: '行业媒体' },
  community: { key: 'community', label: '社区观点' },
  aggregator: { key: 'aggregator', label: '聚合来源' },
  unknown: { key: 'unknown', label: '来源待核验' },
}

function hostnameFromUrl(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function hostMatches(hostname: string, domains: readonly string[]): boolean {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

/** Infer provenance from fields already present on Article without overstating unknown sources. */
export function inferSourceType(source?: string | null, url?: string): SourceTypeMeta {
  const sourceText = source?.trim().toLowerCase() ?? ''
  const hostname = hostnameFromUrl(url)
  const haystack = `${sourceText} ${hostname}`

  if (hostMatches(hostname, ['github.com', 'gitlab.com', 'huggingface.co']) || /\b(github|gitlab)\b/.test(sourceText)) {
    return SOURCE_TYPES.code
  }
  if (
    hostMatches(hostname, ['arxiv.org', 'openreview.net', 'nature.com', 'science.org', 'acm.org', 'ieee.org']) ||
    /\b(arxiv|openreview|nature|science|acm|ieee)\b/.test(sourceText)
  ) {
    return SOURCE_TYPES.research
  }
  if (
    hostMatches(hostname, [
      'openai.com',
      'anthropic.com',
      'deepmind.google',
      'ai.google',
      'microsoft.com',
      'meta.com',
      'nvidia.com',
      'mistral.ai',
      'x.ai',
    ]) ||
    /\b(openai|anthropic|deepmind|google ai|microsoft|meta ai|nvidia|mistral|xai)\b/.test(sourceText)
  ) {
    return SOURCE_TYPES.official
  }
  if (
    hostMatches(hostname, ['reddit.com', 'medium.com', 'substack.com', 'x.com', 'twitter.com', 'zhihu.com']) ||
    /\b(reddit|medium|substack|twitter|知乎)\b/.test(sourceText)
  ) {
    return SOURCE_TYPES.community
  }
  if (/\b(rss|feedly|newsletter|aggregator)\b/.test(haystack) || sourceText.includes('聚合')) {
    return SOURCE_TYPES.aggregator
  }
  if (
    hostMatches(hostname, [
      'reuters.com',
      'bloomberg.com',
      'nytimes.com',
      'wsj.com',
      'theverge.com',
      'techcrunch.com',
      'wired.com',
      '36kr.com',
    ]) ||
    /\b(reuters|bloomberg|new york times|wall street journal|the verge|techcrunch|wired|36kr)\b/.test(sourceText)
  ) {
    return SOURCE_TYPES.media
  }
  return SOURCE_TYPES.unknown
}

export function toShanghaiDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function formatShanghaiDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '日期未知'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: SHANGHAI_TIME_ZONE,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
}

export function formatShanghaiTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: SHANGHAI_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

type TimelineArticle = Pick<Article, 'url_hash' | 'discovered_at'>

export interface TimelineDateGroup<T> {
  dateKey: string
  label: string
  articles: T[]
}

export function sortArticlesNewestFirst<T extends TimelineArticle>(articles: readonly T[]): T[] {
  return articles
    .map((article, index) => ({ article, index }))
    .sort((left, right) => {
      const timeDifference = new Date(right.article.discovered_at).getTime() - new Date(left.article.discovered_at).getTime()
      if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference
      const hashDifference = left.article.url_hash.localeCompare(right.article.url_hash)
      return hashDifference || left.index - right.index
    })
    .map(({ article }) => article)
}

export function groupArticlesByShanghaiDate<T extends TimelineArticle>(articles: readonly T[]): TimelineDateGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const article of sortArticlesNewestFirst(articles)) {
    const dateKey = toShanghaiDateKey(article.discovered_at)
    const groupKey = dateKey || 'unknown'
    const group = groups.get(groupKey) ?? []
    group.push(article)
    groups.set(groupKey, group)
  }

  return [...groups.entries()].map(([dateKey, groupedArticles]) => ({
    dateKey,
    label: dateKey === 'unknown' ? '日期未知' : formatShanghaiDate(groupedArticles[0].discovered_at),
    articles: groupedArticles,
  }))
}

export type DailySectionKey = 'models' | 'products' | 'industry' | 'insights'

export interface DailySectionMeta {
  key: DailySectionKey
  label: string
}

export const DAILY_SECTIONS: readonly DailySectionMeta[] = [
  { key: 'models', label: '模型进展' },
  { key: 'products', label: '产品动态' },
  { key: 'industry', label: '行业观察' },
  { key: 'insights', label: '技巧与观点' },
]

type DailyArticle = Pick<Article, 'url_hash' | 'title' | 'category' | 'type' | 'topic' | 'source' | 'discovered_at'>

export function getDailySection(article: DailyArticle): DailySectionKey {
  const type = article.type?.toLowerCase() ?? ''
  const category = article.category?.toLowerCase() ?? ''
  const text = `${article.title} ${article.topic ?? ''} ${category} ${type} ${article.source}`.toLowerCase()

  if (
    ['tutorial', 'deep', 'opinion'].includes(type) ||
    ['tips', 'tutorial', 'opinion', 'insights'].includes(category) ||
    /教程|技巧|指南|实践|观点|评论|方法/.test(text)
  ) {
    return 'insights'
  }
  if (type === 'paper' || ['model', 'models', 'research'].includes(category)) {
    return 'models'
  }
  if (type === 'tool' || ['product', 'products'].includes(category)) {
    return 'products'
  }
  if (['industry', 'tech-industry'].includes(category)) {
    return 'industry'
  }
  if (/模型|大模型|\bmodel\b|llm|推理|训练|评测|benchmark|研究|论文/.test(text)) {
    return 'models'
  }
  if (/产品|发布|上线|应用|工具|平台|agent|助手|copilot|app\b/.test(text)) return 'products'
  if (/行业|公司|融资|政策|监管|市场|芯片|算力|收购/.test(text)) return 'industry'
  return 'industry'
}

export function partitionDailyArticles<T extends DailyArticle>(articles: readonly T[]): Record<DailySectionKey, T[]> {
  const sections: Record<DailySectionKey, T[]> = {
    models: [],
    products: [],
    industry: [],
    insights: [],
  }
  for (const article of sortArticlesNewestFirst(articles)) {
    sections[getDailySection(article)].push(article)
  }
  return sections
}
