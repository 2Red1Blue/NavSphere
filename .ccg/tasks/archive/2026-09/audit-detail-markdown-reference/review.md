# Review

## Conclusion

Do not introduce the complete Station runtime. Preserve the deterministic, fail-closed daily pipeline and selectively adopt Station's independent reviewer, versioned task specification, cumulative evidence archive, and heterogeneous-model review patterns.

## Critical findings

1. `scripts/fetch_rss.py` calls Trafilatura without Markdown output for fetched full pages, so headings, images, formulas, and other structure are lost before rendering.
2. `NavSphere/src/app/api/feed/route.ts` currently inserts `content` as `NULL`; `scripts/push_to_d1.py` and the feed input validator do not carry article content. The live long body is therefore historical data and new articles cannot reliably receive or update full content.
3. The current content-quality audit checks length and sentence-like signals but not Markdown structure, so structurally broken long text is marked `fulltext_ok`.

## Warnings

1. `fixParagraphSpacing` and `convertIndentedCodeBlocks` guess structure in the browser and can split soft-wrapped paragraphs or misclassify nested content.
2. `prose-sm` and generic component styling weaken long-form readability but are secondary to the broken source semantics.
3. Do not enable raw HTML rendering for untrusted feeds without a sanitization policy.

## Evidence

- The live NavSphere item contains roughly 50k characters and renders 280 paragraphs, no content images, and no real body heading hierarchy.
- The same AIHOT item exposes more than 30 body headings, 55 tables, and 2 images in its rendered DOM.
- Two independent model reviews agreed on the content-contract and extraction-stage root causes and recommended selective Station adoption.

## Recommended order

1. Restore a versioned `content_markdown` ingestion and update contract.
2. Normalize HTML to structured Markdown before quality audit; fail closed to summary plus original link when confidence is low.
3. Add Markdown-structure quality gates and backfill selected historical rows.
4. Remove browser-side structural guessing and then tune typography/components.
5. Add a bounded researcher/critic review stage while keeping publication under the existing deterministic ledger.
