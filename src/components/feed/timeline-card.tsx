import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Sparkles } from 'lucide-react'

import {
  formatShanghaiTime,
  getCategoryLabel,
  getScoreTier,
  inferSourceType,
  toDisplayScore,
} from '@/lib/feed-view'
import { cn } from '@/lib/utils'
import type { Article } from '@/types/feed'

interface TimelineCardProps {
  article: Article
  variant?: 'lead' | 'standard'
  index?: number
}

export default function TimelineCard({ article, variant = 'standard', index = 0 }: TimelineCardProps) {
  const score = toDisplayScore(article.score)
  const tier = getScoreTier(article.score)
  const sourceType = inferSourceType(article.source, article.url)
  const dateTime = article.discovered_at

  const meta = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--feed-muted))]">
      <span className="text-[hsl(var(--feed-ink))]">{article.source || '来源待核验'}</span>
      <span aria-hidden="true">/</span>
      <span>{sourceType.label}</span>
      <time dateTime={dateTime} title="北京时间">{formatShanghaiTime(dateTime)}</time>
      {article.featured === 1 && (
        <span className="feed-accent inline-flex items-center gap-1">
          <Sparkles className="h-3 w-3" aria-hidden="true" /> 精选
        </span>
      )}
    </div>
  )

  if (variant === 'lead') {
    return (
      <article className="group feed-hairline relative overflow-hidden border-y py-7 sm:py-10">
        <Link href={`/feed/${article.url_hash}`} className="grid gap-8 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))] md:grid-cols-[minmax(0,1.5fr)_minmax(15rem,.7fr)] md:items-end" aria-label={`查看详情：${article.title}`}>
          <div>
            <div className="mb-5 flex items-center justify-between gap-4">
              {meta}
              <span className="feed-display text-4xl italic tabular-nums text-[hsl(var(--feed-accent))]">{String(index + 1).padStart(2, '0')}</span>
            </div>
            <h3 className="feed-display max-w-5xl text-balance text-[clamp(2.35rem,5.5vw,5.9rem)] font-medium leading-[0.94] tracking-[-0.055em] transition-transform duration-500 group-hover:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none">
              {article.title}
            </h3>
          </div>
          <div className="md:border-l md:border-[hsl(var(--feed-line))] md:pl-7">
            {article.summary && <p className="line-clamp-5 text-sm leading-7 text-[hsl(var(--feed-muted))] sm:text-base">{article.summary}</p>}
            {article.takeaway && <p className="mt-4 border-l-2 border-[hsl(var(--feed-accent))] pl-3 text-sm font-medium leading-6">{article.takeaway}</p>}
            <div className="mt-6 flex items-end justify-between gap-4">
              <span className="feed-kicker">{getCategoryLabel(article.category)} · {score}/100 {tier.label}</span>
              <span className="feed-accent-bg flex h-11 w-11 items-center justify-center rounded-full text-[hsl(var(--feed-paper))] transition-transform duration-300 group-hover:rotate-[-18deg] group-hover:scale-110 motion-reduce:transform-none motion-reduce:transition-none">
                <ArrowUpRight className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>
          </div>
        </Link>
      </article>
    )
  }

  return (
    <article className="group feed-hairline relative border-b py-7 sm:py-9">
      <Link href={`/feed/${article.url_hash}`} className="flex h-full flex-col rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))]" aria-label={`查看详情：${article.title}`}>
        <div className="mb-5 flex items-start justify-between gap-5">
          {meta}
          <span className="feed-display shrink-0 text-2xl italic tabular-nums text-[hsl(var(--feed-muted))]">{String(index + 1).padStart(2, '0')}</span>
        </div>
        <h3 className="feed-display text-balance text-3xl font-medium leading-[1.02] tracking-[-0.035em] transition-colors duration-300 group-hover:text-[hsl(var(--feed-accent))] motion-reduce:transition-none sm:text-4xl">
          {article.title}
        </h3>
        {article.summary && <p className="mt-5 line-clamp-3 text-sm leading-7 text-[hsl(var(--feed-muted))]">{article.summary}</p>}
        <div className="mt-auto flex items-end justify-between gap-4 pt-7">
          <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--feed-muted))]">
            <span>{getCategoryLabel(article.category)}</span>
            <span className="mx-2">·</span>
            <span className={cn(tier.key === 'must-read' && 'feed-accent')}>{score}/100</span>
          </div>
          <span className="inline-flex items-center gap-2 text-xs font-semibold">
            阅读 <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" aria-hidden="true" />
          </span>
        </div>
      </Link>
    </article>
  )
}
