'use client'

import { cn } from '@/lib/utils'
import type { Article } from '@/types/feed'
import { FeedCard } from './feed-card'

interface FeedListProps {
  articles: Article[]
  className?: string
}

function toLocalDate(dateStr: string): string {
  // Parse ISO string and convert to local timezone date (YYYY-MM-DD)
  const d = new Date(dateStr)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function groupByDay(articles: Article[]): Map<string, Article[]> {
  const groups = new Map<string, Article[]>()
  for (const article of articles) {
    const rawDate = article.discovered_at || article.published_at
    const date = rawDate ? toLocalDate(rawDate) : 'unknown'
    if (!groups.has(date)) groups.set(date, [])
    groups.get(date)!.push(article)
  }
  return groups
}

function formatDayLabel(dateStr: string): string {
  if (dateStr === 'unknown') return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export function FeedList({ articles, className }: FeedListProps) {
  const grouped = groupByDay(articles)

  return (
    <div className={cn('space-y-8', className)}>
      {Array.from(grouped.entries()).map(([date, dayArticles]) => (
        <section key={date}>
          <h3 className="sticky top-14 z-10 -mx-3 px-3 py-2 text-xs font-medium text-muted-foreground bg-background/90 backdrop-blur-sm">
            {formatDayLabel(date)}
          </h3>
          <div className="mt-2 space-y-3">
            {dayArticles.map((article) => (
              <FeedCard key={article.url_hash} article={article} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}