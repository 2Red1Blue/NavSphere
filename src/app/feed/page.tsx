'use client'

export const runtime = 'edge'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { Article, FeedListResponse, FeedState } from '@/types/feed'
import { FeedList } from '@/components/feed/feed-list'
import { FeedSidebar } from '@/components/feed/feed-sidebar'
import { FeedSearch } from '@/components/feed/feed-search'
import { FeedSkeleton } from '@/components/feed/feed-skeleton'
import { FeedEmpty } from '@/components/feed/feed-empty'
import { FeedError } from '@/components/feed/feed-error'
import { Button } from '@/registry/new-york/ui/button'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'

const API_BASE = '/api/feed'
const DEFAULT_LIMIT = 20

export default function FeedPage() {
  const [state, setState] = useState<FeedState>({ status: 'loading' })
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedSource, setSelectedSource] = useState('all')
  const [minScore, setMinScore] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [allArticles, setAllArticles] = useState<Article[]>([])
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([])
  const [sources, setSources] = useState<{ name: string; count: number }[]>([])
  const [pagination, setPagination] = useState({ page: 1, limit: DEFAULT_LIMIT, total: 0, totalPages: 0 })
  const [loadingMore, setLoadingMore] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const fetchArticles = useCallback(
    async (pageNum: number, category: string, source: string, score: number, query: string, append = false) => {
      if (abortRef.current) abortRef.current.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        if (!append) setState({ status: 'loading' })
        else setLoadingMore(true)

        const params = new URLSearchParams({ page: String(pageNum), limit: String(DEFAULT_LIMIT) })
        if (category && category !== 'all') params.set('category', category)
        if (source && source !== 'all') params.set('source', source)
        if (score > 0) params.set('min_score', String(score))
        if (query) params.set('q', query)

        const res = await fetch(`${API_BASE}?${params.toString()}`, { signal: controller.signal })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: { message: 'Unknown error' } }))
          throw new Error(err.error?.message || `HTTP ${res.status}`)
        }

        const data: FeedListResponse = await res.json()

        if (append) {
          setAllArticles((prev) => [...prev, ...data.data])
        } else {
          setAllArticles(data.data)
        }
        setCategories(data.categories)
        setPagination(data.pagination)
        setPage(pageNum)

        if (data.data.length === 0 && data.pagination.total === 0) {
          setState({ status: 'empty' })
        } else {
          setState({ status: 'success', data: data.data, pagination: data.pagination, categories: data.categories })
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setState({ status: 'error', message: (err as Error).message })
      } finally {
        setLoadingMore(false)
      }
    },
    []
  )

  // Fetch sources separately
  useEffect(() => {
    fetch('/api/feed/stats')
      .then((r) => r.json())
      .then((d) => setSources(d.topSources || []))
      .catch(() => {})
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchArticles(1, selectedCategory, selectedSource, minScore, searchQuery)
  }, [selectedCategory, selectedSource, minScore, searchQuery, fetchArticles])

  const handleReset = useCallback(() => {
    setSelectedCategory('all')
    setSelectedSource('all')
    setMinScore(0)
    setSearchQuery('')
    setPage(1)
  }, [])

  const handleLoadMore = useCallback(() => {
    const nextPage = page + 1
    fetchArticles(nextPage, selectedCategory, selectedSource, minScore, searchQuery, true)
  }, [page, selectedCategory, selectedSource, minScore, searchQuery, fetchArticles])

  const hasMore = pagination.page < pagination.totalPages

  const renderContent = () => {
    switch (state.status) {
      case 'loading':
        return <FeedSkeleton />
      case 'empty':
        return <FeedEmpty />
      case 'error':
        return <FeedError message={state.message} onRetry={() => fetchArticles(1, 'all', 'all', 0, '')} />
      default:
        return null
    }
  }

  const showContent = state.status === 'success' || allArticles.length > 0

  return (
    <div className="flex min-h-screen">
      {/* Desktop Sidebar */}
      <div className="hidden md:block sticky top-0 h-screen border-r bg-background">
        <FeedSidebar
          categories={categories}
          sources={sources}
          selectedCategory={selectedCategory}
          selectedSource={selectedSource}
          minScore={minScore}
          onCategoryChange={setSelectedCategory}
          onSourceChange={setSelectedSource}
          onScoreChange={setMinScore}
          onReset={handleReset}
        />
      </div>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="fixed left-0 top-0 bottom-0 w-64 bg-background shadow-xl">
            <FeedSidebar
              categories={categories}
              sources={sources}
              selectedCategory={selectedCategory}
              selectedSource={selectedSource}
              minScore={minScore}
              onCategoryChange={(c) => { setSelectedCategory(c); setSidebarOpen(false) }}
              onSourceChange={(s) => { setSelectedSource(s); setSidebarOpen(false) }}
              onScoreChange={(s) => { setMinScore(s); setSidebarOpen(false) }}
              onReset={() => { handleReset(); setSidebarOpen(false) }}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        {/* Header */}
        <div className="sticky top-0 z-30 bg-background/90 backdrop-blur-sm border-b">
          <div className="px-4 sm:px-6 py-3">
            <div className="flex items-center gap-3">
              {/* Mobile menu button */}
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden shrink-0"
                onClick={() => setSidebarOpen(true)}
                aria-label="打开侧边栏"
              >
                <Menu className="h-5 w-5" />
              </Button>

              <a href="/" className="text-muted-foreground hover:text-foreground transition-colors shrink-0" aria-label="返回首页">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </a>

              <div className="flex-1 min-w-0">
                <h1 className="text-base font-semibold truncate">📰 Content OS 精选</h1>
                <p className="hidden sm:block text-xs text-muted-foreground">
                  AI 安全 · AI 工程 · 认知科学
                </p>
              </div>

              <div className="hidden sm:block w-48">
                <FeedSearch onSearch={setSearchQuery} />
              </div>
            </div>

            {/* Mobile search */}
            <div className="mt-2 sm:hidden">
              <FeedSearch onSearch={setSearchQuery} />
            </div>
          </div>
        </div>

        {/* Content area */}
        <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-2xl mx-auto">
          {/* Active filters indicator */}
          {(selectedCategory !== 'all' || selectedSource !== 'all' || minScore > 0) && (
            <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
              <span>筛选条件：</span>
              {selectedCategory !== 'all' && (
                <span className="bg-secondary px-2 py-0.5 rounded-full">{selectedCategory}</span>
              )}
              {selectedSource !== 'all' && (
                <span className="bg-secondary px-2 py-0.5 rounded-full">{selectedSource}</span>
              )}
              {minScore > 0 && (
                <span className="bg-secondary px-2 py-0.5 rounded-full">≥{minScore}分</span>
              )}
              <Button variant="ghost" size="sm" className="text-xs h-6" onClick={handleReset}>
                清除
              </Button>
            </div>
          )}

          {showContent ? (
            <>
              {allArticles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-sm text-muted-foreground">没有匹配的文章</p>
                  <Button variant="ghost" size="sm" className="mt-2" onClick={handleReset}>
                    清除筛选
                  </Button>
                </div>
              ) : (
                <>
                  <FeedList articles={allArticles} />
                  {hasMore && (
                    <div className="mt-8 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        className="min-w-[120px]"
                      >
                        {loadingMore ? '加载中...' : '加载更多'}
                      </Button>
                    </div>
                  )}
                  <p className="mt-4 text-center text-xs text-muted-foreground">
                    已显示 {allArticles.length} / {pagination.total} 篇
                  </p>
                </>
              )}
            </>
          ) : (
            renderContent()
          )}
        </div>
      </main>
    </div>
  )
}