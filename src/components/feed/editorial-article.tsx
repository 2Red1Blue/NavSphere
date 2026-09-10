'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { ContractViolationV2, validatePublicationV2 } from '@/lib/editorial-contract-v2'

/**
 * Editorial v2 natural-article renderer aligned with the frozen contract
 * `publication_renderer_v2` (drafts/editorial-v2/contracts/CONTRACT.md §3.6).
 *
 * Renders strictly from the structural PublicArticle v2 contract. It never
 * accepts Markdown bodies or arbitrary HTML. Reader states follow §2.4:
 * validation failure or an unknown version is surfaced as an explicit
 * "unavailable" state — it never falls back to v1 rendering. The v1 path is
 * only entered through the explicit schema_version==1 double-read dispatch in
 * the detail page.
 */

export type EditorialArticleV2ContentType = 'brief' | 'explainer'

export interface EditorialArticleV2Source {
  id: string
  title: string
  url: string
  evidence_id?: string
  original_title?: string
}

export type EditorialArticleV2EmphasisSpan = { start: number; end: number }

export type EditorialArticleV2Block =
  | { id: string; type: 'paragraph'; text: string; source_ids: string[]; emphasis_spans?: EditorialArticleV2EmphasisSpan[] }
  | { id: string; type: 'list'; items: string[]; source_ids: string[] }
  | { id: string; type: 'quote'; text: string; source_ids: string[]; attribution?: string }

export interface EditorialArticleV2Section {
  id: string
  heading: string
  blocks: EditorialArticleV2Block[]
}

export interface EditorialArticleV2 {
  schema_version: 2
  renderer_version: 'editorial-v2'
  article_id: string
  content_type: EditorialArticleV2ContentType
  downgraded_from?: 'explainer'
  article: {
    title: string
    deck: string
    sections: EditorialArticleV2Section[]
  }
  sources: EditorialArticleV2Source[]
}

const CONTENT_TYPE_LABELS: Record<EditorialArticleV2ContentType, string> = {
  brief: '简讯',
  explainer: '原文解读',
}

/** DOM anchors are pure functions of contract ids, namespaced by a fixed constant. */
const ANCHOR_PREFIX = 'ed-'
export function sectionAnchor(id: string): string { return `${ANCHOR_PREFIX}${id}` }
export function blockAnchor(id: string): string { return `${ANCHOR_PREFIX}${id}` }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Reader-side validation for publication_renderer_v2 now delegates to the
 * authoritative shared validator (audit P1-2): full §1 prose/URL/placeholder
 * rules and §3.6 field rules — no Reader-side subset that could drift from
 * the release gate.  Hash recomputation is not needed here; integrity is
 * enforced at the release gate before publication (CONTRACT.md §3.8).
 */
export function parseEditorialArticleV2(value: unknown): EditorialArticleV2 | null {
  try {
    validatePublicationV2(value)
  } catch (error) {
    if (error instanceof ContractViolationV2) return null
    throw error
  }
  // Structure and every field rule are proven by the authoritative validator;
  // reinterpret the same object as the reader's typed view.
  return value as unknown as EditorialArticleV2
}

/** Reader-side three states per CONTRACT.md §2.4. */
export type EditorialV2ReaderState =
  | { state: 'absent' }
  | { state: 'available'; publication: EditorialArticleV2 }
  | { state: 'unavailable' }

export function resolveEditorialV2State(value: unknown): EditorialV2ReaderState {
  if (!isRecord(value)) return { state: 'absent' }
  // Explicit v1 double-read dispatch: schema_version==1 belongs to the v1 path.
  if (value.schema_version === 1) return { state: 'absent' }
  // A v2-record exists but the version or body fails validation: unavailable.
  if (value.schema_version !== 2 || value.renderer_version !== 'editorial-v2') return { state: 'unavailable' }
  const publication = parseEditorialArticleV2(value)
  return publication === null ? { state: 'unavailable' } : { state: 'available', publication }
}

/** Chinese reading speed dominates; ~400 CJK chars or ~200 words per minute. */
export function estimateReadingMinutes(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const words = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(cjk / 400 + words / 200))
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch { return '' }
}

/**
 * emphasis_spans use Unicode code-point offsets. Boundaries are expanded out
 * to grapheme-cluster edges before markup is applied (render-side duty per
 * CONTRACT.md §3.6 note 3); spans are never dropped silently.
 */
function renderEmphasis(text: string, spans: ReadonlyArray<EditorialArticleV2EmphasisSpan>): React.ReactNode[] {
  const cpToUnit: number[] = [0]
  let unit = 0
  for (const ch of text) { unit += ch.length; cpToUnit.push(unit) }
  const clusters: Array<{ start: number; end: number }> = []
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' })
    for (const segment of segmenter.segment(text)) {
      clusters.push({ start: segment.index, end: segment.index + segment.segment.length })
    }
  } else {
    let start = 0
    for (const ch of text) { clusters.push({ start, end: start + ch.length }); start += ch.length }
  }
  const clusterEdge = (position: number, edge: 'start' | 'end'): number => {
    for (const cluster of clusters) {
      if (position > cluster.start && position < cluster.end) return edge === 'start' ? cluster.start : cluster.end
    }
    return position
  }
  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    let start = clusterEdge(cpToUnit[Math.min(span.start, cpToUnit.length - 1)], 'start')
    const end = clusterEdge(cpToUnit[Math.min(span.end, cpToUnit.length - 1)], 'end')
    if (start < cursor) start = cursor
    if (end <= start) continue
    if (start > cursor) nodes.push(text.slice(cursor, start))
    nodes.push(<strong key={`em-${span.start}-${span.end}`}>{text.slice(start, end)}</strong>)
    cursor = end
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function SourceMarks({ sourceIds, sourceIndex }: {
  sourceIds: string[]
  sourceIndex: Map<string, number>
}) {
  // Same paragraph, same source: one marker only.
  const marks = [...new Set(sourceIds)]
    .map((id) => ({ id, n: sourceIndex.get(id) }))
    .filter((mark): mark is { id: string; n: number } => mark.n !== undefined)
  if (marks.length === 0) return null
  return (
    <span className="ml-1.5 whitespace-nowrap text-xs align-super leading-none">
      {marks.map(({ id, n }) => (
        <a
          key={id}
          href={`#v2-source-${id}`}
          aria-label={`查看来源 ${n}`}
          className="feed-accent ml-0.5 rounded-sm underline decoration-transparent underline-offset-2 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))] focus-visible:ring-offset-1"
        >
          [{n}]
        </a>
      ))}
    </span>
  )
}

function BlockList({ blocks, sourceIndex }: {
  blocks: EditorialArticleV2Block[]
  sourceIndex: Map<string, number>
}) {
  return (
    <>
      {blocks.map((block) => {
        if (block.type === 'paragraph') {
          const content = block.emphasis_spans?.length
            ? renderEmphasis(block.text, block.emphasis_spans)
            : block.text
          return (
            <p key={block.id} id={blockAnchor(block.id)} className="my-5 [overflow-wrap:anywhere]">
              {content}
              <SourceMarks sourceIds={block.source_ids} sourceIndex={sourceIndex} />
            </p>
          )
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={block.id} id={blockAnchor(block.id)} className="feed-hairline my-6 border-l-2 border-[hsl(var(--feed-accent))] pl-5 text-foreground/85 not-italic">
              {block.text}
              <SourceMarks sourceIds={block.source_ids} sourceIndex={sourceIndex} />
              {block.attribution ? (
                <footer className="feed-muted mt-2 text-sm">
                  —— <cite className="not-italic">{block.attribution}</cite>
                </footer>
              ) : null}
            </blockquote>
          )
        }
        return (
          <div key={block.id} id={blockAnchor(block.id)}>
            <ul className="feed-muted my-5 list-disc space-y-2 pl-6">
              {block.items.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
            <div className="-mt-3 text-[0]">
              <SourceMarks sourceIds={block.source_ids} sourceIndex={sourceIndex} />
            </div>
          </div>
        )
      })}
    </>
  )
}

/** §2.4 unavailable state: comprehensible notice + source entry, never a v1 stand-in. */
export function EditorialArticleUnavailable({ sourceLabel, sourceUrl }: {
  sourceLabel?: string
  sourceUrl?: string | null
}) {
  return (
    <section className="feed-hairline mb-12 border-t pt-6" aria-labelledby="editorial-v2-unavailable-title">
      <p className="feed-kicker mb-4">内容状态</p>
      <h2 id="editorial-v2-unavailable-title" className="feed-display text-base font-semibold leading-snug">编辑稿暂不可用</h2>
      <p className="feed-muted mt-3 max-w-[60ch] text-sm leading-7">
        本条目存在新版编辑稿，但当前未能通过完整校验。为避免以不完整内容冒充正文，这里不做降级展示；可通过下方来源入口继续阅读。
      </p>
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="feed-accent mt-4 inline-flex items-center gap-2 rounded-sm text-sm font-medium underline decoration-current/25 underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))] focus-visible:ring-offset-2"
        >
          {sourceLabel ? `来源入口：${sourceLabel}` : '来源入口'} ↗<span className="sr-only">（新标签页）</span>
        </a>
      ) : sourceLabel ? (
        <p className="feed-muted mt-4 text-sm">来源：{sourceLabel}</p>
      ) : null}
    </section>
  )
}

export function EditorialArticle({ publication, publishedAt, sourceName }: {
  publication: EditorialArticleV2
  publishedAt?: string
  sourceName?: string
}) {
  const { article } = publication
  const tocItems = useMemo(
    () => article.sections.map((section) => ({
      id: sectionAnchor(section.id),
      text: section.heading,
    })),
    [article.sections],
  )
  const sourceIndex = useMemo(
    () => new Map(publication.sources.map((source, index) => [source.id, index + 1])),
    [publication.sources],
  )
  const fullText = useMemo(() => {
    const parts = [article.title, article.deck]
    for (const section of article.sections) {
      parts.push(section.heading)
      for (const block of section.blocks) {
        if (block.type === 'list') parts.push(...block.items)
        else parts.push(block.text)
      }
    }
    return parts.join('\n')
  }, [article])
  const minutes = useMemo(() => estimateReadingMinutes(fullText), [fullText])

  const [activeSectionId, setActiveSectionId] = useState('')
  // Desktop TOC current-section highlight. Mobile keeps a collapsed static list.
  useEffect(() => {
    const elements = tocItems
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => element !== null)
    if (elements.length === 0 || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSectionId(entry.target.id)
        }
      },
      { rootMargin: '-80px 0px -75% 0px', threshold: 0 },
    )
    elements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [tocItems])

  // Return to the previous reading position for this article.
  useEffect(() => {
    const storageKey = `navsphere:reader-v2:${publication.article_id}`
    let frame = 0
    const save = () => {
      try { sessionStorage.setItem(storageKey, String(window.scrollY)) } catch { /* storage unavailable */ }
    }
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => { frame = 0; save() })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', save)
    let restoreFrame = 0
    let saved = 0
    try { saved = Number(sessionStorage.getItem(storageKey) ?? '0') } catch { saved = 0 }
    if (Number.isFinite(saved) && saved > 400) {
      restoreFrame = window.requestAnimationFrame(() => {
        // Always instant: restoring a position should never animate.
        window.scrollTo({ top: saved, behavior: 'auto' })
      })
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      if (restoreFrame) window.cancelAnimationFrame(restoreFrame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
    }
  }, [publication.article_id])

  const scrollToSection = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
    setActiveSectionId(id)
  }

  const tocNav = (variant: 'desktop' | 'mobile') => (
    <nav aria-label="本篇目录" className={variant === 'desktop' ? 'hidden xl:block' : 'xl:hidden'}>
      {variant === 'desktop' ? (
        <div className="feed-kicker mb-3">本篇目录</div>
      ) : null}
      <ul className={cn('feed-hairline space-y-1 border-l', variant === 'desktop' ? 'border-[hsl(var(--feed-line))]' : 'border-[hsl(var(--feed-line))] pl-1')}>
        {tocItems.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={(event) => scrollToSection(event, item.id)}
              aria-current={activeSectionId === item.id ? 'true' : undefined}
              className={cn(
                'block rounded-r-sm py-1.5 text-xs leading-relaxed outline-none transition-colors hover:text-[hsl(var(--feed-ink))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))] focus-visible:ring-offset-2 motion-reduce:transition-none',
                activeSectionId === item.id
                  ? 'feed-accent border-l-2 border-[hsl(var(--feed-accent))] -ml-px pl-2.5 font-medium'
                  : 'feed-muted pl-3',
              )}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )

  return (
    <section aria-labelledby="editorial-article-v2-title" className="mb-12">
      <header>
        <div className="feed-hairline mb-6 border-y py-3">
          <p className="feed-kicker">
            <span className="feed-accent font-semibold">{CONTENT_TYPE_LABELS[publication.content_type]}</span>
            {sourceName ? <span aria-hidden="true"> · </span> : null}
            {sourceName ? <span>{sourceName}</span> : null}
            {publishedAt ? <span aria-hidden="true"> · </span> : null}
            {publishedAt ? <time dateTime={publishedAt}>{formatDate(publishedAt)}</time> : null}
            <span aria-hidden="true"> · </span>
            <span>预计阅读 {minutes} 分钟</span>
          </p>
        </div>
        {publication.downgraded_from === 'explainer' ? (
          <p className="feed-muted mb-6 rounded-sm border border-dashed border-[hsl(var(--feed-line))] px-4 py-3 text-sm leading-7">
            <span className="feed-accent mr-2 font-semibold">降级标识</span>
            本文由「原文解读」路径因材料不足降级为简讯，仅保留已核实的关键信息。
          </p>
        ) : null}
        {/* v2 renders the reviewed article title; scraped original titles stay
            in the source bibliography below (CONTRACT.md §3.6 sources note). */}
        <h1
          id="editorial-article-v2-title"
          className="feed-display max-w-[46rem] text-[28px] font-semibold leading-[1.4] tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-[32px] lg:text-[38px]"
        >
          {article.title}
        </h1>
        {article.deck ? (
          <p className="feed-muted mt-6 max-w-[46rem] border-l-2 border-[hsl(var(--feed-accent))] pl-5 text-base leading-[1.8] sm:text-lg">
            {article.deck}
          </p>
        ) : null}
      </header>

      <details className="feed-hairline mt-8 border-t pt-4 xl:hidden">
        <summary className="feed-kicker cursor-pointer list-none outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))] focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden before:mr-1.5 before:content-['▸'] before:motion-reduce:content-['▸']">
          目录
        </summary>
        <div className="mt-3">
          {tocNav('mobile')}
        </div>
      </details>

      <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="max-w-[720px] text-[17px] leading-[1.8] text-[hsl(var(--feed-ink)/.88)] lg:text-[18px]">
          {article.sections.map((section) => (
            <section key={section.id} id={sectionAnchor(section.id)} className="scroll-mt-24" aria-labelledby={`ed-heading-${section.id}`}>
              <h2
                id={`ed-heading-${section.id}`}
                className="feed-display mt-10 mb-4 border-t border-[hsl(var(--feed-line))] pt-8 text-[20px] font-semibold leading-snug first:border-t-0 first:pt-0 first:mt-0 sm:text-[22px]"
              >
                {section.heading}
              </h2>
              <BlockList blocks={section.blocks} sourceIndex={sourceIndex} />
            </section>
          ))}
        </div>
        <div className="hidden xl:block">
          <div className="sticky top-8">
            {tocNav('desktop')}
          </div>
        </div>
      </div>

      <footer className="feed-hairline mt-12 border-t pt-5">
        <details className="group">
          <summary className="feed-kicker inline-flex cursor-pointer list-none items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))] focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
            <span className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">▸</span>
            相关来源（{publication.sources.length}）
          </summary>
          <ol className="mt-4 space-y-3 text-sm">
            {publication.sources.map((source, index) => (
              <li key={source.id} id={`v2-source-${source.id}`} className="scroll-mt-24">
                <span className="feed-accent mr-2 font-mono text-xs">[{index + 1}]</span>
                <span className="text-[hsl(var(--feed-ink))]">{source.title}</span>
                {' '}
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="feed-accent rounded-sm underline decoration-current/25 underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))] focus-visible:ring-offset-2"
                >
                  查看原文 ↗<span className="sr-only">（新标签页）</span>
                </a>
                {source.original_title ? (
                  <p className="feed-muted mt-1 text-xs leading-6">
                    原始标题（来源书目信息，非本站审定标题）：{source.original_title}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      </footer>
    </section>
  )
}
