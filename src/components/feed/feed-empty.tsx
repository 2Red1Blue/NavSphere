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
      <h3 className="feed-display text-3xl font-medium">今天的版面还在整理</h3>
      <p className="feed-muted mt-3 max-w-xs text-sm leading-6">
        新信号通过采集、写作与审校后，会自动进入这里。
      </p>
    </div>
  )
}
