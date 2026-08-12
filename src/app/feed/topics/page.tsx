'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Tags, ArrowLeft } from 'lucide-react'

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
            <Tags className="h-6 w-6" />
            主题索引
          </h1>
          <span className="text-sm text-muted-foreground">{topics.length} 个主题</span>
        </div>

        {/* Topics Grid */}
        {topics.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            暂无主题数据
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((topic) => (
              <Link
                key={topic.name}
                href={`/feed?topic=${encodeURIComponent(topic.name)}`}
                className="group p-6 rounded-lg border bg-card hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between">
                  <h3 className="font-medium group-hover:text-primary transition-colors">
                    {topic.name}
                  </h3>
                  <span className="text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    {topic.count}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
