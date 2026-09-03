import { getRequestContext } from '@cloudflare/next-on-pages'
import { handleHealthRequest } from '@/lib/health-check'

export const runtime = 'edge'

export async function GET() {
  return handleHealthRequest(getRequestContext)
}
