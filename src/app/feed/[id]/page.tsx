'use client'

export const runtime = 'edge'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { ExternalLink, ArrowLeft, Star, Sparkles, Lightbulb, Target } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/registry/new-york/ui/badge'
import { Skeleton } from '@/registry/new-york/ui/skeleton'
import { FeedError } from '@/components/feed/feed-error'
import type { Article } from '@/types/feed'
import { cn } from '@/lib/utils'

function formatDate(dateStr?: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

function ScoreBar({ icon: Icon, label, value, max, color }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  max: number
  color: string
}) {
  const pct = Math.round((value / max) * 100)
  return (
    <div className="flex items-center gap-3">
      <div className={cn('flex items-center gap-1.5 w-20', color)}>
        <Icon className="h-4 w-4" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-700', color.replace('text-', 'bg-'))}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-mono font-medium w-12 text-right tabular-nums">
        {value}/{max}
      </span>
    </div>
  )
}

export default function FeedDetailPage() {
  const params = useParams()
  const id = params.id as string
  const [article, setArticle] = useState<Article | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchArticle() {
      try {
        setLoading(true)
        const res = await fetch(`/api/feed/${id}`)
        if (!res.ok) {
          if (res.status === 404) throw new Error('文章未找到')
          throw new Error(`加载失败 (${res.status})`)
        }
        const data = await res.json()
        setArticle(data.data)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }
    if (id) fetchArticle()
  }, [id])

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <div className="space-y-3 mt-6 pt-6 border-t">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <FeedError message={error} onRetry={() => window.location.reload()} />
      </div>
    )
  }

  if (!article) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <FeedError message="文章未找到" />
      </div>
    )
  }

  const scoreColor = article.score >= 27
    ? 'text-red-600 dark:text-red-400'
    : article.score >= 24
    ? 'text-orange-600 dark:text-orange-400'
    : article.score >= 21
    ? 'text-yellow-600 dark:text-yellow-400'
    : 'text-muted-foreground'

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Back */}
      <a
        href="/feed"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 group"
      >
        <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
        返回 Feed
      </a>

      <article>
        {/* Hero */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-bold',
                article.score >= 27
                  ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800'
                  : article.score >= 24
                  ? 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800'
                  : 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800'
              )}
              role="status"
              aria-label={`评分 ${article.score}/30`}
            >
              <Star className="h-4 w-4 fill-current" />
              {article.score}/30
            </div>

            {article.content_potential && (
              <Badge
                variant="outline"
                className={cn(
                  'text-xs',
                  article.content_potential === 'High'
                    ? 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-400'
                    : article.content_potential === 'Medium'
                    ? 'border-yellow-300 text-yellow-700 dark:border-yellow-700 dark:text-yellow-400'
                    : ''
                )}
              >
                {article.content_potential === 'High' ? '高潜力' :
                 article.content_potential === 'Medium' ? '中潜力' : '低潜力'}
              </Badge>
            )}
          </div>

          <h1 className="text-2xl font-bold leading-tight tracking-tight">
            {article.title}
          </h1>

          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
            <span className="font-medium text-foreground/70">{article.source}</span>
            {article.published_at && (
              <>
                <span aria-hidden="true">·</span>
                <time dateTime={article.published_at}>{formatDate(article.published_at)}</time>
              </>
            )}
            {article.category && article.category !== 'general' && (
              <>
                <span aria-hidden="true">·</span>
                <Badge variant="secondary" className="text-xs">{article.category}</Badge>
              </>
            )}
          </div>
        </header>

        {/* Summary */}
        {article.summary && (
          <section className="mb-8">
            <h2 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              <Sparkles className="h-3.5 w-3.5" />
              摘要
            </h2>
            <div className="text-sm leading-relaxed text-foreground/85 space-y-2">
              {article.summary.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </section>
        )}

        {/* Takeaway */}
        {article.takeaway && (
          <section className="mb-8 p-4 rounded-xl bg-primary/5 border border-primary/10">
            <h2 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              <Lightbulb className="h-3.5 w-3.5" />
              Takeaway
            </h2>
            <p className="text-sm font-medium leading-relaxed">{article.takeaway}</p>
          </section>
        )}

        {/* Score Analysis */}
        <section className="mb-8 p-5 rounded-xl bg-muted/30">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            <Target className="h-3.5 w-3.5" />
            评分分析
          </h2>
          <div className="space-y-4">
            <ScoreBar
              icon={Sparkles}
              label="信号密度"
              value={article.signal}
              max={10}
              color="text-blue-600 dark:text-blue-400"
            />
            <ScoreBar
              icon={Lightbulb}
              label="新颖度"
              value={article.novelty}
              max={10}
              color="text-purple-600 dark:text-purple-400"
            />
            <ScoreBar
              icon={Target}
              label="实用性"
              value={article.usefulness}
              max={10}
              color="text-green-600 dark:text-green-400"
            />
          </div>
        </section>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button asChild>
            <a href={article.url} target="_blank" rel="noopener noreferrer" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              阅读原文
            </a>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigator.clipboard.writeText(window.location.href)}
            aria-label="复制链接"
            title="复制链接"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </Button>
        </div>
      </article>
    </div>
  )
}