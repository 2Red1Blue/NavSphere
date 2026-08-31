import { NextRequest, NextResponse } from 'next/server'
import { getRequestContext } from '@cloudflare/next-on-pages'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { isHttpUrl } from '@/lib/safe-fetch'
import {
  type SubmissionData,
  type SubmissionIssue,
  SUBMISSION_LABELS,
  generateIssueBody,
  parseSubmissionFromIssueBody,
} from '@/types/submission'

export const runtime = 'edge'
const GITHUB_API = 'https://api.github.com'
const MAX_BODY_BYTES = 12_000
const RATE_WINDOW_MS = 60 * 60 * 1000

const submissionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  url: z.string().trim().max(2_048).refine(isHttpUrl, 'Only HTTP(S) URLs are allowed'),
  description: z.string().trim().min(1).max(1_000),
  category: z.string().trim().min(1).max(100),
  subcategory: z.string().trim().max(100).optional(),
  submitterNote: z.string().trim().max(1_000).optional(),
}).strict()

function validateSubmission(value: unknown): { success: true; data: SubmissionData } | { success: false } {
  const result = submissionSchema.safeParse(value)
  return result.success ? { success: true, data: result.data } : { success: false }
}

async function hashClientKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function consumeRateLimit(
  db: D1Database,
  key: string,
  now = Date.now(),
  limit = 5,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const clientKey = await hashClientKey(key)
  const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS
  const result = await db.prepare(`
    INSERT INTO submission_rate_limits (client_key, window_start, request_count)
    VALUES (?, ?, 1)
    ON CONFLICT(client_key) DO UPDATE SET
      window_start = CASE
        WHEN submission_rate_limits.window_start < excluded.window_start THEN excluded.window_start
        ELSE submission_rate_limits.window_start
      END,
      request_count = CASE
        WHEN submission_rate_limits.window_start < excluded.window_start THEN 1
        ELSE submission_rate_limits.request_count + 1
      END
    RETURNING window_start, request_count
  `).bind(clientKey, windowStart).first<{ window_start: number; request_count: number }>()
  if (!result) throw new Error('Unable to enforce submission rate limit')
  return {
    allowed: result.request_count <= limit,
    retryAfter: Math.max(1, Math.ceil((result.window_start + RATE_WINDOW_MS - now) / 1000)),
  }
}

function githubConfig() {
  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO
  const token = process.env.GITHUB_PAT
  if (!owner || !repo || !token) throw new Error('Submission service is not configured')
  return { owner, repo, token }
}

export async function POST(request: NextRequest) {
  try {
    const declaredLength = Number(request.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_BODY_BYTES) return NextResponse.json({ success: false, message: '请求内容过大' }, { status: 413 })
    const clientKey = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const limit = Math.max(1, Math.min(Number(process.env.SUBMISSION_RATE_LIMIT_PER_HOUR) || 5, 100))
    const { env } = getRequestContext()
    const rate = await consumeRateLimit(env.DB, clientKey, Date.now(), limit)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, message: '提交过于频繁，请稍后再试' }, {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfter) },
      })
    }
    const raw = await request.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ success: false, message: '请求内容过大' }, { status: 413 })
    }
    let value: unknown
    try { value = JSON.parse(raw) } catch { return NextResponse.json({ success: false, message: '请求格式无效' }, { status: 400 }) }
    const validated = validateSubmission(value)
    if (!validated.success) return NextResponse.json({ success: false, message: '投稿内容或网站地址无效' }, { status: 400 })

    const { owner, repo, token } = githubConfig()
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `[投稿] ${validated.data.title}`,
        body: generateIssueBody(validated.data),
        labels: [SUBMISSION_LABELS.SUBMISSION, SUBMISSION_LABELS.PENDING],
      }),
    })
    if (!response.ok) throw new Error(`GitHub issue creation failed: HTTP ${response.status}`)
    const issue = await response.json() as { number: number; html_url: string }
    return NextResponse.json({ success: true, message: '投稿成功！我们会尽快审核您的投稿', issueNumber: issue.number, issueUrl: issue.html_url })
  } catch (error) {
    console.error('Submission error:', error)
    return NextResponse.json({ success: false, message: '服务器错误，请稍后重试' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const status = new URL(request.url).searchParams.get('status') || 'pending'
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
      return NextResponse.json({ success: false, message: '无效的状态' }, { status: 400 })
    }
    let labels = SUBMISSION_LABELS.SUBMISSION
    if (status !== 'all') labels += `,${SUBMISSION_LABELS[status.toUpperCase() as 'PENDING' | 'APPROVED' | 'REJECTED']}`
    const { owner, repo, token } = githubConfig()
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues?labels=${encodeURIComponent(labels)}&state=all&per_page=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error(`Failed to fetch issues: HTTP ${response.status}`)
    const issues = await response.json() as SubmissionIssue[]
    const submissions = issues.map((issue) => ({ ...issue, submissionData: parseSubmissionFromIssueBody(issue.body) }))
    return NextResponse.json({ success: true, submissions })
  } catch (error) {
    console.error('Get submissions error:', error)
    return NextResponse.json({ success: false, message: '获取投稿列表失败' }, { status: 500 })
  }
}
