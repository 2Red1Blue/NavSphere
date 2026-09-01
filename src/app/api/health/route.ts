import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET() {
  const timestamp = new Date().toISOString()

  try {
    const { env } = getRequestContext()
    const result = await env.DB.prepare(
      'SELECT COUNT(*) AS approved FROM articles WHERE approved_for_publication = 1',
    ).first<{ approved: number }>()

    return NextResponse.json({
      app: 'NavSphere',
      status: 'ok',
      checks: { database: 'ok', approvedArticles: result?.approved ?? 0 },
      timestamp,
    })
  } catch (error) {
    console.error('NavSphere database health check failed', error)
    return NextResponse.json({
      app: 'NavSphere',
      status: 'degraded',
      checks: { database: 'failed' },
      timestamp,
    }, { status: 503 })
  }
}
