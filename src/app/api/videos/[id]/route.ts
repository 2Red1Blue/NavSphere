import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getFileContent, mutateJsonFile } from '@/lib/github'
import type { NavigationData, NavigationItem } from '@/types/navigation'

export const runtime = 'edge'
const FILE_PATH = 'src/navsphere/content/videos.json'
type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Context) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const { id } = await params
    const data = await getFileContent<NavigationData>(FILE_PATH)
    const item = data.navigationItems.find((entry) => entry.id === id)
    return item ? NextResponse.json(item) : NextResponse.json({ error: 'Item not found' }, { status: 404 })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch videos data', details: (error as Error).message }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: Context) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const { id } = await params
    const updatedItem = await request.json() as Partial<NavigationItem>
    await mutateJsonFile<NavigationData>(FILE_PATH, 'Update videos data', (data) => ({
      navigationItems: data.navigationItems.map((item) => item.id === id ? { ...item, ...updatedItem, id } : item),
    }))
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update videos data', details: (error as Error).message }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const { id } = await params
    await mutateJsonFile<NavigationData>(FILE_PATH, 'Delete videos data', (data) => ({
      navigationItems: data.navigationItems.filter((item) => item.id !== id),
    }))
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete videos data', details: (error as Error).message }, { status: 500 })
  }
}
