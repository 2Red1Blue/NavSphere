'use client'

import TimelineCard from './timeline-card'
import type { Article } from '@/types/feed'

interface TimelineListProps {
  articles: Article[]
}

export default function TimelineList({ articles }: TimelineListProps) {
  if (articles.length === 0) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">暂无文章</div>
  }

  return (
    <div className="relative">
      {/* Left vertical line */}
      <div className="absolute left-[52px] top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />
      
      {/* Article list */}
      <div className="space-y-2">
        {articles.map((article) => (
          <TimelineCard key={article.url_hash} article={article} />
        ))}
      </div>
    </div>
  )
}
