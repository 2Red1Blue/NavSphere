import { getRequestContext } from '@cloudflare/next-on-pages'
import { revokeFeedFullText } from '@/lib/feed-revocation'
import { withFeedErrorBoundary } from '@/lib/feed-api'

export const runtime = 'edge'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withFeedErrorBoundary(async () => {
    const { env } = getRequestContext()
    const { id } = await params
    return revokeFeedFullText(request, env.DB, env.CONTENT_OS_API_KEY, id)
  }, 'revoke')
}
