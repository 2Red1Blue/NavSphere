import React from 'react'
import Link from 'next/link'
import { hasDisplayScore } from '@/lib/feed-view'
import { PublicArticleTitle } from './public-article-title'

export interface DailyArticleItemData {
  url_hash: string
  title: string
  original_title: string | null
  summary: string | null
  takeaway: string | null
  source: string
  category: string
  topic: string | null
  type: string | null
  displayScore: number
  discovered_at: string
}

export function DailyArticleItem({ article }: { article: DailyArticleItemData }) {
  return <article>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {article.source && <><span className="font-medium text-foreground/80">{article.source}</span><span aria-hidden="true">·</span></>}
      <span>{article.category || '综合'}</span>
      {hasDisplayScore(article.displayScore) && <><span aria-hidden="true">·</span><span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">AI {article.displayScore}</span></>}
    </div>
    <h3 className="feed-display mt-2 text-xl font-semibold leading-relaxed">
      <Link href={`/feed/${article.url_hash}`} className="decoration-[hsl(var(--feed-accent)/.5)] underline-offset-4 transition-colors hover:text-[hsl(var(--feed-accent))] hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))] focus-visible:ring-offset-4">
        <PublicArticleTitle article={article} />
      </Link>
    </h3>
    {article.summary ? <p className="mt-3 text-sm leading-7 text-muted-foreground">{article.summary}</p>
      : <p className="mt-3 text-sm italic text-muted-foreground">暂无摘要，可进入详情查看来源信息。</p>}
    {article.takeaway && <p className="mt-3 border-l-2 border-amber-500/70 pl-3 text-sm leading-6 text-foreground/85">
      <span className="mr-2 text-xs font-semibold text-amber-700 dark:text-amber-400">推荐理由</span>{article.takeaway}
    </p>}
  </article>
}
