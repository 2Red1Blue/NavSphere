import { stringToBase64 } from '@/lib/buffer-utils'

const GITHUB_API = 'https://api.github.com'

export class GitHubFileNotFoundError extends Error {
  readonly status = 404
  constructor(readonly path: string) {
    super(`GitHub file not found: ${path}`)
    this.name = 'GitHubFileNotFoundError'
  }
}

export class GitHubApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

interface GitHubFileSnapshot<T> { value: T; sha: string }
interface GetFileOptions<T> { defaultValue?: T }

function repositoryConfig() {
  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO
  const token = process.env.GITHUB_PAT
  const branch = process.env.GITHUB_BRANCH || 'main'
  if (!owner || !repo) throw new GitHubApiError('GitHub repository is not configured')
  return { owner, repo, token, branch }
}

function githubHeaders(token?: string): HeadersInit {
  return {
    Accept: 'application/vnd.github.v3+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'User-Agent': 'NavSphere',
  }
}

async function githubError(response: Response, operation: string): Promise<GitHubApiError> {
  let detail = response.statusText
  try {
    const body = (await response.json()) as { message?: string }
    detail = body.message || detail
  } catch { /* non-JSON gateway response */ }
  return new GitHubApiError(`${operation}: ${detail}`, response.status)
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\n/g, ''))
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

function encodeGitHubPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

async function readSnapshot<T>(path: string): Promise<GitHubFileSnapshot<T>> {
  const { owner, repo, token, branch } = repositoryConfig()
  let response: Response
  try {
    response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeGitHubPath(path)}?ref=${encodeURIComponent(branch)}`, {
      headers: githubHeaders(token),
      cache: 'no-store',
    })
  } catch (error) {
    throw new GitHubApiError(`Failed to read ${path}: ${error instanceof Error ? error.message : 'network error'}`)
  }
  if (response.status === 404) throw new GitHubFileNotFoundError(path)
  if (!response.ok) throw await githubError(response, `Failed to read ${path}`)
  const file = (await response.json()) as { content?: string; sha?: string; type?: string }
  if (file.type !== 'file' || !file.content || !file.sha) throw new GitHubApiError(`Invalid GitHub file response for ${path}`)
  try {
    return { value: JSON.parse(decodeBase64(file.content)) as T, sha: file.sha }
  } catch (error) {
    throw new GitHubApiError(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : 'parse error'}`)
  }
}

export async function getFileContent<T = unknown>(path: string, options: GetFileOptions<T> = {}): Promise<T> {
  try {
    return (await readSnapshot<T>(path)).value
  } catch (error) {
    if (error instanceof GitHubFileNotFoundError && 'defaultValue' in options) return options.defaultValue as T
    throw error
  }
}

export async function mutateJsonFile<T>(
  path: string,
  message: string,
  mutation: (current: T) => T | Promise<T>,
  options: { attempts?: number } = {},
): Promise<T> {
  const { owner, repo, token, branch } = repositoryConfig()
  if (!token) throw new GitHubApiError('GITHUB_PAT is not configured')
  const attempts = Math.max(1, Math.min(options.attempts ?? 3, 5))

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const snapshot = await readSnapshot<T>(path)
    const next = await mutation(structuredClone(snapshot.value))
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeGitHubPath(path)}`, {
      method: 'PUT',
      headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: stringToBase64(JSON.stringify(next, null, 2)),
        sha: snapshot.sha,
        branch,
      }),
    })
    if (response.ok) return next
    if ((response.status === 409 || response.status === 422) && attempt < attempts) continue
    throw await githubError(response, `Failed to update ${path}`)
  }
  throw new GitHubApiError(`Failed to update ${path} after repeated conflicts`, 409)
}

export async function replaceJsonFile<T>(path: string, value: T, message: string): Promise<T> {
  return mutateJsonFile(path, message, () => value, { attempts: 1 })
}
