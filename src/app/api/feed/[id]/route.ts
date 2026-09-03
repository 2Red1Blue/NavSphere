// Content OS Feed API - Article Detail
// GET /api/feed/[id] - Get single article by url_hash

import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextRequest } from 'next/server'

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

function errorResponse(code: string, message: string, status = 400) {
  return jsonResponse({ error: { code, message } }, status)
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { env } = getRequestContext()
  const { id } = await params

  if (!id) {
    return errorResponse('NOT_FOUND', 'Article ID is required', 404)
  }

  const article = await env.DB.prepare(
    `SELECT
      url_hash, title, original_title, summary, takeaway,
      CASE WHEN content_quality = 'verified_fulltext'
             AND content_format = 'markdown_v1'
             AND fulltext_publication_allowed = 1
           THEN content ELSE NULL END AS content,
      content_format, content_quality, content_hash, content_chars,
      content_quality_score, content_version, content_extracted_at, content_source,
      fulltext_publication_allowed,
      source, url, category, topic, type, featured, score, signal, novelty,
      usefulness, content_potential, published_at, discovered_at, created_at
    FROM articles
    WHERE url_hash = ? AND approved_for_publication = 1`
  )
    .bind(id)
    .first()

  if (!article) {
    return errorResponse('NOT_FOUND', 'Article not found', 404)
  }

  return jsonResponse({ data: article }, 200, {
    'Cache-Control': 'public, s-maxage=300',
  })
}
