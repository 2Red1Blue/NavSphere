'use client'

export const runtime = 'edge'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import Link from 'next/link'
import remarkGfm from 'remark-gfm'
import { ExternalLink, ArrowLeft, Star, Sparkles, Lightbulb, Target, Copy, Check, List } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/registry/new-york/ui/badge'
import { Skeleton } from '@/registry/new-york/ui/skeleton'
import { FeedError } from '@/components/feed/feed-error'
import {
  getCategoryLabel,
  getScoreTier,
  inferSourceType,
  SHANGHAI_TIME_ZONE,
  toDisplayScore,
} from '@/lib/feed-view'
import {
  canRenderFullContent,
  extractMarkdownHeadings,
  normalizeReaderMarkdown,
} from '@/lib/reader-markdown'
import type { ReaderHeading } from '@/lib/reader-markdown'
import type { Article } from '@/types/feed'
import { cn } from '@/lib/utils'

function formatDate(dateStr?: string): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    timeZone: SHANGHAI_TIME_ZONE,
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
          className={cn('h-full rounded-full transition-all duration-700 motion-reduce:transition-none', color.replace('text-', 'bg-'))}
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

function SafeMarkdownImage({ src, alt, className }: {
  src?: string
  alt?: string
  className?: string
}) {
  const [consented, setConsented] = useState(false)
  const safeSource = src && /^https?:\/\//i.test(src) ? src : null
  let host = '外部站点'
  if (safeSource) {
    try {
      host = new URL(safeSource).hostname
    } catch {
      // Keep the generic label and fail closed below.
    }
  }

  if (!safeSource) {
    return alt ? (
      <span className="my-6 block rounded-sm border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        图片：{alt}
      </span>
    ) : null
  }

  if (!consented) {
    return (
      <figure className={cn('my-8 rounded-sm border border-border/70 bg-muted/30 p-4', className)}>
        <figcaption className="text-sm font-medium text-foreground">
          {alt || '文章配图'}
        </figcaption>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          为保护阅读隐私，本站不会自动连接 {host} 加载远程图片。
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            className="rounded-sm font-medium text-primary underline decoration-primary/35 underline-offset-4 outline-none hover:decoration-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => setConsented(true)}
          >
            加载原图
          </button>
          <a
            href={safeSource}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            新窗口查看
          </a>
        </div>
      </figure>
    )
  }

  return (
    // Source images are remote and intentionally load only after user consent.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={safeSource}
      alt={alt ?? ''}
      className={cn('my-8 h-auto max-w-full rounded-sm border border-border/60', className)}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  )
}

function createMarkdownComponents(headings: ReaderHeading[]): Components {
  const headingIds = new Map(
    headings
      .filter((heading) => heading.sourceOffset !== undefined)
      .map((heading) => [heading.sourceOffset as number, heading.id]),
  )
  const headingClassName = 'scroll-mt-24 text-balance font-semibold tracking-tight text-foreground'
  const idForNode = (node: unknown) => {
    if (!node || typeof node !== 'object' || !('position' in node)) return undefined
    const position = (node as { position?: { start?: { offset?: number } } }).position
    const offset = position?.start?.offset
    return offset === undefined ? undefined : headingIds.get(offset)
  }

  /* react-markdown supplies an AST node that must not be forwarded to the DOM. */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  return {
    h1: ({ node: _node, className, ...props }) => (
      <h1 className={cn(headingClassName, 'mt-12 text-3xl leading-tight', className)} {...props} />
    ),
    h2: ({ node, children, className, ...props }) => (
      <h2
        id={idForNode(node)}
        className={cn(headingClassName, 'mb-4 mt-14 border-t border-border/70 pt-8 text-2xl leading-snug', className)}
        {...props}
      >
        {children}
      </h2>
    ),
    h3: ({ node, children, className, ...props }) => (
      <h3
        id={idForNode(node)}
        className={cn(headingClassName, 'mb-3 mt-10 text-xl leading-snug', className)}
        {...props}
      >
        {children}
      </h3>
    ),
    h4: ({ node, children, className, ...props }) => (
      <h4
        id={idForNode(node)}
        className={cn(headingClassName, 'mb-3 mt-8 text-lg leading-snug', className)}
        {...props}
      >
        {children}
      </h4>
    ),
    h5: ({ node: _node, className, ...props }) => (
      <h5 className={cn(headingClassName, 'mb-2 mt-7 text-base leading-snug', className)} {...props} />
    ),
    h6: ({ node: _node, className, ...props }) => (
      <h6 className={cn(headingClassName, 'mb-2 mt-6 text-base leading-snug text-muted-foreground', className)} {...props} />
    ),
    a: ({ node: _node, href, className, children, ...props }) => {
      const opensNewTab = Boolean(href && /^https?:\/\//i.test(href))
      return (
        <a
          href={href}
          className={cn(
            'rounded-sm font-medium text-primary underline decoration-primary/35 underline-offset-4 outline-none transition-colors hover:decoration-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none',
            className,
          )}
          target={opensNewTab ? '_blank' : undefined}
          rel={opensNewTab ? 'noopener noreferrer' : undefined}
          {...props}
        >
          {children}
          {opensNewTab && <span className="sr-only">（在新标签页打开）</span>}
        </a>
      )
    },
    table: ({ node: _node, className, ...props }) => (
      <div
        className="my-8 max-w-full overflow-x-auto rounded-sm border border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        role="region"
        aria-label="可横向滚动的数据表"
        tabIndex={0}
      >
        <table className={cn('my-0 w-full min-w-[36rem] border-collapse text-sm', className)} {...props} />
      </div>
    ),
    th: ({ node: _node, className, ...props }) => (
      <th className={cn('border-b border-r border-border bg-muted/70 px-4 py-3 text-left font-semibold last:border-r-0', className)} {...props} />
    ),
    td: ({ node: _node, className, ...props }) => (
      <td className={cn('border-b border-r border-border/70 px-4 py-3 align-top last:border-r-0', className)} {...props} />
    ),
    img: ({ node: _node, src, alt, className }) => (
      <SafeMarkdownImage src={src} alt={alt ?? undefined} className={className} />
    ),
    pre: ({ node: _node, className, ...props }) => (
      <pre
        className={cn('my-8 max-w-full overflow-x-auto rounded-md border border-border bg-muted/65 p-4 text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-ring [&>code]:bg-transparent [&>code]:p-0', className)}
        tabIndex={0}
        {...props}
      />
    ),
    code: ({ node: _node, className, ...props }) => (
      <code
        className={cn('rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] before:content-none after:content-none', className)}
        {...props}
      />
    ),
    blockquote: ({ node: _node, className, ...props }) => (
      <blockquote
        className={cn('my-8 border-l-2 border-primary/70 pl-5 text-foreground/80 not-italic', className)}
        {...props}
      />
    ),
    p: ({ node: _node, className, ...props }) => (
      <p className={cn('my-5 text-base leading-8 text-foreground/88', className)} {...props} />
    ),
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}

/** 右侧 TOC 大纲组件 */
function TocSidebar({ headings }: { headings: { id: string; text: string; level: number }[] }) {
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -80% 0px', threshold: 0 }
    )

    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter(Boolean) as HTMLElement[]
    elements.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  return (
    <nav className="sticky top-8 hidden w-56 shrink-0 self-start xl:block" aria-label="文章目录">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        <List className="h-3.5 w-3.5" aria-hidden="true" />
        目录
      </div>
      <ul className="space-y-1 border-l border-border/50">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              onClick={(e) => {
                e.preventDefault()
                const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
                document.getElementById(h.id)?.scrollIntoView({
                  behavior: reduceMotion ? 'auto' : 'smooth',
                })
              }}
              className={cn(
                'block rounded-r-sm py-1.5 text-xs leading-relaxed outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none',
                h.level === 2 ? 'pl-3' : h.level === 3 ? 'pl-6' : 'pl-9',
                activeId === h.id
                  ? 'text-foreground font-medium border-l-2 border-primary -ml-px'
                  : 'text-muted-foreground'
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
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

  // Keep the parsed Markdown and component identities stable across SWR/state
  // re-renders. This preserves image consent and avoids reparsing large bodies.
  const rendersFullContent = article ? canRenderFullContent(article) : false
  const articleContent = article?.content
  const articleTitle = article?.title
  const articleSummary = article?.summary
  const readerContent = useMemo(() => (
    rendersFullContent && articleTitle
      ? normalizeReaderMarkdown(articleContent ?? '', articleTitle, articleSummary ?? undefined)
      : null
  ), [rendersFullContent, articleContent, articleTitle, articleSummary])
  const headings = useMemo(
    () => (readerContent ? extractMarkdownHeadings(readerContent) : []),
    [readerContent],
  )
  const components = useMemo(() => createMarkdownComponents(headings), [headings])

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
  const domainLabel = getCategoryLabel(article.category)
  const displayScore = toDisplayScore(article.score)
  const scoreTier = getScoreTier(article.score)
  const sourceType = inferSourceType(article.source, article.url)
  return (
    <div className="mx-auto flex max-w-6xl gap-12 px-4 py-8 sm:px-6 lg:py-12">
      {/* 主内容区 */}
      <main className="min-w-0 w-full max-w-[65ch] flex-1" id="main-content">
        {/* Back */}
        <Link
          href="/feed"
          className="group mb-8 inline-flex items-center gap-2 rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 motion-reduce:transition-none"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none" />
          返回 Feed
        </Link>

        <article>
          {/* Hero */}
          <header className="mb-8">
            {/* Badges row */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <div
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-bold',
                  scoreTier.key === 'must-read'
                    ? 'border-primary/25 bg-primary/10 text-primary'
                    : scoreTier.key === 'recommended'
                    ? 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-border bg-muted text-foreground'
                )}
              >
                <Star className="h-4 w-4 fill-current" />
                {displayScore}/100 · {scoreTier.label}
              </div>

              {typeInfo && (
                <Badge variant="outline" className="text-xs gap-1">
                  <span>{typeInfo.icon}</span>
                  {typeInfo.label}
                </Badge>
              )}

              <Badge variant="secondary" className="text-xs">{domainLabel}</Badge>

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
              <span aria-hidden="true">·</span>
              <span>{sourceType.label}</span>
              {article.published_at && (
                <>
                  <span aria-hidden="true">·</span>
                  <time dateTime={article.published_at}>{formatDate(article.published_at)}</time>
                </>
              )}
            </div>
          </header>

          {/* AI guide */}
          {article.summary && (
            <section className="mb-6">
              <h2 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                <Sparkles className="h-3.5 w-3.5" />
                AI 导读
              </h2>
              <div className="text-sm leading-relaxed text-foreground/85 space-y-2">
                {article.summary.split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </section>
          )}

          {/* Recommendation reason */}
          {article.takeaway && (
            <section className="mb-6 p-4 rounded-xl bg-primary/5 border border-primary/10">
              <h2 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                <Lightbulb className="h-3.5 w-3.5" />
                推荐理由
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
              <ScoreBar icon={Sparkles} label="信号密度" value={article.signal} max={10} color="text-blue-600 dark:text-blue-400" />
              <ScoreBar icon={Lightbulb} label="新颖度" value={article.novelty} max={10} color="text-purple-600 dark:text-purple-400" />
              <ScoreBar icon={Target} label="实用性" value={article.usefulness} max={10} color="text-green-600 dark:text-green-400" />
            </div>
          </section>

          {/* Full Article Content */}
          {readerContent ? (
            <section className="mb-10 border-t pt-8" aria-label="文章正文">
              <div className="prose max-w-[65ch] text-base dark:prose-invert prose-hr:border-border prose-li:my-2 prose-li:leading-8 prose-ol:my-6 prose-ul:my-6 prose-strong:text-foreground">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={components}
                  skipHtml
                >
                  {readerContent}
                </ReactMarkdown>
              </div>
            </section>
          ) : (
            <section className="mb-8 border-y border-border py-6" aria-labelledby="reader-fallback-title">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                内容状态
              </p>
              <h2 id="reader-fallback-title" className="text-lg font-semibold tracking-tight">
                本站暂不展示完整原文
              </h2>
              <p className="mt-3 max-w-[60ch] text-base leading-7 text-muted-foreground">
                当前条目仅提供 AI 导读与推荐理由。完整内容的格式、质量与公开许可尚未同时通过验证，请前往来源网站阅读原文。
              </p>
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
      </main>

      {/* 右侧 TOC 大纲 */}
      {readerContent && <TocSidebar headings={headings} />}
    </div>
  )
}
