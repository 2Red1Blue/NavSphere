'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { TrendingUp, ArrowLeft } from 'lucide-react'

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
      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-48"></div>
            <div className="h-64 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/feed" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6" />
            热点榜
          </h1>
          <span className="text-sm text-muted-foreground">过去 {timeWindow}</span>
        </div>

        {/* Topics Section */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">热门主题</h2>
          {topics.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              暂无热点数据
            </div>
          ) : (
            <div className="grid gap-3">
              {topics.map((item, index) => (
                <Link
                  key={item.topic}
                  href={`/feed?topic=${encodeURIComponent(item.topic)}`}
                  className="group flex items-center gap-4 p-4 rounded-lg border bg-card hover:shadow-md transition-all"
                >
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    index < 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium group-hover:text-primary transition-colors truncate">
                      {item.topic}
                    </h3>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {item.count} 篇
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Sources Section */}
        <section>
          <h2 className="text-lg font-semibold mb-4">活跃来源</h2>
          {sources.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              暂无数据
            </div>
          ) : (
            <div className="grid gap-3">
              {sources.slice(0, 20).map((item, index) => (
                <Link
                  key={`${item.source}-${item.category}`}
                  href={`/feed?source=${encodeURIComponent(item.source)}`}
                  className="group flex items-center gap-4 p-4 rounded-lg border bg-card hover:shadow-md transition-all"
                >
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    index < 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium group-hover:text-primary transition-colors truncate">
                      {item.source}
                    </h3>
                    <p className="text-xs text-muted-foreground">{item.category}</p>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {item.count} 篇
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
