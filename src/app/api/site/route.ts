import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getFileContent, GitHubFileNotFoundError, replaceJsonFile } from '@/lib/github'
import type { SiteInfo } from '@/types/site'

export const runtime = 'edge'

export async function GET() {
  try {
    const data = await getFileContent('src/navsphere/content/site.json') as SiteInfo
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to read site data:', error)
    if (error instanceof GitHubFileNotFoundError) return NextResponse.json({
      basic: {
        title: '',
        description: '',
        keywords: ''
      },
      appearance: {
        logo: '',
        favicon: '',
        theme: 'system'
      },
      navigation: {
        linkTarget: '_blank'
      }
    })
    return NextResponse.json({ error: 'Site data is unavailable' }, { status: 502 })
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response

    const data: SiteInfo = await request.json()

    // 提交到 GitHub
    await replaceJsonFile(
      'src/navsphere/content/site.json',
      data,
      'Update site configuration',
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to save site data:', error)
    return NextResponse.json(
      { error: 'Failed to save site data' },
      { status: 500 }
    )
  }
}
