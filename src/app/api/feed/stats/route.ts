// Content OS Feed API - Statistics
// GET /api/feed/stats - Get aggregate statistics

import { getRequestContext } from '@cloudflare/next-on-pages'

export const runtime = 'edge'

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  })
}

export async function GET() {
  const { env } = getRequestContext()

  const totalResult = await env.DB.prepare(
    'SELECT COUNT(*) as total FROM articles WHERE approved_for_publication = 1'
  ).first<{ total: number }>()

  const todayResult = await env.DB.prepare(
    "SELECT COUNT(*) as today FROM articles WHERE approved_for_publication = 1 AND date(discovered_at) = date('now')"
  ).first<{ today: number }>()

  const categories = await env.DB.prepare(
    'SELECT category as name, COUNT(*) as count FROM articles WHERE approved_for_publication = 1 GROUP BY category ORDER BY count DESC'
  ).all<{ name: string; count: number }>()

  const topSources = await env.DB.prepare(
    'SELECT source as name, COUNT(*) as count FROM articles WHERE approved_for_publication = 1 GROUP BY source ORDER BY count DESC LIMIT 10'
  ).all<{ name: string; count: number }>()

  return jsonResponse(
    {
      total: totalResult?.total || 0,
      today: todayResult?.today || 0,
      categories: categories.results,
      topSources: topSources.results,
    },
    200,
    { 'Cache-Control': 'public, s-maxage=300' }
  )
}
