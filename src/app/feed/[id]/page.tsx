'use client'

export const runtime = 'edge'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, ArrowLeft, Star, Sparkles, Lightbulb, Target, Copy, Check } from 'lucide-react'
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

// 过滤掉 YAML frontmatter 和元数据头部
function cleanMarkdownContent(content: string): string {
  // 移除 YAML frontmatter (--- ... ---)
  let cleaned = content.replace(/^---[\s\S]*?---\n?/, '')
  
  // 移除可能的纯文本元数据行 (Source: ... Author: ... Published: ... URL: ...)
  cleaned = cleaned.replace(/^(Source|Author|Published|URL):\s*.+\n?/gm, '')
  
  return cleaned.trim()
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

// 类型图标映射
const TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  paper: { label: '论文', icon: '📄' },
  tutorial: { label: '教程', icon: '📚' },
  deep: { label: '深度', icon: '🔍' },
  news: { label: '新闻', icon: '📰' },
  tool: { label: '工具', icon: '🔧' },
}

// 领域中文映射
const DOMAIN_LABELS: Record<string, string> = {
  'ai-engineering': 'AI 工程',
  'ai-safety': 'AI 安全',
  'cognitive-science': '认知科学',
  'decision-method': '决策方法',
  'health-science': '健康科学',
  'social-observation': '社会观察',
  'tech-industry': '技术产业',
  'general': '综合',
}

/**
 * 过滤掉 YAML frontmatter 和元数据行
 * 原文格式: --- (YAML) --- + Source: / Author: / Published: / URL: 行
 */
function cleanContent(raw: string): string {
  let s = raw
  // 1. 移除 YAML frontmatter (--- ... ---)
  const fmMatch = s.match(/^---\n[\s\S]*?\n---\n?/)
  if (fmMatch) {
    s = s.slice(fmMatch[0].length)
  }
  // 2. 移除 Markdown 加粗格式的元数据行
  // 格式: **Source:** ... / **Author:** ... / **Published:** ... / **URL:** ...
  s = s.replace(/^\*\*(Source|Author|Published|URL):\*\*\s*.+\n?/gm, '')
  // 3. 移除纯文本元数据行（单行或多行格式）
  s = s.replace(/^Source:\s*.+(?:Author:\s*.+)?(?:Published:\s*.+)?(?:URL:\s*.+)?\n?/gm, '')
  s = s.replace(/^(Source|Author|Published|URL):\s*.+\n?/gm, '')
  // 4. 移除元数据后面的分隔线 (---) 如果紧接着元数据
  s = s.replace(/^---\n+/m, '')
  // 5. 移除开头的 # 标题行（已在页面 header 展示）
  s = s.replace(/^#\s+.+\n+/, '')
  // 6. 移除开头的连续空行
  s = s.replace(/^\n+/, '')
  return s.trim()
}

export default function FeedDetailPage() {
  const params = useParams()
  const id = params.id as string
  const [article, setArticle] = useState<Article | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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

  const handleCopy = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <div className="space-y-3 mt-6 pt-6 border-t">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="h-64 w-full mt-8" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <FeedError message={error} onRetry={() => window.location.reload()} />
      </div>
    )
  }

  if (!article) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <FeedError message="文章未找到" />
      </div>
    )
  }

  const typeInfo = article.type ? TYPE_LABELS[article.type] : null
  const domainLabel = DOMAIN_LABELS[article.category] || article.category
  const cleanedContent = article.content ? cleanContent(article.content) : null

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
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
          {/* Badges row */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {/* Score */}
            <div
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-bold',
                article.score >= 27
                  ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800'
                  : article.score >= 24
                  ? 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800'
                  : 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800'
              )}
            >
              <Star className="h-4 w-4 fill-current" />
              {article.score}/30
            </div>

            {/* Type */}
            {typeInfo && (
              <Badge variant="outline" className="text-xs gap-1">
                <span>{typeInfo.icon}</span>
                {typeInfo.label}
              </Badge>
            )}

            {/* Domain */}
            {article.category && article.category !== 'general' && (
              <Badge variant="secondary" className="text-xs">{domainLabel}</Badge>
            )}

            {/* Content potential */}
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

          {/* Title */}
          <h1 className="text-2xl font-bold leading-tight tracking-tight">
            {article.title}
          </h1>

          {/* Meta */}
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
            <span className="font-medium text-foreground/70">{article.source}</span>
            {article.published_at && (
              <>
                <span aria-hidden="true">·</span>
                <time dateTime={article.published_at}>{formatDate(article.published_at)}</time>
              </>
            )}
          </div>
        </header>

        {/* Summary */}
        {article.summary && (
          <section className="mb-6">
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
          <section className="mb-6 p-4 rounded-xl bg-primary/5 border border-primary/10">
            <h2 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              <Lightbulb className="h-3.5 w-3.5" />
              核心收获
            </h2>
            <p className="text-sm font-medium leading-relaxed">{article.takeaway}</p>
          </section>
        )}

        {/* Score Analysis */}
        <section className="mb-6 p-5 rounded-xl bg-muted/30">
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

        {/* Full Article Content — 直接展示，无折叠 */}
        {cleanedContent && (
          <section className="mb-8 pt-4 border-t">
            <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:tracking-tight prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:text-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-img:rounded-lg prose-img:max-w-full prose-blockquote:border-l-primary prose-hr:border-border">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {cleanedContent}
              </ReactMarkdown>
            </div>
          </section>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t">
          <Button asChild>
            <a href={article.url} target="_blank" rel="noopener noreferrer" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              阅读原文
            </a>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleCopy}
            aria-label="复制链接"
            title="复制链接"
          >
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </article>
    </div>
  )
}
