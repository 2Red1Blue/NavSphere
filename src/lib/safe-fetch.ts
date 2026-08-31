const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const FORBIDDEN_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home', '.lan']
const MAX_REDIRECTS = 4

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch { return false }
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map(Number)
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? octets : null
}

export function isForbiddenIp(value: string): boolean {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, '')
  const ipv4 = parseIpv4(normalized)
  if (ipv4) {
    const [a, b] = ipv4
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) ||
      (a === 192 && b === 88) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0) || a >= 224
  }
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') ||
    normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:') || normalized.startsWith('2001:10:') ||
    normalized.startsWith('2001:0:') || normalized.startsWith('2001:20:') ||
    normalized.startsWith('2002:') || normalized.startsWith('::ffff:')
}

export function assertSafeUrl(value: string): URL {
  if (!isHttpUrl(value)) throw new UnsafeUrlError('Only HTTP(S) URLs are allowed')
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || FORBIDDEN_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) || isForbiddenIp(hostname)) {
    throw new UnsafeUrlError('Private or reserved network targets are not allowed')
  }
  if (url.username || url.password) throw new UnsafeUrlError('URL credentials are not allowed')
  return url
}

async function assertPublicDns(hostname: string): Promise<void> {
  if (parseIpv4(hostname) || hostname.includes(':')) {
    if (isForbiddenIp(hostname)) throw new UnsafeUrlError('Private or reserved network targets are not allowed')
    return
  }
  const answers: string[] = []
  for (const type of ['A', 'AAAA']) {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) throw new UnsafeUrlError('Unable to verify target DNS')
    const body = (await response.json()) as { Answer?: Array<{ data?: string }> }
    for (const answer of body.Answer ?? []) if (answer.data) answers.push(answer.data)
  }
  const addresses = answers.filter((answer) => parseIpv4(answer) || answer.includes(':'))
  if (addresses.length === 0) throw new UnsafeUrlError('Target hostname did not resolve')
  if (addresses.some(isForbiddenIp)) throw new UnsafeUrlError('Target resolves to a private or reserved address')
}

export interface SafeFetchOptions {
  headers?: HeadersInit
  timeoutMs?: number
  maxBytes: number
  allowedMimeTypes: readonly string[]
}

export async function safeFetch(value: string, options: SafeFetchOptions): Promise<{ response: Response; bytes: Uint8Array; finalUrl: string }> {
  let url = assertSafeUrl(value)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicDns(url.hostname)
    const response = await fetch(url, {
      headers: options.headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    })
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location')
      if (!location || redirects === MAX_REDIRECTS) throw new UnsafeUrlError('Invalid or excessive redirects')
      url = assertSafeUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) throw new Error(`Remote server returned HTTP ${response.status}`)
    const mime = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase()
    if (!options.allowedMimeTypes.includes(mime)) throw new UnsafeUrlError(`Disallowed response type: ${mime || 'unknown'}`)
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > options.maxBytes) throw new UnsafeUrlError('Remote response is too large')

    const reader = response.body?.getReader()
    if (!reader) throw new Error('Remote response body is unavailable')
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      size += chunk.byteLength
      if (size > options.maxBytes) {
        await reader.cancel()
        throw new UnsafeUrlError('Remote response is too large')
      }
      chunks.push(chunk)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return { response, bytes, finalUrl: url.toString() }
  }
  throw new UnsafeUrlError('Unable to fetch URL safely')
}
