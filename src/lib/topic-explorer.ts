export interface FeedTopic { name: string; count: number }

/** Reject malformed public API metadata instead of rendering broken controls. */
export function parseFeedTopics(value: unknown): FeedTopic[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const { name, count } = item
    if (typeof name !== 'string' || !name.trim() || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || seen.has(name.trim())) return []
    seen.add(name.trim())
    return [{ name: name.trim(), count }]
  })
}

export function topicFeedUrl(topic: string, limit = 6): string {
  return `/api/feed?${new URLSearchParams({ topic, limit: String(limit) })}`
}

export function topicPageUrl(topic: string): string {
  return `/feed/topics?${new URLSearchParams({ topic })}`
}
