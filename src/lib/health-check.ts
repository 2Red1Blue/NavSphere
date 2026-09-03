import { NextResponse } from 'next/server'
import { FEED_LIST_COLUMNS } from './feed-api'

export const CONTENT_CONTRACT_COLUMNS = [
  'content',
  'content_format',
  'content_quality',
  'content_hash',
  'content_chars',
  'content_quality_score',
  'content_version',
  'content_extracted_at',
  'content_source',
  'fulltext_publication_allowed',
  'fulltext_revoked_at',
] as const

/** Every list/detail column plus the versioned full-content contract. */
export const REQUIRED_FEED_COLUMNS = [
  ...FEED_LIST_COLUMNS,
  'approved_for_publication',
  ...CONTENT_CONTRACT_COLUMNS,
] as const

export function createDatabaseFailureResponse(): NextResponse {
  return NextResponse.json({
    app: 'NavSphere',
    status: 'degraded',
    checks: { database: 'failed', schema: 'unknown' },
    timestamp: new Date().toISOString(),
  }, { status: 503 })
}

/**
 * Build a readiness response without depending on the Cloudflare runtime.
 *
 * Runtime readiness verifies the presence of the columns consumed by Feed.
 * Types, defaults, and CHECK constraints remain owned by schema.sql/migrations
 * and are validated by the schema gate, rather than duplicated here.
 */
export async function createHealthResponse(db: D1Database): Promise<NextResponse> {
  const timestamp = new Date().toISOString()

  try {
    const schema = await db.prepare("PRAGMA table_info('articles')").all<{ name: string }>()
    const presentColumns = new Set(schema.results.map((column) => column.name))
    const missingColumns = REQUIRED_FEED_COLUMNS.filter((column) => !presentColumns.has(column))

    if (missingColumns.length > 0) {
      console.error('NavSphere Feed schema is incomplete', { missingColumns })
      return NextResponse.json({
        app: 'NavSphere',
        status: 'degraded',
        checks: { database: 'ok', schema: 'incomplete' },
        timestamp,
      }, { status: 503 })
    }

    const result = await db.prepare(
      'SELECT COUNT(*) AS approved FROM articles WHERE approved_for_publication = 1',
    ).first<{ approved: number }>()

    return NextResponse.json({
      app: 'NavSphere',
      status: 'ok',
      checks: { database: 'ok', schema: 'ok', approvedArticles: result?.approved ?? 0 },
      timestamp,
    })
  } catch (error) {
    console.error('NavSphere database health check failed', error)
    return createDatabaseFailureResponse()
  }
}

/** Include Cloudflare context acquisition in the same sanitized error boundary. */
export async function handleHealthRequest(
  getContext: () => { env: { DB: D1Database } },
): Promise<NextResponse> {
  try {
    const { env } = getContext()
    return await createHealthResponse(env.DB)
  } catch (error) {
    console.error('NavSphere health context acquisition failed', error)
    return createDatabaseFailureResponse()
  }
}
