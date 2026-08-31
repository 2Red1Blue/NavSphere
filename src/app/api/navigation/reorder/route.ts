import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { mutateJsonFile } from '@/lib/github'
import type { NavigationData, NavigationItem } from '@/types/navigation'

export const runtime = 'edge'

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response

    const { sourceIndex, destinationIndex, itemId } = await request.json()

    const data = await mutateJsonFile<NavigationData>(
      'src/navsphere/content/navigation.json',
      `重新排序导航项 - ${new Date().toISOString()}`,
      (current) => {
        const updatedItems = [...current.navigationItems]
        const currentIndex = updatedItems.findIndex((item) => item.id === itemId)
        const from = currentIndex >= 0 ? currentIndex : sourceIndex
        if (from < 0 || from >= updatedItems.length || destinationIndex < 0 || destinationIndex >= updatedItems.length) {
          throw new Error('无效的排序位置')
        }
        const [movedItem] = updatedItems.splice(from, 1)
        updatedItems.splice(destinationIndex, 0, movedItem)
        return { navigationItems: updatedItems }
      },
    )

    return NextResponse.json(data.navigationItems, { status: 200 })
  } catch (error) {
    console.error('重新排序导航项错误:', error)
    return NextResponse.json({
      error: '重新排序导航项失败',
      details: (error as Error).message
    }, { status: 500 })
  }
}
