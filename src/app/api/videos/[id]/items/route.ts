import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getFileContent, mutateJsonFile } from '@/lib/github'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'

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
    return item ? NextResponse.json(item.items ?? []) : NextResponse.json({ error: 'Navigation not found' }, { status: 404 })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: Context) {
  return updateItems(request, params, 'add')
}

export async function PUT(request: Request, { params }: Context) {
  return updateItems(request, params, 'replace')
}

export async function DELETE(request: Request, { params }: Context) {
  return updateItems(request, params, 'delete')
}

async function updateItems(request: Request, params: Promise<{ id: string }>, action: 'add' | 'replace' | 'delete') {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const { id } = await params
    const body = await request.json() as NavigationSubItem | { index: number; item?: NavigationSubItem }
    await mutateJsonFile<NavigationData>(FILE_PATH, `${action} video item`, (data) => ({
      navigationItems: data.navigationItems.map((navigation) => {
        if (navigation.id !== id) return navigation
        const items = [...(navigation.items ?? [])]
        if (action === 'add') items.push(body as NavigationSubItem)
        else {
          const { index, item } = body as { index: number; item?: NavigationSubItem }
          if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error('Invalid item index')
          if (action === 'replace' && item) items[index] = item
          else if (action === 'delete') items.splice(index, 1)
        }
        return { ...navigation, items }
      }),
    }))
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: `Failed to ${action} item` }, { status: 500 })
  }
}
