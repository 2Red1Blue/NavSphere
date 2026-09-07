import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { D1_RETENTION_TIMESTAMP_CTES } from '../src/lib/d1-retention-sql'
import { runCommandWithLimits } from './production-gate'

const PROJECT_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const WRANGLER = join(PROJECT_DIR, 'node_modules', '.bin', 'wrangler')
const CEILING_BYTES = 500_000_000
const MAX_COMMAND_OUTPUT_BYTES = 128 * 1024
const SAFETY = {
  archiveEnabled: false,
  deletionEnabled: false,
  candidateCountsAuthorizeDeletion: false,
} as const
const COUNT_FIELDS = [
  'total', 'eligible', 'invalidDate', 'approved', 'unapproved',
  'fulltextPermission', 'revoked', 'eligibleApproved', 'eligibleUnapproved',
  'eligibleFulltextPermission', 'eligibleRevoked',
] as const

type Counts = Record<typeof COUNT_FIELDS[number], number>
type CommandRunner = (command: string, args: string[], timeoutMs: number) => Promise<{
  code: number; stdout: string; stderr: string
}>
type FailureCode = 'INVALID_OPTIONS' | 'QUERY_FAILED' | 'INVALID_RESPONSE'

export type D1RetentionAuditOptions = {
  now?: Date
  retentionDays?: number
  timeoutMs?: number
  commandRunner?: CommandRunner
}

export type D1RetentionAuditResult = typeof SAFETY & ({
  status: 'failed'
  code: FailureCode
} | {
  status: 'completed'
  code: 'AUDIT_COMPLETED'
  auditedAt: string
  cutoff: string
  retentionDays: number
  counts: Counts
  capacity: {
    bytes: number
    ceilingBytes: number
    utilizationPercent: number
    status: 'normal' | 'warning' | 'critical' | 'limit'
  }
  query: { rowsRead: number; rowsWritten: 0; changedDb: false }
})

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

function cutoffFor(now: Date, retentionDays: number): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !boundedInteger(retentionDays, 1, 3650)) {
    throw new Error('INVALID_OPTIONS')
  }
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000)
  if (!Number.isFinite(cutoff.getTime()) || !/^\d{4}-/.test(now.toISOString()) || !/^\d{4}-/.test(cutoff.toISOString())) {
    throw new Error('INVALID_OPTIONS')
  }
  return cutoff.toISOString()
}

/**
 * One aggregate-only SELECT; unsupported ISO dates are invalid. Normalize whole
 * seconds separately so SQLite cannot round a pre-cutoff fraction up to cutoff.
 */
export function buildD1RetentionAuditQuery(now: Date, retentionDays = 30): string {
  const cutoff = cutoffFor(now, retentionDays)
  return `WITH retention_source AS (
  SELECT discovered_at AS ts, approved_for_publication, fulltext_publication_allowed, fulltext_revoked_at
  FROM articles
), ${D1_RETENTION_TIMESTAMP_CTES}, classified AS (
  SELECT *, CASE WHEN utc_timestamp < '${cutoff}' THEN 1 ELSE 0 END AS eligible FROM normalized
)
SELECT COUNT(*) AS total,
  COALESCE(SUM(eligible), 0) AS eligible,
  COUNT(CASE WHEN utc_timestamp IS NULL THEN 1 END) AS invalidDate,
  COUNT(CASE WHEN approved_for_publication = 1 THEN 1 END) AS approved,
  COUNT(CASE WHEN approved_for_publication = 0 THEN 1 END) AS unapproved,
  COUNT(CASE WHEN fulltext_publication_allowed = 1 THEN 1 END) AS fulltextPermission,
  COUNT(CASE WHEN fulltext_revoked_at IS NOT NULL THEN 1 END) AS revoked,
  COUNT(CASE WHEN eligible = 1 AND approved_for_publication = 1 THEN 1 END) AS eligibleApproved,
  COUNT(CASE WHEN eligible = 1 AND approved_for_publication = 0 THEN 1 END) AS eligibleUnapproved,
  COUNT(CASE WHEN eligible = 1 AND fulltext_publication_allowed = 1 THEN 1 END) AS eligibleFulltextPermission,
  COUNT(CASE WHEN eligible = 1 AND fulltext_revoked_at IS NOT NULL THEN 1 END) AS eligibleRevoked
FROM classified`
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function parseCounts(row: Record<string, unknown>): Counts | null {
  const counts = {} as Counts
  for (const field of COUNT_FIELDS) {
    const value = row[field]
    if (!boundedInteger(value, 0, Number.MAX_SAFE_INTEGER)) return null
    counts[field] = value
  }
  if (counts.approved !== counts.total - counts.unapproved
    || counts.eligibleApproved !== counts.eligible - counts.eligibleUnapproved
    || counts.eligible > counts.total - counts.invalidDate) return null
  for (const [total, eligible] of [
    [counts.approved, counts.eligibleApproved], [counts.unapproved, counts.eligibleUnapproved],
    [counts.fulltextPermission, counts.eligibleFulltextPermission], [counts.revoked, counts.eligibleRevoked],
  ]) {
    if (total > counts.total || eligible > total || eligible > counts.eligible
      || total - eligible > counts.total - counts.eligible) return null
  }
  return counts
}

function parseResponse(stdout: string): { counts: Counts; bytes: number; rowsRead: number } | null {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (!Array.isArray(parsed) || parsed.length !== 1) return null
    const envelope = object(parsed[0])
    if (envelope?.success !== true || !Array.isArray(envelope.results) || envelope.results.length !== 1) return null
    const meta = object(envelope.meta)
    const row = object(envelope.results[0])
    if (!meta || !row || meta.rows_written !== 0 || meta.changed_db !== false
      || !boundedInteger(meta.size_after, 0, Number.MAX_SAFE_INTEGER)
      || !boundedInteger(meta.rows_read, 0, Number.MAX_SAFE_INTEGER)) return null
    const counts = parseCounts(row)
    return counts ? { counts, bytes: meta.size_after, rowsRead: meta.rows_read } : null
  } catch {
    return null
  }
}

function failure(code: FailureCode): D1RetentionAuditResult {
  return { ...SAFETY, status: 'failed', code }
}

export async function runD1RetentionAudit(options: D1RetentionAuditOptions = {}): Promise<D1RetentionAuditResult> {
  const now = options.now ?? new Date()
  const retentionDays = options.retentionDays ?? 30
  const timeoutMs = options.timeoutMs ?? 30_000
  let auditedAt: string
  let cutoff: string
  let sql: string
  try {
    if (!boundedInteger(timeoutMs, 100, 120_000)) return failure('INVALID_OPTIONS')
    cutoff = cutoffFor(now, retentionDays)
    sql = buildD1RetentionAuditQuery(now, retentionDays)
    auditedAt = now.toISOString()
  } catch {
    return failure('INVALID_OPTIONS')
  }
  const commandRunner = options.commandRunner ?? runCommandWithLimits
  let output: Awaited<ReturnType<CommandRunner>>
  try {
    output = await commandRunner(WRANGLER, [
      'd1', 'execute', 'content-os-feed', '--remote', '--env', 'production', '--json', '--command', sql,
    ], timeoutMs)
  } catch {
    return failure('QUERY_FAILED')
  }
  if (output.code !== 0) return failure('QUERY_FAILED')
  if (typeof output.stdout !== 'string' || typeof output.stderr !== 'string'
    || Buffer.byteLength(output.stdout) + Buffer.byteLength(output.stderr) > MAX_COMMAND_OUTPUT_BYTES) {
    return failure('INVALID_RESPONSE')
  }
  const parsed = parseResponse(output.stdout)
  if (!parsed) return failure('INVALID_RESPONSE')
  const { bytes, counts, rowsRead } = parsed
  return {
    ...SAFETY, status: 'completed', code: 'AUDIT_COMPLETED',
    auditedAt, cutoff, retentionDays, counts,
    capacity: {
      bytes, ceilingBytes: CEILING_BYTES, utilizationPercent: bytes / CEILING_BYTES * 100,
      status: bytes >= CEILING_BYTES ? 'limit'
        : bytes >= CEILING_BYTES * 0.85 ? 'critical'
          : bytes >= CEILING_BYTES * 0.7 ? 'warning' : 'normal',
    },
    query: { rowsRead, rowsWritten: 0, changedDb: false },
  }
}

export function parseD1RetentionAuditCli(argv: string[]): D1RetentionAuditOptions {
  const options: D1RetentionAuditOptions = {}
  const args = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!value || !/^[1-9]\d*$/.test(value)) throw new Error('INVALID_OPTIONS')
    if (flag === '--days' && options.retentionDays === undefined && boundedInteger(Number(value), 1, 3650)) {
      options.retentionDays = Number(value)
    } else if (flag === '--timeout-ms' && options.timeoutMs === undefined && boundedInteger(Number(value), 100, 120_000)) {
      options.timeoutMs = Number(value)
    } else throw new Error('INVALID_OPTIONS')
  }
  return options
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  Promise.resolve()
    .then(() => runD1RetentionAudit(parseD1RetentionAuditCli(process.argv.slice(2))))
    .catch(() => failure('INVALID_OPTIONS'))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
      process.exitCode = result.status === 'completed' ? 0 : 2
    })
}
