'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { cn } from '@/lib/utils'

interface FeedErrorProps {
  message: string
  onRetry?: () => void
  className?: string
}

export function FeedError({ message, onRetry, className }: FeedErrorProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)} role="alert">
      <div className="rounded-full bg-destructive/10 p-4 mb-4">
        <AlertCircle className="h-8 w-8 text-destructive/70" />
      </div>
      <h3 className="text-lg font-medium">加载失败</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-xs">
        {message || '无法加载文章，请稍后重试。'}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          重试
        </Button>
      )}
    </div>
  )
}