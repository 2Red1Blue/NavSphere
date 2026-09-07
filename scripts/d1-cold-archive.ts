import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { validateCapacityPolicySnapshot } from '../src/lib/feed-archive-maintenance'
import type { CapacityPolicySnapshot } from '../src/lib/feed-archive-maintenance'

type Mode = 'audit' | 'stage' | 'compact' | 'rehydrate'
type CliOptions = { mode: Mode; limit: number; id?: string; capacityPolicyFile?: string }
type Config = { feedUrl: string; apiKey: string }
type Item = { url_hash: string; code: string }
type InventoryStats = { scanned: number; invalidDates: number; truncated: boolean }
type Report = Partial<InventoryStats> & { status: 'completed' | 'failed'; code: string; items: Item[]; candidates?: number; moreCandidates?: boolean }
type Candidate = { url_hash: string; state: 'hot' | 'staged'; bytes: number }
const ID = /^[a-f0-9]{16,64}$/
const MAX_RESPONSE_BYTES = 65_536
// This repository is nested inside personal-content-os, whose .env is the sole
// workspace credential file. NavSphere/.env must not become a second source.
export const PROJECT_ENV_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env')
const OUTCOME_CODES = new Set(['STAGED', 'ALREADY_STAGED', 'ALREADY_COLD', 'COMPACTED', 'REHYDRATED',
  'ALREADY_HOT', 'ARCHIVE_DISABLED', 'COMPACTION_DISABLED', 'STAGING_TOO_RECENT', 'STATE_CHANGED',
  'NOT_FOUND', 'NOT_STAGED', 'NO_CONTENT', 'NOT_ELIGIBLE', 'WRITE_BUDGET_EXHAUSTED',
  'ARCHIVE_UNAVAILABLE', 'UNAUTHORIZED', 'INVALID_REQUEST', 'INVALID_OPTIONS', 'CAPACITY_POLICY_REQUIRED',
  'INVALID_CAPACITY_POLICY', 'CAPACITY_COMPACTION_NOT_REQUIRED'])
const SUCCESS_CODES: Record<Exclude<Mode, 'audit'>, readonly string[]> = {
  stage: ['STAGED', 'ALREADY_STAGED'], compact: ['COMPACTED', 'ALREADY_COLD'],
  rehydrate: ['REHYDRATED', 'ALREADY_HOT'],
}
const ERROR_STATUS: Record<string, number> = {
  ARCHIVE_DISABLED: 409, COMPACTION_DISABLED: 409, STAGING_TOO_RECENT: 409,
  STATE_CHANGED: 409, NOT_FOUND: 404, NOT_STAGED: 409, NO_CONTENT: 409,
  NOT_ELIGIBLE: 409, WRITE_BUDGET_EXHAUSTED: 429, ARCHIVE_UNAVAILABLE: 503,
  UNAUTHORIZED: 401, INVALID_REQUEST: 400, INVALID_OPTIONS: 400, ALREADY_COLD: 409,
  CAPACITY_POLICY_REQUIRED: 409, INVALID_CAPACITY_POLICY: 400, CAPACITY_COMPACTION_NOT_REQUIRED: 409,
}

export function parseArchiveCli(argv: string[]): CliOptions {
  const args = argv[0] === '--' ? argv.slice(1) : argv
  const options: CliOptions = { mode: 'audit', limit: 20 }
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (seen.has(flag)) throw new Error('INVALID_OPTIONS')
    seen.add(flag)
    if (flag === '--confirmed-recovery' || flag === '--confirmed-cold-reader') continue
    const value = args[++index]
    if (flag === '--mode' && ['audit', 'stage', 'compact', 'rehydrate'].includes(value)) options.mode = value as Mode
    else if (flag === '--id' && ID.test(value ?? '')) options.id = value
    else if (flag === '--limit' && /^(?:[1-9]|1[0-9]|20)$/.test(value ?? '')) options.limit = Number(value)
    else if (flag === '--capacity-policy-file' && value && value.length <= 1_024) options.capacityPolicyFile = value
    else throw new Error('INVALID_OPTIONS')
  }
  if (options.mode === 'compact' && (!seen.has('--confirmed-recovery') || !seen.has('--confirmed-cold-reader'))) {
    throw new Error('CONFIRMATION_REQUIRED')
  }
  if (options.mode === 'compact' && !options.capacityPolicyFile) throw new Error('CAPACITY_POLICY_REQUIRED')
  if (options.mode !== 'compact' && options.capacityPolicyFile) throw new Error('INVALID_OPTIONS')
  if (options.mode === 'rehydrate' && !options.id) throw new Error('EXACT_ID_REQUIRED')
  return options
}

function readCapacityPolicySnapshot(path: string): CapacityPolicySnapshot | null {
  try {
    const raw = readFileSync(path, 'utf8')
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const policy = (parsed as Record<string, unknown>).capacityPolicy ?? parsed
    return validateCapacityPolicySnapshot(policy, new Date()) === 'compact' ? policy as CapacityPolicySnapshot : null
  } catch { return null }
}

function failed(code: string, items: Item[] = []): Report { return { status: 'failed', code, items } }

async function bodyObject(response: Response): Promise<Record<string, unknown> | null> {
  const reader = response.body?.getReader()
  if (!reader) return null
  let bytes = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); return null }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

function candidates(value: unknown): Candidate[] | null {
  if (!Array.isArray(value) || value.length > 200) return null
  const rows: Candidate[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || !ID.test(item.url_hash) || seen.has(item.url_hash)
      || !['hot', 'staged'].includes(item.state) || !Number.isSafeInteger(item.bytes) || item.bytes < 0) return null
    seen.add(item.url_hash)
    rows.push({ url_hash: item.url_hash, state: item.state, bytes: item.bytes })
  }
  return rows
}

function inventoryStats(value: Record<string, unknown> | null): InventoryStats | null {
  if (!value || typeof value.scanned !== 'number' || !Number.isSafeInteger(value.scanned)
    || value.scanned < 0 || value.scanned > 200 || typeof value.invalidDates !== 'number'
    || !Number.isSafeInteger(value.invalidDates) || value.invalidDates < 0
    || typeof value.truncated !== 'boolean') return null
  // invalidDates covers all hot bodies, not only the bounded candidate scan.
  return { scanned: value.scanned, invalidDates: value.invalidDates, truncated: value.truncated }
}

export async function runArchiveCli(options: CliOptions, config: Config, fetchImpl: typeof fetch = fetch): Promise<Report> {
  let endpoint: URL
  try {
    endpoint = new URL(config.feedUrl)
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || !/^\/api\/feed\/?$/.test(endpoint.pathname) || !config.apiKey.trim()) return failed('INVALID_CONFIGURATION')
    endpoint.pathname = '/api/feed/archive'
  } catch { return failed('INVALID_CONFIGURATION') }
  const capacityPolicy = options.mode === 'compact' && options.capacityPolicyFile
    ? readCapacityPolicySnapshot(options.capacityPolicyFile) : undefined
  if (options.mode === 'compact' && !capacityPolicy) return failed('INVALID_CAPACITY_POLICY')
  const request = async (url: URL, method: string) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetchImpl(url, { method, redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...(method === 'POST' && capacityPolicy
            ? { 'X-Content-Archive-Capacity-Policy': JSON.stringify(capacityPolicy) } : {}),
        } })
      return { ok: response.ok, status: response.status, value: await bodyObject(response) }
    } finally { clearTimeout(timer) }
  }
  const items: Item[] = []
  let stats: InventoryStats | undefined
  const fail = (code: string): Report => ({ ...failed(code, items), ...stats })
  let moreCandidates = false
  try {
    let ids = options.id ? [options.id] : []
    if (options.mode === 'audit' || !options.id) {
      const inventory = await request(endpoint, 'GET')
      const rows = candidates(inventory.value?.candidates)
      if (!inventory.ok) return fail(inventory.status === 401 ? 'UNAUTHORIZED' : 'ARCHIVE_UNAVAILABLE')
      const audited = inventoryStats(inventory.value)
      if (!rows || !audited || rows.length > audited.scanned
        || inventory.value?.code !== 'AUDIT_COMPLETED') return fail('INVALID_RESPONSE')
      stats = audited
      if (options.mode === 'audit') return { status: 'completed', code: 'AUDIT_COMPLETED', items,
        candidates: rows.length, ...stats }
      const selected = rows.filter(row => row.state === (options.mode === 'stage' ? 'hot' : 'staged'))
      const capacityBounded = options.mode === 'compact' && capacityPolicy
        ? (() => {
          let remaining = capacityPolicy.bytesToRelease
          return selected.filter((row) => {
            if (row.bytes > remaining) return false
            remaining -= row.bytes
            return true
          })
        })() : selected
      moreCandidates = stats.truncated || selected.length > capacityBounded.length || capacityBounded.length > options.limit
      ids = capacityBounded.slice(0, options.limit).map(row => row.url_hash)
    }
    for (const id of ids) {
      const url = new URL(endpoint)
      url.searchParams.set('action', options.mode)
      url.searchParams.set('id', id)
      const response = await request(url, 'POST')
      const code = response.value?.code
      if (typeof code !== 'string' || !OUTCOME_CODES.has(code)) return fail('INVALID_RESPONSE')
      if (response.ok && (response.value?.url_hash !== id
        || !SUCCESS_CODES[options.mode].includes(code))) return fail('INVALID_RESPONSE')
      if (!response.ok && (ERROR_STATUS[code] !== response.status
        || (response.value?.url_hash !== undefined && response.value.url_hash !== id)
        || (['COMPACTION_DISABLED', 'STAGING_TOO_RECENT'].includes(code) && options.mode !== 'compact')
        || (['NO_CONTENT', 'WRITE_BUDGET_EXHAUSTED', 'ALREADY_COLD'].includes(code) && options.mode !== 'stage'))) {
        return fail('INVALID_RESPONSE')
      }
      items.push({ url_hash: id, code })
      // No automatic POST retries after an ambiguous network outcome.
      if (!response.ok) return fail(code)
    }
    return { status: 'completed', code: 'BATCH_COMPLETED', items, moreCandidates, ...stats }
  } catch { return fail('REQUEST_FAILED') }
}

async function main() {
  try {
    const options = parseArchiveCli(process.argv.slice(2))
    const loader = (process as NodeJS.Process & { loadEnvFile?: (path: string) => void }).loadEnvFile
    if (!loader) throw new Error('ENV_LOADER_UNAVAILABLE')
    // Node's native dotenv parser; only the project root .env, never user-global credentials.
    loader(PROJECT_ENV_FILE)
    const report = await runArchiveCli(options, {
      feedUrl: process.env.FEED_API_URL ?? 'https://navsphere-4se.pages.dev/api/feed',
      apiKey: process.env.CONTENT_OS_API_KEY ?? '',
    })
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.status === 'completed' ? 0 : 2
  } catch {
    console.log(JSON.stringify(failed('INVALID_OPTIONS_OR_CONFIGURATION')))
    process.exitCode = 2
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main()
