/// TypeScript half of the editorial v2 contract fixture 对拍 (FREEZE.md §4).
///
/// Runs the same golden fixtures as tests/test_editorial_contract_fixtures.py
/// (Python side).  Both halves must agree on every cross-language fixture:
/// valid wires validate and every expected hash recomputes identically;
/// negative raw_cases are rejected with exactly the expected error code.
/// The invocation ledger (editorial_invocation_events) is Python-private by
/// design §8 — its fixtures are validated on the Python side only.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canonicalEditorialJson } from '../src/lib/editorial-contract'
import {
  ContractViolationV2, PYTHON_ONLY_CONTRACTS, articleSha256, configureHasher,
  sha256Canonical, sha256Hex, validateRawCase, validateSourceDocumentV2,
  validateWire, validateWriterEnvelopeV2,
} from '../src/lib/editorial-contract-v2'

// 对拍 requires hash recomputation (segment hashes, policy/draft digests):
// install the node-crypto hasher (Reader runs without one, structure-only).
configureHasher((text) => createHash('sha256').update(text, 'utf8').digest('hex'))

const FIXTURE_DIR = new URL('../../drafts/editorial-v2/contracts/fixtures/', import.meta.url)

type FixtureWrapper = {
  contract_id: string
  kind: string
  wire: Record<string, unknown>
  expected: Record<string, unknown>
  raw_cases?: string[]
  expected_error?: string
}

type ManifestEntry = {
  file: string
  kind: string
  contract_id: string
  purpose: string
  size_bytes: number
  sha256: string
}

type Manifest = {
  fixture_count: number
  fixtures: ManifestEntry[]
}

type SourceDocumentExpected = {
  text_utf8: string
  text_sha256: string
  text_byte_length: number
  segments: Array<{ id: string; start_byte: number; end_byte: number; byte_length: number; sha256: string }>
  note?: string
}

function load(name: string): FixtureWrapper {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), 'utf8'))
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(new URL('manifest.json', FIXTURE_DIR), 'utf8'))
}

function fileSha256(name: string): string {
  return createHash('sha256').update(readFileSync(new URL(name, FIXTURE_DIR))).digest('hex')
}

test('manifest integrity: counts, sizes and hashes match the files', () => {
  const manifest = loadManifest()
  assert.equal(manifest.fixture_count, manifest.fixtures.length)
  for (const entry of manifest.fixtures) {
    assert.equal(fileSha256(entry.file), entry.sha256, entry.file)
  }
})

test('valid fixtures: wire validates and every expected value recomputes', () => {
  const manifest = loadManifest()
  let ran = 0
  for (const entry of manifest.fixtures) {
    if (entry.kind.startsWith('negative')) continue
    if (PYTHON_ONLY_CONTRACTS.has(entry.contract_id)) continue
    const fixture = load(entry.file)
    const wire = fixture.wire
    const expected = fixture.expected
    validateWire(entry.contract_id, wire)
    if (entry.contract_id === 'source_document_v2') {
      const sourceExpected = expected as unknown as SourceDocumentExpected
      const text = Buffer.from(sourceExpected.text_utf8, 'utf8')
      assert.equal(sha256Hex(sourceExpected.text_utf8), sourceExpected.text_sha256)
      assert.equal(text.byteLength, sourceExpected.text_byte_length)
      for (const segment of sourceExpected.segments) {
        const slice = text.subarray(segment.start_byte, segment.end_byte)
        assert.equal(sha256Hex(slice.toString('utf8')), segment.sha256)
        assert.equal(slice.byteLength, segment.byte_length)
      }
    } else if (entry.contract_id === 'capture_receipt_v3') {
      // packet_digest binds the evidence_packet_v2 canonical JSON; recompute
      // it from the packet fixture and pin byte-level canonical equality.
      const packet = load('evidence_packet_v2_minimal.json').wire
      assert.equal(sha256Canonical(packet), expected.packet_digest)
      assert.equal(canonicalEditorialJson(packet), expected.canonical_packet_json)
    } else if (entry.contract_id === 'evidence_packet_v2') {
      assert.equal(sha256Canonical(wire), expected.packet_sha256)
      assert.equal(canonicalEditorialJson(wire), expected.canonical_json)
    } else if (entry.contract_id === 'writer_envelope_v2') {
      assert.equal(sha256Canonical(wire), expected.envelope_sha256)
      assert.equal(sha256Canonical(wire.draft), expected.draft_sha256)
      assert.deepEqual(wire.writer_action, expected.writer_action)
    } else if (entry.contract_id === 'review_report_v2') {
      assert.equal(sha256Canonical(wire), expected.envelope_sha256)
    } else if (entry.contract_id === 'publication_renderer_v2') {
      assert.equal(articleSha256(wire), expected.article_sha256)
      if ('canonical_json' in expected) {
        assert.equal(canonicalEditorialJson(wire), expected.canonical_json)
      }
    } else if (entry.contract_id === 'distribution_binding_v2') {
      assert.equal(sha256Canonical(wire), expected.distribution_sha256)
      assert.equal(expected.article_sha256, wire.article_sha256)
    }
    ran += 1
  }
  assert.equal(ran, 9)
})

test('negative fixtures: every raw_case is rejected with the expected code', () => {
  const manifest = loadManifest()
  const mbText = Buffer.from(
    load('source_document_v2_multibyte.json').expected.text_utf8 as string, 'utf8',
  )
  let ran = 0
  for (const entry of manifest.fixtures) {
    if (!entry.kind.startsWith('negative')) continue
    if (PYTHON_ONLY_CONTRACTS.has(entry.contract_id)) continue
    const fixture = load(entry.file)
    const text = entry.contract_id === 'source_document_v2' ? mbText : undefined
    const rawCases = fixture.raw_cases ?? []
    assert(rawCases.length >= 1, `${entry.file}: negative fixture has no raw_cases`)
    for (const raw of rawCases) {
      assert.throws(
        () => validateRawCase(entry.contract_id, raw, text),
        (error: unknown) => error instanceof ContractViolationV2
          && error.code === fixture.expected_error,
        `${entry.file}: ${String(raw).slice(0, 80)}`,
      )
    }
    ran += 1
  }
  assert.equal(ran, 9)
})

test('cross-language anchor: multibyte publication article_sha256 matches Python', () => {
  const fixture = load('publication_v2_multibyte.json')
  assert.equal(articleSha256(fixture.wire), fixture.expected.article_sha256)
})

test('malformed derived fields fail with ContractViolationV2 instead of native type errors', () => {
  const source = structuredClone(load('source_document_v2_minimal.json').wire)
  source.text_sha256 = null
  assert.throws(
    () => validateSourceDocumentV2(source),
    (error: unknown) => error instanceof ContractViolationV2 && error.code === 'invalid_digest',
  )

  const writer = structuredClone(load('writer_envelope_v2_minimal.json').wire)
  writer.policy_text = null
  assert.throws(
    () => validateWriterEnvelopeV2(writer),
    (error: unknown) => error instanceof ContractViolationV2 && error.code === 'invalid_policy_text',
  )
})
