import { FEED_LIST_COLUMNS, FEED_RETRY_AFTER_SECONDS } from './feed-api'
import { ARCHIVE_COLUMNS, readArchiveBody, sameArchiveSnapshot } from './content-archive'
import type { ArchiveKV, ArchiveRow } from './content-archive'
import { parseEditorialJson, validateEditorialPublication } from './editorial-contract'
import type { PublicEditorial } from '../types/feed'

const PUBLIC_DETAIL_COLUMNS = [
  ...FEED_LIST_COLUMNS,
  'content_format', 'content_quality', 'content_hash', 'content_chars',
  'content_quality_score', 'content_version', 'content_extracted_at', 'content_source',
  'fulltext_publication_allowed',
] as const

const DETAIL_COLUMNS = [...new Set([...PUBLIC_DETAIL_COLUMNS, ...ARCHIVE_COLUMNS])]
type DetailRow = ArchiveRow & Record<string, unknown>

function missingEditorialTable(error: unknown): boolean {
  // Only the exact missing-table diagnostic permits rollout fallback. Missing
  // columns, other tables, corruption and timeouts remain service failures.
  return error instanceof Error
    && /^(?:D1_ERROR: |Parse error near line \d+: )?no such table: article_editorials(?:: SQLITE_ERROR)?$/.test(error.message)
}

function editorialProjection(row: DetailRow): PublicEditorial | null {
  if (row.approved_for_publication !== 1 || row.editorial_state !== 'published'
    || typeof row.editorial_publication_json !== 'string'
    || typeof row.editorial_revision !== 'number' || !Number.isInteger(row.editorial_revision)
    || row.editorial_revision < 1 || row.editorial_revision > 2147483647
    || typeof row.editorial_published_at !== 'string') return null
  try {
    const publication = validateEditorialPublication(parseEditorialJson(row.editorial_publication_json))
    const source = publication.source
    if (publication.article_id !== row.url_hash || source.url !== row.url
      || source.original_url !== row.original_url
      || source.original_url_provenance !== row.original_url_provenance) return null
    return { ...publication, revision: row.editorial_revision, published_at: row.editorial_published_at }
  } catch { return null }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(status === 503 ? { 'Retry-After': String(FEED_RETRY_AFTER_SECONDS) } : {}),
    },
  })
}

function notFound(): Response {
  return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Article not found' } }, 404)
}

function unavailable(): Response {
  return jsonResponse({ error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Feed service is temporarily unavailable',
  } }, 503)
}

function canReadBody(row: ArchiveRow): boolean {
  return row.approved_for_publication === 1
    && row.content_quality === 'verified_fulltext'
    && row.content_format === 'markdown_v1'
    && row.fulltext_publication_allowed === 1
    && row.fulltext_revoked_at === null
}

function publicResponse(row: DetailRow, content: string | null): Response {
  const data = Object.fromEntries(PUBLIC_DETAIL_COLUMNS.map((column) => [column, row[column]]))
  return jsonResponse({ data: { ...data, content, editorial: editorialProjection(row) } })
}

/** D1 remains the authority for publication; KV supplies only verified body bytes. */
export async function readFeedDetail(
  db: D1Database,
  kv: ArchiveKV | undefined,
  id: string,
): Promise<Response> {
  if (!id) return notFound()

  const readCurrent = async () => {
    try {
      return await db.prepare(
        `SELECT ${DETAIL_COLUMNS.map((column) => `a.${column}`).join(', ')},
          e.state AS editorial_state, e.revision AS editorial_revision,
          e.publication_json AS editorial_publication_json, e.published_at AS editorial_published_at
          FROM articles AS a LEFT JOIN article_editorials AS e ON e.url_hash = a.url_hash
          WHERE a.url_hash = ?`,
      ).bind(id).first<DetailRow>()
    } catch (error) {
      if (!missingEditorialTable(error)) throw error
      // No cached schema decision: a migration may finish during a cold read.
      // All original body/source/control columns and subsequent checks survive.
      return db.prepare(`SELECT ${DETAIL_COLUMNS.join(', ')} FROM articles WHERE url_hash = ?`)
        .bind(id).first<DetailRow>()
    }
  }

  try {
    const row = await readCurrent()
    if (!row || row.approved_for_publication !== 1) return notFound()
    if (!canReadBody(row)) return publicResponse(row, null)
    if (row.content === null && row.content_archive_key === null) return publicResponse(row, null)

    let body: string
    if (row.content !== null) {
      body = row.content
    } else {
      try {
        body = await readArchiveBody(kv, row)
      } catch {
        // A cold-body outage must not turn an independently published brief
        // into original text. Re-read D1 so withdrawals and source changes win.
        const current = await readCurrent()
        if (!current || current.approved_for_publication !== 1) return notFound()
        if (editorialProjection(current)) return publicResponse(current, null)
        return unavailable()
      }
    }
    // Any await can overlap a withdrawal or replacement. Check both rights and
    // the complete body/control snapshot, including same-second rights changes.
    const current = await readCurrent()
    if (!current || current.approved_for_publication !== 1) return notFound()
    if (!canReadBody(current)) return publicResponse(current, null)
    if (!sameArchiveSnapshot(row, current)) return unavailable()
    return publicResponse(current, body)
  } catch {
    return unavailable()
  }
}
