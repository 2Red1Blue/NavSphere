import { secureTokenEquals } from './feed-api'
import { EditorialValidationError, MAX_EDITORIAL_REQUEST_BYTES, parseEditorialJson } from './editorial-contract'
import { EditorialConflictError, EditorialNotFoundError, mutateEditorial, readEditorialState } from './feed-editorial'

function reply(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    ...(status === 503 ? { 'Retry-After': '300' } : {}),
  } })
}
/** Shared by the versioned manual endpoints so a bounded body is always a
 * client error, never confused with a transient D1 or provider outage. */
export class EditorialBodyTooLarge extends Error {}

/** Accept only this path's single decoded Next adapter ID, never query-selected identity. */
function matchesEditorialUrl(requestUrl: string, articleId: string): boolean {
  if (!/^[a-f0-9]{16}$/.test(articleId)) return false
  let url: URL
  try { url = new URL(requestUrl) } catch { return false }
  if (url.pathname !== `/api/feed/${articleId}/editorial`) return false
  if (!url.search) return true
  const entries = Array.from(url.searchParams.entries())
  return entries.length === 1 && entries[0][0] === 'id' && entries[0][1] === articleId
}

/** Timeout override is for local tests only; the route always uses ten seconds. */
export async function readEditorialRequestBody(request: Request, timeoutMs = 10_000) {
  const declared = request.headers.get('Content-Length')
  if (declared !== null && (!/^[0-9]+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) throw new EditorialValidationError()
  if (declared !== null && Number(declared) > MAX_EDITORIAL_REQUEST_BYTES) throw new EditorialBodyTooLarge()
  if (!request.body) throw new EditorialValidationError()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new EditorialValidationError())
      void reader.cancel().catch(() => undefined)
    }, timeoutMs)
  })
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) break
      if (value.byteLength === 0) {
        void reader.cancel().catch(() => undefined)
        throw new EditorialValidationError()
      }
      size += value.byteLength
      if (size > MAX_EDITORIAL_REQUEST_BYTES) {
        void reader.cancel().catch(() => undefined)
        throw new EditorialBodyTooLarge()
      }
      chunks.push(value)
    }
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return parseEditorialJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)) }
  catch { throw new EditorialValidationError() }
}

/** Separate admin authority/configuration from all untrusted body fields. */
export async function handleEditorialRequest(request: Request, articleId: string, getEnv: () => CloudflareEnv): Promise<Response> {
  try {
    const env = getEnv()
    const authorization = request.headers.get('Authorization') ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!(await secureTokenEquals(token, env.CONTENT_OS_API_KEY))) return reply({ code: 'UNAUTHORIZED' }, 401)
    if (!matchesEditorialUrl(request.url, articleId) || !['GET', 'POST'].includes(request.method)) return reply({ code: 'INVALID_REQUEST' }, 400)
    if (request.method === 'GET') {
      const state = await readEditorialState(env.DB, articleId)
      return state ? reply(state) : reply({ code: 'NOT_FOUND' }, 404)
    }
    if (env.FEED_EDITORIAL_ENABLED !== 'true') return reply({ code: 'EDITORIAL_DISABLED' }, 409)
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') ?? '')
      || !['', 'identity'].includes(request.headers.get('Content-Encoding') ?? '')) return reply({ code: 'INVALID_REQUEST' }, 400)
    return reply(await mutateEditorial(env.DB, articleId, await readEditorialRequestBody(request)))
  } catch (error) {
    if (error instanceof EditorialBodyTooLarge) return reply({ code: 'BODY_TOO_LARGE' }, 413)
    if (error instanceof EditorialValidationError) return reply({ code: 'INVALID_REQUEST' }, 400)
    if (error instanceof EditorialNotFoundError) return reply({ code: 'NOT_FOUND' }, 404)
    if (error instanceof EditorialConflictError) return reply({ code: 'EDITORIAL_CONFLICT' }, 409)
    return reply({ code: 'EDITORIAL_UNAVAILABLE' }, 503)
  }
}
