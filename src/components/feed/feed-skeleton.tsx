'use client'

import { Skeleton } from '@/registry/new-york/ui/skeleton'

export function FeedSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-8" role="status" aria-label="加载中">
      {Array.from({ length: Math.min(count, 3) }).map((_, groupIdx) => (
        <section key={groupIdx}>
          <Skeleton className="h-4 w-16 mb-3" />
          <div className="space-y-3">
            {Array.from({ length: Math.ceil(count / 3) }).map((_, i) => (
              <div key={i} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                  <Skeleton className="h-6 w-14 rounded-full" />
                </div>
                <div className="flex gap-1">
                  <Skeleton className="h-1 flex-1" />
                  <Skeleton className="h-1 flex-1" />
                  <Skeleton className="h-1 flex-1" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <span className="sr-only">正在加载文章...</span>
    </div>
  )
}
