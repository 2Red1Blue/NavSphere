import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getFileContent, GitHubFileNotFoundError, replaceJsonFile } from '@/lib/github'
import type { NavigationData } from '@/types/navigation'

export const runtime = 'edge'
const FILE_PATH = 'src/navsphere/content/videos.json'

function validate(data: NavigationData): void {
  if (!data || typeof data !== 'object' || !Array.isArray(data.navigationItems)) {
    throw new Error('Invalid videos data')
  }
}

export async function GET() {
  try {
    return NextResponse.json(await getFileContent<NavigationData>(FILE_PATH))
  } catch (error) {
    console.error('Failed to fetch videos data:', error)
    if (error instanceof GitHubFileNotFoundError) return NextResponse.json({ navigationItems: [] })
    return NextResponse.json({ error: 'Videos data is unavailable' }, { status: 502 })
  }
}

async function write(request: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const data = await request.json() as NavigationData
    validate(data)
    await replaceJsonFile(FILE_PATH, data, 'Update videos data')
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save videos data', details: (error as Error).message }, { status: 500 })
  }
}

export const POST = write
export const PUT = write
