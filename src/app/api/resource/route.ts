import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getFileContent, mutateJsonFile } from '@/lib/github'
import type { ResourceMetadata } from '@/types/resource-metadata'
import { uint8ArrayToBase64 } from '@/lib/buffer-utils'

export const runtime = 'edge'
const METADATA_PATH = 'src/navsphere/content/resource-metadata.json'
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/

export async function GET() {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const data = await getFileContent<ResourceMetadata>(METADATA_PATH)
    if (!Array.isArray(data.metadata)) throw new Error('Invalid data structure')
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch resource metadata:', error)
    return NextResponse.json({ error: 'Failed to fetch resource metadata' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const { image, folder = 'assets', prefix = 'img' } = await request.json() as Record<string, string>
    const match = typeof image === 'string' ? image.match(IMAGE_DATA_URL) : null
    if (!match) return NextResponse.json({ error: 'Invalid image data' }, { status: 400 })
    const binaryData = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0))
    if (binaryData.byteLength > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'Image is too large' }, { status: 413 })
    if (!/^[a-zA-Z0-9/_-]{1,80}$/.test(folder) || !/^[a-zA-Z0-9_-]{1,40}$/.test(prefix)) {
      return NextResponse.json({ error: 'Invalid asset path' }, { status: 400 })
    }
    const extension = match[1].split('/')[1].replace('jpeg', 'jpg')
    const { path: imageUrl, commitHash } = await uploadImageToGitHub(binaryData, folder, prefix, extension)
    await mutateJsonFile<ResourceMetadata>(METADATA_PATH, 'Update resource metadata', (metadata) => ({
      ...metadata,
      metadata: [{ commit: commitHash, hash: commitHash, path: imageUrl }, ...metadata.metadata],
    }))
    return NextResponse.json({ success: true, imageUrl })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save resource metadata' }, { status: 500 })
  }
}

async function uploadImageToGitHub(binaryData: Uint8Array, folder: string, prefix: string, extension: string) {
  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO
  const branch = process.env.GITHUB_BRANCH || 'main'
  const token = process.env.GITHUB_PAT
  if (!owner || !repo || !token) throw new Error('GitHub writes are not configured')
  const cleanFolder = folder.replace(/^\/+|\/+$/g, '')
  const path = `/${cleanFolder}/${prefix}_${crypto.randomUUID()}.${extension}`
  const githubPath = `public${path}`
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${githubPath}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Upload ${githubPath}`, content: uint8ArrayToBase64(binaryData), branch }),
  })
  if (!response.ok) throw new Error(`Failed to upload image: HTTP ${response.status}`)
  const result = await response.json() as { commit: { sha: string } }
  return { path, commitHash: result.commit.sha }
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  try {
    const { resourceHashes } = await request.json() as { resourceHashes: string[] }
    if (!Array.isArray(resourceHashes) || resourceHashes.length === 0 || resourceHashes.length > 100) {
      return NextResponse.json({ error: 'Invalid resource hashes' }, { status: 400 })
    }
    const hashes = new Set(resourceHashes.filter((hash) => typeof hash === 'string' && hash.length <= 100))
    let deletedCount = 0
    await mutateJsonFile<ResourceMetadata>(METADATA_PATH, `Delete ${hashes.size} resource(s)`, (metadata) => {
      const next = metadata.metadata.filter((item) => !hashes.has(item.hash))
      deletedCount = metadata.metadata.length - next.length
      return { ...metadata, metadata: next }
    })
    return NextResponse.json({ success: true, deletedCount })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to delete resources' }, { status: 500 })
  }
}
