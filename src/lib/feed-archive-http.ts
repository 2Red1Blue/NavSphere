import { secureTokenEquals } from './feed-api'
import { archiveCandidates, maintainArchive } from './feed-archive-maintenance'
import type { ArchiveAction } from './feed-archive-maintenance'

function reply(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    ...(status === 503 || status === 429 ? { 'Retry-After': '300' } : {}),
  } })
}

/** Separate authenticated maintenance from public read models. */
export async function handleArchiveRequest(request: Request, getEnv: () => CloudflareEnv): Promise<Response> {
  try {
    const env = getEnv()
    const auth = request.headers.get('Authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!(await secureTokenEquals(token, env.CONTENT_OS_API_KEY))) return reply({ code: 'UNAUTHORIZED' }, 401)
    const url = new URL(request.url)
    if (request.method === 'GET') {
      if (url.search) return reply({ code: 'INVALID_REQUEST' }, 400)
      return reply(await archiveCandidates(env.DB))
    }
    const action = url.searchParams.get('action')
    const id = url.searchParams.get('id') ?? ''
    if (request.method !== 'POST' || Array.from(url.searchParams).length !== 2 || !action
      || !['stage', 'compact', 'rehydrate'].includes(action)) return reply({ code: 'INVALID_REQUEST' }, 400)
    const outcome = await maintainArchive(env.DB, env.CONTENT_ARCHIVE, id, action as ArchiveAction, {
      enabled: env.CONTENT_ARCHIVE_ENABLED === 'true',
      compactEnabled: env.CONTENT_ARCHIVE_COMPACT_ENABLED === 'true',
    })
    return reply(outcome, outcome.status)
  } catch { return reply({ code: 'ARCHIVE_UNAVAILABLE' }, 503) }
}
