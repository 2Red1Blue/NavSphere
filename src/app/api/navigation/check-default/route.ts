import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getFileContent, GitHubFileNotFoundError } from '@/lib/github'
import type { NavigationData } from '@/types/navigation'

export const runtime = 'edge'

export async function GET() {
  try {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response

    try {
      const defaultData = await getFileContent<NavigationData>('src/navsphere/content/navigation-default.json')

      // 验证文件格式
      const isValid = defaultData &&
        typeof defaultData === 'object' &&
        Array.isArray(defaultData.navigationItems)

      return NextResponse.json({
        exists: true,
        valid: isValid,
        itemCount: isValid ? defaultData.navigationItems.length : 0
      })
    } catch (error) {
      // 文件不存在
      if (error instanceof GitHubFileNotFoundError) {
        return NextResponse.json({
          exists: false,
          valid: false,
          itemCount: 0
        })
      }
      throw error
    }
  } catch (error) {
    console.error('Failed to check default file:', error)
    return NextResponse.json(
      {
        error: 'Failed to check default file',
        details: (error as Error).message
      },
      { status: 500 }
    )
  }
}
