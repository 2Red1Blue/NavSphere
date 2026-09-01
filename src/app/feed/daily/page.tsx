'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, CalendarDays, Clock3, Newspaper } from 'lucide-react'

interface ArchiveDay {
  date: string
  count: number
  issue: string
  estimatedReadMinutes: number
}

type ArchiveState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; days: ArchiveDay[] }

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(`${date}T00:00:00+08:00`))
}

export default function DailyArchivePage() {
  const [state, setState] = useState<ArchiveState>({ status: 'loading' })

  const loadArchive = useCallback(async (signal?: AbortSignal) => {
    setState({ status: 'loading' })
    try {
      const response = await fetch('/api/feed/daily', { signal })
      if (!response.ok) throw new Error(`加载失败 (${response.status})`)
      const payload = await response.json() as { data?: ArchiveDay[] }
      setState({ status: 'success', days: payload.data ?? [] })
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      setState({ status: 'error', message: (error as Error).message || '暂时无法加载日报' })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadArchive(controller.signal)
    return () => controller.abort()
  }, [loadArchive])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
          <Link
            href="/feed"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            返回精选流
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-16">
          <div>
            <div className="mb-9 max-w-2xl">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-400">
                Daily intelligence brief
              </p>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">AI 每日简报</h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
                每天不超过 8 条公开精选，按模型、产品、行业与技巧观点整理。约三分钟，先看结论，再决定深入阅读什么。
              </p>
            </div>

            {state.status === 'loading' ? (
              <div aria-label="正在加载日报" className="divide-y divide-border border-y" role="status">
                {[0, 1, 2, 3].map((item) => (
                  <div className="animate-pulse py-6" key={item}>
                    <div className="h-5 w-48 bg-muted" />
                    <div className="mt-3 h-4 w-64 bg-muted" />
                  </div>
                ))}
              </div>
            ) : state.status === 'error' ? (
              <div className="border-y border-border py-12" role="alert">
                <h2 className="text-lg font-semibold">日报暂时没有送达</h2>
                <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
                <button
                  className="mt-5 border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
                  onClick={() => void loadArchive()}
                  type="button"
                >
                  重新加载
                </button>
              </div>
            ) : state.days.length === 0 ? (
              <div className="border-y border-border py-14">
                <h2 className="text-lg font-semibold">第一期正在整理</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  当天有文章通过公开审核后，日报会自动出现在这里。你也可以先浏览完整精选流。
                </p>
                <Link className="mt-5 inline-flex text-sm font-medium underline underline-offset-4" href="/feed">
                  浏览精选流
                </Link>
              </div>
            ) : (
              <section aria-labelledby="archive-heading">
                <div className="mb-3 flex items-end justify-between gap-4">
                  <h2 className="text-sm font-semibold">近期归档</h2>
                  <span className="text-xs text-muted-foreground">Asia / Shanghai</span>
                </div>
                <ol className="divide-y divide-border border-y">
                  {state.days.map((day, index) => (
                    <li key={day.date}>
                      <Link
                        href={`/feed/daily/${day.date}`}
                        className="group grid gap-4 py-6 transition-colors hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:items-center sm:px-3"
                      >
                        <span className="text-sm font-semibold tabular-nums text-muted-foreground" aria-hidden="true">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span>
                          <span className="block text-lg font-semibold tracking-tight group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
                            {formatDate(day.date)}
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>第 {day.issue} 期</span>
                            <span>{Math.min(day.count, 8)} 篇精选</span>
                            <span>约 {day.estimatedReadMinutes} 分钟</span>
                          </span>
                        </span>
                        <ArrowUpRight aria-hidden="true" className="hidden h-5 w-5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 sm:block" />
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          <aside className="h-fit border-t border-border pt-6 lg:sticky lg:top-8" aria-label="日报说明">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">阅读方法</h2>
            <dl className="mt-5 space-y-5 text-sm">
              <div className="flex gap-3">
                <Newspaper aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div><dt className="font-medium">少而精</dt><dd className="mt-1 leading-6 text-muted-foreground">高分优先，稳定选取，不用无尽滚动。</dd></div>
              </div>
              <div className="flex gap-3">
                <Clock3 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div><dt className="font-medium">三分钟</dt><dd className="mt-1 leading-6 text-muted-foreground">摘要负责扫读，推荐理由解释为什么值得看。</dd></div>
              </div>
              <div className="flex gap-3">
                <CalendarDays aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div><dt className="font-medium">北京时间</dt><dd className="mt-1 leading-6 text-muted-foreground">所有期次按 Asia/Shanghai 业务日期归档。</dd></div>
              </div>
            </dl>
          </aside>
        </div>
      </main>
    </div>
  )
}
