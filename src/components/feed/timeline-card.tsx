import Link from 'next/link'
import { ArrowUpRight, Sparkles } from 'lucide-react'

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
}

const SCORE_STYLES = {
  'must-read': 'border-primary/25 bg-primary/10 text-primary',
  recommended: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  notable: 'border-border bg-muted text-foreground',
  standard: 'border-border bg-background text-muted-foreground',
} as const

export default function TimelineCard({ article }: TimelineCardProps) {
  const score = toDisplayScore(article.score)
  const tier = getScoreTier(article.score)
  const sourceType = inferSourceType(article.source, article.url)
  const dateTime = article.discovered_at

  return (
    <article className="group relative grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 py-5 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-5 sm:py-6">
      <div className="relative pt-1 text-center">
        <time
          dateTime={dateTime}
          className="text-xs font-medium tabular-nums text-muted-foreground"
          title="北京时间"
        >
          {formatShanghaiTime(dateTime)}
        </time>
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-8 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-primary/70 ring-4 ring-background"
        />
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 top-10 -translate-x-1/2 border-l border-border group-last:hidden"
        />
      </div>

      <Link
        href={`/feed/${article.url_hash}`}
        className="min-w-0 rounded-md outline-none transition-colors duration-200 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        aria-label={`查看详情：${article.title}`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{article.source || '来源待核验'}</span>
            <span aria-hidden="true">·</span>
            <span>{sourceType.label}</span>
            {article.featured === 1 && (
              <span className="inline-flex items-center gap-1 font-medium text-primary">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                精选
              </span>
            )}
            <span className="ml-auto inline-flex items-baseline gap-1">
              <span className={cn('rounded border px-2 py-0.5 font-semibold tabular-nums', SCORE_STYLES[tier.key])}>
                {score}
              </span>
              <span>/ 100 · {tier.label}</span>
            </span>
          </div>

          <h3 className="text-lg font-semibold leading-snug tracking-tight transition-colors duration-200 group-hover:text-primary motion-reduce:transition-none sm:text-xl">
            {article.title}
            <ArrowUpRight className="ml-1 inline h-4 w-4 -translate-y-px opacity-0 transition-opacity duration-200 group-hover:opacity-70 group-focus-within:opacity-70 motion-reduce:transition-none" aria-hidden="true" />
          </h3>

          {article.summary && (
            <p className="line-clamp-3 text-sm leading-6 text-muted-foreground sm:text-[0.9375rem]">
              <span className="sr-only">AI 导读：</span>
              {article.summary}
            </p>
          )}

          {article.takeaway && (
            <div className="border-l-2 border-primary/40 pl-3 text-sm leading-6">
              <span className="mr-2 font-semibold text-foreground">推荐理由</span>
              <span className="text-muted-foreground">{article.takeaway}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-2 py-1">{getCategoryLabel(article.category)}</span>
            {article.type && <span>{article.type}</span>}
          </div>
        </div>
      </Link>
    </article>
  )
}
