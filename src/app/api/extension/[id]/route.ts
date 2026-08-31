import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { mutateJsonFile } from '@/lib/github'
import type { NavigationCategory, NavigationData, NavigationItem } from '@/types/navigation'

export const runtime = 'edge'

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
          subCategories: [
            ...new Map(
              [
                ...(existingItem.subCategories || []),
                ...(updatedItem.subCategories || []),
              ].map((subCategory) => {
                const existingSubCategory = existingItem.subCategories?.find(
                  (candidate) => candidate.id === subCategory.id,
                )
                return [
                  subCategory.id,
                  {
                    ...existingSubCategory,
                    ...subCategory,
                    items: [
                      ...new Map(
                        [
                          ...(existingSubCategory?.items || []),
                          ...(subCategory.items || []),
                        ].map((item) => [item.id, item]),
                      ).values(),
                    ],
                  },
                ] as [string, NavigationCategory]
              }),
            ).values(),
          ],
        }
        return { navigationItems: data.navigationItems.map(item => item.id === id ? mergedItem! : item) }
      },
    )

    return NextResponse.json(mergedItem)
  } catch (error) {
    console.error('Update error:', error)
    if (error instanceof Error && error.message === 'Navigation item not found') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to update navigation' }, { status: 500 })
  }
}
