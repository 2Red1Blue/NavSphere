'use client'

import { Suspense, useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Article, FeedListResponse, FeedState } from '@/types/feed'
import TimelineList from '@/components/feed/timeline-list'
import SidebarNav from '@/components/feed/sidebar-nav'
import { FeedSkeleton } from '@/components/feed/feed-skeleton'
import { FeedEmpty } from '@/components/feed/feed-empty'
import { FeedError } from '@/components/feed/feed-error'
import { Button } from '@/registry/new-york/ui/button'
import { ArrowUpRight, Menu, Search, X } from 'lucide-react'

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

  useEffect(() => {
    if (!mobileMenuOpen) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileMenuOpen])

  const handleLoadMore = useCallback(() => {
    fetchArticles(page + 1, true)
  }, [page, fetchArticles])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchArticles(1)
  }

  const hasMore = pagination.page < pagination.totalPages
  const showContent = state.status === 'success' || allArticles.length > 0
  const pageTitle = featured ? '本周精选' : topic ? topic : '今日信号'
  const pageNote = featured
    ? '编辑部从近期内容中挑出的高密度读物。'
    : topic
      ? `正在浏览「${topic}」相关的公开内容与独立编辑稿。`
      : '从模型、产品与研究噪声里，留下值得继续读的部分。'

  return (
    <div className="feed-paper min-h-screen selection:bg-orange-200/70 selection:text-stone-950 dark:selection:bg-orange-800/70 dark:selection:text-stone-50">
      <header className="feed-hairline sticky top-0 z-30 border-b bg-[hsl(var(--feed-paper)/0.94)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[90rem] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-ml-2 rounded-full lg:hidden"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label={mobileMenuOpen ? '关闭栏目与筛选' : '打开栏目与筛选'}
              aria-expanded={mobileMenuOpen}
              aria-controls="feed-mobile-navigation"
            >
              <Menu className="h-5 w-5" />
            </Button>

          <Link href="/feed" className="group mr-auto flex items-baseline gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-orange-600">
            <span className="feed-display text-xl font-semibold tracking-[-0.04em] sm:text-2xl">信号志</span>
            <span className="feed-kicker hidden group-hover:text-[hsl(var(--feed-ink))] sm:inline">NavSphere Signals</span>
          </Link>

          <nav className="hidden items-center gap-1 text-sm lg:flex" aria-label="Feed 主导航">
            {[
              ['/feed?featured=true', '精选'],
              ['/feed/daily', '日报'],
              ['/feed/hot', '热点'],
              ['/feed/topics', '主题'],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="feed-muted rounded-full px-3 py-1.5 transition-colors hover:bg-black/5 hover:text-[hsl(var(--feed-ink))] dark:hover:bg-white/5">
                {label}
              </Link>
            ))}
          </nav>

            <form onSubmit={handleSearch} className="w-[min(15rem,42vw)] sm:w-64">
              <div className="relative">
                <Search className="feed-muted absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索信号"
                  aria-label="搜索文章"
                  className="feed-hairline h-9 w-full rounded-full border bg-transparent pl-9 pr-4 text-sm outline-none transition-colors placeholder:text-[hsl(var(--feed-muted))] focus:border-[hsl(var(--feed-accent))] focus:ring-2 focus:ring-[hsl(var(--feed-accent)/0.16)]"
                />
              </div>
            </form>
        </div>
      </header>

      <section className="feed-hairline border-b">
        <div className="mx-auto grid max-w-[90rem] gap-6 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end lg:px-8">
          <div>
            <p className="feed-kicker">Issue / {new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date())}</p>
            <h1 className="feed-display mt-3 max-w-4xl text-5xl font-medium leading-[0.95] tracking-[-0.055em] text-balance sm:text-7xl">
              {pageTitle}
            </h1>
          </div>
          <div className="lg:pb-1">
            <p className="max-w-md text-sm leading-7 text-[hsl(var(--feed-muted))] sm:text-base">{pageNote}</p>
            <div className="feed-hairline mt-5 flex items-center justify-between border-t pt-3 text-xs tabular-nums text-[hsl(var(--feed-muted))]">
              <span>{pagination.total ? `${pagination.total} 篇馆藏` : '正在整理馆藏'}</span>
              <Link href="/feed/daily" className="group inline-flex items-center gap-1 font-semibold text-[hsl(var(--feed-ink))]">
                阅读今日简报 <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[90rem] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12 lg:px-8 lg:py-12">
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

          {mobileMenuOpen && (
            <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="栏目与筛选">
              <button type="button" className="fixed inset-0 cursor-default bg-stone-950/45 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} aria-label="关闭栏目与筛选" />
              <div id="feed-mobile-navigation" className="feed-drawer feed-paper fixed bottom-0 left-0 top-0 w-[min(21rem,88vw)] overflow-y-auto border-r border-[hsl(var(--feed-line))] p-4 shadow-2xl">
                <div className="mb-4 flex items-center justify-between px-2">
                  <span className="feed-display text-xl font-semibold">阅览索引</span>
                  <Button type="button" autoFocus variant="ghost" size="icon" className="rounded-full" onClick={() => setMobileMenuOpen(false)} aria-label="关闭栏目与筛选">
                    <X className="h-5 w-5" />
                  </Button>
                </div>
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

          <main className="min-w-0" id="main-content">
            {showContent ? (
              <>
                <TimelineList articles={allArticles} />
                {hasMore && (
                  <div className="feed-hairline mt-10 border-t pt-8 text-center">
                    <Button
                      variant="outline"
                      className="feed-hairline rounded-full bg-transparent px-6 hover:bg-[hsl(var(--feed-ink))] hover:text-[hsl(var(--feed-paper))]"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                    >
                      {loadingMore ? '加载中...' : '加载更多'}
                    </Button>
                  </div>
                )}
                <p className="mt-4 text-center text-xs tabular-nums text-[hsl(var(--feed-muted))]">
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
  )
}

export default function FeedPage() {
  return (
    <Suspense fallback={<div className="feed-paper min-h-screen px-4 py-16 sm:px-6"><div className="mx-auto max-w-[90rem]"><FeedSkeleton /></div></div>}>
      <FeedContent />
    </Suspense>
  )
}
