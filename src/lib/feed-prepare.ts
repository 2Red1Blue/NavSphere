import { secureTokenEquals, validateFeedRequest } from './feed-api'
import { FEED_PREPARE_SQL, feedArticleBindings } from './feed-ingest-sql'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function errorResponse(code: string, message: string, status: number, details?: string[]): Response {
  return jsonResponse({ error: { code, message, details } }, status)
}

/** Create a selected item without updating existing metadata, content or approval. */
export async function prepareFeedArticle(
  request: Request,
  db: D1Database,
  apiKey: string | undefined,
): Promise<Response> {
  const authorization = request.headers.get('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!(await secureTokenEquals(token, apiKey))) {
    return errorResponse('UNAUTHORIZED', 'Invalid or missing API key', 401)
  }

  const validated = await validateFeedRequest(request)
  if (!validated.valid) {
    return errorResponse(validated.code, validated.message, validated.status, validated.details)
  }
  if (validated.articles.length !== 1) {
    return errorResponse('VALIDATION_ERROR', 'Preparation requires exactly one article', 422)
  }

  const result = await db.prepare(FEED_PREPARE_SQL)
    .bind(...feedArticleBindings(validated.articles[0]))
    .run()
  if (result.success !== true) {
    throw new Error('D1 did not confirm Feed preparation')
  }

  // A no-op conflict is successful preparation, not proof of public readability.
  // The caller must separately verify the public detail and its exact identity.
  return jsonResponse({ prepared: 1 })
}
