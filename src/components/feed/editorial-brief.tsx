import React from 'react'
import { validateEditorialPublication } from '../../lib/editorial-contract'
import type { EditorialClaim, EditorialPublication } from '../../lib/editorial-contract'
import type { PublicEditorial } from '../../types/feed'

const linkStyle = 'feed-accent rounded-sm font-semibold underline decoration-current/25 underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))] focus-visible:ring-offset-2'

function CitedText({ claim, evidence }: {
  claim: EditorialClaim
  evidence: EditorialPublication['evidence']
}) {
  return <>
    {claim.text}
    <span className="ml-1.5 inline-flex gap-1.5 align-baseline text-xs">
      {claim.evidence_ids.map((id) => {
        const source = evidence.find((item) => item.id === id)!
        return <a key={id} href={source.url} target="_blank" rel="noopener noreferrer"
          className={linkStyle} aria-label={`证据 ${id}：${source.label}（新标签页）`}>
          [{id}]
        </a>
      })}
    </span>
  </>
}

/** Typed editorial IR is rendered as text, never arbitrary Markdown or HTML. */
export function EditorialBrief({ editorial }: { editorial: PublicEditorial }) {
  let publication: EditorialPublication
  try {
    const { revision, published_at, ...value } = editorial
    if (!Number.isInteger(revision) || revision < 1 || revision > 2147483647
      || typeof published_at !== 'string') return null
    publication = validateEditorialPublication(value)
  } catch { return null }
  const { brief, evidence } = publication
  return (
    <section className="mb-12" aria-labelledby="editorial-brief-title">
      <div className="feed-hairline mb-8 flex items-center justify-between border-y py-3">
        <p className="feed-kicker">本站整理 / Writer Agent 成稿 · 独立新闻短稿</p>
        <p className="feed-muted text-xs tabular-nums">Revision {editorial.revision}</p>
      </div>
      <h2 id="editorial-brief-title" className="feed-display text-balance text-4xl font-medium leading-[1.04] tracking-[-0.04em] sm:text-5xl">
        <CitedText claim={brief.headline} evidence={evidence} />
      </h2>
      <p className="feed-display mt-8 border-l-2 border-[hsl(var(--feed-accent))] pl-5 text-xl leading-9 text-[hsl(var(--feed-ink)/.82)] sm:text-2xl sm:leading-10">
        <CitedText claim={brief.lead} evidence={evidence} />
      </p>
      <h3 className="feed-kicker mb-4 mt-12">材料中的事实与主张</h3>
      <ul className="feed-hairline grid border-t sm:grid-cols-2">
        {brief.facts.map((claim, index) => <li key={index} className="feed-hairline grid grid-cols-[2rem_1fr] gap-3 border-b py-5 text-base leading-8 sm:odd:border-r sm:odd:pr-6 sm:even:pl-6">
          <span className="feed-display feed-accent pt-0.5 text-xl italic">{String(index + 1).padStart(2, '0')}</span>
          <span><CitedText claim={claim} evidence={evidence} /></span>
        </li>)}
      </ul>
      <div className="mt-12 grid gap-8 sm:grid-cols-[1fr_15rem]">
        <div>
          <h3 className="feed-kicker mb-4">分析与判断</h3>
          <p className="text-lg leading-9"><CitedText claim={brief.analysis} evidence={evidence} /></p>
        </div>
        <aside className="feed-hairline border-t pt-4" aria-labelledby="editorial-caveats-title">
        <h3 id="editorial-caveats-title" aria-label="不确定性与局限" className="text-xs font-semibold">边界与不确定性</h3>
        <ul className="feed-muted mt-3 list-disc space-y-2 pl-4 text-xs leading-6">
          {brief.caveats.map((caveat, index) => <li key={index}>{caveat}</li>)}
        </ul>
        </aside>
      </div>
      <footer className="feed-hairline feed-muted mt-12 border-t pt-5 text-xs leading-6">
        <p>依据以下材料整理，不代表独立复核，也不构成原文全文转载。</p>
        <ol className="mt-2 space-y-1.5">
          {evidence.map((source) => <li key={source.id} className="break-words">
            <span className="mr-2 font-mono">{source.id}</span>
            <a href={source.url} target="_blank" rel="noopener noreferrer" className={linkStyle}>
              {source.label}<span className="sr-only">（新标签页）</span>
            </a>
            <span className="ml-2">{source.kind === 'primary' ? '一手材料' : '二手材料'}（整理者标注）</span>
          </li>)}
        </ol>
      </footer>
    </section>
  )
}
