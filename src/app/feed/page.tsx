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
import { ArrowUpRight, Menu, Search, X, Rows3, AlignLeft } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { FeedThemeToggle } from '@/components/feed/theme-toggle'
import { TopicDiscovery } from '@/components/feed/topic-discovery'
import { parseFeedTopics, type FeedTopic } from '@/lib/topic-explorer'

const API_BASE = '/api/feed'
const DEFAULT_LIMIT = 20

function FeedContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  
  const [state, setState] = useState<FeedState>({ status: 'loading' })
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [compact, setCompact] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [page, setPage] = useState(1)
  const [allArticles, setAllArticles] = useState<Article[]>([])
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([])
  const [types, setTypes] = useState<{ name: string; count: number }[]>([])
  const [topics, setTopics] = useState<FeedTopic[]>([])
  const [pagination, setPagination] = useState({ page: 1, limit: DEFAULT_LIMIT, total: 0, totalPages: 0 })
  const [loadingMore, setLoadingMore] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const featured = searchParams.get('featured') === 'true'
  const topic = searchParams.get('topic') || ''
  const source = searchParams.get('source') || ''
  const selectedCategory = searchParams.get('category') || 'all'
  const selectedType = searchParams.get('type') || 'all'

  const fetchArticles = useCallback(
    async (pageNum: number, append = false) => {
      if (abortRef.current) abortRef.current.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        if (!append) {
          setState({ status: 'loading' })
          setAllArticles([])
        }
        else setLoadingMore(true)

        const params = new URLSearchParams({ page: String(pageNum), limit: String(DEFAULT_LIMIT) })
        if (featured) params.set('featured', 'true')
        if (topic) params.set('topic', topic)
        if (source) params.set('source', source)
        if (selectedCategory !== 'all') params.set('category', selectedCategory)
        if (selectedType !== 'all') params.set('type', selectedType)
        if (searchQuery) params.set('q', searchQuery)

        const res = await fetch(`${API_BASE}?${params.toString()}`, { signal: controller.signal })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: { message: 'Unknown error' } }))
          throw new Error(err.error?.message || `HTTP ${res.status}`)
        }

        const data: FeedListResponse = await res.json()
        if (controller.signal.aborted) return

        if (append) {
          setAllArticles((prev) => [...prev, ...data.data])
        } else {
          setAllArticles(data.data)
        }
        setCategories(data.categories || [])
        setTypes(data.types || [])
        setTopics(parseFeedTopics(data.topics))
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
        if (!controller.signal.aborted) setLoadingMore(false)
      }
    },
    [featured, topic, source, selectedCategory, selectedType, searchQuery]
  )

  useEffect(() => {
    void fetchArticles(1)
    return () => abortRef.current?.abort()
  }, [fetchArticles])

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const changeFilter = (key: 'category' | 'type', value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') params.delete(key)
    else params.set(key, value)
    router.push(`/feed?${params.toString()}`, { scroll: false })
    setMobileMenuOpen(false)
  }


  const handleLoadMore = useCallback(() => {
    fetchArticles(page + 1, true)
  }, [page, fetchArticles])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery === searchInput.trim()) void fetchArticles(1)
    else setSearchQuery(searchInput.trim())
  }

  const hasMore = pagination.page < pagination.totalPages
  const showContent = state.status === 'success' || allArticles.length > 0
  const pageTitle = featured ? '精选' : topic ? topic : '最新动态'
  const pageNote = featured
    ? '经过筛选的 AI 新闻、研究与工具。'
    : topic
      ? `正在浏览「${topic}」相关的公开内容与独立编辑稿。`
      : 'AI 新闻、研究与工具，按时间更新。'

  return (
    <Dialog.Root open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
    <div className="feed-paper min-h-screen selection:bg-emerald-200/70 selection:text-stone-950 dark:selection:bg-emerald-800/70 dark:selection:text-stone-50">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:p-3">跳至文章列表</a>
      <header className="feed-hairline sticky top-0 z-30 border-b bg-[hsl(var(--feed-paper)/0.94)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[76rem] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <Dialog.Trigger asChild><Button
              type="button"
              variant="ghost"
              size="icon"
              className="-ml-2 rounded-full lg:hidden"
              aria-label={mobileMenuOpen ? '关闭栏目与筛选' : '打开栏目与筛选'}
              aria-expanded={mobileMenuOpen}
              aria-controls="feed-mobile-navigation"
            >
              <Menu className="h-5 w-5" />
            </Button></Dialog.Trigger>

          <Link href="/feed" className="group mr-auto flex items-baseline gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))]">
            <span className="cyber-wordmark feed-display text-xl font-semibold tracking-[-0.035em]">NavSphere<span aria-hidden="true" className="cyber-wordmark-slash">{'//'}</span></span>
            <span className="feed-kicker hidden group-hover:text-[hsl(var(--feed-ink))] sm:inline">AI 资讯</span>
          </Link>



            <form onSubmit={handleSearch} className="min-w-0 flex-1 sm:max-w-72">
              <div className="relative">
                <Search className="feed-muted absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
                <input
                  type="text"
                  ref={searchRef}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="搜索文章 /"
                  aria-label="搜索文章"
                  className="feed-hairline h-10 w-full rounded-lg border bg-transparent pl-9 pr-4 text-sm outline-none transition-colors placeholder:text-[hsl(var(--feed-muted))] focus:border-[hsl(var(--feed-accent))] focus:ring-2 focus:ring-[hsl(var(--feed-accent)/0.16)]"
                />
              </div>
            </form>
          <FeedThemeToggle />
        </div>
      </header>



      <div className="mx-auto grid max-w-[76rem] gap-8 px-4 py-7 sm:px-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:py-8">
          <SidebarNav
            categories={categories} types={types}
            selectedCategory={selectedCategory} selectedType={selectedType}
            onCategoryChange={(value) => changeFilter('category', value)}
            onTypeChange={(value) => changeFilter('type', value)}
          />
          <Dialog.Portal>
            <Dialog.Overlay className="feed-overlay fixed inset-0 z-40 bg-slate-950/40" />
            <Dialog.Content id="feed-mobile-navigation" aria-describedby={undefined} className="feed-drawer feed-paper fixed inset-y-0 left-0 z-50 w-[min(21rem,88vw)] overflow-y-auto border-r border-[hsl(var(--feed-line))] p-5 shadow-xl">
              <div className="mb-5 flex items-center justify-between">
                <Dialog.Title className="text-lg font-semibold">浏览与筛选</Dialog.Title>
                <Dialog.Close className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))]" aria-label="关闭栏目与筛选"><X className="h-5 w-5" /></Dialog.Close>
              </div>
              <SidebarNav categories={categories} types={types} selectedCategory={selectedCategory} selectedType={selectedType}
                onCategoryChange={(value) => changeFilter('category', value)}
                onTypeChange={(value) => changeFilter('type', value)} />
            </Dialog.Content>
          </Dialog.Portal>

          <main className="min-w-0" id="main-content">
            <div className="cyber-page-intro mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="feed-display text-[28px] font-semibold leading-tight tracking-[-0.025em] sm:text-[32px]">{pageTitle}</h1>
                <p className="feed-muted mt-2 text-sm leading-6">{pageNote}</p>
              </div>
              <Link href="/feed/daily" className="feed-accent inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--feed-accent)/.2)] bg-[hsl(var(--feed-surface))] px-3 py-2 text-xs font-medium">
                阅读日报 <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
            {!featured && !topic && !source && selectedCategory === 'all' && selectedType === 'all' && !searchQuery && <TopicDiscovery topics={topics} />}
            <div className="feed-hairline mb-5 flex items-center justify-between gap-3 border-b pb-4">
              <p className="feed-muted text-xs" role="status" aria-live="polite">{state.status === 'loading' ? '正在更新…' : `${pagination.total} 篇文章`}</p>
              <div className="relative flex rounded-lg bg-[hsl(var(--feed-ink)/.05)] p-1" role="group" aria-label="阅读密度">
                <span aria-hidden="true" className="feed-density-indicator absolute inset-y-1 left-1 w-[calc((100%-8px)/2)] rounded-md bg-[hsl(var(--feed-surface))] shadow-sm" style={{ transform: compact ? 'translateX(100%)' : 'translateX(0)' }} />
                {[{ value: false, label: '阅读', Icon: AlignLeft }, { value: true, label: '速览', Icon: Rows3 }].map(({ value, label, Icon }) => (
                  <button key={label} type="button" aria-pressed={compact === value} onClick={() => setCompact(value)} className="relative z-10 inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))]"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}</button>
                ))}
              </div>
            </div>
            {(selectedCategory !== 'all' || selectedType !== 'all') && <div className="mb-4 flex flex-wrap gap-2" aria-label="已选筛选">
              {selectedCategory !== 'all' && <button className="feed-filter-chip" onClick={() => changeFilter('category', 'all')}>清除领域筛选 <X className="h-3 w-3" aria-hidden="true" /></button>}
              {selectedType !== 'all' && <button className="feed-filter-chip" onClick={() => changeFilter('type', 'all')}>清除类型筛选 <X className="h-3 w-3" aria-hidden="true" /></button>}
            </div>}
            {state.status === 'error' && allArticles.length > 0 && <FeedError message={state.message} onRetry={handleLoadMore} />}
            {showContent ? (
              <>
                <TimelineList articles={allArticles} compact={compact} />
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
    </Dialog.Root>
  )
}

export default function FeedPage() {
  return (
    <Suspense fallback={<div className="feed-paper min-h-screen px-4 py-16 sm:px-6"><div className="mx-auto max-w-[76rem]"><FeedSkeleton /></div></div>}>
      <FeedContent />
    </Suspense>
  )
}
