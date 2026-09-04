import { getRequestContext } from '@cloudflare/next-on-pages'
import { withFeedErrorBoundary } from '@/lib/feed-api'
import { prepareFeedArticle } from '@/lib/feed-prepare'

export const runtime = 'edge'

export async function POST(request: Request) {
  return withFeedErrorBoundary(async () => {
    const { env } = getRequestContext()
    return prepareFeedArticle(request, env.DB, env.CONTENT_OS_API_KEY)
  }, 'prepare')
}
