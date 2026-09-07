// Content OS Feed API - Article Detail
// GET /api/feed/[id] - Get single article by url_hash

import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextRequest } from 'next/server'
import { withFeedErrorBoundary } from '@/lib/feed-api'
import { readFeedDetail } from '@/lib/feed-detail'

export const runtime = 'edge'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withFeedErrorBoundary(async () => {
    const { env } = getRequestContext()
    const { id } = await params

    return readFeedDetail(env.DB, env.CONTENT_ARCHIVE, id)
  }, 'detail')
}
