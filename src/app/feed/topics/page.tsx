'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { FeedMasthead } from '@/components/feed/feed-masthead'

interface Topic {
  name: string
  count: number
}

export default function TopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/feed')
      .then(r => r.json())
      .then(data => {
        setTopics(data.topics || [])
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
      <FeedMasthead section="Index / 主题索引" />
      <main className="mx-auto max-w-[90rem] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <header className="feed-hairline grid gap-6 border-b pb-10 lg:grid-cols-[1fr_20rem] lg:items-end">
          <div><p className="feed-kicker">Index / {topics.length} topics</p><h1 className="feed-display mt-3 text-6xl font-medium tracking-[-0.055em] sm:text-8xl">主题索引</h1></div>
          <p className="feed-muted text-sm leading-7">用主题进入馆藏，不被发布时间绑架。每个词条都是一条可以继续追踪的认知路径。</p>
        </header>

        {/* Topics Grid */}
        {topics.length === 0 ? (
          <div className="feed-hairline feed-muted border-b py-12">
            暂无主题数据
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((topic, index) => (
              <Link
                key={topic.name}
                href={`/feed?topic=${encodeURIComponent(topic.name)}`}
                className="feed-hairline group min-h-44 border-b p-6 outline-none transition-colors hover:bg-[hsl(var(--feed-ink)/.035)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))] sm:border-r lg:min-h-56"
              >
                <div className="flex h-full flex-col justify-between gap-8">
                  <div className="flex items-start justify-between gap-4"><span className="feed-display feed-muted text-2xl italic">{String(index + 1).padStart(2, '0')}</span><ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-1 group-hover:translate-x-1 motion-reduce:transform-none" /></div>
                  <div><h3 className="feed-display text-3xl font-medium tracking-[-0.03em] transition-colors group-hover:text-[hsl(var(--feed-accent))]">
                    {topic.name}
                  </h3><span className="feed-muted mt-2 block text-xs">{topic.count} 篇馆藏</span></div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
