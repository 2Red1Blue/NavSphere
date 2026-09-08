'use client'

import React from 'react'
import { useId, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, ChevronDown, Sparkles } from 'lucide-react'
import { formatShanghaiTime, getArticleDisplayTitle, getCategoryLabel, hasDisplayScore, toDisplayScore } from '@/lib/feed-view'
import type { Article } from '@/types/feed'

interface TimelineCardProps {
  article: Article
  compact?: boolean
  index?: number
}

export default function TimelineCard({ article, compact = false, index = 0 }: TimelineCardProps) {
  const [expanded, setExpanded] = useState(false)
  const previewId = useId()
  const title = getArticleDisplayTitle(article)
  return (
    <article className={`feed-story group feed-hairline border-b px-5 sm:px-7 last:border-b-0 ${compact ? 'py-4' : 'py-5 sm:py-6'}`} style={{ animationDelay: `${Math.min(index, 4) * 35}ms` }}>
      <Link
        href={`/feed/${article.url_hash}`}
        className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))]"
        aria-label={`查看详情：${title}`}
      >
        <div className="feed-muted mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {article.source && <><span className="font-medium text-[hsl(var(--feed-ink))]">{article.source}</span><span aria-hidden="true">·</span></>}
          <time dateTime={article.discovered_at} title="北京时间">{formatShanghaiTime(article.discovered_at)}</time>
          {article.featured === 1 && (
            <span className="feed-accent ml-1 inline-flex items-center gap-1 rounded bg-[hsl(var(--feed-accent)/.08)] px-1.5 py-0.5">
              <Sparkles className="h-3 w-3" aria-hidden="true" /> 精选
            </span>
          )}
        </div>
        <div className="flex items-start gap-5">
          <h3 className={`feed-display min-w-0 flex-1 font-semibold leading-[1.5] tracking-[-0.015em] [overflow-wrap:anywhere] transition-colors group-hover:text-[hsl(var(--feed-accent))] ${compact ? 'text-lg' : 'text-[20px] sm:text-[22px]'}`}>
            {title}
          </h3>
          <ArrowUpRight className="feed-muted mt-2 hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
        </div>
      </Link>
        {!compact && !expanded && article.summary && <p className="feed-muted mt-2 line-clamp-2 text-sm leading-7">{article.summary}</p>}
        {expanded && <div id={previewId} className="feed-preview mt-3 space-y-3 text-sm leading-7">
          {article.summary && <p className="feed-muted">{article.summary}</p>}
          {article.takeaway && <p className="rounded-lg bg-[hsl(var(--feed-accent)/.06)] px-4 py-3"><span className="feed-accent mr-2 font-semibold">推荐理由</span>{article.takeaway}</p>}
        </div>}
        <div className="feed-muted mt-3 flex items-center gap-3 text-xs">
          <span className="rounded-md bg-[hsl(var(--feed-ink)/.045)] px-2 py-1">{getCategoryLabel(article.category)}</span>
          {(article.summary || article.takeaway) && <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={expanded ? previewId : undefined}
            className="feed-accent inline-flex min-h-9 items-center gap-1 rounded-md px-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))]">
            {expanded ? '收起导读' : '展开导读'}<ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </button>}
          {hasDisplayScore(article.score) && <span className="ml-auto tabular-nums" title="系统综合评分">评分 {toDisplayScore(article.score)}/100</span>}
        </div>
    </article>
  )
}
