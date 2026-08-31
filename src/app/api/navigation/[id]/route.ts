import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getFileContent, mutateJsonFile } from '@/lib/github'
import type { NavigationData, NavigationItem } from '@/types/navigation'

export const runtime = 'edge'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const { id } = await params
    const data = await getFileContent('src/navsphere/content/navigation.json') as NavigationData
    const item = data.navigationItems.find(item => item.id === id)

    if (!item) {
      return new Response('Not Found', { status: 404 })
    }

    return NextResponse.json(item)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch navigation item' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response

    const updatedItem: NavigationItem = await request.json()
    let mergedItem: NavigationItem | undefined
    await mutateJsonFile<NavigationData>(
      'src/navsphere/content/navigation.json',
      'Update navigation item',
      (data) => {
        const existingItem = data.navigationItems.find(item => item.id === id)
        if (!existingItem) throw new Error('Navigation item not found')
        mergedItem = {
          ...existingItem,
          ...updatedItem,
          id,
          items: updatedItem.items || existingItem.items || [],
          subCategories: updatedItem.subCategories || existingItem.subCategories || [],
        }
        return { navigationItems: data.navigationItems.map(item => item.id === id ? mergedItem! : item) }
      },
    )

    return NextResponse.json(mergedItem)
  } catch (error) {
    console.error('Update error:', error)
    return NextResponse.json({ error: 'Failed to update navigation' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response
    await mutateJsonFile<NavigationData>(
      'src/navsphere/content/navigation.json',
      'Delete navigation item',
      (data) => ({ navigationItems: data.navigationItems.filter(item => item.id !== id) }),
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete error:', error)
    return NextResponse.json({ error: 'Failed to delete navigation' }, { status: 500 })
  }
}
