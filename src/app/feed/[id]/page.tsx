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
import { Skeleton } from '@/registry/new-york/ui/skeleton'
import { FeedError } from '@/components/feed/feed-error'
import { EditorialBrief } from '@/components/feed/editorial-brief'
import {
  EditorialArticle,
  EditorialArticleUnavailable,
  resolveEditorialV2State,
  type EditorialArticleV2,
} from '@/components/feed/editorial-article'
import { PublicArticleTitle } from '@/components/feed/public-article-title'
import {
  getCategoryLabel,
  getScoreTier,
  getSourceLink,
  hasDisplayScore,
  hasScoreBreakdown,
  SHANGHAI_TIME_ZONE,
  toDisplayScore,
} from '@/lib/feed-view'
import {
  canRenderFullContent,
  extractMarkdownHeadings,
  normalizeReaderMarkdown,
} from '@/lib/reader-markdown'
import { validateEditorialPublication } from '@/lib/editorial-contract'
import { resolveMockPreviewKey } from '@/lib/mock-preview'
import type { ReaderHeading } from '@/lib/reader-markdown'
import type { Article, PublicEditorial } from '@/types/feed'
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
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--feed-line)/.45)]">
        <div
          className="feed-accent-bg h-full rounded-full transition-all duration-700 motion-reduce:transition-none"
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

function getRenderableEditorial(editorial: Article['editorial']): PublicEditorial | null {
  if (!editorial) return null
  const { revision, published_at, ...publication } = editorial
  if (!Number.isInteger(revision) || revision < 1 || revision > 2147483647
    || typeof published_at !== 'string') return null
  try {
    return { ...validateEditorialPublication(publication), revision, published_at }
  } catch {
    return null
  }
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
  const [readingProgress, setReadingProgress] = useState(0)
  // ?mock_v2=<key> renders a development-only fixture.  Real v2 publications
  // always use the v2 contract below; a feature flag must not make an invalid
  // v2 payload silently fall back to the v1 renderer.
  const [mockArticleV2, setMockArticleV2] = useState<EditorialArticleV2 | null>(null)

  useEffect(() => {
    // Mock v2 preview entry is registered only in non-production builds. The
    // literal NODE_ENV guard folds to a constant at compile time, so bundler
    // dead-branch elimination removes this whole branch — including the
    // dynamic __fixtures__ import and its 【占位】 content — from production
    // bundles. In production ?mock_v2= is ignored entirely and the page
    // follows the normal v1/v2 dispatch.
    if (process.env.NODE_ENV !== 'production') {
      const mockKey = resolveMockPreviewKey(window.location.search)
      if (!mockKey) return
      let cancelled = false
      import('@/components/feed/__fixtures__').then(({ loadMockEditorialArticleV2 }) => {
        if (!cancelled) setMockArticleV2(loadMockEditorialArticleV2(mockKey))
      }).catch(() => { /* mock preview is best-effort only */ })
      return () => { cancelled = true }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function fetchArticle() {
      // Mock v2 preview renders placeholder fixtures without a live payload.
      // Same compile-time gate as above: in production builds this branch —
      // and the 【占位】 stub article — is dead code eliminated from the
      // bundle, and the request goes straight to the live API.
      if (process.env.NODE_ENV !== 'production'
        && resolveMockPreviewKey(window.location.search)) {
        setArticle({
          url_hash: 'mockv2preview',
          title: '【占位】mock 文章',
          original_title: '【占位】原始抓取标题（仅供排版验证）',
          source: 'Mock 来源',
          url: 'https://example.org/article',
          category: 'general',
          score: 0, signal: 0, novelty: 0, usefulness: 0,
          discovered_at: '', created_at: '',
          published_at: '2026-09-08T00:00:00Z',
        })
        setLoading(false)
        return
      }
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/feed/${id}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok) {
          if (res.status === 404) throw new Error('文章未找到')
          throw new Error(`加载失败 (${res.status})`)
        }
        const data = await res.json()
        if (!controller.signal.aborted) setArticle(data.data)
      } catch (err) {
        if ((err as Error).name !== 'AbortError' && !controller.signal.aborted) {
          setError((err as Error).message)
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    if (id) fetchArticle()
    return () => controller.abort()
  }, [id])

  useEffect(() => {
    const updateProgress = () => {
      const root = document.documentElement
      const scrollable = root.scrollHeight - root.clientHeight
      setReadingProgress(scrollable > 0 ? Math.min(100, (root.scrollTop / scrollable) * 100) : 0)
    }
    updateProgress()
    window.addEventListener('scroll', updateProgress, { passive: true })
    window.addEventListener('resize', updateProgress)
    return () => {
      window.removeEventListener('scroll', updateProgress)
      window.removeEventListener('resize', updateProgress)
    }
  }, [article])

  const handleCopy = async () => {
    if (!navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  // Keep the parsed Markdown and component identities stable across SWR/state
  // re-renders. This preserves image consent and avoids reparsing large bodies.
  const editorial = useMemo(() => getRenderableEditorial(article?.editorial), [article?.editorial])
  // editorial-v2 reader states (CONTRACT.md §2.4): available renders the v2
  // article; unavailable (v2 record present but invalid/unknown version) shows
  // an explicit notice and never falls back to v1. absent defers entirely to
  // the untouched v1 dispatch below (including schema_version==1 records).
  const editorialV2State = useMemo(() => {
    if (mockArticleV2) return { state: 'available', publication: mockArticleV2 } as const
    return resolveEditorialV2State(article?.editorial_v2)
  }, [mockArticleV2, article?.editorial_v2])
  const editorialV2 = editorialV2State.state === 'available' ? editorialV2State.publication : null
  const rendersFullContent = article ? canRenderFullContent(article) : false
  const articleContent = article?.content
  const articleTitle = article?.title
  const articleSummary = article?.summary
  const readerContent = useMemo(() => (
    !editorial && rendersFullContent && articleTitle
      ? normalizeReaderMarkdown(articleContent ?? '', articleTitle, articleSummary ?? undefined)
      : null
  ), [editorial, rendersFullContent, articleContent, articleTitle, articleSummary])
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
  const scored = hasDisplayScore(article.score)
  const scoreBreakdownAvailable = scored && hasScoreBreakdown(article)
  const displayScore = toDisplayScore(article.score)
  const scoreTier = getScoreTier(article.score)
  const sourceLink = getSourceLink(article)
  return (
    <div className="feed-paper min-h-screen selection:bg-orange-200/70 selection:text-stone-950 dark:selection:bg-orange-800/70 dark:selection:text-stone-50">
      <div className="feed-accent-bg fixed left-0 top-0 z-50 h-0.5" style={{ width: `${readingProgress}%` }} aria-hidden="true" />

      <header className="feed-hairline border-b">
        <div className="mx-auto flex max-w-[76rem] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/feed" className="group inline-flex items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))]">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1 motion-reduce:transform-none" />
            <span className="feed-display text-xl font-semibold">NavSphere</span>
          </Link>
          <span className="feed-kicker hidden sm:block">AI 资讯</span>
          <button type="button" onClick={handleCopy} className="feed-muted inline-flex items-center gap-2 rounded-full border border-[hsl(var(--feed-line))] px-3 py-1.5 text-xs transition-colors hover:text-[hsl(var(--feed-ink))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))]" aria-label="复制链接" title="复制链接">
            {copied ? <Check className="h-3.5 w-3.5 feed-accent" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? '已复制' : '分享'}
          </button>
        </div>
      </header>

      <article>
        <header className="feed-hairline border-b">
          <div className="mx-auto max-w-[76rem] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
            <div className="mb-7 flex flex-wrap items-center gap-x-3 gap-y-2">
              {scored && <><span className="feed-accent inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em]"><Star className="h-3.5 w-3.5 fill-current" /> {displayScore}/100 · {scoreTier.label}</span><span className="feed-muted">/</span></>}
              <span className="feed-kicker !text-[hsl(var(--feed-muted))]">{domainLabel}{typeInfo ? ` · ${typeInfo.label}` : ''}</span>
            </div>
            {editorialV2 ? null : (
              <>
                {/* v1 header: original-title-first display stays untouched. */}
                <h1 className="feed-display max-w-4xl text-[28px] font-semibold leading-[1.4] tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-[36px] lg:text-[40px]">
                  <PublicArticleTitle article={article} />
                </h1>
                <div className="feed-muted mt-5 flex flex-wrap items-center gap-2 text-sm">
                  {article.source && <span className="font-semibold text-[hsl(var(--feed-ink))]">{article.source}</span>}
                  {article.source && article.published_at && <span aria-hidden="true">·</span>}
                  {article.published_at && <time dateTime={article.published_at}>{formatDate(article.published_at)}</time>}
                </div>
              </>
            )}
          </div>
        </header>

        {/* v2 uses a single reading column (body max 720px + in-component TOC). */}
        <div className={cn('mx-auto grid max-w-[76rem] gap-12 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:px-8 lg:py-10 xl:gap-12', editorialV2 && 'lg:grid-cols-none')}>
          <main className={cn('min-w-0', editorialV2 ? 'max-w-none' : 'max-w-[76ch]')} id="main-content">
            {/* Editorials take the body slot; original Markdown is shown only otherwise. */}
            {editorialV2 ? (
              <EditorialArticle
                publication={editorialV2}
                publishedAt={article.published_at}
                sourceName={article.source}
              />
            ) : editorialV2State.state === 'unavailable' ? (
              <EditorialArticleUnavailable sourceLabel={article.source} sourceUrl={article.url} />
            ) : editorial ? (
              <EditorialBrief editorial={editorial} />
            ) : readerContent ? (
              <section className="mb-12" aria-label="文章正文">
                <div className="feed-hairline mb-8 flex items-center justify-between border-y py-3">
                  <p className="feed-kicker">Reader / 正文</p>
                  <span className="feed-muted text-xs">经格式与许可校验</span>
                </div>
                <div className="prose max-w-[68ch] text-base dark:prose-invert prose-hr:border-[hsl(var(--feed-line))] prose-li:my-2 prose-li:leading-8 prose-ol:my-6 prose-ul:my-6 prose-strong:text-[hsl(var(--feed-ink))]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{readerContent}</ReactMarkdown>
                </div>
              </section>
            ) : (
              <div className="mb-12">
                {(article.summary || article.takeaway) && <section className="mb-8" aria-label="内容导读">
                  <h2 className="feed-kicker mb-5">内容导读</h2>
                  {article.summary && <div className="space-y-3 text-base leading-8">{article.summary.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>}
                  {article.takeaway && <p className="mt-6 rounded-lg bg-[hsl(var(--feed-accent)/.06)] p-5 text-sm leading-7"><span className="feed-accent mr-2 font-semibold">推荐理由</span>{article.takeaway}</p>}
                </section>}
              <section className="feed-hairline border-t pt-6" aria-labelledby="reader-fallback-title">
                <p className="feed-kicker mb-4">内容状态</p>
                <h2 id="reader-fallback-title" className="feed-display text-base font-semibold leading-snug">本站暂不展示完整原文</h2>
                <p className="feed-muted mt-3 max-w-[60ch] text-sm leading-7">
                  当前条目仅提供编辑导读与推荐理由。完整原文的格式、质量与公开许可尚未同时通过验证。
                  {sourceLink?.label === 'AIHOT收录页' ? '尚未核验上游原文链接，可前往 AIHOT 收录页查看来源线索。' : sourceLink ? '可通过来源链接继续阅读。' : '当前没有可安全打开的来源链接。'}
                </p>
              </section>
              </div>
            )}
          </main>

          {/* v2 keeps sources in the article footer; the v1 aside stays untouched. */}
          <aside className={cn('min-w-0 lg:order-none', editorialV2 && 'hidden')} aria-label="编辑注与文章信息">
            <div className="space-y-8 lg:sticky lg:top-8">
              {(editorial || readerContent) && (article.summary || article.takeaway) && (
                <section className="feed-hairline border-t pt-4">
                  <h2 className="feed-kicker mb-4">内容导读</h2>
                  {article.summary && <div className="feed-muted space-y-2 text-sm leading-7">{article.summary.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>}
                  {article.takeaway && <p className="mt-5 border-l-2 border-[hsl(var(--feed-accent))] pl-4 text-sm font-semibold leading-7">{article.takeaway}</p>}
                </section>
              )}

              {scoreBreakdownAvailable && <section className="feed-hairline border-t pt-4">
                <h2 className="feed-kicker mb-5">系统评分</h2>
                <div className="space-y-4">
                  <ScoreBar icon={Sparkles} label="信息密度" value={article.signal} max={10} color="text-[hsl(var(--feed-accent))]" />
                  <ScoreBar icon={Lightbulb} label="新颖度" value={article.novelty} max={10} color="text-[hsl(var(--feed-accent))]" />
                  <ScoreBar icon={Target} label="实用性" value={article.usefulness} max={10} color="text-[hsl(var(--feed-accent))]" />
                </div>
              </section>}

              {readerContent && <TocSidebar headings={headings} />}

              <div className="feed-hairline flex items-center gap-3 border-t pt-5">
                {sourceLink && <Button asChild className="feed-accent-bg flex-1 rounded-full border-0 text-[hsl(var(--feed-paper))] hover:opacity-90">
                  <a href={sourceLink.url} target="_blank" rel="noopener noreferrer" className="gap-2">
                    <ExternalLink className="h-4 w-4" />{sourceLink.label}
                  </a>
                </Button>}
              </div>
            </div>
          </aside>
        </div>
      </article>
    </div>
  )
}
