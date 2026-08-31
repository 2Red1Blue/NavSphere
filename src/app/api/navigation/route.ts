import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getFileContent, GitHubFileNotFoundError, replaceJsonFile } from '@/lib/github'
import type { NavigationData, NavigationItem } from '@/types/navigation'

export const runtime = 'edge'

export async function GET() {
  try {
    const data = await getFileContent('src/navsphere/content/navigation.json')
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch navigation data:', error)
    if (error instanceof GitHubFileNotFoundError) return NextResponse.json({ navigationItems: [] })
    return NextResponse.json({ error: 'Navigation data is unavailable' }, { status: 502 })
  }
}

async function validateAndSaveNavigationData(data: NavigationData) {
  // 严格验证数据结构
  if (!data || typeof data !== 'object') {
    console.error('Invalid data: not an object')
    throw new Error('Invalid navigation data: not an object')
  }

  if (!('navigationItems' in data)) {
    console.error('Missing navigationItems key')
    throw new Error('Invalid navigation data: missing navigationItems')
  }

  if (!Array.isArray(data.navigationItems)) {
    console.error('navigationItems is not an array', typeof data.navigationItems)
    throw new Error('Invalid navigation data: navigationItems must be an array')
  }

  // 额外的数据验证
  const invalidItems = data.navigationItems.filter((item: NavigationItem) =>
    !item.id ||
    !item.title ||
    (item.items && !Array.isArray(item.items)) ||
    (item.subCategories && !Array.isArray(item.subCategories))
  )

  if (invalidItems.length > 0) {
    console.error('Invalid navigation items:', invalidItems)
    throw new Error('Invalid navigation data: some items are malformed')
  }

  await replaceJsonFile(
    'src/navsphere/content/navigation.json',
    data,
    'Update navigation data',
  )
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response

    const data = await request.json()
    await validateAndSaveNavigationData(data)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to save navigation data:', error)
    return NextResponse.json(
      {
        error: 'Failed to save navigation data',
        details: (error as Error).message
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response

    const data = await request.json()
    await validateAndSaveNavigationData(data)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to update navigation data:', error)
    return NextResponse.json(
      {
        error: 'Failed to update navigation data',
        details: (error as Error).message
      },
      { status: 500 }
    )
  }
}
