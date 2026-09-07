import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'

export const SYNTHETIC_EDITORIAL_KEY = 'synthetic-editorial-worker-smoke-only'
const OUTPUT_LIMIT = 256 * 1024
const COMMAND_TIMEOUT = 45_000
const STARTUP_TIMEOUT = 60_000
const require = createRequire(import.meta.url)
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

type Exit = { code: number | null; signal: NodeJS.Signals | null }
type OwnedProcess = {
  child: ChildProcess
  done: Promise<Exit>
  exit?: Exit
  output: string
  stdout: string
  bytes: number
  overflow: boolean
  logPath: string
  logged: boolean
  stopping?: Promise<void>
}
export type WorkerResponse = { status: number; cacheControl: string | null; json: unknown }
type RequestOptions = { body?: unknown; anonymous?: boolean; timeoutMs?: number }

function sanitize(output: string): string {
  return output.replaceAll(SYNTHETIC_EDITORIAL_KEY, '[SYNTHETIC_KEY]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:[A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))\s*[:=]\s*)[^\r\n]+/g, '$1[REDACTED]')
}

function signalGroup(process: OwnedProcess, signal: NodeJS.Signals): void {
  if (!process.child.pid) return
  try { globalThis.process.kill(-process.child.pid, signal) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
}

function groupExists(process: OwnedProcess): boolean {
  if (!process.child.pid) return false
  try { globalThis.process.kill(-process.child.pid, 0); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

async function waitForGroupExit(process: OwnedProcess, milliseconds: number): Promise<boolean> {
  const deadline = Date.now() + milliseconds
  do {
    if (process.exit && !groupExists(process)) return true
    await delay(50)
  } while (Date.now() < deadline)
  return Boolean(process.exit) && !groupExists(process)
}

function stopProcess(process: OwnedProcess): Promise<void> {
  if (process.stopping) return process.stopping
  process.stopping = (async () => {
    signalGroup(process, 'SIGTERM')
    if (!(await waitForGroupExit(process, 3_000))) {
      signalGroup(process, 'SIGKILL')
      if (!(await waitForGroupExit(process, 3_000))) throw new Error(`Owned Wrangler process group did not exit; logs: ${process.logPath}`)
    }
    await process.done
  })()
  return process.stopping
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

function artifactPath(): string {
  const supplied = process.env.EDITORIAL_WORKER_ARTIFACT
  if (!supplied || !isAbsolute(supplied)) throw new Error('EDITORIAL_WORKER_ARTIFACT must explicitly name an absolute next-on-pages static directory; missing artifacts never skip this test')
  const artifact = realpathSync(supplied)
  if (!lstatSync(artifact).isDirectory() || !existsSync(join(artifact, '_worker.js', 'index.js'))) {
    throw new Error('EDITORIAL_WORKER_ARTIFACT is missing the compiled _worker.js/index.js entrypoint')
  }
  return artifact
}

/** A real compiled Pages Worker, with only synthetic local bindings and owned state. */
export class PagesWorkerFixture {
  readonly directory: string
  private readonly wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js')
  private readonly processes = new Set<OwnedProcess>()
  private service?: OwnedProcess
  private origin?: string
  private sequence = 0
  private closed = false
  private closing?: Promise<void>

  constructor() {
    if (process.platform === 'win32') throw new Error('This smoke requires POSIX process groups; unsupported runtime is a failure, not a skip')
    const artifact = artifactPath()
    this.directory = mkdtempSync(join(tmpdir(), 'navsphere-editorial-worker-'))
    chmodSync(this.directory, 0o700)
    try {
      mkdirSync(join(this.directory, 'logs'), { mode: 0o700 })
      // A copy freezes the exact artifact and leaves the original build untouched.
      cpSync(artifact, join(this.directory, 'static'), {
        recursive: true, force: false, errorOnExist: true,
        filter(source) {
          if (lstatSync(source).isSymbolicLink()) throw new Error('Compiled smoke artifacts must not contain symbolic links')
          if (/^(?:\.env(?:\.|$)|\.dev\.vars(?:\.|$)|wrangler\.(?:toml|jsonc?))/.test(basename(source))) {
            throw new Error('Compiled smoke artifacts must not include environment or Wrangler configuration files')
          }
          return true
        },
      })
      this.writeConfig(false)
    } catch (error) {
      rmSync(this.directory, { recursive: true, force: true })
      throw error
    }
  }

  private writeConfig(enabled: boolean): void {
    writeFileSync(join(this.directory, 'wrangler.jsonc'), JSON.stringify({
      name: 'editorial-worker-smoke', pages_build_output_dir: './static',
      compatibility_date: '2024-11-11', compatibility_flags: ['nodejs_compat'],
      vars: { CONTENT_OS_API_KEY: SYNTHETIC_EDITORIAL_KEY, FEED_EDITORIAL_ENABLED: String(enabled) },
      d1_databases: [{ binding: 'DB', database_name: 'editorial-smoke',
        database_id: '00000000-0000-4000-8000-000000000001', remote: false }],
    }, null, 2), { mode: 0o600 })
  }

  private environment(): NodeJS.ProcessEnv {
    // Never inherit NODE_OPTIONS, Cloudflare credentials, application keys or .env.
    const cliEnvironment: Record<string, string> = {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, CI: '1', NO_COLOR: '1',
      NEXT_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false',
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
      WRANGLER_LOG_PATH: join(this.directory, 'logs'), WRANGLER_LOG_SANITIZE: 'true',
      // Capture one bounded/sanitized log ourselves, not Wrangler's debug dump.
      WRANGLER_WRITE_LOGS: 'false',
      XDG_CONFIG_HOME: join(this.directory, 'config'), XDG_CACHE_HOME: join(this.directory, 'cache'),
    }
    // The application's ProcessEnv augmentation requires app-only settings.
    // This is a deliberately smaller child CLI environment, not the app env.
    return cliEnvironment as NodeJS.ProcessEnv
  }

  private launch(args: string[]): OwnedProcess {
    if (this.closed) throw new Error('Pages Worker fixture is closed')
    const child = spawn(process.execPath, [this.wrangler, ...args], {
      cwd: this.directory, env: this.environment(), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let finished!: (exit: Exit) => void
    const owned: OwnedProcess = {
      child, done: new Promise<Exit>((resolve) => { finished = resolve }),
      output: '', stdout: '', bytes: 0, overflow: false, logged: false,
      logPath: join(this.directory, 'logs', `command-${++this.sequence}.log`),
    }
    this.processes.add(owned)
    const capture = (chunk: Buffer) => {
      if (owned.overflow) return
      const remaining = OUTPUT_LIMIT - owned.bytes
      owned.output += chunk.subarray(0, Math.max(0, remaining)).toString('utf8')
      owned.bytes += chunk.length
      if (owned.bytes > OUTPUT_LIMIT) {
        owned.overflow = true
        owned.output += '\n[output limit exceeded]\n'
        signalGroup(owned, 'SIGKILL')
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      if (!owned.overflow) owned.stdout += chunk.subarray(0, Math.max(0, OUTPUT_LIMIT - owned.bytes)).toString('utf8')
      capture(chunk)
    })
    child.stderr?.on('data', capture)
    child.once('error', () => { owned.output += '\n[failed to spawn installed Wrangler with process.execPath]\n' })
    child.once('close', (code, signal) => {
      owned.exit = { code, signal }
      finished(owned.exit)
    })
    return owned
  }

  private saveLog(owned: OwnedProcess): void {
    if (owned.logged) return
    writeFileSync(owned.logPath, sanitize(owned.output), { flag: 'wx', mode: 0o600 })
    owned.logged = true
  }

  private async command(args: string[]): Promise<string> {
    const owned = this.launch(args)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), COMMAND_TIMEOUT) })
    try {
      const exit = await Promise.race([owned.done, timeout])
      if (!exit) throw new Error(`Local Wrangler command timed out; logs: ${owned.logPath}`)
      if (exit.code !== 0 || owned.overflow) throw new Error(`Local Wrangler command failed (exit ${exit.code}); logs: ${owned.logPath}`)
      return owned.stdout
    } finally {
      clearTimeout(timer)
      await stopProcess(owned)
      this.saveLog(owned)
    }
  }

  async seed(sql: string): Promise<void> {
    if (this.closed) throw new Error('Pages Worker fixture is closed')
    writeFileSync(join(this.directory, 'seed.sql'), sql, { flag: 'wx', mode: 0o600 })
    await this.command(['d1', 'execute', 'editorial-smoke', '--local', '--persist-to', 'state', '--file', 'seed.sql', '--json'])
  }

  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    if (!/^\s*(?:SELECT|PRAGMA table_info\b)/i.test(sql) || sql.includes(';')) throw new Error('Smoke inspection accepts one local read-only statement')
    const output = await this.command(['d1', 'execute', 'editorial-smoke', '--local', '--persist-to', 'state', `--command=${sql}`, '--json'])
    const receipts: unknown = JSON.parse(output)
    if (!Array.isArray(receipts) || receipts.length !== 1 || receipts[0]?.success !== true || !Array.isArray(receipts[0]?.results)) {
      throw new Error('Local D1 inspection did not return exactly one successful receipt')
    }
    return receipts[0].results as T[]
  }

  async start(enabled: boolean): Promise<void> {
    await this.stop()
    if (this.closed) throw new Error('Pages Worker fixture is closed')
    this.writeConfig(enabled)
    const port = await freePort()
    this.origin = `http://127.0.0.1:${port}`
    this.service = this.launch(['pages', 'dev', 'static', '--local', '--ip', '127.0.0.1', '--port', String(port),
      '--inspector-port', '0', '--persist-to', 'state', '--show-interactive-dev-session=false'])
    const deadline = Date.now() + STARTUP_TIMEOUT
    while (Date.now() < deadline) {
      if (this.closed || this.service.exit || this.service.overflow) break
      try {
        const response = await this.request('/api/health', { anonymous: true, timeoutMs: 1_000 })
        if (response.status === 200 && (response.json as { status?: unknown }).status === 'ok') return
      } catch { /* Only readiness GETs may be repeated; mutations are never retried. */ }
      await delay(150)
    }
    throw new Error(`Compiled Pages Worker did not become healthy; logs: ${this.service.logPath}`)
  }

  async request(path: string, options: RequestOptions = {}): Promise<WorkerResponse> {
    if (!this.origin || !this.service || this.service.exit || this.closed) throw new Error('Pages Worker is not running')
    const url = new URL(path, this.origin)
    if (!path.startsWith('/') || path.startsWith('//') || url.origin !== this.origin) throw new Error('Smoke HTTP requests must remain on the owned loopback origin')
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), options.timeoutMs ?? 5_000)
    try {
      const response = await fetch(url, {
        method: options.body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: abort.signal,
        headers: { Accept: 'application/json', ...(options.anonymous ? {} : { Authorization: `Bearer ${SYNTHETIC_EDITORIAL_KEY}` }),
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        throw new Error(`Unexpected redirect from local smoke path: ${url.pathname}`)
      }
      const chunks: Uint8Array[] = []
      const reader = response.body?.getReader()
      let size = 0
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.length
            if (size > OUTPUT_LIMIT) { await reader.cancel(); throw new Error('Smoke response exceeded 256 KiB') }
            chunks.push(value)
          }
        } finally { reader.releaseLock() }
      }
      const body = Buffer.concat(chunks).toString('utf8')
      return { status: response.status, cacheControl: response.headers.get('Cache-Control'), json: JSON.parse(body) as unknown }
    } finally { clearTimeout(timeout) }
  }

  async stop(): Promise<void> {
    if (!this.service) return
    const service = this.service
    await stopProcess(service)
    this.saveLog(service)
    if (this.service === service) { this.service = undefined; this.origin = undefined }
  }

  close(preserveLogs: boolean): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = (async () => {
      const results = await Promise.allSettled([...this.processes].map(async (owned) => {
        await stopProcess(owned)
        this.saveLog(owned)
      }))
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
      if (!preserveLogs) rmSync(this.directory, { recursive: true, force: true })
    })()
    return this.closing
  }
}

export function readSmokeSchema(): string {
  return readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
}
