// Content OS Feed API - Article Detail
// GET /api/feed/[id] - Get single article by url_hash

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

export async function onRequest(context: { request: Request; env: { DB: D1Database }; params: Record<string, string> }) {
  const { env, params } = context
  // Cloudflare Pages Functions: params may be undefined for catch-all routes
  const id = params?.id || new URL(context.request.url).pathname.split('/').pop() || ''

  if (!id) {
    return errorResponse('NOT_FOUND', 'Article ID is required', 404)
  }

  const article = await env.DB.prepare('SELECT * FROM articles WHERE url_hash = ?')
    .bind(id)
    .first()

  if (!article) {
    return errorResponse('NOT_FOUND', 'Article not found', 404)
  }

  return jsonResponse({ data: article }, 200, {
    'Cache-Control': 'public, s-maxage=300',
  })
}