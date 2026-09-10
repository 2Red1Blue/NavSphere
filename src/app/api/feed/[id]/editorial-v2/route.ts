import { getRequestContext } from '@cloudflare/next-on-pages'
import { handleManualEditorialV2Request } from '@/lib/feed-editorial-v2-http'

export const runtime = 'edge'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handleManualEditorialV2Request(request, id, () => getRequestContext().env)
}
