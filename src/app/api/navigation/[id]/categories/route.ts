import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { mutateJsonFile } from '@/lib/github'
import type { NavigationData } from '@/types/navigation'

export const runtime = 'edge'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response

    const { categoryId } = await request.json()
    if (!categoryId) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 })
    }

    await mutateJsonFile<NavigationData>(
      'src/navsphere/content/navigation.json',
      `Delete category: ${categoryId}`,
      (data) => ({
        navigationItems: data.navigationItems.map((nav) => nav.id === id
          ? { ...nav, subCategories: (nav.subCategories || []).filter((cat) => cat.id !== categoryId) }
          : nav),
      }),
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete category error:', error)
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
  }
}
