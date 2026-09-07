import TimelineCard from './timeline-card'
import { groupArticlesByShanghaiDate } from '@/lib/feed-view'
import type { Article } from '@/types/feed'

interface TimelineListProps {
  articles: Article[]
  compact?: boolean
}

export default function TimelineList({ articles, compact = false }: TimelineListProps) {
  if (articles.length === 0) {
    return (
      <div className="border-y border-border py-12 text-center text-sm text-muted-foreground">
        今天还没有可展示的 AI 动态
      </div>
    )
  }

  const groups = groupArticlesByShanghaiDate(articles)

  return (
    <div className="space-y-7">
      {groups.map((group) => {
        const headingId = `feed-date-${group.dateKey}`
        return (
          <section key={group.dateKey} aria-labelledby={headingId}>
            <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
              <h2 id={headingId} className="text-sm font-semibold">
                <time dateTime={group.dateKey === 'unknown' ? undefined : group.dateKey}>
                  {group.label}
                </time>
              </h2>
              <span className="feed-muted text-xs tabular-nums">
                {group.articles.length} 篇
              </span>
            </div>
            <div className="cyber-panel feed-hairline overflow-hidden border bg-[hsl(var(--feed-surface))]">
              {group.articles.map((article, index) => <TimelineCard key={article.url_hash} article={article} compact={compact} index={index} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}
