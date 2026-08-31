import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { assertSafeUrl, safeFetch } from '@/lib/safe-fetch'
import { uint8ArrayToBase64 } from '@/lib/buffer-utils'

export const runtime = 'edge'
const MAX_HTML_BYTES = 1024 * 1024
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const HTML_MIMES = ['text/html', 'application/xhtml+xml'] as const
const JSON_MIMES = ['application/json'] as const
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'] as const

interface WebsiteMetadata {
  title: string
  description: string
  icon: string
  image?: string
  videoConfig?: {
    type: 'bilibili' | 'youtube'
    videoId?: string
    bvid?: string
    aid?: string
    cid?: string
    p?: number
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const body = await request.json() as { url?: unknown }
    if (typeof body.url !== 'string' || body.url.length > 2_048) {
      return NextResponse.json({ error: '请提供有效的网站链接' }, { status: 400 })
    }
    const target = assertSafeUrl(body.url).toString()
    const metadata = await fetchWebsiteMetadata(target)

    if (metadata.image) {
      try { metadata.image = await downloadAndUploadImage(metadata.image, 'cover', 'assets/cover') }
      catch (error) { console.warn('Failed to persist cover image:', error); metadata.image = '' }
    }
    if (metadata.icon) {
      try { metadata.icon = await downloadAndUploadImage(metadata.icon, 'favicon', 'assets') }
      catch (error) { console.warn('Failed to persist favicon:', error); metadata.icon = '' }
    }
    return NextResponse.json(metadata)
  } catch (error) {
    console.error('Failed to fetch website metadata:', error)
    const message = error instanceof Error ? error.message : '获取网站信息失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

async function fetchWebsiteMetadata(url: string): Promise<WebsiteMetadata> {
  const bilibiliId = extractBilibiliId(url)
  if (bilibiliId) {
    try { return await fetchBilibiliMetadata(bilibiliId) }
    catch (error) { console.warn('Bilibili metadata API failed, using page metadata:', error) }
  }
  const result = await safeFetch(url, {
    headers: {
      'User-Agent': 'NavSphere Metadata Fetcher/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
    timeoutMs: 5_000,
    maxBytes: MAX_HTML_BYTES,
    allowedMimeTypes: HTML_MIMES,
  })
  const metadata = parseMetadataFromHtml(new TextDecoder().decode(result.bytes), result.finalUrl)
  metadata.videoConfig = extractVideoConfig(result.finalUrl)
  return metadata
}

function extractBilibiliId(value: string): { bvid?: string; aid?: string } | null {
  const url = new URL(value)
  if (url.hostname !== 'bilibili.com' && !url.hostname.endsWith('.bilibili.com')) return null
  const bvid = url.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1]
  const aid = url.pathname.match(/\/video\/av(\d+)/i)?.[1]
  return bvid ? { bvid } : aid ? { aid } : null
}

function extractVideoConfig(value: string): WebsiteMetadata['videoConfig'] {
  const url = new URL(value)
  const bilibili = extractBilibiliId(value)
  if (bilibili) return { type: 'bilibili', ...bilibili, p: Number(url.searchParams.get('p')) || 1 }
  if (url.hostname === 'youtu.be') return { type: 'youtube', videoId: url.pathname.split('/').filter(Boolean)[0] }
  if (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) {
    const videoId = url.searchParams.get('v') || url.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1]
    if (videoId) return { type: 'youtube', videoId }
  }
  return undefined
}

async function fetchBilibiliMetadata(id: { bvid?: string; aid?: string }): Promise<WebsiteMetadata> {
  const query = id.bvid ? `bvid=${encodeURIComponent(id.bvid)}` : `aid=${encodeURIComponent(id.aid!)}`
  const result = await safeFetch(`https://api.bilibili.com/x/web-interface/view?${query}`, {
    headers: { 'User-Agent': 'NavSphere Metadata Fetcher/1.0', Referer: 'https://www.bilibili.com/' },
    timeoutMs: 5_000,
    maxBytes: 512 * 1024,
    allowedMimeTypes: JSON_MIMES,
  })
  const body = JSON.parse(new TextDecoder().decode(result.bytes)) as {
    code?: number
    data?: { title?: string; desc?: string; pic?: string; bvid?: string; aid?: number; cid?: number; pages?: Array<{ cid?: number }> }
  }
  if (body.code !== 0 || !body.data) throw new Error('Bilibili returned invalid metadata')
  return {
    title: (body.data.title || '').slice(0, 300),
    description: (body.data.desc || '').slice(0, 2_000),
    icon: 'https://www.bilibili.com/favicon.ico',
    image: body.data.pic ? assertSafeUrl(body.data.pic).toString() : undefined,
    videoConfig: {
      type: 'bilibili',
      bvid: body.data.bvid,
      aid: body.data.aid?.toString(),
      cid: (body.data.pages?.[0]?.cid || body.data.cid)?.toString(),
      p: 1,
    },
  }
}

function parseMetadataFromHtml(html: string, url: string): WebsiteMetadata {
  const base = new URL(url)
  const title = extractMetaContent(html, 'title') || extractMetaContent(html, 'og:title') || base.hostname
  const description = extractMetaContent(html, 'description') || extractMetaContent(html, 'og:description') || ''
  const rawImage = extractMetaContent(html, 'og:image') || extractMetaContent(html, 'twitter:image')
  const rawIcon = extractFavicon(html) || '/favicon.ico'
  return {
    title: decodeEntities(title).trim().slice(0, 300),
    description: decodeEntities(description).trim().slice(0, 2_000),
    icon: resolveRemoteUrl(rawIcon, base),
    image: rawImage ? resolveRemoteUrl(rawImage, base) : undefined,
  }
}

function resolveRemoteUrl(value: string, base: URL): string {
  try { return assertSafeUrl(new URL(value, base).toString()).toString() }
  catch { return '' }
}

function extractMetaContent(html: string, name: string): string | null {
  if (name === 'title') return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${escaped}["']`, 'i'),
  ]
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1]
    if (value) return value
  }
  return null
}

function extractFavicon(html: string): string | null {
  const links = html.match(/<link\b[^>]*>/gi) ?? []
  for (const link of links) {
    const rel = link.match(/\brel=["']([^"']*)["']/i)?.[1]?.toLowerCase()
    if (!rel?.split(/\s+/).some((value) => value === 'icon' || value === 'apple-touch-icon')) continue
    const href = link.match(/\bhref=["']([^"']*)["']/i)?.[1]
    if (href) return href
  }
  return null
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
}

async function downloadAndUploadImage(url: string, prefix: string, folder: string): Promise<string> {
  const result = await safeFetch(url, {
    headers: { 'User-Agent': 'NavSphere Image Fetcher/1.0', Accept: IMAGE_MIMES.join(',') },
    timeoutMs: 7_000,
    maxBytes: MAX_IMAGE_BYTES,
    allowedMimeTypes: IMAGE_MIMES,
  })
  const mime = result.response.headers.get('content-type')?.split(';', 1)[0].toLowerCase() ?? ''
  const extension: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
    'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
  }
  return uploadImageToGitHub(result.bytes, extension[mime] || 'png', prefix, folder)
}

async function uploadImageToGitHub(bytes: Uint8Array, extension: string, prefix: string, folder: string): Promise<string> {
  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO
  const branch = process.env.GITHUB_BRANCH || 'main'
  const token = process.env.GITHUB_PAT
  if (!owner || !repo || !token) throw new Error('GitHub writes are not configured')
  const path = `/${folder}/${prefix}_${crypto.randomUUID()}.${extension}`
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/public${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Upload ${prefix}`, content: uint8ArrayToBase64(bytes), branch }),
  })
  if (!response.ok) throw new Error(`Image upload failed: HTTP ${response.status}`)
  return path
}
