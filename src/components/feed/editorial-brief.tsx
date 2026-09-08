import React from 'react'
import { validateEditorialPublication } from '../../lib/editorial-contract'
import type { EditorialPublication } from '../../lib/editorial-contract'
import type { PublicEditorial } from '../../types/feed'

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
      <div className="feed-hairline mb-8 border-y py-3">
        <h2 id="editorial-brief-title" className="feed-kicker">内容解读</h2>
      </div>
      <p className="feed-display border-l-2 border-[hsl(var(--feed-accent))] pl-5 text-lg leading-8 text-[hsl(var(--feed-ink)/.82)]">
        {brief.lead.text}
      </p>
      <h3 className="feed-kicker mb-4 mt-12">材料中的事实与主张</h3>
      <ul className="feed-hairline grid border-t sm:grid-cols-2">
        {brief.facts.map((claim, index) => <li key={index} className="feed-hairline grid grid-cols-[2rem_1fr] gap-3 border-b py-5 text-base leading-8 sm:odd:border-r sm:odd:pr-6 sm:even:pl-6">
          <span className="feed-display feed-accent pt-0.5 text-xl italic">{String(index + 1).padStart(2, '0')}</span>
          <span>{claim.text}</span>
        </li>)}
      </ul>
      <div className="mt-12 grid gap-8 sm:grid-cols-[1fr_15rem]">
        <div>
          <h3 className="feed-kicker mb-4">分析与判断</h3>
          <p className="text-lg leading-9">{brief.analysis.text}</p>
        </div>
        <aside className="feed-hairline border-t pt-4" aria-labelledby="editorial-caveats-title">
        <h3 id="editorial-caveats-title" aria-label="不确定性与局限" className="text-xs font-semibold">边界与不确定性</h3>
        <ul className="feed-muted mt-3 list-disc space-y-2 pl-4 text-xs leading-6">
          {brief.caveats.map((caveat, index) => <li key={index}>{caveat}</li>)}
        </ul>
        </aside>
      </div>
      <footer className="feed-hairline mt-10 border-t pt-5">
        <h3 className="feed-kicker mb-3">相关来源</h3>
        <ul className="space-y-2 text-sm">
          {evidence.map((source) => <li key={source.id}>
            <a href={source.url} target="_blank" rel="noopener noreferrer"
              className="feed-accent rounded-sm underline decoration-current/25 underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-[hsl(var(--feed-accent))] focus-visible:ring-offset-2">
              {source.label}<span className="sr-only">（新标签页）</span>
            </a>
          </li>)}
        </ul>
      </footer>
    </section>
  )
}
