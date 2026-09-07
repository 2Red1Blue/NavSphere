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
  let articleIndex = 0

  return (
    <div className="space-y-14">
      {groups.map((group) => {
        const headingId = `feed-date-${group.dateKey}`
        return (
          <section key={group.dateKey} aria-labelledby={headingId}>
            <div className="feed-hairline mb-1 flex items-baseline justify-between gap-3 border-b pb-3">
              <h2 id={headingId} className="feed-kicker">
                <time dateTime={group.dateKey === 'unknown' ? undefined : group.dateKey}>
                  {group.label}
                </time>
              </h2>
              <span className="feed-muted text-xs tabular-nums">
                {group.articles.length} 个信号
              </span>
            </div>
            <div className="grid md:grid-cols-2 md:gap-x-9">
              {group.articles.map((article) => {
                const index = articleIndex++
                return (
                  <div key={article.url_hash} className={index === 0 ? 'md:col-span-2' : ''}>
                    <TimelineCard article={article} index={index} variant={index === 0 ? 'lead' : 'standard'} />
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
