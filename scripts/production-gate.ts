import { readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = dirname(SCRIPT_DIR)
const MIGRATIONS_DIR = join(PROJECT_DIR, 'migrations')
const MAX_RESPONSE_BYTES = 256 * 1024
const MAX_COMMAND_OUTPUT_BYTES = 128 * 1024
const COMMAND_TIMEOUT_MS = 30_000
const MIGRATION_QUERY = 'SELECT id, name, applied_at FROM d1_migrations ORDER BY id'
const COLUMNS_QUERY = "SELECT name FROM pragma_table_info('articles') WHERE name IN ('content_format','content_quality','content_hash','content_chars','content_quality_score','content_version','content_extracted_at','content_source','fulltext_publication_allowed','fulltext_revoked_at') ORDER BY name"
const REQUIRED_COLUMNS = [
  'content_format',
  'content_quality',
  'content_hash',
  'content_chars',
  'content_quality_score',
  'content_version',
  'content_extracted_at',
  'content_source',
  'fulltext_publication_allowed',
  'fulltext_revoked_at',
]

export type GateStatus = 'passed' | 'failed'

export type GateCheck = {
  name: string
  status: GateStatus
  code: string
  httpStatus?: number
  itemCount?: number
}

export type GateResult = {
  status: GateStatus
  checks: GateCheck[]
}

type CommandResult = { code: number; stdout: string; stderr: string }
type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>
type FetchLike = typeof fetch

export type ProductionGateOptions = {
  baseUrl?: string
  detailId?: string
  timeoutMs?: number
  fetchImpl?: FetchLike
  commandRunner?: CommandRunner
  migrationNames?: string[]
}

export function runCommandWithLimits(
  command: string,
  args: string[],
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: PROJECT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: process.platform !== 'win32',
      env: process.env,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let settled = false
    let timedOut = false
    let abortCode: number | undefined
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (forceTimer) clearTimeout(forceTimer)
      resolve(result)
    }
    const killProcessTree = (signal: NodeJS.Signals) => {
      if (child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, signal)
          return
        } catch {
          // Fall back to the direct child if the process group already exited.
        }
      }
      child.kill(signal)
    }
    const abort = (code: number) => {
      if (abortCode !== undefined) return
      abortCode = code
      killProcessTree('SIGTERM')
      forceTimer = setTimeout(() => {
        killProcessTree('SIGKILL')
        finish({ code, stdout: '', stderr: '' })
      }, 2_000)
    }
    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        abort(1)
        return
      }
      target.push(chunk)
    }
    const timer = setTimeout(() => {
      timedOut = true
      abort(124)
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk))
    child.on('error', () => finish({ code: 127, stdout: '', stderr: '' }))
    child.on('close', (code) => finish({
      code: abortCode ?? (timedOut ? 124 : typeof code === 'number' ? code : 1),
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }))
  })
}

function localCommandRunner(command: string, args: string[]): Promise<CommandResult> {
  return runCommandWithLimits(command, args)
}

async function localMigrationNames(): Promise<string[]> {
  const names = await readdir(MIGRATIONS_DIR)
  return names
    .filter((name) => /^\d{3}-.+\.sql$/.test(name))
    // Match Wrangler's deterministic filename ordering without locale/ICU
    // collation differences across developer machines and CI runners.
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

function parseWranglerRows(stdout: string): Record<string, unknown>[] | null {
  try {
    const parsed: unknown = JSON.parse(stdout)
    const envelope = Array.isArray(parsed) ? parsed[0] : parsed
    if (!envelope || typeof envelope !== 'object') return null
    if ((envelope as { success?: unknown }).success !== true) return null
    const results = (envelope as { results?: unknown }).results
    return Array.isArray(results) && results.every((row) => row && typeof row === 'object')
      ? results as Record<string, unknown>[]
      : null
  } catch {
    return null
  }
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export async function readResponseBody(response: Response): Promise<string | null> {
  const length = response.headers.get('content-length')
  if (length && Number(length) > MAX_RESPONSE_BYTES) {
    try {
      await response.body?.cancel()
    } catch {
      // The readiness result remains a bounded failure even if cancellation
      // races a closed response stream.
    }
    return null
  }
  if (!response.body) {
    const body = await response.text()
    return Buffer.byteLength(body, 'utf8') <= MAX_RESPONSE_BYTES ? body : null
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

function validateBaseUrl(value: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('INVALID_BASE_URL')
  }
  const insecureLocalhost = process.env.ALLOW_INSECURE_LOCALHOST === '1'
    && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  if (!['https:'].includes(parsed.protocol) && !insecureLocalhost) throw new Error('INVALID_BASE_URL')
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('INVALID_BASE_URL')
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed
}

function validDetailId(value: string): boolean {
  return /^[a-f0-9]{16,64}$/i.test(value)
}

function check(name: string, status: GateStatus, code: string, extra: Partial<GateCheck> = {}): GateCheck {
  return { name, status, code, ...extra }
}

async function runRemoteChecks(
  expectedMigrations: string[],
  commandRunner: CommandRunner,
): Promise<GateCheck[]> {
  const args = ['exec', 'wrangler', 'd1', 'execute', 'content-os-feed', '--remote', '--env', 'production', '--json', '--command']
  const migrationResult = await commandRunner('pnpm', [...args, MIGRATION_QUERY])
  const migrationRows = migrationResult.code === 0 ? parseWranglerRows(migrationResult.stdout) : null
  const migrationRowsValid = migrationRows !== null && migrationRows.every((row, index) =>
    Number.isInteger(row.id) && row.id === index + 1
    && typeof row.name === 'string' && row.name.length > 0
    && typeof row.applied_at === 'string' && row.applied_at.length > 0
  )
  const remoteNames = migrationRowsValid ? migrationRows.map((row) => row.name as string) : []
  const migrationPass = migrationResult.code === 0
    && migrationRowsValid
    && remoteNames.length === expectedMigrations.length
    && remoteNames.every((name, index) => name === expectedMigrations[index])
  const migrationCode = migrationResult.code !== 0
    ? 'MIGRATION_QUERY_FAILED'
    : !migrationRowsValid
      ? 'MIGRATION_INVALID_JSON'
      : migrationPass ? 'MIGRATIONS_UP_TO_DATE' : 'MIGRATIONS_PENDING_OR_UNKNOWN'

  const columnsResult = await commandRunner('pnpm', [...args, COLUMNS_QUERY])
  const columnRows = columnsResult.code === 0 ? parseWranglerRows(columnsResult.stdout) : null
  const columnsValid = columnRows !== null && columnRows.every((row) => typeof row.name === 'string' && row.name.length > 0)
  const columns = columnsValid ? columnRows.map((row) => row.name as string) : []
  const columnsPass = columnsResult.code === 0
    && columnsValid
    && REQUIRED_COLUMNS.every((column) => columns.includes(column))

  return [
    check('migrations', migrationPass ? 'passed' : 'failed', migrationCode),
    check(
      'schema-columns',
      columnsPass ? 'passed' : 'failed',
      columnsResult.code !== 0
        ? 'SCHEMA_QUERY_FAILED'
        : !columnsValid
          ? 'SCHEMA_INVALID_JSON'
          : columnsPass ? 'FULLTEXT_CONTRACT_PRESENT' : 'FULLTEXT_CONTRACT_INCOMPLETE',
    ),
  ]
}

async function runHttpChecks(baseUrl: URL, detailId: string | undefined, timeoutMs: number, fetchImpl: FetchLike): Promise<GateCheck[]> {
  const request = async (path: string): Promise<{ response?: Response; body?: string; error?: string }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(new URL(path, baseUrl), {
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      })
      const body = await readResponseBody(response)
      return { response, body: body ?? undefined, error: body === null ? 'RESPONSE_TOO_LARGE' : undefined }
    } catch {
      return { error: 'HTTP_REQUEST_FAILED' }
    } finally {
      clearTimeout(timer)
    }
  }

  const health = await request('/api/health')
  const healthJson = health.body ? parseJsonObject(health.body) : null
  const healthPass = health.response?.status === 200
    && healthJson?.app === 'NavSphere'
    && healthJson.status === 'ok'
    && (healthJson.checks as Record<string, unknown> | undefined)?.database === 'ok'
    && (healthJson.checks as Record<string, unknown> | undefined)?.schema === 'ok'

  const feed = await request(`/api/feed?page=1&limit=1&probe=${Date.now()}`)
  const feedJson = feed.body ? parseJsonObject(feed.body) : null
  const feedData = feedJson && Array.isArray(feedJson.data) ? feedJson.data : []
  const feedPass = feed.response?.status === 200
    && Array.isArray(feedJson?.data)
    && !!feedJson?.pagination
    && typeof (feedJson.pagination as Record<string, unknown>).total === 'number'
  const selectedDetailId = detailId ?? (() => {
    const first = feedData[0]
    return first && typeof first === 'object' && typeof first.url_hash === 'string' ? first.url_hash : undefined
  })()

  let detail: GateCheck
  if (!selectedDetailId) {
    detail = check('detail', 'failed', 'DETAIL_ID_REQUIRED_OR_FEED_EMPTY')
  } else if (!validDetailId(selectedDetailId)) {
    detail = check('detail', 'failed', 'INVALID_DETAIL_ID')
  } else {
    const detailResponse = await request(`/api/feed/${encodeURIComponent(selectedDetailId)}`)
    const detailJson = detailResponse.body ? parseJsonObject(detailResponse.body) : null
    const detailPass = detailResponse.response?.status === 200
      && !!detailJson?.data
      && typeof (detailJson.data as Record<string, unknown>).url_hash === 'string'
      && (detailJson.data as Record<string, unknown>).url_hash === selectedDetailId
    detail = check(
      'detail',
      detailPass ? 'passed' : 'failed',
      detailResponse.error ?? (detailPass ? 'DETAIL_OK' : `DETAIL_HTTP_${detailResponse.response?.status ?? 0}`),
    )
  }

  return [
    check('health', healthPass ? 'passed' : 'failed', health.error ?? (healthPass ? 'HEALTH_OK' : `HEALTH_HTTP_${health.response?.status ?? 0}`), { httpStatus: health.response?.status }),
    check('feed', feedPass ? 'passed' : 'failed', feed.error ?? (feedPass ? 'FEED_OK' : `FEED_HTTP_${feed.response?.status ?? 0}`), { httpStatus: feed.response?.status, itemCount: feedData.length }),
    detail,
  ]
}

export async function runProductionGate(options: ProductionGateOptions = {}): Promise<GateResult> {
  const baseUrl = validateBaseUrl(options.baseUrl ?? process.env.PRODUCTION_URL ?? 'https://navsphere-4se.pages.dev')
  const timeoutMs = options.timeoutMs ?? 10_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100) throw new Error('INVALID_TIMEOUT')
  const expectedMigrations = options.migrationNames ?? await localMigrationNames()
  const commandRunner = options.commandRunner ?? localCommandRunner
  const fetchImpl = options.fetchImpl ?? fetch
  const checks = [
    ...await runRemoteChecks(expectedMigrations, commandRunner),
    ...await runHttpChecks(baseUrl, options.detailId, timeoutMs, fetchImpl),
  ]
  return { status: checks.every((item) => item.status === 'passed') ? 'passed' : 'failed', checks }
}

function parseCli(argv: string[]): ProductionGateOptions {
  const options: ProductionGateOptions = {}
  const args = argv.filter((arg) => arg !== '--')
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--base-url' && args[index + 1]) options.baseUrl = args[++index]
    else if (arg === '--detail-id' && args[index + 1]) options.detailId = args[++index]
    else if (arg === '--timeout-ms' && args[index + 1]) options.timeoutMs = Number(args[++index])
    else throw new Error('INVALID_ARGUMENTS')
  }
  return options
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  Promise.resolve()
    .then(() => runProductionGate(parseCli(process.argv.slice(2))))
    .then((result) => {
      for (const item of result.checks) console.log(`[${item.name}] ${item.status.toUpperCase()} ${item.code}`)
      console.log(`PRODUCTION GATE ${result.status === 'passed' ? 'PASSED' : 'FAILED'}`)
      process.exitCode = result.status === 'passed' ? 0 : 1
    })
    .catch((error: unknown) => {
      const code = error instanceof Error ? error.message : 'GATE_FAILED'
      console.error(`PRODUCTION GATE ERROR ${code}`)
      process.exitCode = 2
    })
}
