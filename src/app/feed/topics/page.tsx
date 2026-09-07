'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Boxes, ChevronLeft, ChevronRight, List, Search } from 'lucide-react'
import { FeedMasthead } from '@/components/feed/feed-masthead'
import { TopicSpace } from '@/components/feed/topic-space'
import { parseFeedTopics, topicFeedUrl, topicPageUrl, type FeedTopic } from '@/lib/topic-explorer'
import { formatShanghaiTime } from '@/lib/feed-view'
import type { Article } from '@/types/feed'

type ReadingState = { topic: string; status: 'loading' } | { topic: string; status: 'error' } | { topic: string; status: 'ready'; articles: Article[] }
type CachedArticles = { time: number; articles: Article[] }

function TopicExplorer() {
  const router = useRouter()
  const params = useSearchParams()
  const [topics, setTopics] = useState<FeedTopic[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [retry, setRetry] = useState(0)
  const [readingRetry, setReadingRetry] = useState(0)
  const [reading, setReading] = useState<ReadingState>({ topic: '', status: 'loading' })
  const [view, setView] = useState<'space' | 'list'>('space')
  const [query, setQuery] = useState('')
  const cache = useRef(new Map<string, CachedArticles>())
  const readingPane = useRef<HTMLElement>(null)
  const previousTopic = useRef('')
  const pendingScrollTopic = useRef('')
  const requested = params.get('topic') || ''
  const selected = topics.find(topic => topic.name === requested) || topics[0]
  const selectedName = selected?.name || ''
  const groupIndex = Math.max(0, Math.floor(topics.findIndex(topic => topic.name === selectedName) / 6))
  const groupCount = Math.ceil(topics.length / 6)
  const visibleTopics = topics.slice(groupIndex * 6, groupIndex * 6 + 6)
  const filteredTopics = useMemo(() => topics.filter(topic => topic.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [topics, query])

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    fetch('/api/feed?limit=1', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('topics unavailable')
        const result = await response.json()
        if (!Array.isArray(result.topics)) throw new Error('invalid topics')
        if (!controller.signal.aborted) { setTopics(parseFeedTopics(result.topics)); setStatus('ready') }
      })
      .catch(() => { if (!controller.signal.aborted) setStatus('error') })
    return () => controller.abort()
  }, [retry])

  useEffect(() => {
    if (!selectedName) return
    const cached = cache.current.get(selectedName)
    if (cached && Date.now() - cached.time < 60_000) {
      setReading({ topic: selectedName, status: 'ready', articles: cached.articles })
      return
    }
    const controller = new AbortController()
    setReading({ topic: selectedName, status: 'loading' })
    fetch(topicFeedUrl(selectedName), { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('articles unavailable')
        const result = await response.json()
        if (!Array.isArray(result.data)) throw new Error('invalid articles')
        if (controller.signal.aborted) return
        const articles = result.data as Article[]
        if (cache.current.size >= 20) cache.current.delete(cache.current.keys().next().value!)
        cache.current.set(selectedName, { time: Date.now(), articles })
        setReading({ topic: selectedName, status: 'ready', articles })
      })
      .catch(() => { if (!controller.signal.aborted) setReading({ topic: selectedName, status: 'error' }) })
    return () => controller.abort()
  }, [selectedName, readingRetry])

  useEffect(() => {
    if (previousTopic.current && previousTopic.current !== selectedName) {
      pendingScrollTopic.current = matchMedia('(max-width: 900px)').matches ? selectedName : ''
    }
    previousTopic.current = selectedName
  }, [selectedName])

  useEffect(() => {
    if (pendingScrollTopic.current === selectedName && reading.topic === selectedName && reading.status !== 'loading') {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.feedEffects === 'off'
      readingPane.current?.focus({ preventScroll: true })
      readingPane.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
      pendingScrollTopic.current = ''
    }
  }, [selectedName, reading])

  const visibleReading: ReadingState = reading.topic === selectedName ? reading : { topic: selectedName, status: 'loading' }

  const select = (name: string) => {
    if (name === selectedName && matchMedia('(max-width: 900px)').matches) {
      readingPane.current?.focus({ preventScroll: true })
      readingPane.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
    }
    router.replace(topicPageUrl(name), { scroll: false })
  }

  return (
    <div className="feed-paper min-h-screen">
      <FeedMasthead section="专题" />
      <main className="topic-explorer-shell" id="main-content">
        <header className="topic-explorer-heading">
          <div><p className="feed-kicker mb-2">按兴趣，深入一步</p><h1 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">发现专题</h1></div>
          <p className="feed-muted max-w-sm text-sm leading-7">从一个主题开始，把值得读的报道放在一起。<br className="hidden sm:block" />选择空间中的专题，或直接浏览列表。</p>
        </header>

        <div className="topic-explorer-toolbar">
          <div className="topic-view-switch" role="group" aria-label="专题浏览方式">
            <button type="button" aria-pressed={view === 'space'} onClick={() => { setView('space'); setQuery('') }}><Boxes className="h-4 w-4" aria-hidden="true" />空间</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><List className="h-4 w-4" aria-hidden="true" />列表</button>
          </div>
          <label className="topic-search"><Search className="h-4 w-4" aria-hidden="true" /><span className="sr-only">搜索专题</span><input value={query} onChange={event => { setQuery(event.target.value); if (event.target.value) setView('list') }} placeholder="搜索专题" /></label>
          <span className="feed-muted ml-auto hidden text-xs sm:block">{status === 'ready' ? `${topics.length} 个专题` : '正在读取专题'}</span>
        </div>

        {status === 'loading' ? <div className="topic-explorer-loading" role="status">正在加载专题…</div>
          : status === 'error' ? <div className="topic-explorer-loading" role="alert"><p>暂时无法加载专题，请稍后重试。</p><button className="topic-text-button mt-4" onClick={() => setRetry(retry + 1)}>重新加载</button></div>
          : topics.length === 0 ? <div className="topic-explorer-loading"><p>还没有可公开展示的专题。</p><Link href="/feed" className="topic-text-button mt-4">浏览最新动态</Link></div>
          : <div className="topic-explorer-layout">
            <div className="min-w-0">
              {view === 'space' ? <>
                <TopicSpace topics={visibleTopics} selected={selectedName} onSelect={select} />
                <div className="topic-space-pagination"><span>{groupIndex + 1} / {groupCount} 组</span><div className="flex gap-2">
                  <button aria-label="上一组专题" disabled={groupIndex === 0} onClick={() => select(topics[(groupIndex - 1) * 6].name)}><ChevronLeft className="h-4 w-4" /></button>
                  <button aria-label="下一组专题" disabled={groupIndex + 1 >= groupCount} onClick={() => select(topics[(groupIndex + 1) * 6].name)}><ChevronRight className="h-4 w-4" /></button>
                </div></div>
              </> : <div className="topic-index" aria-label="全部专题">
                {filteredTopics.length ? filteredTopics.map((topic, index) => <button key={topic.name} type="button" aria-pressed={selectedName === topic.name} onClick={() => select(topic.name)}>
                  <span className="topic-index-number">{String(index + 1).padStart(2, '0')}</span><span className="flex-1"><strong>{topic.name}</strong><small>{topic.count} 篇文章</small></span><ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </button>) : <p className="feed-muted p-6 text-sm">没有匹配的专题，试试其他关键词。</p>}
              </div>}
            </div>

            {selected && <section ref={readingPane} tabIndex={-1} className="topic-reading-pane" aria-label="专题文章" aria-busy={visibleReading.status === 'loading'}>
              <header className="topic-reading-heading"><p className="feed-kicker mb-3">当前专题</p><div className="flex items-baseline justify-between gap-4"><h2 className="text-2xl font-semibold">{selected.name}</h2><span className="feed-muted shrink-0 text-xs">{selected.count} 篇</span></div><p className="feed-muted mt-2 text-xs">最新收录 · 公开内容</p></header>
              <div className="topic-reading-body">
                {visibleReading.status === 'loading' ? <p role="status" className="feed-muted py-6 text-sm">正在加载相关文章…</p>
                  : visibleReading.status === 'error' ? <div role="alert" className="py-6 text-sm"><p>相关文章暂时加载失败。</p><button className="topic-text-button mt-3" onClick={() => setReadingRetry(readingRetry + 1)}>重试文章</button></div>
                  : visibleReading.articles.length === 0 ? <p className="feed-muted py-6 text-sm">当前没有可展示的相关文章。</p>
                  : visibleReading.articles.map(article => <article key={article.url_hash} className="topic-reading-article"><Link href={`/feed/${article.url_hash}`}>
                    <p className="feed-muted mb-2 text-xs">{article.source} · <time dateTime={article.discovered_at}>{formatShanghaiTime(article.discovered_at)}</time></p>
                    <h3 className="text-lg font-semibold leading-relaxed">{article.title}</h3>
                    {article.summary && <p className="feed-muted mt-2 line-clamp-2 text-sm leading-7">{article.summary}</p>}
                    <span className="topic-reading-link">阅读全文 <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></span>
                  </Link></article>)}
              </div>
              <Link className="topic-reading-all" href={`/feed?${new URLSearchParams({ topic: selected.name })}`}>浏览「{selected.name}」全部文章 <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </section>}
          </div>}
      </main>
    </div>
  )
}

export default function TopicsPage() {
  return <Suspense fallback={<div className="feed-paper min-h-screen p-8">正在加载专题…</div>}><TopicExplorer /></Suspense>
}
