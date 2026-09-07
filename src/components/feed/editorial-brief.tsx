import React from 'react'
import { validateEditorialPublication } from '../../lib/editorial-contract'
import type { EditorialClaim, EditorialPublication } from '../../lib/editorial-contract'
import type { PublicEditorial } from '../../types/feed'

const linkStyle = 'rounded-sm text-primary underline decoration-primary/30 underline-offset-4 outline-none hover:decoration-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

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
    <section className="mb-10 border-y border-border py-8 sm:py-10" aria-labelledby="editorial-brief-title">
      <p className="mb-4 text-xs font-semibold tracking-[0.12em] text-muted-foreground">
        本站整理 <span aria-hidden="true">·</span> 独立新闻短稿
      </p>
      <h2 id="editorial-brief-title" className="text-balance text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
        <CitedText claim={brief.headline} evidence={evidence} />
      </h2>
      <p className="mt-6 text-base leading-8 text-foreground/90 sm:text-lg sm:leading-9">
        <CitedText claim={brief.lead} evidence={evidence} />
      </p>
      <h3 className="mb-3 mt-8 text-sm font-semibold tracking-wide">材料中的事实与主张</h3>
      <ul className="space-y-4 border-l border-border pl-5 text-base leading-8">
        {brief.facts.map((claim, index) => <li key={index}>
          <CitedText claim={claim} evidence={evidence} />
        </li>)}
      </ul>
      <h3 className="mb-3 mt-8 text-sm font-semibold tracking-wide">分析与判断</h3>
      <p className="text-base leading-8"><CitedText claim={brief.analysis} evidence={evidence} /></p>
      <aside className="mt-8 rounded-sm bg-muted/40 px-5 py-4" aria-labelledby="editorial-caveats-title">
        <h3 id="editorial-caveats-title" className="mb-2 text-sm font-semibold">不确定性与局限</h3>
        <ul className="list-disc space-y-2 pl-4 text-sm leading-7 text-muted-foreground">
          {brief.caveats.map((caveat, index) => <li key={index}>{caveat}</li>)}
        </ul>
      </aside>
      <footer className="mt-8 border-t border-border/60 pt-5 text-xs leading-6 text-muted-foreground">
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
