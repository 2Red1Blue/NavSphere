import { secureTokenEquals } from './feed-api'

const URL_HASH_PATTERN = /^[a-f0-9]{16,64}$/i

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status)
}

/**
 * Revoke public full-text permission without deleting the article summary.
 * The operation is intentionally separate from metadata/content upsert: a
 * rights withdrawal must work even when the source body and hash are unchanged.
 */
export async function revokeFeedFullText(
  request: Request,
  db: D1Database,
  apiKey: string | undefined,
  rawUrlHash: string,
): Promise<Response> {
  const authorization = request.headers.get('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!(await secureTokenEquals(token, apiKey))) {
    return errorResponse('UNAUTHORIZED', 'Invalid or missing API key', 401)
  }

  const urlHash = rawUrlHash.trim().toLowerCase()
  if (!URL_HASH_PATTERN.test(urlHash)) {
    return errorResponse('INVALID_ID', 'Article ID is invalid', 400)
  }

  try {
    const result = await db.prepare(
      `UPDATE articles
       SET fulltext_publication_allowed = 0,
           fulltext_revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE url_hash = ?`,
    ).bind(urlHash).run()

    if (!result.success) {
      return errorResponse('REVOCATION_FAILED', 'Unable to revoke full-text access', 503)
    }
    const changes = Number((result.meta as { changes?: unknown } | undefined)?.changes ?? 0)
    if (!Number.isFinite(changes) || changes < 1) {
      const existing = await db.prepare(
        'SELECT url_hash FROM articles WHERE url_hash = ?',
      ).bind(urlHash).first<{ url_hash: string }>()
      if (existing) return jsonResponse({ revoked: true, url_hash: urlHash })
      return errorResponse('NOT_FOUND', 'Article not found', 404)
    }

    return jsonResponse({ revoked: true, url_hash: urlHash })
  } catch (error) {
    console.error('NavSphere full-text revocation failed', error)
    return errorResponse('REVOCATION_FAILED', 'Unable to revoke full-text access', 503)
  }
}

/** Explicitly re-authorize a verified body after a prior rights withdrawal. */
export async function restoreFeedFullText(
  request: Request,
  db: D1Database,
  apiKey: string | undefined,
  rawUrlHash: string,
): Promise<Response> {
  const authorization = request.headers.get('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!(await secureTokenEquals(token, apiKey))) {
    return errorResponse('UNAUTHORIZED', 'Invalid or missing API key', 401)
  }

  const urlHash = rawUrlHash.trim().toLowerCase()
  if (!URL_HASH_PATTERN.test(urlHash)) {
    return errorResponse('INVALID_ID', 'Article ID is invalid', 400)
  }

  try {
    const result = await db.prepare(
      `UPDATE articles
       SET fulltext_publication_allowed = 1,
           fulltext_revoked_at = NULL
       WHERE url_hash = ?
         AND approved_for_publication = 1
         AND content IS NOT NULL
         AND content_quality = 'verified_fulltext'
         AND content_format = 'markdown_v1'`,
    ).bind(urlHash).run()
    const changes = Number((result.meta as { changes?: unknown } | undefined)?.changes ?? 0)
    if (!result.success || !Number.isFinite(changes)) {
      return errorResponse('RESTORE_FAILED', 'Unable to restore full-text access', 503)
    }
    if (changes < 1) {
      const existing = await db.prepare(
        'SELECT url_hash FROM articles WHERE url_hash = ?',
      ).bind(urlHash).first<{ url_hash: string }>()
      if (!existing) return errorResponse('NOT_FOUND', 'Article not found', 404)
      return errorResponse('NO_VERIFIED_CONTENT', 'No verified full text is available', 409)
    }
    return jsonResponse({ restored: true, url_hash: urlHash })
  } catch (error) {
    console.error('NavSphere full-text restoration failed', error)
    return errorResponse('RESTORE_FAILED', 'Unable to restore full-text access', 503)
  }
}
