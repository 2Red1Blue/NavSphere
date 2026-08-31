import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { mutateJsonFile } from '@/lib/github'
import type { NavigationData } from '@/types/navigation'
import { SUBMISSION_LABELS, parseSubmissionFromIssueBody } from '@/types/submission'

export const runtime = 'edge'
const GITHUB_API = 'https://api.github.com'
type RouteParams = { params: Promise<{ number: string }> }

function githubConfig() {
  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO
  const token = process.env.GITHUB_PAT
  if (!owner || !repo || !token) throw new Error('GitHub is not configured')
  return { owner, repo, token }
}

async function githubRequest(path: string, init: RequestInit = {}) {
  const { owner, repo, token } = githubConfig()
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!response.ok) throw new Error(`GitHub operation ${path} failed: HTTP ${response.status}`)
  return response
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const { number } = await params
    if (!/^\d{1,10}$/.test(number)) return NextResponse.json({ success: false, message: '无效的 Issue 编号' }, { status: 400 })
    const body = await request.json() as { action?: string; reason?: string }
    if (body.action !== 'approve' && body.action !== 'reject') {
      return NextResponse.json({ success: false, message: '无效的操作' }, { status: 400 })
    }
    if (body.reason && body.reason.length > 1_000) return NextResponse.json({ success: false, message: '拒绝原因过长' }, { status: 400 })

    const issueResponse = await githubRequest(`/issues/${number}`)
    const issue = await issueResponse.json() as { body: string; labels: Array<{ name: string }> }
    const submission = parseSubmissionFromIssueBody(issue.body)
    if (!submission) return NextResponse.json({ success: false, message: '无法解析投稿数据' }, { status: 400 })

    if (body.action === 'approve') {
      await mutateJsonFile<NavigationData>('src/navsphere/content/navigation.json', `Add approved submission #${number}`, (data) => {
        const itemId = `submission-${number}`
        if (data.navigationItems.some((category) =>
          category.items?.some((item) => item.id === itemId) ||
          category.subCategories?.some((subcategory) => subcategory.items?.some((item) => item.id === itemId)))) return data

        const category = data.navigationItems.find((item) => item.id === submission.category || item.title === submission.category)
        if (!category) throw new Error('Target category does not exist')
        const newItem = { id: itemId, title: submission.title, href: submission.url, description: submission.description, icon: '/assets/images/default-website-icon.png', enabled: true }
        const subcategory = category.subCategories?.find((item) => item.id === submission.subcategory || item.title === submission.subcategory)
        if (subcategory) subcategory.items = [...(subcategory.items ?? []), newItem]
        else category.items = [...(category.items ?? []), newItem]
        return data
      })
    }

    const finalLabel = body.action === 'approve' ? SUBMISSION_LABELS.APPROVED : SUBMISSION_LABELS.REJECTED
    const labels = issue.labels.map((label) => label.name).filter((label) => label !== SUBMISSION_LABELS.PENDING && label !== SUBMISSION_LABELS.APPROVED && label !== SUBMISSION_LABELS.REJECTED)
    await githubRequest(`/issues/${number}`, { method: 'PATCH', body: JSON.stringify({ labels: [...labels, finalLabel] }) })

    const reviewer = admin.session.user.login || 'admin'
    const comment = body.action === 'approve'
      ? `✅ **投稿已通过**\n\n该网站已成功添加到导航列表。\n\n审核人: @${reviewer}`
      : `❌ **投稿已拒绝**\n\n${body.reason ? `拒绝原因: ${body.reason}` : '感谢您的投稿，但该网站暂不符合我们的收录标准。'}\n\n审核人: @${reviewer}`
    await githubRequest(`/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body: comment }) })
    await githubRequest(`/issues/${number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) })

    return NextResponse.json({ success: true, message: body.action === 'approve' ? '投稿已通过，网站已添加到导航列表' : '投稿已拒绝' })
  } catch (error) {
    console.error('Review submission error:', error)
    return NextResponse.json({ success: false, message: `审核失败: ${error instanceof Error ? error.message : 'unknown error'}` }, { status: 500 })
  }
}
