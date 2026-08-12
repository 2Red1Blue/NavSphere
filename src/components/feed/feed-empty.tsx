'use client'

import { Newspaper } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  className?: string
}

export function FeedEmpty({ className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      <div className="rounded-full bg-muted p-4 mb-4">
        <Newspaper className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium">暂无文章</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-xs">
        Content OS Pipeline 尚未推送数据。
        <br />
        请先运行 pipeline 将文章推送到 Feed。
      </p>
    </div>
  )
}