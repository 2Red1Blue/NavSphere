export interface ArchivePointer {
  content_archive_key: string | null
  content_archive_sha256: string | null
  content_archive_version: number | null
  content_archive_bytes: number | null
  content_archived_at: string | null
}

export interface ArchiveRow extends ArchivePointer {
  url_hash: string
  url: string
  source: string
  original_url: string | null
  original_url_provenance: string | null
  discovered_at: string
  content: string | null
  content_hash: string | null
  content_version: number
  content_format: string | null
  content_quality: string
  content_chars: number
  content_quality_score: number
  content_extracted_at: string | null
  content_source: string | null
  approved_for_publication: number
  fulltext_publication_allowed: number
  fulltext_revoked_at: string | null
  fulltext_control_version: number
}

/** Deliberately no expiration/delete port: an archive may be the only body copy. */
export interface ArchiveKV {
  get(key: string, type: 'text'): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

export const ARCHIVE_POINTER_COLUMNS = [
  'content_archive_key', 'content_archive_sha256', 'content_archive_version',
  'content_archive_bytes', 'content_archived_at',
] as const satisfies readonly (keyof ArchivePointer)[]

export const ARCHIVE_COLUMNS = [
  'url_hash', 'url', 'source', 'original_url', 'original_url_provenance', 'discovered_at',
  'content', 'content_hash', 'content_version', 'content_format', 'content_quality',
  'content_chars', 'content_quality_score', 'content_extracted_at', 'content_source',
  'approved_for_publication', 'fulltext_publication_allowed', 'fulltext_revoked_at',
  'fulltext_control_version', ...ARCHIVE_POINTER_COLUMNS,
] as const satisfies readonly (keyof ArchiveRow)[]

export const MAX_ARCHIVE_BODY_BYTES = 800_000
// JSON may escape each single-byte control character as six ASCII bytes.
const MAX_ARCHIVE_OBJECT_BYTES = MAX_ARCHIVE_BODY_BYTES * 6 + 2_048
const ARCHIVE_TIMEOUT_MS = 5_000
const ID_PATTERN = /^[a-f0-9]{16,64}$/i
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const KEY_PATTERN = /^feed-body\/v1\/([a-fA-F0-9]{16,64})\/(0|[1-9][0-9]*)\/([a-f0-9]{64})$/
const OBJECT_FIELDS = ['schema', 'id', 'version', 'format', 'body', 'sha256', 'bytes']
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function safeVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return false
  const canonical = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_, fraction: string) => `.${fraction.padEnd(3, '0')}Z`) : value.replace('Z', '.000Z')
  return date.toISOString() === canonical
}

function validKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length > 180) return false
  const match = KEY_PATTERN.exec(key)
  return !!match && safeVersion(Number(match[2])) && SHA256_PATTERN.test(match[3])
}

function objectKey(id: string, version: number, sha256: string): string {
  return `feed-body/v1/${id}/${version}/${sha256}`
}

export function archivePointer(row: ArchiveRow): boolean {
  return ID_PATTERN.test(row.url_hash)
    && safeVersion(row.content_version)
    && safeVersion(row.content_archive_version)
    && row.content_archive_version === row.content_version
    && typeof row.content_archive_sha256 === 'string'
    && SHA256_PATTERN.test(row.content_archive_sha256)
    && safeVersion(row.content_archive_bytes)
    && row.content_archive_bytes > 0
    && row.content_archive_bytes <= MAX_ARCHIVE_BODY_BYTES
    && validTimestamp(row.content_archived_at)
    && row.content_archive_key === objectKey(row.url_hash, row.content_version, row.content_archive_sha256)
}

function bodyBytes(body: unknown): Uint8Array {
  if (typeof body !== 'string') throw new Error('ARCHIVE_INVALID_BODY')
  if (body.length > MAX_ARCHIVE_BODY_BYTES) throw new Error('ARCHIVE_TOO_LARGE')
  const bytes = encoder.encode(body)
  if (bytes.byteLength > MAX_ARCHIVE_BODY_BYTES) throw new Error('ARCHIVE_TOO_LARGE')
  // Reject lone surrogates: UTF-8 encoding must not silently replace original text.
  if (decoder.decode(bytes) !== body) throw new Error('ARCHIVE_INVALID_BODY')
  return bytes
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Body(body: string): Promise<string> {
  return digest(bodyBytes(body))
}

export async function makeArchiveObject(row: ArchiveRow): Promise<{ key: string; value: string; sha256: string; bytes: number }> {
  const { url_hash: id, content_version: version, content_format: format, content: body } = row
  if (!ID_PATTERN.test(id) || !safeVersion(version)
    || (format !== null && format !== 'markdown_v1')) throw new Error('ARCHIVE_INVALID_SNAPSHOT')
  const encoded = bodyBytes(body)
  if (!encoded.byteLength) throw new Error('ARCHIVE_INVALID_BODY')
  const sha256 = await digest(encoded)
  const bytes = encoded.byteLength
  return {
    key: objectKey(id, version, sha256), sha256, bytes,
    value: JSON.stringify({ schema: 1, id, version, format, body, sha256, bytes }),
  }
}

async function boundedStorage<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutError = new Error('ARCHIVE_TIMEOUT')
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timeoutError), ARCHIVE_TIMEOUT_MS) }),
    ])
  } catch (error) {
    throw error === timeoutError ? timeoutError : new Error('ARCHIVE_UNAVAILABLE')
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function checkObjectSize(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('ARCHIVE_INVALID_OBJECT')
  if (value.length > MAX_ARCHIVE_OBJECT_BYTES || encoder.encode(value).byteLength > MAX_ARCHIVE_OBJECT_BYTES) throw new Error('ARCHIVE_TOO_LARGE')
}

export async function readArchiveObject(kv: ArchiveKV | undefined, key: string): Promise<string | null> {
  if (!validKey(key)) throw new Error('ARCHIVE_INVALID_KEY')
  if (!kv) throw new Error('ARCHIVE_UNAVAILABLE')
  const value = await boundedStorage(() => kv.get(key, 'text'))
  if (value !== null) checkObjectSize(value)
  return value
}

export async function writeArchiveObject(kv: ArchiveKV | undefined, key: string, value: string): Promise<void> {
  if (!validKey(key)) throw new Error('ARCHIVE_INVALID_KEY')
  checkObjectSize(value)
  if (!kv) throw new Error('ARCHIVE_UNAVAILABLE')
  await boundedStorage(() => kv.put(key, value))
}

function parseObject(value: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('ARCHIVE_INVALID_OBJECT') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('ARCHIVE_INVALID_OBJECT')
  const object = parsed
  if (Object.keys(object).length !== OBJECT_FIELDS.length
    || !OBJECT_FIELDS.every((field) => Object.hasOwn(object, field))) throw new Error('ARCHIVE_INVALID_OBJECT')
  return object as Record<string, unknown>
}

export async function readArchiveBody(kv: ArchiveKV | undefined, row: ArchiveRow): Promise<string> {
  const snapshot = { ...row }
  if (!archivePointer(snapshot)) throw new Error('ARCHIVE_INVALID_POINTER')
  const value = await readArchiveObject(kv, snapshot.content_archive_key!)
  if (value === null) throw new Error('ARCHIVE_MISSING')
  const object = parseObject(value)
  if (object.schema !== 1 || object.id !== snapshot.url_hash || object.version !== snapshot.content_version
    || (object.format !== null && object.format !== 'markdown_v1')
    || object.format !== snapshot.content_format || object.sha256 !== snapshot.content_archive_sha256
    || object.bytes !== snapshot.content_archive_bytes || typeof object.body !== 'string') throw new Error('ARCHIVE_INTEGRITY')
  const encoded = bodyBytes(object.body)
  if (encoded.byteLength !== object.bytes || await digest(encoded) !== object.sha256) throw new Error('ARCHIVE_INTEGRITY')
  return object.body
}

export function sameArchiveSnapshot(a: ArchiveRow, b: ArchiveRow): boolean {
  return ARCHIVE_COLUMNS.every((field) => a[field] === b[field])
}

export function archiveSnapshotGuard(row: ArchiveRow, startIndex = 1): { sql: string; values: (string | number | null)[] } {
  if (!Number.isSafeInteger(startIndex) || startIndex < 1 || startIndex + ARCHIVE_COLUMNS.length > Number.MAX_SAFE_INTEGER) throw new Error('ARCHIVE_INVALID_SNAPSHOT')
  const values = ARCHIVE_COLUMNS.map((field) => row[field])
  if (values.some((value) => value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))) throw new Error('ARCHIVE_INVALID_SNAPSHOT')
  return { sql: ARCHIVE_COLUMNS.map((field, index) => `"${field}" IS ?${startIndex + index}`).join(' AND '), values }
}
