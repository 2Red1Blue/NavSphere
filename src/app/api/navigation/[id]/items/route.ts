import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getFileContent, mutateJsonFile } from '@/lib/github'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'

export const runtime = 'edge'
const FILE_PATH = 'src/navsphere/content/navigation.json'
type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Context) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const { id } = await params
    const data = await getFileContent<NavigationData>(FILE_PATH)
    const item = data.navigationItems.find((entry) => entry.id === id)
    return item
      ? NextResponse.json(item.items ?? [])
      : NextResponse.json({ error: 'Navigation not found' }, { status: 404 })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: Context) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const { id } = await params
    const newItem = await request.json() as NavigationSubItem
    await mutateJsonFile<NavigationData>(FILE_PATH, 'Add navigation item', (data) => ({
      navigationItems: data.navigationItems.map((item) => item.id === id
        ? { ...item, items: [...(item.items ?? []), newItem] }
        : item),
    }))
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to add item' }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: Context) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const { id } = await params
    const { index, item } = await request.json() as { index: number; item: NavigationSubItem }
    await mutateJsonFile<NavigationData>(FILE_PATH, 'Update navigation item', (data) => ({
      navigationItems: data.navigationItems.map((navigation) => {
        if (navigation.id !== id) return navigation
        const items = [...(navigation.items ?? [])]
        if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error('Invalid item index')
        items[index] = item
        return { ...navigation, items }
      }),
    }))
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const { id } = await params
    const { index } = await request.json() as { index: number }
    await mutateJsonFile<NavigationData>(FILE_PATH, 'Delete navigation item', (data) => ({
      navigationItems: data.navigationItems.map((navigation) => navigation.id === id
        ? { ...navigation, items: (navigation.items ?? []).filter((_, itemIndex) => itemIndex !== index) }
        : navigation),
    }))
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
  }
}
