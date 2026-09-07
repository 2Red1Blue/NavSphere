'use client'

import { Newspaper } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  className?: string
}

export function FeedEmpty({ className }: EmptyStateProps) {
  return (
    <div className={cn('feed-hairline flex flex-col items-center justify-center border-y py-20 text-center', className)}>
      <div className="feed-accent mb-5">
        <Newspaper className="h-9 w-9" />
      </div>
      <h3 className="feed-display text-xl font-semibold">暂无相关文章</h3>
      <p className="feed-muted mt-3 max-w-xs text-sm leading-6">
        可以换个关键词或筛选条件，稍后再来查看新内容。
      </p>
    </div>
  )
}
