'use client'

import { Suspense, useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { Article, FeedListResponse, FeedState } from '@/types/feed'
import TimelineList from '@/components/feed/timeline-list'
import SidebarNav from '@/components/feed/sidebar-nav'
import { FeedSkeleton } from '@/components/feed/feed-skeleton'
import { FeedEmpty } from '@/components/feed/feed-empty'
import { FeedError } from '@/components/feed/feed-error'
import { Button } from '@/registry/new-york/ui/button'
import { Menu, Search } from 'lucide-react'

const API_BASE = '/api/feed'
const DEFAULT_LIMIT = 20

function FeedContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  
  const [state, setState] = useState<FeedState>({ status: 'loading' })
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [allArticles, setAllArticles] = useState<Article[]>([])
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([])
  const [types, setTypes] = useState<{ name: string; count: number }[]>([])
  const [pagination, setPagination] = useState({ page: 1, limit: DEFAULT_LIMIT, total: 0, totalPages: 0 })
  const [loadingMore, setLoadingMore] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const featured = searchParams.get('featured') === 'true'
  const topic = searchParams.get('topic') || ''
  const selectedCategory = searchParams.get('category') || 'all'
  const selectedType = searchParams.get('type') || 'all'

  const fetchArticles = useCallback(
    async (pageNum: number, append = false) => {
      if (abortRef.current) abortRef.current.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        if (!append) setState({ status: 'loading' })
        else setLoadingMore(true)

        const params = new URLSearchParams({ page: String(pageNum), limit: String(DEFAULT_LIMIT) })
        if (featured) params.set('featured', 'true')
        if (topic) params.set('topic', topic)
        if (selectedCategory !== 'all') params.set('category', selectedCategory)
        if (selectedType !== 'all') params.set('type', selectedType)
        if (searchQuery) params.set('q', searchQuery)

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
        setCategories(data.categories || [])
        setTypes(data.types || [])
        setPagination(data.pagination)
        setPage(pageNum)

        if (data.data.length === 0 && data.pagination.total === 0) {
          setState({ status: 'empty' })
        } else {
          setState({ status: 'success', data: data.data, pagination: data.pagination, categories: [] })
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setState({ status: 'error', message: (err as Error).message })
      } finally {
        setLoadingMore(false)
      }
    },
    [featured, topic, selectedCategory, selectedType, searchQuery]
  )

  useEffect(() => {
    fetchArticles(1)
  }, [fetchArticles])

  const handleLoadMore = useCallback(() => {
    fetchArticles(page + 1, true)
  }, [page, fetchArticles])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchArticles(1)
  }

  const hasMore = pagination.page < pagination.totalPages
  const showContent = state.status === 'success' || allArticles.length > 0

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <Menu className="h-5 w-5" />
            </Button>

            <h1 className="text-xl font-bold">
              {featured ? '⭐ 精选' : topic ? `主题: ${topic}` : '全部文章'}
            </h1>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1 max-w-md ml-auto">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索文章..."
                  className="w-full pl-10 pr-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </form>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex gap-8">
          {/* Sidebar */}
          <SidebarNav 
            categories={categories}
            types={types}
            selectedCategory={selectedCategory}
            selectedType={selectedType}
            onCategoryChange={(cat) => {
              const params = new URLSearchParams(searchParams.toString())
              if (cat === 'all') {
                params.delete('category')
              } else {
                params.set('category', cat)
              }
              router.push(`/feed?${params.toString()}`)
            }}
            onTypeChange={(type) => {
              const params = new URLSearchParams(searchParams.toString())
              if (type === 'all') {
                params.delete('type')
              } else {
                params.set('type', type)
              }
              router.push(`/feed?${params.toString()}`)
            }}
          />

          {/* Mobile menu overlay */}
          {mobileMenuOpen && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <div className="fixed inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
              <div className="fixed left-0 top-0 bottom-0 w-64 bg-background shadow-xl">
                <SidebarNav 
                  categories={categories}
                  types={types}
                  selectedCategory={selectedCategory}
                  selectedType={selectedType}
                  onCategoryChange={(cat) => {
                    const params = new URLSearchParams(searchParams.toString())
                    if (cat === 'all') {
                      params.delete('category')
                    } else {
                      params.set('category', cat)
                    }
                    router.push(`/feed?${params.toString()}`)
                  }}
                  onTypeChange={(type) => {
                    const params = new URLSearchParams(searchParams.toString())
                    if (type === 'all') {
                      params.delete('type')
                    } else {
                      params.set('type', type)
                    }
                    router.push(`/feed?${params.toString()}`)
                  }}
                />
              </div>
            </div>
          )}

          {/* Timeline content */}
          <main className="flex-1 min-w-0">
            {showContent ? (
              <>
                <TimelineList articles={allArticles} />
                {hasMore && (
                  <div className="mt-8 text-center">
                    <Button
                      variant="outline"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                    >
                      {loadingMore ? '加载中...' : '加载更多'}
                    </Button>
                  </div>
                )}
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  已显示 {allArticles.length} / {pagination.total} 篇
                </p>
              </>
            ) : state.status === 'loading' ? (
              <FeedSkeleton />
            ) : state.status === 'empty' ? (
              <FeedEmpty />
            ) : state.status === 'error' ? (
              <FeedError message={state.message} onRetry={() => fetchArticles(1)} />
            ) : null}
          </main>
        </div>
      </div>
    </div>
  )
}

export default function FeedPage() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <FeedContent />
    </Suspense>
  )
}
