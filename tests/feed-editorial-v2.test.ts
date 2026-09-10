import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { canonicalEditorialJson } from '../src/lib/editorial-contract'
import { handleManualEditorialV2Request } from '../src/lib/feed-editorial-v2-http'
import { readFeedDetail } from '../src/lib/feed-detail'
import { createSqliteD1, type SqliteD1Fixture } from './helpers/sqlite-d1'

const id = 'a1b2c3d4e5f60718'
const source = {
  url: 'https://aihot.virxact.com/items/psyche',
  original_url: 'https://psyche.co/ideas/is-it-morally-wrong-to-not-take-care-of-yourself',
  original_url_provenance: 'aihot_api_v1',
}
const hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const v1Fixture = JSON.parse(readFileSync(new URL('./fixtures/editorial-publication-v1.json', import.meta.url), 'utf8'))

function publication() {
  return {
    schema_version: 2,
    renderer_version: 'editorial-v2',
    article_id: id,
    source,
    content_type: 'explainer',
    article: {
      title: '自我义务的心理学研究如何展开',
      deck: '一系列研究考察普通人是否把自我照顾看作道德义务，并保留哲学争议与研究边界。',
      sections: [{
        id: 'sec_01', heading: '核心问题', blocks: [{
          id: 'b_01', type: 'paragraph',
          text: '文章区分对自己的道德义务、个人偏好与对他人的义务，不把描述性调查结果当作规范性证明。',
          source_ids: ['src_01'],
        }],
      }],
    },
    sources: [{ id: 'src_01', title: 'Psyche 原文', url: source.original_url, evidence_id: 'E1' }],
  }
}

function body(expected_state: 'absent' | 'published' | 'withdrawn' = 'absent', expected_revision = 0) {
  return {
    schema_version: 2, expected_state, expected_revision, publication: publication(),
    acceptance: {
      schema_version: 1, accepted_by: 'user', accepted_at: '2026-09-10T00:00:00Z',
      candidate_sha256: '1'.repeat(64), draft_sha256: '2'.repeat(64), review_sha256: '3'.repeat(64),
      minor_issue_count: 4,
    },
  }
}

function fixture() {
  const fixture = createSqliteD1(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  fixture.query(`INSERT INTO articles(url_hash,title,source,url,original_url,original_url_provenance,discovered_at,approved_for_publication,score,signal,novelty,usefulness,content)
    VALUES (?, 'Psyche collection', 'aihot', ?, ?, ?, '2026-09-10T00:00:00Z', 1, 30, 8, 9, 8, ?)`,
    [id, source.url, source.original_url, source.original_url_provenance, 'Original body must never change'])
  return fixture
}

function request(fixture: SqliteD1Fixture, value: unknown, options: { token?: string, enabled?: string, id?: string, suffix?: string } = {}) {
  const articleId = options.id ?? id
  const req = new Request(`https://local.example/api/feed/${articleId}/editorial-v2${options.suffix ?? ''}`, {
    method: 'POST', headers: { Authorization: `Bearer ${options.token ?? 'test-secret'}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  })
  return handleManualEditorialV2Request(req, articleId, () => ({
    DB: fixture.db, CONTENT_OS_API_KEY: 'test-secret', FEED_EDITORIAL_ENABLED: options.enabled ?? 'true',
  }))
}

test('manual v2 endpoint writes canonical v2 only after explicit human acceptance and preserves original body', async () => {
  const f = fixture()
  try {
    const before = f.query('SELECT hex(content) AS content_bytes, approved_for_publication FROM articles WHERE url_hash=?', [id])
    const response = await request(f, body())
    assert.equal(response.status, 200)
    const receipt = await response.json() as Record<string, unknown>
    assert.equal(receipt.state, 'published')
    assert.equal(receipt.revision, 1)
    const row = f.query<{ publication_json: string, manifest_sha256: string, approval_digest: string }>('SELECT publication_json,manifest_sha256,approval_digest FROM article_editorials')[0]
    assert.equal(row.publication_json, canonicalEditorialJson(publication()))
    assert.equal(row.manifest_sha256, hex(row.publication_json))
    assert.match(row.approval_digest, /^[a-f0-9]{64}$/)
    assert.deepEqual(f.query('SELECT hex(content) AS content_bytes, approved_for_publication FROM articles WHERE url_hash=?', [id]), before)
  } finally { f.close() }
})

test('manual v2 endpoint is auth-first, path-bound, feature-gated and source-CAS guarded', async () => {
  const f = fixture()
  try {
    assert.equal((await request(f, body(), { token: 'wrong' })).status, 401)
    assert.equal((await request(f, body(), { enabled: 'false' })).status, 409)
    assert.equal((await request(f, body(), { suffix: '?id=' + id })).status, 400)
    const mismatched = body(); mismatched.publication.article_id = 'fedcba9876543210'
    assert.equal((await request(f, mismatched)).status, 400)
    const invalidBinding = body(); invalidBinding.publication.source = {
      url: 'https://psyche.co/ideas/not-a-collection',
      original_url: source.original_url,
      original_url_provenance: source.original_url_provenance,
    }
    assert.equal((await request(f, invalidBinding)).status, 400)
    const wrongSource = body(); wrongSource.publication.source = { ...source, url: 'https://aihot.virxact.com/items/other' }
    assert.equal((await request(f, wrongSource)).status, 409)
    assert.equal(f.query('SELECT * FROM article_editorials').length, 0)
  } finally { f.close() }
})

test('manual v2 endpoint preserves bounded-body semantics', async () => {
  const f = fixture()
  try {
    const requestTooLarge = new Request(`https://local.example/api/feed/${id}/editorial-v2`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-secret',
        'Content-Type': 'application/json',
        'Content-Length': String(256 * 1024 + 1),
      },
      body: '{}',
    })
    const response = await handleManualEditorialV2Request(requestTooLarge, id, () => ({
      DB: f.db, CONTENT_OS_API_KEY: 'test-secret', FEED_EDITORIAL_ENABLED: 'true',
    }))
    assert.equal(response.status, 413)
    assert.deepEqual(await response.json(), { code: 'BODY_TOO_LARGE' })
  } finally { f.close() }
})

test('reader projects valid v2 and never falls back from invalid or unknown v2 payloads', async () => {
  const f = fixture()
  try {
    assert.equal((await request(f, body())).status, 200)
    const valid = await readFeedDetail(f.db, undefined, id)
    const validData = await valid.json() as { data: { editorial: unknown, editorial_v2: Record<string, unknown> | null } }
    assert.equal(validData.data.editorial, null)
    assert.equal(validData.data.editorial_v2?.renderer_version, 'editorial-v2')
    f.exec("UPDATE articles SET original_url='https://psyche.co/ideas/changed' WHERE url_hash='a1b2c3d4e5f60718'")
    const staleSource = await readFeedDetail(f.db, undefined, id)
    const staleSourceData = await staleSource.json() as { data: { editorial_v2: unknown } }
    assert.equal(staleSourceData.data.editorial_v2, null)
    f.exec("UPDATE articles SET original_url='https://psyche.co/ideas/is-it-morally-wrong-to-not-take-care-of-yourself' WHERE url_hash='a1b2c3d4e5f60718'")
    f.exec("UPDATE article_editorials SET publication_json=json_set(publication_json, '$.renderer_version', 'editorial-v9')")
    const unknown = await readFeedDetail(f.db, undefined, id)
    const unknownData = await unknown.json() as { data: { editorial_v2: unknown } }
    assert.equal(unknownData.data.editorial_v2, null)
    f.exec("UPDATE article_editorials SET publication_json=json_set(publication_json, '$.schema_version', 1)")
    const confused = await readFeedDetail(f.db, undefined, id)
    const confusedData = await confused.json() as { data: { editorial_v2: unknown } }
    assert.equal(confusedData.data.editorial_v2, null)
  } finally { f.close() }
})

test('manual v2 compare-and-swap permits exactly one first publication', async () => {
  const f = fixture()
  try {
    const responses = await Promise.all([request(f, body()), request(f, body())])
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
    assert.deepEqual(f.query('SELECT revision,state FROM article_editorials'), [{ revision: 1, state: 'published' }])
  } finally { f.close() }
})

test('manual v2 may restore a withdrawn editorial only with its exact current revision', async () => {
  const f = fixture()
  try {
    assert.equal((await request(f, body())).status, 200)
    f.exec("UPDATE article_editorials SET state='withdrawn', withdrawn_at='2026-09-10T00:00:01Z', withdrawal_reason='test withdrawal' WHERE url_hash='a1b2c3d4e5f60718'")
    assert.equal((await request(f, body('withdrawn', 0))).status, 409)
    const restored = await request(f, body('withdrawn', 1))
    assert.equal(restored.status, 200)
    assert.equal((await restored.json() as { revision: number }).revision, 2)
  } finally { f.close() }
})

test('v1 editorial projection remains in its established field when v2 is additive', async () => {
  const f = createSqliteD1(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  const v1 = v1Fixture.manifest.publication
  try {
    f.query(`INSERT INTO articles(url_hash,title,source,url,original_url,original_url_provenance,discovered_at,approved_for_publication,score,signal,novelty,usefulness,content)
      VALUES (?, 'v1 collection', 'aihot', ?, ?, ?, '2026-09-10T00:00:00Z', 1, 30, 8, 9, 8, 'body')`,
    [v1.article_id, v1.source.url, v1.source.original_url, v1.source.original_url_provenance])
    f.query(`INSERT INTO article_editorials(url_hash,revision,state,publication_json,manifest_sha256,approval_digest,review_sha256,approved_by,approved_at,published_at)
      VALUES (?,1,'published',?,?,?,?,?,?,?)`,
    [v1.article_id, v1Fixture.expected.publication_json, v1Fixture.expected.manifest_sha256,
      v1Fixture.expected.approval_digest, v1Fixture.expected.review_sha256, 'test', '2026-09-10T00:00:00Z', '2026-09-10T00:00:00Z'])
    const response = await readFeedDetail(f.db, undefined, v1.article_id)
    const data = await response.json() as { data: { editorial: unknown, editorial_v2: unknown } }
    assert.deepEqual(data.data.editorial, { ...v1, revision: 1, published_at: '2026-09-10T00:00:00Z' })
    assert.equal(data.data.editorial_v2, null)
  } finally { f.close() }
})
