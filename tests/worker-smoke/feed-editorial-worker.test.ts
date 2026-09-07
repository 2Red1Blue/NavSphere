import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canonicalEditorialJson, type EditorialAttestation, type EditorialManifest } from '../../src/lib/editorial-contract'
import { PagesWorkerFixture, readSmokeSchema, type WorkerResponse } from '../helpers/pages-worker'

type Approval = { manifest: EditorialManifest; attestation: EditorialAttestation }
type SyntheticFixture = Approval & { expected: { manifest_sha256: string; approval_digest: string } }
const fixture = JSON.parse(readFileSync(new URL('../fixtures/editorial-publication-v1.json', import.meta.url), 'utf8')) as SyntheticFixture
const ID = fixture.manifest.publication.article_id
const OTHER_ID = 'fedcba9876543210'
const MISSING_ID = 'aaaaaaaaaaaaaaaa'
const DATE = '2026-09-04T00:00:00Z'
const SUMMARY = 'Synthetic unchanged summary; independent editorial must remain separate.'
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const route = (id = ID) => `/api/feed/${id}/editorial`
const approval: Approval = { manifest: fixture.manifest, attestation: fixture.attestation }

function sqlValue(value: unknown): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') { assert(Number.isSafeInteger(value)); return String(value) }
  assert.equal(typeof value, 'string')
  return `CAST(X'${Buffer.from(value as string, 'utf8').toString('hex')}' AS TEXT)`
}

function syntheticArticle(id: string): Record<string, unknown> {
  const body = `Synthetic private original for ${id}\r\n\u0000preserve every byte 🧪`
  const source = fixture.manifest.publication.source
  return {
    url_hash: id, title: `Synthetic original ${id}`, original_title: 'Original title 🧪',
    summary: SUMMARY, takeaway: 'Synthetic unchanged takeaway', content: body,
    content_format: 'markdown_v1', content_quality: 'verified_fulltext', content_hash: hash(body),
    content_chars: body.length, content_quality_score: 87, content_version: 3,
    content_extracted_at: DATE, content_source: 'synthetic-fixture', fulltext_publication_allowed: 0,
    fulltext_revoked_at: DATE, fulltext_control_version: 7,
    content_archive_key: `feed-body/v1/${id}/3/${hash(body)}`, content_archive_sha256: hash(body),
    content_archive_version: 3, content_archive_bytes: Buffer.byteLength(body), content_archived_at: DATE,
    source: 'AIHOT synthetic', url: id === ID ? source.url : 'https://aihot.virxact.com/items/other-synthetic',
    original_url: source.original_url, original_url_provenance: source.original_url_provenance,
    category: 'ai', topic: 'synthetic', type: 'news', featured: 1, score: 24, signal: 8, novelty: 9,
    usefulness: 7, content_potential: 'High', published_at: DATE, discovered_at: DATE,
    approved_for_publication: 1, created_at: DATE,
  }
}

function seedSql(): string {
  return readSmokeSchema() + '\n' + [ID, OTHER_ID].map((id) => {
    const row = syntheticArticle(id)
    assert.equal(Object.keys(row).length, 39)
    return `INSERT INTO articles(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(sqlValue).join(',')});`
  }).join('\n')
}

function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}

function expectStatus(response: WorkerResponse, status: number, code?: string): Record<string, unknown> {
  assert.equal(response.status, status, `Expected ${status}; received ${response.status}`)
  assert.equal(response.cacheControl, 'no-store')
  const json = object(response.json)
  if (code) assert.deepEqual(json, { code })
  return json
}

function expectedReceipt(bundle: Approval, revision: number) {
  return { article_id: ID, state: 'published', revision,
    manifest_sha256: hash(canonicalEditorialJson(bundle.manifest)), approval_digest: hash(canonicalEditorialJson(bundle)) }
}

function expectedAbsent(id = ID) {
  const row = syntheticArticle(id)
  return { article_id: id, state: 'absent', revision: 0, manifest_sha256: null, approval_digest: null,
    article_global_approved: true,
    source: { url: row.url, original_url: row.original_url, original_url_provenance: row.original_url_provenance } }
}

async function inspect(worker: PagesWorkerFixture, suffix = '', id = ID) {
  return expectStatus(await worker.request(route(id) + suffix), 200)
}

async function publicDetail(worker: PagesWorkerFixture, revision: number | null) {
  const data = object(expectStatus(await worker.request(`/api/feed/${ID}`, { anonymous: true }), 200).data)
  assert.equal(data.url_hash, ID)
  assert.equal(data.summary, SUMMARY)
  assert.equal(data.content, null)
  assert.equal(data.fulltext_publication_allowed, 0)
  assert.equal(data.url, fixture.manifest.publication.source.url)
  assert.equal(data.original_url, fixture.manifest.publication.source.original_url)
  assert.equal(data.original_url_provenance, fixture.manifest.publication.source.original_url_provenance)
  for (const key of Object.keys(data)) assert(!/archive|private|manifest|approved_by|approval_digest|review_sha256/.test(key), `Private public-detail field: ${key}`)
  assert(Object.hasOwn(data, 'editorial'))
  if (revision === null) { assert.equal(data.editorial, null); return }
  const editorial = object(data.editorial)
  assert.equal(editorial.revision, revision)
  assert.match(String(editorial.published_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  const { revision: ignoredRevision, published_at: ignoredDate, ...publication } = editorial
  assert.equal(ignoredRevision, revision)
  assert.equal(typeof ignoredDate, 'string')
  assert.deepEqual(publication, fixture.manifest.publication)
}

test('compiled Pages editorial route preserves path identity, explicit authority and the synthetic CAS lifecycle', { timeout: 240_000 }, async (context) => {
  const worker = new PagesWorkerFixture()
  let passed = false
  context.after(async () => {
    let cleaned = false
    try { await worker.close(!passed); cleaned = true }
    finally {
      if (!passed || !cleaned) context.diagnostic(`Bounded synthetic Worker logs retained in ${worker.directory}/logs`)
    }
  })
  await worker.seed(seedSql())
  const before = await worker.query('SELECT *, hex(content) AS content_hex FROM articles ORDER BY url_hash')
  assert.equal(before.length, 2)
  for (const row of before) {
    assert.equal(Object.keys(row).length, 40, 'All 39 original columns plus hex(content) are compared')
    assert.equal(row.content_hex, Buffer.from(syntheticArticle(String(row.url_hash)).content as string).toString('hex').toUpperCase())
  }

  await worker.start(false)
  expectStatus(await worker.request(route(), { body: approval }), 409, 'EDITORIAL_DISABLED')
  expectStatus(await worker.request(route(), { body: approval, anonymous: true }), 401, 'UNAUTHORIZED')
  expectStatus(await worker.request(route(), { anonymous: true }), 401, 'UNAUTHORIZED')
  assert.deepEqual(await inspect(worker), expectedAbsent())
  expectStatus(await worker.request(route(MISSING_ID)), 404, 'NOT_FOUND')
  await publicDetail(worker, null)
  context.diagnostic('Disabled compiled Worker: authenticated POST=409, anonymous=401, GET=absent0, missing article=404')

  await worker.start(true)
  const published = expectStatus(await worker.request(route(), { body: approval }), 200)
  assert.deepEqual(published, expectedReceipt(approval, 1))
  assert.equal(published.manifest_sha256, fixture.expected.manifest_sha256)
  assert.equal(published.approval_digest, fixture.expected.approval_digest)
  const current = await inspect(worker)
  assert.deepEqual(current, { ...expectedAbsent(), ...published })
  await publicDetail(worker, 1)
  expectStatus(await worker.request(route(), { body: approval }), 409, 'EDITORIAL_CONFLICT')

  for (const suffix of ['?extra=1', '?id=' + ID + '&extra=1', '?unknown=value']) {
    expectStatus(await worker.request(route() + suffix), 400, 'INVALID_REQUEST')
    expectStatus(await worker.request(route() + suffix, { body: approval }), 400, 'INVALID_REQUEST')
  }
  // These are original CLIENT queries, not direct-handler URL fixtures. The
  // pinned Next/next-on-pages build overwrites id/nxtPid and removes _rsc.
  // Consequently they are accepted with the PATH identity, not proof that the
  // original query was absent. Assert exact outcomes, never "200 or 400".
  for (const suffix of [`?id=${OTHER_ID}`, `?id=${ID}`, `?nxtPid=${OTHER_ID}`, '?_rsc=x']) {
    assert.deepEqual(await inspect(worker, suffix), current, `Normalized client query changed identity: ${suffix}`)
    expectStatus(await worker.request(route() + suffix, { body: approval }), 409, 'EDITORIAL_CONFLICT')
    assert.deepEqual(await inspect(worker, '', OTHER_ID), expectedAbsent(OTHER_ID))
    context.diagnostic(`Client query ${suffix}: exact GET=200 on path ID, stale POST=409 on path ID; not raw-query rejection evidence`)
  }
  const template = `/api/feed/[id]/editorial?id=${ID}`
  expectStatus(await worker.request(template), 400, 'INVALID_REQUEST')
  expectStatus(await worker.request(template, { body: approval }), 400, 'INVALID_REQUEST')

  const otherBundle = structuredClone(approval)
  otherBundle.manifest.publication.article_id = OTHER_ID
  otherBundle.manifest.publication.source.url = String(syntheticArticle(OTHER_ID).url)
  otherBundle.attestation.manifest_sha256 = hash(canonicalEditorialJson(otherBundle.manifest))
  expectStatus(await worker.request(route() + `?id=${OTHER_ID}`, { body: otherBundle }), 400, 'INVALID_REQUEST')
  assert.deepEqual(await inspect(worker, '', OTHER_ID), expectedAbsent(OTHER_ID))
  assert.deepEqual(await inspect(worker), current)

  const revoked = expectStatus(await worker.request(route(), { body: {
    action: 'revoke', expected_state: 'published', expected_revision: 1, reason: 'Synthetic local withdrawal only.',
  } }), 200)
  assert.deepEqual(revoked, { ...published, state: 'withdrawn', revision: 2 })
  assert.deepEqual(await inspect(worker), { ...current, state: 'withdrawn', revision: 2 })
  await publicDetail(worker, null)

  // Restore needs a NEW exact attestation/digest for the new CAS expectation.
  const restore = structuredClone(approval)
  restore.manifest.action = 'restore'
  restore.manifest.expected_state = 'withdrawn'
  restore.manifest.expected_revision = 2
  restore.attestation.attested_at = '2026-09-04T00:00:01Z'
  restore.attestation.manifest_sha256 = hash(canonicalEditorialJson(restore.manifest))
  assert.notEqual(restore.attestation.manifest_sha256, fixture.expected.manifest_sha256)
  const restored = expectStatus(await worker.request(route(), { body: restore }), 200)
  assert.deepEqual(restored, expectedReceipt(restore, 3))
  assert.deepEqual(await inspect(worker), { ...expectedAbsent(), ...restored })
  await publicDetail(worker, 3)
  assert.deepEqual(await inspect(worker, '', OTHER_ID), expectedAbsent(OTHER_ID))

  await worker.stop()
  assert.deepEqual(await worker.query('SELECT *, hex(content) AS content_hex FROM articles ORDER BY url_hash'), before)
  assert.deepEqual(await worker.query('SELECT url_hash, state, revision FROM article_editorials ORDER BY url_hash'), [
    { url_hash: ID, state: 'published', revision: 3 },
  ])
  passed = true
  context.diagnostic('Enabled compiled Worker: publish1/revoke2/restore3, exact digests, anonymous summary/editorial projection, both original 39-column rows and body hex unchanged')
})
