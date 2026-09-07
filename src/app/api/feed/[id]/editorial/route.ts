import { getRequestContext } from '@cloudflare/next-on-pages'
import { handleEditorialRequest } from '@/lib/feed-editorial-http'

export const runtime = 'edge'

async function handle(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleEditorialRequest(request, id, () => getRequestContext().env)
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS, handle as HEAD }
