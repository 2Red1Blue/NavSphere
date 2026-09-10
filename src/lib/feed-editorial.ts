import {
  EditorialValidationError, canonicalEditorialJson, validateEditorialApproval, validateEditorialRevoke,
  type EditorialSource, type EditorialState, type EditorialRevoke,
} from './editorial-contract'
import { digestCanonicalV2, validateManualEditorialV2Submission } from './editorial-contract-v2'

export interface EditorialReceipt {
  article_id: string
  state: Exclude<EditorialState, 'absent'>
  revision: number
  manifest_sha256: string | null
  approval_digest: string | null
}
export interface EditorialInspection extends Omit<EditorialReceipt, 'state'> {
  state: EditorialState
  source: EditorialSource
  article_global_approved: boolean
}
type InspectionRow = Omit<EditorialInspection, 'source' | 'article_global_approved'> & EditorialSource & { approved_for_publication: number }
export class EditorialConflictError extends Error {
  constructor() { super('Editorial changed; inspect before any new submission') }
}
export class EditorialNotFoundError extends Error {
  constructor() { super('Article not found') }
}
const RETURNING = 'RETURNING url_hash AS article_id, state, revision, manifest_sha256, approval_digest'
const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"

export async function readEditorialState(db: D1Database, articleId: string): Promise<EditorialInspection | null> {
  const row = await db.prepare(`SELECT a.url_hash AS article_id, a.url, a.original_url, a.original_url_provenance,
    a.approved_for_publication, COALESCE(e.state, 'absent') AS state, COALESCE(e.revision, 0) AS revision,
    e.manifest_sha256, e.approval_digest
    FROM articles a LEFT JOIN article_editorials e ON e.url_hash = a.url_hash WHERE a.url_hash = ?`)
    .bind(articleId).first<InspectionRow>()
  if (!row) return null
  return {
    article_id: row.article_id, state: row.state, revision: row.revision,
    manifest_sha256: row.manifest_sha256, approval_digest: row.approval_digest,
    source: { url: row.url, original_url: row.original_url, original_url_provenance: row.original_url_provenance },
    article_global_approved: row.approved_for_publication === 1,
  }
}

function revokeStatement(db: D1Database, articleId: string, revoke: EditorialRevoke) {
  if (revoke.expected_state === 'absent') {
    return db.prepare(`INSERT INTO article_editorials (url_hash, revision, state, withdrawn_at, withdrawal_reason)
      SELECT a.url_hash, 1, 'withdrawn', ${NOW}, ? FROM articles a
      WHERE a.url_hash = ? AND NOT EXISTS (SELECT 1 FROM article_editorials e WHERE e.url_hash = a.url_hash)
      ${RETURNING}`).bind(revoke.reason, articleId)
  }
  return db.prepare(`UPDATE article_editorials SET revision = revision + 1, state = 'withdrawn',
    withdrawn_at = ${NOW}, withdrawal_reason = ?
    WHERE url_hash = ? AND state = ? AND revision = ? ${RETURNING}`)
    .bind(revoke.reason, articleId, revoke.expected_state, revoke.expected_revision)
}

async function approvedStatement(db: D1Database, articleId: string, body: Record<string, unknown>) {
  if (Object.keys(body).length !== 2 || !Object.hasOwn(body, 'manifest') || !Object.hasOwn(body, 'attestation')) throw new EditorialValidationError()
  const approved = await validateEditorialApproval(body.manifest, body.attestation)
  const { manifest, attestation } = approved
  if (manifest.publication.article_id !== articleId) throw new EditorialValidationError()
  const source = manifest.publication.source
  const approvalValues = [approved.publicationJson, approved.manifestSha256, approved.approvalDigest,
    approved.reviewSha256, attestation.reviewer, attestation.attested_at]
  // Article permission and byte-exact source checks are inside the write, not its preflight.
  const articleGuard = 'a.url_hash = ? AND a.approved_for_publication = 1 AND a.url IS ? AND a.original_url IS ? AND a.original_url_provenance IS ?'
  const sourceValues = [articleId, source.url, source.original_url, source.original_url_provenance]
  if (manifest.expected_state === 'absent') {
    return db.prepare(`INSERT INTO article_editorials (url_hash, revision, state, publication_json,
      manifest_sha256, approval_digest, review_sha256, approved_by, approved_at, published_at)
      SELECT a.url_hash, 1, 'published', ?, ?, ?, ?, ?, ?, ${NOW} FROM articles a
      WHERE ${articleGuard} AND NOT EXISTS (SELECT 1 FROM article_editorials e WHERE e.url_hash = a.url_hash)
      ${RETURNING}`).bind(...approvalValues, ...sourceValues)
  }
  return db.prepare(`UPDATE article_editorials SET revision = revision + 1, state = 'published',
    publication_json = ?, manifest_sha256 = ?, approval_digest = ?, review_sha256 = ?, approved_by = ?,
    approved_at = ?, published_at = ${NOW}, withdrawn_at = NULL, withdrawal_reason = NULL
    WHERE url_hash = ? AND state = ? AND revision = ?
      AND EXISTS (SELECT 1 FROM articles a WHERE ${articleGuard}) ${RETURNING}`)
    .bind(...approvalValues, articleId, manifest.expected_state, manifest.expected_revision, ...sourceValues)
}

async function manuallyAcceptedV2Statement(db: D1Database, articleId: string, body: unknown) {
  const submission = validateManualEditorialV2Submission(body)
  if (submission.publication.article_id !== articleId) throw new EditorialValidationError()
  const publicationJson = canonicalEditorialJson(submission.publication)
  const manifestSha256 = await digestCanonicalV2(submission.publication)
  const approvalDigest = await digestCanonicalV2({
    publication_sha256: manifestSha256,
    source: submission.publication.source,
    acceptance: submission.acceptance,
  })
  const values = [publicationJson, manifestSha256, approvalDigest,
    submission.acceptance.review_sha256, submission.acceptance.accepted_by,
    submission.acceptance.accepted_at]
  const source = submission.publication.source
  const articleGuard = 'a.url_hash = ? AND a.approved_for_publication = 1 AND a.url IS ? AND a.original_url IS ? AND a.original_url_provenance IS ?'
  const sourceValues = [articleId, source.url, source.original_url, source.original_url_provenance]
  if (submission.expected_state === 'absent') {
    return db.prepare(`INSERT INTO article_editorials (url_hash, revision, state, publication_json,
      manifest_sha256, approval_digest, review_sha256, approved_by, approved_at, published_at)
      SELECT a.url_hash, 1, 'published', ?, ?, ?, ?, ?, ?, ${NOW} FROM articles a
      WHERE ${articleGuard} AND NOT EXISTS (SELECT 1 FROM article_editorials e WHERE e.url_hash = a.url_hash)
      ${RETURNING}`).bind(...values, ...sourceValues)
  }
  return db.prepare(`UPDATE article_editorials SET revision = revision + 1, state = 'published',
    publication_json = ?, manifest_sha256 = ?, approval_digest = ?, review_sha256 = ?, approved_by = ?,
    approved_at = ?, published_at = ${NOW}, withdrawn_at = NULL, withdrawal_reason = NULL
    WHERE url_hash = ? AND state = ? AND revision = ?
      AND EXISTS (SELECT 1 FROM articles a WHERE ${articleGuard}) ${RETURNING}`)
    .bind(...values, articleId, submission.expected_state, submission.expected_revision, ...sourceValues)
}

/** One bounded CAS operation; never retry an uncertain or stale request. */
export async function mutateEditorial(db: D1Database, articleId: string, body: unknown): Promise<EditorialReceipt> {
  if (!(await readEditorialState(db, articleId))) throw new EditorialNotFoundError()
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EditorialValidationError()
  const input = body as Record<string, unknown>
  const statement = input.action === 'revoke'
    ? revokeStatement(db, articleId, validateEditorialRevoke(input))
    : await approvedStatement(db, articleId, input)
  const result = await statement.all<EditorialReceipt>()
  if (result.success !== true || !Array.isArray(result.results)) throw new Error('Editorial write unavailable')
  if (result.results.length === 0) throw new EditorialConflictError()
  const receipt = result.results[0]
  // Trigger-inclusive meta.changes is deliberately not a receipt or revision.
  if (result.results.length !== 1 || receipt.article_id !== articleId
    || !Number.isInteger(receipt.revision) || receipt.revision < 1 || receipt.revision > 2147483647
    || !['published', 'withdrawn'].includes(receipt.state)) throw new Error('Editorial receipt unavailable')
  return receipt
}

/** Explicit v2 human-acceptance write.  It shares the D1 CAS primitive with
 * v1 but never accepts a v1 manifest, auto policy authorization, or revoke. */
export async function mutateManualEditorialV2(db: D1Database, articleId: string, body: unknown): Promise<EditorialReceipt> {
  if (!(await readEditorialState(db, articleId))) throw new EditorialNotFoundError()
  const statement = await manuallyAcceptedV2Statement(db, articleId, body)
  const result = await statement.all<EditorialReceipt>()
  if (result.success !== true || !Array.isArray(result.results)) throw new Error('Editorial write unavailable')
  if (result.results.length === 0) throw new EditorialConflictError()
  const receipt = result.results[0]
  if (result.results.length !== 1 || receipt.article_id !== articleId
    || !Number.isInteger(receipt.revision) || receipt.revision < 1 || receipt.revision > 2147483647
    || receipt.state !== 'published' || typeof receipt.manifest_sha256 !== 'string'
    || typeof receipt.approval_digest !== 'string') throw new Error('Editorial receipt unavailable')
  return receipt
}
