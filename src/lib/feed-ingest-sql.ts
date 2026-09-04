import type { FeedArticleInput } from './feed-api'

const CONTENT_REPLACE_PREDICATE = String.raw`
  excluded.content IS NOT NULL
  AND articles.content_hash IS NOT excluded.content_hash
  AND (
    articles.content IS NULL
    OR CASE excluded.content_quality
         WHEN 'verified_fulltext' THEN 2
         WHEN 'legacy_unverified' THEN 1
         ELSE 0
       END
       > CASE articles.content_quality
           WHEN 'verified_fulltext' THEN 2
           WHEN 'legacy_unverified' THEN 1
           ELSE 0
         END
    OR (
      excluded.content_quality = articles.content_quality
      AND (
        excluded.content_quality_score > articles.content_quality_score
        OR (
          excluded.content_quality_score = articles.content_quality_score
          AND julianday(excluded.content_extracted_at) > julianday(articles.content_extracted_at)
        )
      )
    )
  )
`

const CONTENT_COLUMNS = [
  'content',
  'content_format',
  'content_quality',
  'content_hash',
  'content_chars',
  'content_quality_score',
  'content_extracted_at',
  'content_source',
  'fulltext_publication_allowed',
] as const

const CONTENT_REPLACEMENTS = CONTENT_COLUMNS.map((column) => {
  if (column === 'fulltext_publication_allowed') {
    return String.raw`
      ${column} = CASE
        WHEN articles.fulltext_revoked_at IS NOT NULL THEN 0
        WHEN ${CONTENT_REPLACE_PREDICATE} THEN excluded.${column}
        ELSE articles.${column}
      END`
  }
  return String.raw`
      ${column} = CASE WHEN ${CONTENT_REPLACE_PREDICATE}
        THEN excluded.${column} ELSE articles.${column} END`
}).join(',')

/** Keep insertion columns and placeholder order identical for both write paths. */
const FEED_INSERT_SQL = String.raw`
    INSERT INTO articles (
      url_hash, title, original_title, summary, takeaway, content,
      content_format, content_quality, content_hash, content_chars,
      content_quality_score, content_version, content_extracted_at, content_source,
      fulltext_publication_allowed, source, url, category, topic, type, featured,
      score, signal, novelty, usefulness, content_potential, published_at,
      discovered_at, approved_for_publication
    )
    VALUES (
      ?1, ?2, ?3, ?4, ?5, ?6,
      ?7, ?8, ?9, ?10,
      ?11, CASE WHEN ?6 IS NULL THEN 0 ELSE 1 END, ?12, ?13,
      ?14, ?15, ?16, ?17, ?18, ?19, ?20,
      ?21, ?22, ?23, ?24, ?25, ?26,
      ?27, ?28
    )
`

/** Canonical D1 statement shared by the edge route and executable tests. */
export const FEED_UPSERT_SQL = String.raw`${FEED_INSERT_SQL}
    ON CONFLICT(url_hash) DO UPDATE SET
      title = excluded.title,
      original_title = excluded.original_title,
      summary = excluded.summary,
      takeaway = excluded.takeaway,
      source = excluded.source,
      url = excluded.url,
      category = excluded.category,
      topic = excluded.topic,
      type = excluded.type,
      featured = excluded.featured,
      score = excluded.score,
      signal = excluded.signal,
      novelty = excluded.novelty,
      usefulness = excluded.usefulness,
      content_potential = excluded.content_potential,
      published_at = excluded.published_at,
      discovered_at = excluded.discovered_at,
      approved_for_publication = excluded.approved_for_publication,
      ${CONTENT_REPLACEMENTS},
      content_version = articles.content_version + CASE WHEN ${CONTENT_REPLACE_PREDICATE}
        THEN 1 ELSE 0 END
`

/** Preparing a selected link must never alter an existing publication decision. */
export const FEED_PREPARE_SQL = String.raw`${FEED_INSERT_SQL}
    ON CONFLICT(url_hash) DO NOTHING
`

export function feedArticleBindings(a: FeedArticleInput): Array<string | number | null> {
  return [
    a.url_hash, a.title, a.original_title, a.summary,
    a.takeaway, a.content?.body ?? null, a.content?.format ?? null,
    a.content?.quality ?? 'summary_only', a.content?.hash ?? null,
    a.content?.chars ?? 0, a.content?.quality_score ?? 0,
    a.content?.extracted_at ?? null, a.content?.source ?? null,
    a.content?.fulltext_publication_allowed ? 1 : 0,
    a.source, a.url, a.category, a.topic, a.type, a.featured,
    a.score, a.signal, a.novelty, a.usefulness, a.content_potential ?? null,
    a.published_at, a.discovered_at, a.approved_for_publication,
  ]
}
