import TimelineCard from './timeline-card'
import { groupArticlesByShanghaiDate } from '@/lib/feed-view'
import type { Article } from '@/types/feed'

interface TimelineListProps {
  articles: Article[]
}

export default function TimelineList({ articles }: TimelineListProps) {
  if (articles.length === 0) {
    return (
      <div className="border-y border-border py-12 text-center text-sm text-muted-foreground">
        今天还没有可展示的 AI 动态
      </div>
    )
  }

  const groups = groupArticlesByShanghaiDate(articles)

  return (
    <div className="space-y-10">
      {groups.map((group) => {
        const headingId = `feed-date-${group.dateKey}`
        return (
          <section key={group.dateKey} aria-labelledby={headingId}>
            <div className="mb-2 flex items-baseline gap-3 border-b border-border pb-3">
              <h2 id={headingId} className="text-base font-semibold tracking-tight">
                <time dateTime={group.dateKey === 'unknown' ? undefined : group.dateKey}>
                  {group.label}
                </time>
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {group.articles.length} 条动态
              </span>
            </div>
            <div className="divide-y divide-border">
              {group.articles.map((article) => (
                <TimelineCard key={article.url_hash} article={article} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
