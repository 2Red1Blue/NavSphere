'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { FeedMasthead } from '@/components/feed/feed-masthead'

interface HotTopic {
  topic: string
  count: number
}

interface HotSource {
  source: string
  category: string
  count: number
}

export default function HotPage() {
  const [topics, setTopics] = useState<HotTopic[]>([])
  const [sources, setSources] = useState<HotSource[]>([])
  const [loading, setLoading] = useState(true)
  const [timeWindow, setTimeWindow] = useState('48h')

  useEffect(() => {
    fetch('/api/hot-topics')
      .then(r => r.json())
      .then(data => {
        setTopics(data.topics || [])
        setSources(data.sources || [])
        setTimeWindow(data.timeWindow || '48h')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="feed-paper min-h-screen">
        <div className="mx-auto max-w-[90rem] px-4 py-12 sm:px-6 lg:px-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-48"></div>
            <div className="h-64 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="feed-paper min-h-screen">
      <FeedMasthead section="Radar / 热点雷达" />
      <main className="mx-auto max-w-[90rem] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <header className="feed-hairline grid gap-6 border-b pb-10 lg:grid-cols-[1fr_20rem] lg:items-end">
          <div><p className="feed-kicker">Live radar / {timeWindow}</p><h1 className="feed-display mt-3 text-6xl font-medium tracking-[-0.055em] sm:text-8xl">热点雷达</h1></div>
          <p className="feed-muted text-sm leading-7">不是热搜复刻。这里记录近期被多个来源反复提及、值得继续观察的主题与信号源。</p>
        </header>

        <div className="grid gap-14 py-10 lg:grid-cols-[1.25fr_.75fr] lg:gap-16">
        <section>
          <h2 className="feed-kicker mb-4">热门主题</h2>
          {topics.length === 0 ? (
            <div className="feed-hairline feed-muted border-y py-12">
              暂无热点数据
            </div>
          ) : (
            <ol className="feed-hairline border-t">
              {topics.map((item, index) => (
                <Link
                  key={item.topic}
                  href={`/feed?topic=${encodeURIComponent(item.topic)}`}
                  className="feed-hairline group grid grid-cols-[3rem_1fr_auto] items-center gap-4 border-b py-5 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))]"
                >
                  <span className={`feed-display text-3xl italic tabular-nums ${index < 3 ? 'feed-accent' : 'feed-muted'}`}>{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <h3 className="feed-display truncate text-2xl font-medium tracking-[-0.025em] transition-colors group-hover:text-[hsl(var(--feed-accent))] sm:text-3xl">
                      {item.topic}
                    </h3>
                  </div>
                  <span className="feed-muted flex items-center gap-2 text-xs">{item.count} 篇 <ArrowUpRight className="h-3.5 w-3.5" /></span>
                </Link>
              ))}
            </ol>
          )}
        </section>

        {/* Sources Section */}
        <section>
          <h2 className="feed-kicker mb-4">活跃来源</h2>
          {sources.length === 0 ? (
            <div className="feed-hairline feed-muted border-y py-12">
              暂无数据
            </div>
          ) : (
            <ol className="feed-hairline border-t">
              {sources.slice(0, 20).map((item, index) => (
                <Link
                  key={`${item.source}-${item.category}`}
                  href={`/feed?source=${encodeURIComponent(item.source)}`}
                  className="feed-hairline group grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b py-4 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))]"
                >
                  <span className="feed-muted feed-display italic">{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold transition-colors group-hover:text-[hsl(var(--feed-accent))]">
                      {item.source}
                    </h3>
                    <p className="feed-muted mt-1 text-xs">{item.category}</p>
                  </div>
                  <span className="feed-muted text-xs">{item.count}</span>
                </Link>
              ))}
            </ol>
          )}
        </section>
        </div>
      </main>
    </div>
  )
}
