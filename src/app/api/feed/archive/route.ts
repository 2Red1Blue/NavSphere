import { getRequestContext } from '@cloudflare/next-on-pages'
import { handleArchiveRequest } from '@/lib/feed-archive-http'

export const runtime = 'edge'

async function handle(request: Request) {
  return handleArchiveRequest(request, () => getRequestContext().env)
}

export const GET = handle
export const POST = handle
