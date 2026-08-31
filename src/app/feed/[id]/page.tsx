'use client'

export const runtime = 'edge'

import { useState, useEffect } from 'react'
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
 */
function cleanContent(raw: string): string {
  let s = raw
  // 1. 移除 YAML frontmatter (--- ... ---)
  const fmMatch = s.match(/^---\n[\s\S]*?\n---\n?/)
  if (fmMatch) {
    s = s.slice(fmMatch[0].length)
  }
  // 2. 移除 Markdown 加粗格式的元数据行
  s = s.replace(/^\*\*(Source|Author|Published|URL):\*\*\s*.+\n?/gm, '')
  // 3. 移除纯文本元数据行
  s = s.replace(/^Source:\s*.+(?:Author:\s*.+)?(?:Published:\s*.+)?(?:URL:\s*.+)?\n?/gm, '')
  s = s.replace(/^(Source|Author|Published|URL):\s*.+\n?/gm, '')
  // 4. 移除元数据后面的分隔线
  s = s.replace(/^---\n+/m, '')
  // 5. 移除开头的 # 标题行（已在页面 header 展示）
  s = s.replace(/^#\s+.+\n+/, '')
  // 6. 移除开头的连续空行
  s = s.replace(/^\n+/, '')

  // 7. 先把缩进代码块转换为 fenced 代码块（避免被段落分隔打散）
  s = convertIndentedCodeBlocks(s)
  // 8. 修复段落分隔：连续两段纯文本行之间只有单 \n 的情况
  s = fixParagraphSpacing(s)

  return s.trim()
}

/**
 * 将缩进代码块（4空格/tab 缩进）转换为 fenced 代码块（```）
 * 避免后续段落分隔逻辑打散代码块
 */
function convertIndentedCodeBlocks(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let i = 0
  let inFencedBlock = false

  while (i < lines.length) {
    const line = lines[i]

    // 追踪已有 fenced 代码块
    if (line.trimStart().startsWith('```')) {
      inFencedBlock = !inFencedBlock
      result.push(line)
      i++
      continue
    }
    if (inFencedBlock) {
      result.push(line)
      i++
      continue
    }

    // 检测缩进代码块：连续 >=2 行的 4空格/tab 缩进行
    // （单行缩进可能是列表或引用，不当作代码块）
    if (/^(    |\t)/.test(line) && line.trim() !== '') {
      const codeLines: string[] = [line]
      let j = i + 1
      while (j < lines.length) {
        const nextLine = lines[j]
        // 继续收集：缩进行或空行（代码块内允许空行）
        if (/^(    |\t)/.test(nextLine) || nextLine.trim() === '') {
          codeLines.push(nextLine)
          j++
        } else {
          break
        }
      }
      // 至少2行才算代码块（排除列表续行等情况）
      const nonEmptyCodeLines = codeLines.filter(l => l.trim() !== '')
      if (nonEmptyCodeLines.length >= 2) {
        // 移除尾部空行
        while (codeLines.length > 0 && codeLines[codeLines.length - 1].trim() === '') {
          codeLines.pop()
        }
        // 去除公共缩进（最少4空格）
        const stripped = codeLines.map(l => l.replace(/^( {4}|\t)/, ''))
        result.push('```')
        result.push(...stripped)
        result.push('```')
        i = j
        continue
      }
    }

    result.push(line)
    i++
  }

  return result.join('\n')
}

/**
 * 智能段落分隔：扫描文本行，对连续的非结构性文本行补充空行
 */
function fixParagraphSpacing(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1]

    // 追踪代码块状态
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
    }

    result.push(line)

    if (inCodeBlock || !next) continue

    // 判断当前行是否是"结构性"行（不需要在其后加空行）
    const isStructural = (l: string) =>
      l === '' ||
      l.startsWith('#') ||
      l.startsWith('- ') ||
      l.startsWith('* ') ||
      l.startsWith('> ') ||
      l.startsWith('```') ||
      l.startsWith('|') ||
      /^(    |\t)/.test(l) ||  // 缩进行（代码块或列表）
      /^\d+\.\s/.test(l) ||
      /^\s+$/.test(l)

    const currIsStructural = isStructural(line)
    const nextIsStructural = isStructural(next)

    // 只在两个非空、非结构性行之间补充空行
    if (!currIsStructural && !nextIsStructural && line.trim() !== '' && next.trim() !== '') {
      result.push('')
    }
  }

  return result.join('\n')
}

/** 从 markdown 文本中提取 heading 用于 TOC */
function extractHeadings(content: string): { id: string; text: string; level: number }[] {
  const headings: { id: string; text: string; level: number }[] = []
  const lines = content.split('\n')
  let inCode = false

  for (const line of lines) {
    if (line.startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) continue

    const match = line.match(/^(#{2,4})\s+(.+)/)
    if (match) {
      const level = match[1].length
      const text = match[2].replace(/[*_`\[\]]/g, '').trim()
      const id = text
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60)
      headings.push({ id, text, level })
    }
  }
  return headings
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
    <nav className="sticky top-8 hidden xl:block w-56 shrink-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        <List className="h-3.5 w-3.5" />
        目录
      </div>
      <ul className="space-y-1 border-l border-border/50">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth' })
              }}
              className={cn(
                'block text-xs leading-relaxed transition-colors hover:text-foreground',
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
  const headings = cleanedContent ? extractHeadings(cleanedContent) : []

  // 自定义 ReactMarkdown 组件映射：给 heading 加上 id
  const components: Components = {
    h2: ({ children, ...props }) => {
      const text = typeof children === 'string' ? children : extractTextFromChildren(children)
      const id = text
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60)
      return <h2 id={id} {...props}>{children}</h2>
    },
    h3: ({ children, ...props }) => {
      const text = typeof children === 'string' ? children : extractTextFromChildren(children)
      const id = text
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60)
      return <h3 id={id} {...props}>{children}</h3>
    },
    h4: ({ children, ...props }) => {
      const text = typeof children === 'string' ? children : extractTextFromChildren(children)
      const id = text
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60)
      return <h4 id={id} {...props}>{children}</h4>
    },
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 flex gap-10">
      {/* 主内容区 */}
      <div className="flex-1 min-w-0 max-w-3xl">
        {/* Back */}
        <Link
          href="/feed"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
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

              {typeInfo && (
                <Badge variant="outline" className="text-xs gap-1">
                  <span>{typeInfo.icon}</span>
                  {typeInfo.label}
                </Badge>
              )}

              {article.category && article.category !== 'general' && (
                <Badge variant="secondary" className="text-xs">{domainLabel}</Badge>
              )}

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
              <ScoreBar icon={Sparkles} label="信号密度" value={article.signal} max={10} color="text-blue-600 dark:text-blue-400" />
              <ScoreBar icon={Lightbulb} label="新颖度" value={article.novelty} max={10} color="text-purple-600 dark:text-purple-400" />
              <ScoreBar icon={Target} label="实用性" value={article.usefulness} max={10} color="text-green-600 dark:text-green-400" />
            </div>
          </section>

          {/* Full Article Content */}
          {cleanedContent && (
            <section className="mb-8 pt-4 border-t">
              <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:tracking-tight prose-headings:scroll-mt-20 prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:text-sm prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-img:rounded-lg prose-img:max-w-full prose-blockquote:border-l-primary prose-hr:border-border">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
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

      {/* 右侧 TOC 大纲 */}
      {cleanedContent && <TocSidebar headings={headings} />}
    </div>
  )
}

/** 从 React children 中提取纯文本 */
function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    return extractTextFromChildren((children as React.ReactElement).props.children)
  }
  return ''
}
