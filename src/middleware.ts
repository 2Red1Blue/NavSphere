import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const ARTICLE_ID = /^[a-f0-9]{16}$/
// Static subroutes that live under /feed and must never be gated.
const FEED_RESERVED_SEGMENTS = new Set(['daily', 'hot', 'topics'])

/**
 * Soft-404 fix (audit P2, 2026-09-09): /feed/[id] is a client-rendered page
 * that always answers 200; article existence is checked here so that a
 * nonexistent article id gets a real HTTP 404 on document navigation.
 * Client-side RSC navigations pass through (the app shows its own
 * "文章未找到" state), and API routes are untouched.
 */
async function feedArticleStatus(request: NextRequest, id: string): Promise<number> {
  try {
    const api = new URL(`/api/feed/${id}`, request.nextUrl.origin)
    const response = await fetch(api, {
      // The public detail API explicitly supports GET.  Do not rely on a
      // framework-generated HEAD handler, which can be absent or return 405.
      method: 'GET',
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    })
    return response.status
  } catch {
    // A failed existence lookup cannot prove the article exists.  Surface a
    // finite dependency failure instead of serving a misleading 200 detail
    // document for a missing or unavailable article.
    return 0
  }
}

function unavailableResponse(): Response {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>503 - NavSphere</title><meta name="robots" content="noindex"><style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{text-align:center;max-width:32rem;padding:2rem}a{color:#f97316}</style></head><body><main><h1>503 · 文章暂不可用</h1><p>暂时无法确认条目状态，请稍后重试。</p><p><a href="/feed">返回文章列表</a> · <a href="/">返回首页</a></p></main></body></html>`
  return new Response(html, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function notFoundResponse(): Response {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>404 - NavSphere</title><meta name="robots" content="noindex"><style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{text-align:center;max-width:32rem;padding:2rem}a{color:#f97316}</style></head><body><main><h1>404 · 文章不存在</h1><p>请求的条目不存在或已被移除。</p><p><a href="/feed">返回文章列表</a> · <a href="/">返回首页</a></p></main></body></html>`
  return new Response(html, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  if (pathname.startsWith('/admin')) {
    const session = await auth()

    if (!session?.user) {
      const callbackUrl = request.url
      return NextResponse.redirect(
        new URL(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`, request.url)
      )
    }
  }

  // Soft-404 gate for article detail pages. Only document navigations are
  // gated: RSC/`fetch` subrequests keep their own handling in the client.
  const feedSub = /^\/feed\/([^/]+)$/.exec(pathname)
  if (feedSub && !request.headers.has('RSC') && !request.headers.has('Next-Router-Prefetch')) {
    const segment = feedSub[1]
    if (!FEED_RESERVED_SEGMENTS.has(segment)) {
      // Malformed ids can never exist; well-formed ids are checked via the API.
      if (!ARTICLE_ID.test(segment)) return notFoundResponse()
      const status = await feedArticleStatus(request, segment)
      if (status === 404) return notFoundResponse()
      if (status < 200 || status >= 400) return unavailableResponse()
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/feed/:path*']
}
