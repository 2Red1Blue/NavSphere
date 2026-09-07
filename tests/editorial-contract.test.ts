import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canonicalEditorialJson, parseEditorialJson, validateEditorialApproval, validateEditorialPublication,
  type EditorialManifest, type EditorialAttestation,
} from '../src/lib/editorial-contract'

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

function approval() {
  const claim = (text: string) => ({ text, evidence_ids: ['E1'] })
  const publication = {
    schema_version: 1, renderer_version: 'editorial-v1', article_id: '0123456789abcdef',
    source: { url: 'https://aihot.virxact.com/p/one?x=%2f', original_url: 'https://example.com/paper?sig=A%2fb', original_url_provenance: 'aihot_api_v1' },
    packet_sha256: '1'.repeat(64),
    evidence: [{ id: 'E1', label: '作者材料', url: 'https://example.com/paper?sig=A%2fb', kind: 'primary', text_sha256: '2'.repeat(64) }],
    brief: {
      headline: claim('作者介绍新的研究方法'),
      lead: claim('据作者提供的研究材料，该方法仍处于早期实验阶段，需要进一步独立检验。'),
      facts: [claim('作者材料描述了实验方法与当前适用范围。'), claim('作者报告的结果仅适用于本次选定的数据。')],
      analysis: claim('这些结果可能有参考意义，但不等同于已被独立验证。'),
      caveats: ['目前没有足够的独立复核材料。'],
    },
  }
  const sections = [
    ['headline', publication.brief.headline, 'supported'], ['lead', publication.brief.lead, 'qualified'],
    ...publication.brief.facts.map((fact, index) => [`facts.${index}`, fact, 'supported']),
    ['analysis', publication.brief.analysis, 'interpretation'],
    ['caveats.0', claim(publication.brief.caveats[0]), 'limitation'],
  ] as const
  const manifest = {
    schema_version: 1, publication, action: 'publish', expected_revision: 0, expected_state: 'absent',
    review: { version: 'editorial-review-v1', decisions: sections.map(([path, section, decision]) => ({
      path, text_sha256: hash((section as { text: string }).text), evidence_ids: ['E1'], decision, note: '已核对材料上下文与限制条件。',
    })) },
  } as EditorialManifest
  const attestation: EditorialAttestation = {
    schema_version: 1, manifest_sha256: hash(canonicalEditorialJson(manifest)), reviewer: '测试审核人',
    attested_at: '2026-09-04T00:00:00Z', statement: 'reviewed-for-independent-editorial-publication-v1',
  }
  return { manifest, attestation }
}

test('editorial canonical JSON preserves Unicode and URL bytes and binds all approval fields', async () => {
  assert.equal(canonicalEditorialJson({ z: '😀中文', a: ['é', 'é'] }), '{"a":["é","é"],"z":"😀中文"}')
  const { manifest, attestation } = approval()
  const result = await validateEditorialApproval(manifest, attestation)
  assert.equal(result.manifestSha256, attestation.manifest_sha256)
  assert.equal(result.publicationJson, canonicalEditorialJson(manifest.publication))
  assert.equal(result.approvalDigest, hash(canonicalEditorialJson({ manifest, attestation })))
  assert.equal(result.reviewSha256, hash(canonicalEditorialJson(manifest.review)))
  assert.equal(result.manifest.publication.source.url, manifest.publication.source.url)
  assert.notEqual(result.manifest, manifest)
})

test('editorial shared Python/TypeScript golden fixture has byte-exact publication and approval digests', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/editorial-publication-v1.json', import.meta.url), 'utf8'))
  const actual = await validateEditorialApproval(fixture.manifest, fixture.attestation)
  assert.equal(actual.publicationJson, fixture.expected.publication_json)
  assert.equal(actual.manifestSha256, fixture.expected.manifest_sha256)
  assert.equal(actual.approvalDigest, fixture.expected.approval_digest)
  assert.equal(actual.reviewSha256, fixture.expected.review_sha256)
})

test('editorial Unicode prose boundaries, count limits, dates and semantic review hashes stay exact', async () => {
  const { manifest } = approval()
  manifest.publication.brief.headline.text = '研究团队TODO公布系统实验结果'
  assert.doesNotThrow(() => validateEditorialPublication(manifest.publication))
  manifest.publication.brief.headline.text = '研究团队 TODO 公布系统实验结果'
  assert.throws(() => validateEditorialPublication(manifest.publication))
  for (const [left, right] of [['Straße实验方法与当前适用范围', 'STRASSE实验方法与当前适用范围'], ['Σςσ实验方法与当前适用范围', 'σσς实验方法与当前适用范围'], ['ＡＢＣ实验方法与当前适用范围', 'abc实验方法与当前适用范围']]) {
    const { manifest } = approval()
    manifest.publication.brief.facts[0].text = left
    manifest.publication.brief.facts[1].text = right
    assert.throws(() => validateEditorialPublication(manifest.publication))
  }
  for (const attested_at of ['2026-02-30T00:00:00Z', '2026-09-04T24:00:00Z', '0000-01-01T00:00:00Z', '2026-09-04T00:00:00+00:00']) {
    const { manifest, attestation } = approval()
    await assert.rejects(validateEditorialApproval(manifest, { ...attestation, attested_at }))
  }
  for (const mutate of [
    (m: EditorialManifest) => { m.review.decisions[0].text_sha256 = '3'.repeat(64) },
    (m: EditorialManifest) => { m.review.decisions[0].evidence_ids = ['E2'] },
    (m: EditorialManifest) => { m.review.decisions[0].path = 'facts.0' },
    (m: EditorialManifest) => { m.review.decisions.at(-1)!.evidence_ids = [] },
    (m: EditorialManifest) => { m.publication.brief.headline.text = '🧪'.repeat(81) },
  ]) {
    const { manifest, attestation } = approval()
    mutate(manifest)
    attestation.manifest_sha256 = hash(canonicalEditorialJson(manifest))
    await assert.rejects(validateEditorialApproval(manifest, attestation))
  }
})

test('editorial approval rejects tampered public/private/CAS fields and incomplete semantic decisions', async () => {
  const mutations: Array<(manifest: EditorialManifest) => void> = [
    (m) => { m.publication.brief.headline.text += '变更' },
    (m) => { m.publication.evidence[0].label += '变更' },
    (m) => { m.publication.evidence[0].text_sha256 = '3'.repeat(64) },
    (m) => { m.publication.packet_sha256 = '3'.repeat(64) },
    (m) => { m.publication.source.url += '&changed=1' },
    (m) => { m.expected_revision = 1; m.expected_state = 'published' },
    (m) => { m.action = 'restore'; m.expected_revision = 1; m.expected_state = 'withdrawn' },
    (m) => { m.review.decisions[0].note += '变更' },
    (m) => { m.review.decisions.pop() },
    (m) => { m.review.decisions.reverse() },
  ]
  for (const mutate of mutations) {
    const { manifest, attestation } = approval()
    mutate(manifest)
    await assert.rejects(validateEditorialApproval(manifest, attestation))
  }
  for (const decision of ['pending', 'remove', 'interpretation']) {
    const { manifest, attestation } = approval()
    Object.assign(manifest.review.decisions[0], { decision })
    attestation.manifest_sha256 = hash(canonicalEditorialJson(manifest))
    await assert.rejects(validateEditorialApproval(manifest, attestation))
  }
})

test('editorial strict parser rejects duplicate escaped keys, floats, unpaired Unicode and excess depth', () => {
  for (const text of ['{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}', '1.0', '1e2', 'NaN', '-0', '"\\ud800"', '"\udfff"', '['.repeat(22) + '0' + ']'.repeat(22)]) {
    assert.throws(() => parseEditorialJson(text), { name: 'EditorialValidationError' }, text)
  }
  assert.deepEqual(parseEditorialJson('{"a": [1, null, true], "b":"😀"}'), { a: [1, null, true], b: '😀' })
  assert.throws(() => canonicalEditorialJson({ a: undefined }))
  assert.throws(() => canonicalEditorialJson({ a: 1.5 }))
})

test('editorial publication rejects unknown fields, unsafe prose, references, URLs and metadata pairs', () => {
  for (const mutate of [
    (m: EditorialManifest) => { Object.assign(m.publication, { fulltext_publication_allowed: true }) },
    (m: EditorialManifest) => { m.publication.brief.lead.text += '<script>' },
    (m: EditorialManifest) => { m.publication.brief.lead.text += '\n换行' },
    (m: EditorialManifest) => { m.publication.brief.lead.text += ' example.com' },
    (m: EditorialManifest) => { m.publication.brief.facts[1] = m.publication.brief.facts[0] },
    (m: EditorialManifest) => { m.publication.brief.headline.evidence_ids = ['E2'] },
    (m: EditorialManifest) => { m.publication.evidence[0].url = 'http://127.0.0.1/private' },
    (m: EditorialManifest) => { m.publication.source.original_url = null },
    (m: EditorialManifest) => { m.publication.article_id = 'ABCDEF0123456789' },
  ]) {
    const { manifest } = approval()
    mutate(manifest)
    assert.throws(() => validateEditorialPublication(manifest.publication))
  }
})
