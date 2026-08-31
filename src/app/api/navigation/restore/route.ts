import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getFileContent, GitHubFileNotFoundError, replaceJsonFile } from '@/lib/github'
import type { NavigationData } from '@/types/navigation'

export const runtime = 'edge'

export async function POST() {
  try {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response

    // 检查默认数据文件是否存在
    try {
      const defaultData = await getFileContent<NavigationData>('src/navsphere/content/navigation-default.json')

      // 验证默认数据格式
      if (!defaultData || typeof defaultData !== 'object' || !defaultData.navigationItems) {
        return NextResponse.json(
          {
            error: 'Invalid default data format',
            details: 'navigation-default.json does not contain valid navigation data'
          },
          { status: 400 }
        )
      }

      // 将默认数据写入到navigation.json
      await replaceJsonFile(
        'src/navsphere/content/navigation.json',
        defaultData,
        'Restore navigation data to default',
      )

      return NextResponse.json(defaultData)
    } catch (fileError) {
      // 检查是否是文件不存在的错误
      if (fileError instanceof GitHubFileNotFoundError) {
        return NextResponse.json(
          {
            error: 'Default data file not found',
            details: 'navigation-default.json file does not exist in the repository'
          },
          { status: 404 }
        )
      }
      throw fileError
    }
  } catch (error) {
    console.error('Failed to restore navigation data:', error)
    return NextResponse.json(
      {
        error: 'Failed to restore navigation data',
        details: (error as Error).message
      },
      { status: 500 }
    )
  }
}
