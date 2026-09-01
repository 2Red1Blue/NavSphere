'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, CalendarDays, Clock3 } from 'lucide-react'

export const runtime = 'edge'

type SectionKey = 'models' | 'products' | 'industry' | 'insights'

interface DailyArticle {
  url_hash: string
  title: string
  summary: string | null
  takeaway: string | null
  source: string
  category: string
  topic: string | null
  type: string | null
  displayScore: number
  discovered_at: string
}

interface DailyDigest {
  date: string
  issue: string
  total: number
  estimatedReadMinutes: number
  sections: Record<SectionKey, DailyArticle[]>
}

interface DailyResponse {
  data: DailyDigest
  navigation: {
    previousDate: string | null
    nextDate: string | null
  }
}

const SECTION_META: Array<{ key: SectionKey; index: string; title: string; note: string }> = [
  { key: 'models', index: '01', title: '模型进展', note: '能力、研究与评测' },
  { key: 'products', index: '02', title: '产品动态', note: '发布、工具与应用' },
  { key: 'industry', index: '03', title: '行业观察', note: '公司、市场与政策' },
  { key: 'insights', index: '04', title: '技巧与观点', note: '实践方法与判断' },
]

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${date}T00:00:00+08:00`))
}

function Section({ meta, articles }: { meta: (typeof SECTION_META)[number]; articles: DailyArticle[] }) {
  return (
    <section aria-labelledby={`section-${meta.key}`} className="grid gap-5 border-t border-border py-9 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-8 sm:py-11">
      <div>
        <span className="text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{meta.index}</span>
        <h2 className="mt-2 text-lg font-bold tracking-tight" id={`section-${meta.key}`}>{meta.title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.note}</p>
      </div>

      {articles.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">本期没有进入精选的{meta.title}内容。</p>
      ) : (
        <ol className="divide-y divide-border/70">
          {articles.map((article) => (
            <li className="py-6 first:pt-0 last:pb-0" key={article.url_hash}>
              <article>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{article.source}</span>
                  <span aria-hidden="true">·</span>
                  <span>{article.category || '综合'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">AI {article.displayScore}</span>
                </div>
                <h3 className="mt-2 text-lg font-semibold leading-snug tracking-tight sm:text-xl">
                  <Link
                    href={`/feed/${article.url_hash}`}
                    className="decoration-emerald-600/50 underline-offset-4 transition-colors hover:text-emerald-700 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 dark:hover:text-emerald-400"
                  >
                    {article.title}
                  </Link>
                </h3>
                {article.summary ? (
                  <p className="mt-3 text-sm leading-7 text-muted-foreground">{article.summary}</p>
                ) : (
                  <p className="mt-3 text-sm italic text-muted-foreground">暂无摘要，可进入详情查看来源信息。</p>
                )}
                {article.takeaway && (
                  <p className="mt-3 border-l-2 border-amber-500/70 pl-3 text-sm leading-6 text-foreground/85">
                    <span className="mr-2 text-xs font-semibold text-amber-700 dark:text-amber-400">推荐理由</span>
                    {article.takeaway}
                  </p>
                )}
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export default function DailyDetailPage() {
  const params = useParams()
  const date = typeof params.date === 'string' ? params.date : ''
  const [data, setData] = useState<DailyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    async function loadDigest() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/feed/daily?date=${encodeURIComponent(date)}`, { signal: controller.signal })
        const payload = await response.json().catch(() => null) as (DailyResponse & { error?: { message?: string } }) | null
        if (!response.ok) throw new Error(payload?.error?.message || `加载失败 (${response.status})`)
        if (!payload?.data) throw new Error('日报响应不完整')
        setData(payload)
      } catch (caught) {
        if ((caught as Error).name !== 'AbortError') setError((caught as Error).message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    if (date) void loadDigest()
    else {
      setError('日期无效')
      setLoading(false)
    }
    return () => controller.abort()
  }, [date])

  if (loading) {
    return (
      <main className="mx-auto min-h-screen max-w-4xl px-4 py-10 sm:px-6" aria-busy="true">
        <div className="animate-pulse space-y-5" role="status" aria-label="正在加载日报">
          <div className="h-4 w-28 bg-muted" />
          <div className="h-10 w-2/3 bg-muted" />
          <div className="h-5 w-72 bg-muted" />
          <div className="mt-12 h-64 border-y border-border bg-muted/30" />
        </div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="mx-auto min-h-screen max-w-4xl px-4 py-12 sm:px-6">
        <Link className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" href="/feed/daily">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" /> 返回日报归档
        </Link>
        <div className="mt-12 border-y border-border py-12" role="alert">
          <h1 className="text-2xl font-bold">无法打开这期日报</h1>
          <p className="mt-3 text-sm text-muted-foreground">{error || '日报不存在'}</p>
          <button className="mt-6 border border-border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => window.location.reload()} type="button">
            重新加载
          </button>
        </div>
      </main>
    )
  }

  const { data: digest, navigation } = data

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <Link className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4" href="/feed/daily">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" /> 日报归档
          </Link>
          <Link className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4" href="/feed">
            完整精选流
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <article>
          <header className="pb-10 sm:pb-12">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-400">AI Daily · 第 {digest.issue} 期</p>
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">{formatDate(digest.date)}</h1>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2"><CalendarDays aria-hidden="true" className="h-4 w-4" />{digest.total} 篇精选</span>
              <span className="inline-flex items-center gap-2"><Clock3 aria-hidden="true" className="h-4 w-4" />预计阅读 {digest.estimatedReadMinutes} 分钟</span>
              <span>北京时间</span>
            </div>
            <p className="mt-7 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
              今天值得关注的 AI 进展已按主题压缩整理。评分来自自动化内容评估，推荐理由帮助你快速判断是否继续深入。
            </p>
          </header>

          {digest.total === 0 ? (
            <section className="border-y border-border py-14">
              <h2 className="text-xl font-semibold">这一天没有公开精选</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">可以通过前后日期继续浏览，或返回日报归档选择已有期次。</p>
            </section>
          ) : (
            SECTION_META.map((meta) => <Section articles={digest.sections[meta.key]} key={meta.key} meta={meta} />)
          )}
        </article>

        <nav aria-label="日报日期导航" className="mt-8 grid grid-cols-2 gap-3 border-t border-border pt-7">
          {navigation.previousDate ? (
            <Link className="group flex min-h-16 items-center gap-3 border border-border px-4 py-3 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/feed/daily/${navigation.previousDate}`}>
              <ArrowLeft aria-hidden="true" className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              <span><span className="block text-xs text-muted-foreground">前一期</span><span className="mt-1 block font-medium">{navigation.previousDate}</span></span>
            </Link>
          ) : <span className="flex min-h-16 items-center border border-dashed border-border px-4 text-sm text-muted-foreground">没有更早期次</span>}
          {navigation.nextDate ? (
            <Link className="group flex min-h-16 items-center justify-end gap-3 border border-border px-4 py-3 text-right text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/feed/daily/${navigation.nextDate}`}>
              <span><span className="block text-xs text-muted-foreground">后一期</span><span className="mt-1 block font-medium">{navigation.nextDate}</span></span>
              <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : <span className="flex min-h-16 items-center justify-end border border-dashed border-border px-4 text-right text-sm text-muted-foreground">已经是最新一期</span>}
        </nav>
      </main>
    </div>
  )
}
