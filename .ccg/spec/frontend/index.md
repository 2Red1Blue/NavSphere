# Frontend conventions — public Feed reader

- Public article titles use trimmed `original_title` when present, then fall back to trimmed `title`, then `未命名文章`. Editorial `brief.headline` remains validated review data and must not create a second public title.
- A stored score of zero represents legacy or unscored content. Do not render it as a trustworthy `0/100` judgment or show an empty score panel. Positive fractional scores display at least `1/100`.
- Keep editorial evidence IDs, revision numbers, source-kind annotations and review disclaimers in the audit contract. Public prose may render only the reviewed lead, facts, analysis and caveats. The verified upstream URL remains available through “查看原文”; additional validated evidence may appear as human-readable “相关来源” links without internal IDs or material tiers.
- Hiding review metadata never relaxes `validateEditorialPublication`, original-URL validation, publication permission, revocation or fail-closed behavior.
