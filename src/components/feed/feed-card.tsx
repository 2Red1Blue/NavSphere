'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Star } from 'lucide-react'
import type { Article } from '@/types/feed'

interface FeedCardProps {
  article: Article
  className?: string
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 27
    ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800'
    : score >= 24
    ? 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800'
    : score >= 21
    ? 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800'
    : 'bg-muted text-muted-foreground border-border'

  return (
    <div
      className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold', color)}
      role="status"
      aria-label={`评分 ${score}/30`}
    >
      <Star className="h-3 w-3 fill-current" />
      {score}/30
    </div>
  )
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function FeedCard({ article, className }: FeedCardProps) {
  return (
    <Link
      href={`/feed/${article.url_hash}`}
      className={cn(
        'group block rounded-lg border bg-card p-5 transition-all',
        'hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5',
        className
      )}
    >
      <article>
        {/* Header row: score + meta */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1 min-w-0">
            {/* Title */}
            <h3 className="font-semibold text-base leading-snug group-hover:text-primary transition-colors line-clamp-2">
              {article.title}
            </h3>

            {/* Meta */}
            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <span className="font-medium text-foreground/60">{article.source}</span>
              {article.published_at && (
                <>
                  <span className="text-border" aria-hidden="true">·</span>
                  <time dateTime={article.published_at}>{formatDate(article.published_at)}</time>
                </>
              )}
            </div>
          </div>

          <ScoreBadge score={article.score} />
        </div>

        {/* Summary */}
        {article.summary && (
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 mb-3">
            {article.summary}
          </p>
        )}

        {/* Score bars */}
        <div className="flex gap-3">
          {[
            { label: '信号', value: article.signal, max: 10 },
            { label: '新颖', value: article.novelty, max: 10 },
            { label: '实用', value: article.usefulness, max: 10 },
          ].map((dim) => (
            <div key={dim.label} className="flex-1 flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground w-5 shrink-0">{dim.label}</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary/50 rounded-full transition-all group-hover:bg-primary/70"
                  style={{ width: `${(dim.value / dim.max) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground w-3 text-right">{dim.value}</span>
            </div>
          ))}
        </div>
      </article>
    </Link>
  )
}
