import { secureTokenEquals } from './feed-api'
import { EditorialValidationError } from './editorial-contract'
import { ContractViolationV2 } from './editorial-contract-v2'
import { EditorialConflictError, EditorialNotFoundError, mutateManualEditorialV2 } from './feed-editorial'
import { EditorialBodyTooLarge, readEditorialRequestBody } from './feed-editorial-http'

function reply(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    ...(status === 503 ? { 'Retry-After': '300' } : {}),
  } })
}

function matchesManualV2Url(requestUrl: string, articleId: string): boolean {
  if (!/^[a-f0-9]{16}$/.test(articleId)) return false
  try {
    const url = new URL(requestUrl)
    return url.pathname === `/api/feed/${articleId}/editorial-v2` && !url.search
  } catch { return false }
}

/** Manual-only v2 publication endpoint.  It intentionally has no GET, auto
 * authorization or delivery action; v1 editorial handling remains separate. */
export async function handleManualEditorialV2Request(
  request: Request,
  articleId: string,
  getEnv: () => CloudflareEnv,
): Promise<Response> {
  try {
    const env = getEnv()
    const authorization = request.headers.get('Authorization') ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!(await secureTokenEquals(token, env.CONTENT_OS_API_KEY))) return reply({ code: 'UNAUTHORIZED' }, 401)
    if (!matchesManualV2Url(request.url, articleId) || request.method !== 'POST') return reply({ code: 'INVALID_REQUEST' }, 400)
    if (env.FEED_EDITORIAL_ENABLED !== 'true') return reply({ code: 'EDITORIAL_DISABLED' }, 409)
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') ?? '')
      || !['', 'identity'].includes(request.headers.get('Content-Encoding') ?? '')) return reply({ code: 'INVALID_REQUEST' }, 400)
    return reply(await mutateManualEditorialV2(env.DB, articleId, await readEditorialRequestBody(request)))
  } catch (error) {
    if (error instanceof EditorialBodyTooLarge) return reply({ code: 'BODY_TOO_LARGE' }, 413)
    if (error instanceof EditorialValidationError || error instanceof ContractViolationV2) return reply({ code: 'INVALID_REQUEST' }, 400)
    if (error instanceof EditorialNotFoundError) return reply({ code: 'NOT_FOUND' }, 404)
    if (error instanceof EditorialConflictError) return reply({ code: 'EDITORIAL_CONFLICT' }, 409)
    return reply({ code: 'EDITORIAL_UNAVAILABLE' }, 503)
  }
}
