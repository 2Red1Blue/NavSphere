/**
 * Editorial v2 contract validators (CONTRACT.md §1–§3, TypeScript half).
 *
 * Mirrors scripts/editorial_contract_v2.py for the cross-language contracts
 * (§8: the invocation ledger stays Python-private and is NOT validated here).
 * The golden fixtures in drafts/editorial-v2/contracts/fixtures pin identical
 * accept/reject decisions and identical canonical hashes on both sides — that
 * agreement is the freeze condition in FREEZE.md §4.
 */
import { canonicalEditorialJson, parseEditorialJson } from './editorial-contract'
import { validOriginalMetadata, validateOriginalUrl, type OriginalUrlProvenance } from './source-provenance'

// OQ-14/审计 P1-2: this module must stay import-safe in browser/Reader code,
// so node:crypto is NOT imported.  Hash recomputation (segment hashes, policy
// and draft digests) only runs when a hasher is configured via
// `configureHasher` — server code and the fixture 对拍 tests install the
// node-crypto implementation; the Reader validates structure without hashing
// (hash integrity is enforced at the release gate, before publication).
type HashFn = (text: string) => string
let hasher: HashFn | null = null

export function configureHasher(fn: HashFn | null): void {
  hasher = fn
}

function hashText(text: string): string {
  assert(hasher !== null, 'hasher_not_configured')
  return hasher!(text)
}

export class ContractViolationV2 extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'ContractViolationV2'
    this.code = code
  }
}

export interface EditorialPublicationV2 {
  schema_version: 2
  renderer_version: 'editorial-v2'
  article_id: string
  source: EditorialV2SourceBinding
  content_type: 'brief' | 'explainer'
  downgraded_from?: 'explainer'
  article: Record<string, unknown>
  sources: Array<Record<string, unknown>>
}

export type EditorialV2SourceBinding = {
  url: string
  original_url: string | null
  original_url_provenance: OriginalUrlProvenance | null
}

export type ManualEditorialV2Submission = {
  schema_version: 2
  expected_state: 'absent' | 'published' | 'withdrawn'
  expected_revision: number
  publication: EditorialPublicationV2
  acceptance: {
    schema_version: 1
    accepted_by: string
    accepted_at: string
    candidate_sha256: string
    draft_sha256: string
    review_sha256: string
    minor_issue_count: number
  }
}

function fail(code: string): never {
  throw new ContractViolationV2(code)
}

export function sha256Hex(text: string): string {
  return hashText(text)
}

export function sha256Canonical(value: unknown): string {
  return hashText(canonicalEditorialJson(value))
}

const HEX64 = /^[a-f0-9]{64}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MODEL_URL = /[a-z][a-z0-9+.-]*:\/\/|\b(?:www\.|mailto:|tel:|javascript:|data:)|\b[\w.+-]+@[\w.-]+\.[^\W\d_]{2,63}\b|\b(?:[\w-]+\.)+[^\W\d_][\w-]{1,62}\b|(?<!\w)\/\/\S+/i
const PLACEHOLDER = /\b(?:todo|tbd|placeholder|lorem ipsum)\b|待补充|待完善|占位/i
const LIMITATIONS = [
  'local_integrity_only_not_authorship_or_approval',
  'prefix_not_representative_or_semantically_verified',
  'source_kind_is_curator_claim',
  'no_fulltext_republication_rights_inferred',
]

export function strictParse(raw: string): unknown {
  let value: unknown
  try {
    value = parseEditorialJson(raw)
  } catch {
    fail('invalid_json')
  }
  rejectOversizedInts(value)
  return value
}

function rejectOversizedInts(value: unknown): void {
  if (typeof value === 'number') {
    assert(Number.isSafeInteger(value))
  } else if (Array.isArray(value)) {
    value.forEach(rejectOversizedInts)
  } else if (value !== null && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(rejectOversizedInts)
  }
}

export function requireCanonical(raw: string, value: unknown): void {
  if (canonicalEditorialJson(value) !== raw) fail('noncanonical_json')
}

function assert(condition: unknown, code = 'invalid_json'): asserts condition {
  if (!condition) fail(code)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Closed field set (§1.6). */
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!isObject(value)) fail('invalid_object')
  const keys = new Set(Object.keys(value))
  for (const key of required) assert(keys.has(key), 'invalid_object')
  for (const key of Object.keys(value)) {
    assert(required.includes(key) || optional.includes(key), 'unknown_key')
  }
  return value
}

function hex64(value: unknown): string {
  assert(typeof value === 'string' && HEX64.test(value), 'invalid_digest')
  return value
}

function integer(value: unknown, minimum: number, maximum?: number): number {
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum, 'invalid_integer')
  if (maximum !== undefined) assert(value <= maximum, 'invalid_integer')
  return value
}

function enumValue(value: unknown, allowed: string[], code: string): string {
  assert(typeof value === 'string' && allowed.includes(value), code)
  return value
}

function url(value: unknown): string {
  assert(typeof value === 'string' && validateOriginalUrl(value) !== null, 'invalid_url')
  return value
}

// Reader validation runs in browser bundles as well as Node tests.  Use Web
// platform UTF-8 primitives instead of Node's Buffer global.
const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8')
const DISALLOWED_TEXT_CODEPOINT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u

function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength
}

function decodeUtf8(value: Uint8Array): string {
  return utf8Decoder.decode(value)
}

/** §1.9 text(n,m) — v2 edition: U+200D (ZWJ, Cf) is allowed inside emoji sequences. */
function text(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== 'string') fail('invalid_text')
  const length = [...value].length
  assert(minimum <= length && length <= maximum, 'invalid_text')
  assert(value === value.trim(), 'unsafe_text')
  for (const character of value) {
    if (character === '\u200d') continue
    assert(!DISALLOWED_TEXT_CODEPOINT.test(character), 'unsafe_text')
  }
  return value
}

function prose(value: unknown, minimum: number, maximum: number): string {
  const result = text(value, minimum, maximum)
  assert(!MODEL_URL.test(result) && !/[<>\[\]{}*_`#\\|]/.test(result), 'invalid_prose')
  assert(!PLACEHOLDER.test(result), 'placeholder_text')
  return result
}

function policyText(value: unknown): string {
  if (typeof value !== 'string') fail('invalid_policy_text')
  const length = [...value].length
  assert(1 <= length && length <= 24000, 'invalid_policy_text')
  for (const character of value) {
    const code = character.codePointAt(0)!
    assert(character === '\n' || character === '\r' || character === '\t'
      || !(code < 0x20 || (code >= 0x7f && code <= 0x9f)), 'unsafe_text')
  }
  return value
}

// ---------------------------------------------------------------------------
// §3.1 source_document_v2
// ---------------------------------------------------------------------------

export function validateSourceDocumentV2(doc: unknown, fulltext?: Uint8Array): Record<string, unknown> {
  const value = object(doc, ['schema_version', 'document_id', 'source_url', 'title',
    'text_sha256', 'extractor_version', 'segments'])
  assert(value.schema_version === 2, 'invalid_schema_version')
  const documentTextSha = hex64(value.text_sha256)
  assert(typeof value.document_id === 'string' && /^doc_[0-9a-f]{16}$/.test(value.document_id),
    'invalid_document_id')
  assert(value.document_id === `doc_${documentTextSha.slice(0, 16)}`, 'invalid_document_id')
  url(value.source_url)
  text(value.title, 1, 240)
  text(value.extractor_version, 1, 80)
  const segments = value.segments
  assert(Array.isArray(segments) && segments.length >= 1 && segments.length <= 4096, 'invalid_segments')
  let previousEnd = 0
  let lastNumber = 0
  const seen = new Set<string>()
  for (const raw of segments) {
    const segment = object(raw, ['id', 'start_byte', 'end_byte', 'text_sha256'])
    assert(typeof segment.id === 'string' && /^s[0-9]{2,6}$/.test(segment.id) && !seen.has(segment.id),
      'invalid_segment_id')
    seen.add(segment.id)
    const number = Number.parseInt(segment.id.slice(1), 10)
    assert(number > lastNumber, 'invalid_segment_id')
    lastNumber = number
    const start = integer(segment.start_byte, 0)
    const end = integer(segment.end_byte, 1)
    assert(start < end && start >= previousEnd, 'invalid_segments')
    if (fulltext !== undefined) assert(end <= fulltext.byteLength, 'invalid_segments')
    previousEnd = end
    hex64(segment.text_sha256)
    if (fulltext !== undefined) {
      assert(isCharBoundary(fulltext, start) && isCharBoundary(fulltext, end),
        'segment_span_not_char_boundary')
      assert(sha256Hex(decodeUtf8(fulltext.slice(start, end))) === segment.text_sha256,
        'segment_sha256_mismatch')
    }
  }
  if (fulltext !== undefined) assert(previousEnd === fulltext.byteLength, 'invalid_segments')
  return value
}

function isCharBoundary(bytes: Uint8Array, offset: number): boolean {
  return offset === 0 || offset === bytes.byteLength || (bytes[offset] & 0xc0) !== 0x80
}

// ---------------------------------------------------------------------------
// §3.2 capture_receipt_v3
// ---------------------------------------------------------------------------

function validateCollection(collection: unknown): Record<string, unknown> {
  const value = object(collection, ['url_hash', 'title', 'url'],
    ['original_url', 'original_url_provenance'])
  assert(typeof value.url_hash === 'string' && /^[0-9a-f]{16}$/.test(value.url_hash), 'invalid_url_hash')
  text(value.title, 1, 240)
  url(value.url)
  if ('original_url' in value && value.original_url !== null) url(value.original_url)
  return value
}

export function validateCaptureReceiptV3(receipt: unknown): Record<string, unknown> {
  const value = object(receipt, ['schema_version', 'status', 'visibility',
    'fulltext_publication_allowed', 'authorship', 'collection', 'source', 'extractor',
    'artifacts', 'fulltext', 'excerpt', 'packet_digest', 'limitations'])
  assert(value.schema_version === 3, 'invalid_schema_version')
  assert(value.status === 'needs_human_review' && value.visibility === 'private_capture'
    && value.fulltext_publication_allowed === false && value.authorship === 'unknown',
    'invalid_receipt_constants')
  validateCollection(value.collection)
  const source = object(value.source, ['requested_url', 'final_url', 'source_role',
    'fetched_at', 'content_type', 'hops'])
  url(source.requested_url)
  url(source.final_url)
  enumValue(source.source_role, ['upstream', 'aihot_collection_secondary'], 'invalid_enum')
  assert(typeof source.fetched_at === 'string' && TIMESTAMP.test(source.fetched_at), 'invalid_timestamp')
  text(source.content_type, 1, 120)
  assert(Array.isArray(source.hops) && source.hops.length >= 1 && source.hops.length <= 6, 'invalid_hops')
  for (const raw of source.hops) {
    const hop = object(raw, ['url', 'status'])
    url(hop.url)
    integer(hop.status, 100, 599)
  }
  const extractor = object(value.extractor, ['name', 'version', 'options'])
  text(extractor.name, 1, 80)
  text(extractor.version, 1, 40)
  assert(isObject(extractor.options), 'invalid_extractor_options')
  const artifacts = object(value.artifacts, ['response.html', 'extracted.txt', 'packet.json'])
  for (const artifact of Object.values(artifacts)) {
    const entry = object(artifact, ['sha256', 'size_bytes'])
    hex64(entry.sha256)
    integer(entry.size_bytes, 1)
  }
  const fulltext = object(value.fulltext, ['document_id', 'text_sha256', 'size_bytes',
    'char_count', 'segment_count'])
  assert(typeof fulltext.document_id === 'string' && /^doc_[0-9a-f]{16}$/.test(fulltext.document_id),
    'invalid_document_id')
  hex64(fulltext.text_sha256)
  integer(fulltext.size_bytes, 1)
  integer(fulltext.char_count, 0)
  integer(fulltext.segment_count, 1)
  const excerpt = object(value.excerpt, ['evidence_id', 'selection', 'start', 'end', 'sha256'])
  assert(typeof excerpt.evidence_id === 'string' && /^E[1-4]$/.test(excerpt.evidence_id),
    'invalid_evidence_id')
  enumValue(excerpt.selection, ['prefix_unreviewed', 'full'], 'invalid_enum')
  integer(excerpt.start, 0)
  integer(excerpt.end, 0)
  hex64(excerpt.sha256)
  hex64(value.packet_digest)
  assert(JSON.stringify(value.limitations) === JSON.stringify(LIMITATIONS), 'invalid_limitations')
  return value
}

// ---------------------------------------------------------------------------
// §3.3 evidence_packet_v2
// ---------------------------------------------------------------------------

export function validateEvidencePacketV2(packet: unknown, fulltext?: Uint8Array): Record<string, unknown> {
  const value = object(packet, ['schema_version', 'collection', 'document', 'evidence'])
  assert(value.schema_version === 2, 'invalid_schema_version')
  validateCollection(value.collection)
  const document = object(value.document, ['document_id', 'text_sha256'])
  assert(typeof document.document_id === 'string' && /^doc_[0-9a-f]{16}$/.test(document.document_id),
    'invalid_document_id')
  const documentTextSha = hex64(document.text_sha256)
  assert(document.document_id === `doc_${documentTextSha.slice(0, 16)}`,
    'invalid_document_id')
  const evidence = value.evidence
  assert(Array.isArray(evidence) && evidence.length >= 1 && evidence.length <= 4, 'invalid_evidence_count')
  const seen = new Set<string>()
  for (const raw of evidence) {
    const entry = object(raw, ['id', 'label', 'url', 'kind', 'text_sha256', 'start_byte', 'end_byte'])
    assert(typeof entry.id === 'string' && /^E[1-4]$/.test(entry.id) && !seen.has(entry.id),
      'invalid_evidence_id')
    seen.add(entry.id)
    text(entry.label, 1, 160)
    url(entry.url)
    enumValue(entry.kind, ['primary', 'secondary'], 'invalid_enum')
    hex64(entry.text_sha256)
    const start = integer(entry.start_byte, 0)
    const end = integer(entry.end_byte, 1)
    assert(start < end, 'invalid_segments')
    if (fulltext !== undefined) {
      assert(end <= fulltext.byteLength && isCharBoundary(fulltext, start)
        && isCharBoundary(fulltext, end), 'segment_span_not_char_boundary')
      assert(sha256Hex(decodeUtf8(fulltext.slice(start, end))) === entry.text_sha256,
        'segment_sha256_mismatch')
    }
  }
  assert(utf8ByteLength(canonicalEditorialJson(value)) <= 64 * 1024, 'packet_too_large')
  return value
}

// ---------------------------------------------------------------------------
// §3.6 article / sources structure (shared with writer_envelope draft)
// ---------------------------------------------------------------------------

function validateArticleStructure(article: unknown, sources: unknown, content_type: string,
  downgraded_from?: unknown): void {
  assert(['brief', 'explainer'].includes(content_type), 'invalid_content_type')
  if (downgraded_from !== undefined && downgraded_from !== null) {
    assert(downgraded_from === 'explainer' && content_type === 'brief', 'invalid_downgrade')
  }
  // Audit P1 stability: validate sources BEFORE anything maps over them —
  // malformed input must raise ContractViolationV2, never a native TypeError.
  validateSources(sources)
  const sourceIds = new Set<string>(
    (sources as Record<string, unknown>[]).map((source) => source.id as string),
  )
  const articleValue = object(article, ['title', 'deck', 'sections'])
  prose(articleValue.title, 8, 80)
  prose(articleValue.deck, 20, 260)
  const sections = articleValue.sections
  assert(Array.isArray(sections) && sections.length >= 1 && sections.length <= 64, 'invalid_sections')
  const sectionIds = new Set<string>()
  const blockIds = new Set<string>()
  for (const rawSection of sections) {
    const section = object(rawSection, ['id', 'heading', 'blocks'])
    assert(typeof section.id === 'string' && /^sec_[0-9]{2,4}$/.test(section.id)
      && !sectionIds.has(section.id), 'invalid_section_id')
    sectionIds.add(section.id)
    prose(section.heading, 2, 80)
    const blocks = section.blocks
    assert(Array.isArray(blocks) && blocks.length >= 1 && blocks.length <= 64, 'invalid_blocks')
    for (const rawBlock of blocks) {
      const block = object(rawBlock, ['id', 'type', 'source_ids'],
        ['text', 'items', 'emphasis_spans', 'attribution'])
      assert(typeof block.id === 'string' && /^b_[0-9]{2,6}$/.test(block.id)
        && !blockIds.has(block.id), 'invalid_block_id')
      blockIds.add(block.id)
      const references = block.source_ids
      // Audit P1-3 (2026-09-09 收紧): paragraph/list/quote require at least
      // one source — traceability is part of the article goal.
      assert(Array.isArray(references) && references.length >= 1 && references.length <= 8,
        'invalid_references')
      for (const reference of references) assert(sourceIds.has(reference as string), 'invalid_references')
      assert(new Set(references).size === references.length, 'invalid_references')
      const blockType = enumValue(block.type, ['paragraph', 'list', 'quote'], 'invalid_block_type')
      if (blockType === 'paragraph') {
        assert(!('items' in block) && !('attribution' in block), 'unknown_key')
        const blockText = prose(block.text, 1, 2000)
        if ('emphasis_spans' in block) {
          const spans = block.emphasis_spans
          assert(Array.isArray(spans) && spans.length <= 4, 'invalid_emphasis')
          const codepoints = [...blockText].length
          let previousEnd = -1
          for (const rawSpan of spans) {
            const span = object(rawSpan, ['start', 'end'])
            const start = integer(span.start, 0)
            const end = integer(span.end, 1)
            // Unicode codepoint offsets (Python len convention), never UTF-16.
            assert(start < end && end <= codepoints && start > previousEnd, 'invalid_emphasis')
            previousEnd = end
          }
        }
      } else if (blockType === 'list') {
        assert(!('text' in block) && !('attribution' in block) && !('emphasis_spans' in block),
          'unknown_key')
        const items = block.items
        assert(Array.isArray(items) && items.length >= 1 && items.length <= 12, 'invalid_list')
        for (const item of items) prose(item, 1, 220)
      } else {
        assert(!('items' in block) && !('emphasis_spans' in block), 'unknown_key')
        prose(block.text, 20, 600)
        if ('attribution' in block) prose(block.attribution, 2, 80)
      }
    }
  }
  validateSources(sources)
}

function validateSources(sources: unknown): void {
  assert(Array.isArray(sources) && sources.length >= 1 && sources.length <= 8, 'invalid_sources')
  const seen = new Set<string>()
  for (const raw of sources) {
    const source = object(raw, ['id', 'title', 'url'], ['evidence_id', 'original_title'])
    assert(typeof source.id === 'string' && /^src_[0-9]{2,4}$/.test(source.id)
      && !seen.has(source.id), 'invalid_source_id')
    seen.add(source.id)
    text(source.title, 1, 160)
    url(source.url)
    if ('evidence_id' in source && source.evidence_id !== null) {
      assert(typeof source.evidence_id === 'string' && /^E[1-4]$/.test(source.evidence_id),
        'invalid_evidence_id')
    }
    if ('original_title' in source && source.original_title !== null) {
      text(source.original_title, 1, 240)
    }
  }
}

// ---------------------------------------------------------------------------
// §3.4 writer_envelope_v2 / §3.5 review_report_v2
// ---------------------------------------------------------------------------

function validateAction(action: unknown, prefix: string): Record<string, unknown> {
  const value = object(action, ['action_id', 'successful_invocation_id',
    'invocation_set_sha256', 'terminal_receipt_sha256'])
  assert(typeof value.action_id === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(value.action_id),
    `invalid_${prefix}_action`)
  assert(typeof value.successful_invocation_id === 'string'
    && UUID.test(value.successful_invocation_id), `invalid_${prefix}_action`)
  hex64(value.invocation_set_sha256)
  hex64(value.terminal_receipt_sha256)
  return value
}

function validateIdentityAssurance(value: unknown): void {
  assert(typeof value === 'string'
    && ['attested', 'provider_reported', 'route_declared', 'unknown'].includes(value),
    'invalid_identity_assurance')
}

export function validateWriterEnvelopeV2(envelope: unknown): Record<string, unknown> {
  const value = object(envelope, ['schema_version', 'task', 'status', 'packet_sha256',
    'document_id', 'policy_sha256', 'policy_text', 'prompt_sha256', 'prompt_version',
    'draft_sha256', 'draft', 'editorial_note', 'writer_action'], ['identity_assurance'])
  assert(value.schema_version === 2, 'invalid_schema_version')
  assert(value.task === 'editorial_v2' && value.status === 'needs_human_review',
    'invalid_envelope_constants')
  hex64(value.packet_sha256)
  assert(typeof value.document_id === 'string' && /^doc_[0-9a-f]{16}$/.test(value.document_id),
    'invalid_document_id')
  const policySha = hex64(value.policy_sha256)
  const policy = policyText(value.policy_text)
  assert(sha256Hex(policy) === policySha, 'invalid_policy_digest')
  hex64(value.prompt_sha256)
  text(value.prompt_version, 1, 80)
  hex64(value.draft_sha256)
  const draft = object(value.draft, ['content_type', 'article', 'sources'])
  enumValue(draft.content_type, ['brief', 'explainer'], 'invalid_content_type')
  validateArticleStructure(draft.article, draft.sources, draft.content_type as string)
  assert(sha256Canonical(draft) === value.draft_sha256, 'invalid_draft_digest')
  const note = object(value.editorial_note, ['summary', 'open_questions'])
  prose(note.summary, 1, 600)
  assert(Array.isArray(note.open_questions) && note.open_questions.length <= 8,
    'invalid_editorial_note')
  for (const question of note.open_questions) prose(question, 4, 200)
  validateAction(value.writer_action, 'writer')
  if ('identity_assurance' in value) validateIdentityAssurance(value.identity_assurance)
  return value
}

export function validateReviewReportV2(envelope: unknown): Record<string, unknown> {
  const value = object(envelope, ['schema_version', 'status', 'automated_review_passed',
    'draft_sha256', 'writer_envelope_sha256', 'writer_prompt_sha256',
    'writer_prompt_version', 'review_prompt_sha256', 'review_prompt_version',
    'reviewer_action', 'review'], ['identity_assurance'])
  assert(value.schema_version === 2, 'invalid_schema_version')
  assert(value.status === 'needs_human_review', 'invalid_envelope_constants')
  hex64(value.draft_sha256)
  hex64(value.writer_envelope_sha256)
  hex64(value.writer_prompt_sha256)
  text(value.writer_prompt_version, 1, 80)
  hex64(value.review_prompt_sha256)
  text(value.review_prompt_version, 1, 80)
  validateAction(value.reviewer_action, 'reviewer')
  if ('identity_assurance' in value) validateIdentityAssurance(value.identity_assurance)
  const review = object(value.review, ['schema_version', 'recommendation', 'dimensions', 'issues'])
  assert(review.schema_version === 2, 'invalid_schema_version')
  enumValue(review.recommendation, ['approve', 'revise', 'needs_evidence', 'reject'],
    'invalid_recommendation')
  assert(value.automated_review_passed === (review.recommendation === 'approve'),
    'invalid_review_gate')
  const dimensions = review.dimensions
  assert(Array.isArray(dimensions) && dimensions.length === 4, 'invalid_dimensions')
  const seenDimensions = new Set<string>()
  for (const raw of dimensions) {
    const dimension = object(raw, ['dimension', 'status', 'summary'])
    enumValue(dimension.dimension, ['fact_support', 'coverage', 'explanation_quality',
      'reader_expression'], 'invalid_dimension')
    assert(!seenDimensions.has(dimension.dimension as string), 'invalid_dimensions')
    seenDimensions.add(dimension.dimension as string)
    enumValue(dimension.status, ['pass', 'fail', 'needs_evidence'], 'invalid_dimension_status')
    prose(dimension.summary, 1, 600)
  }
  const issues = review.issues
  assert(Array.isArray(issues) && issues.length <= 64, 'invalid_issues')
  for (const raw of issues) {
    const issue = object(raw, ['severity', 'code', 'target', 'evidence_refs', 'requested_change'])
    enumValue(issue.severity, ['blocker', 'major', 'minor'], 'invalid_severity')
    assert(typeof issue.code === 'string' && /^[a-z][a-z0-9_]{2,63}$/.test(issue.code),
      'invalid_issue_code')
    const target = object(issue.target, ['kind', 'id'])
    const kind = enumValue(target.kind, ['document', 'coverage_requirement', 'block_id'],
      'invalid_issue_target')
    if (kind === 'document') {
      assert(target.id === 'document', 'invalid_issue_target')
    } else if (kind === 'coverage_requirement') {
      assert(typeof target.id === 'string' && /^cov_[0-9]{2,6}$/.test(target.id),
        'invalid_issue_target')
    } else {
      assert(typeof target.id === 'string' && /^b_[0-9]{2,6}$/.test(target.id),
        'invalid_issue_target')
    }
    const refs = issue.evidence_refs
    assert(Array.isArray(refs) && refs.length <= 16, 'invalid_references')
    for (const ref of refs) {
      assert(typeof ref === 'string' && ref !== ''
        && (/^src_[0-9]{2,4}$/.test(ref) || /^s[0-9]{2,6}$/.test(ref)), 'invalid_references')
    }
    assert(new Set(refs).size === refs.length, 'invalid_references')
    prose(issue.requested_change, 1, 600)
  }
  return value
}

// ---------------------------------------------------------------------------
// §3.6 publication_renderer_v2 / §3.7 distribution_binding_v2
// ---------------------------------------------------------------------------

export function validatePublicationV2(publication: unknown): Record<string, unknown> {
  const value = object(publication, ['schema_version', 'renderer_version', 'article_id',
    'source', 'content_type', 'article', 'sources'], ['downgraded_from'])
  assert(value.schema_version === 2, 'invalid_schema_version')
  assert(value.renderer_version === 'editorial-v2', 'invalid_schema_version')
  assert(typeof value.article_id === 'string' && /^[a-f0-9]{16}$/.test(value.article_id),
    'invalid_article_id')
  sourceBinding(value.source)
  enumValue(value.content_type, ['brief', 'explainer'], 'invalid_content_type')
  if ('downgraded_from' in value && value.downgraded_from !== null) {
    assert(value.downgraded_from === 'explainer' && value.content_type === 'brief',
      'invalid_downgrade')
  }
  validateArticleStructure(value.article, value.sources, value.content_type as string,
    'downgraded_from' in value ? value.downgraded_from : undefined)
  assert(utf8ByteLength(canonicalEditorialJson(value)) <= 24 * 1024,
    'publication_too_large')
  return value
}

function sourceBinding(value: unknown): EditorialV2SourceBinding {
  const source = object(value, ['url', 'original_url', 'original_url_provenance'])
  const current = url(source.url)
  const original = source.original_url
  const provenance = source.original_url_provenance
  if (original === null || provenance === null) {
    assert(original === null && provenance === null, 'invalid_source_binding')
    return { url: current, original_url: null, original_url_provenance: null }
  }
  const validatedOriginal = url(original)
  assert(validOriginalMetadata({ url: current, original_url: validatedOriginal, original_url_provenance: provenance }),
    'invalid_source_binding')
  return { url: current, original_url: validatedOriginal, original_url_provenance: provenance as OriginalUrlProvenance }
}

/** Manual-only v2 publication request.  This is a transport envelope, not a
 * public article: private drafts, prompts, model output and review prose are
 * intentionally excluded. */
export function validateManualEditorialV2Submission(value: unknown): ManualEditorialV2Submission {
  const request = object(value, ['schema_version', 'expected_state', 'expected_revision',
    'publication', 'acceptance'])
  assert(request.schema_version === 2, 'invalid_schema_version')
  const expectedState = enumValue(request.expected_state, ['absent', 'published', 'withdrawn'], 'invalid_expected_state')
  const expectedRevision = integer(request.expected_revision, 0, 2147483647)
  const publication = validatePublicationV2(request.publication) as unknown as EditorialPublicationV2
  const acceptance = object(request.acceptance, ['schema_version', 'accepted_by', 'accepted_at',
    'candidate_sha256', 'draft_sha256', 'review_sha256', 'minor_issue_count'])
  assert(acceptance.schema_version === 1, 'invalid_acceptance')
  text(acceptance.accepted_by, 1, 80)
  assert(typeof acceptance.accepted_at === 'string' && TIMESTAMP.test(acceptance.accepted_at), 'invalid_acceptance')
  for (const field of ['candidate_sha256', 'draft_sha256', 'review_sha256'] as const) hex64(acceptance[field])
  integer(acceptance.minor_issue_count, 0, 64)
  return {
    schema_version: 2,
    expected_state: expectedState as ManualEditorialV2Submission['expected_state'],
    expected_revision: expectedRevision,
    publication,
    acceptance: {
      schema_version: 1,
      accepted_by: acceptance.accepted_by as string,
      accepted_at: acceptance.accepted_at as string,
      candidate_sha256: acceptance.candidate_sha256 as string,
      draft_sha256: acceptance.draft_sha256 as string,
      review_sha256: acceptance.review_sha256 as string,
      minor_issue_count: acceptance.minor_issue_count as number,
    },
  }
}

export function articleSha256(publication: unknown): string {
  return sha256Canonical(publication)
}

/** Server/edge digest for the manually submitted canonical public payload.
 * Unlike `articleSha256`, this uses Web Crypto and therefore needs no mutable
 * Node hasher configuration. */
export async function digestCanonicalV2(value: unknown): Promise<string> {
  const bytes = utf8Encoder.encode(canonicalEditorialJson(value))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function validateDistributionBindingV2(binding: unknown): Record<string, unknown> {
  const value = object(binding, ['schema_version', 'article_id', 'revision',
    'article_sha256', 'channel', 'delivery_kind', 'template_version', 'title',
    'summary', 'content_url', 'idempotency_key', 'delivery_disposition'])
  assert(value.schema_version === 2, 'invalid_schema_version')
  assert(typeof value.article_id === 'string' && /^[a-f0-9]{16}$/.test(value.article_id),
    'invalid_article_id')
  integer(value.revision, 0, 2147483646)
  hex64(value.article_sha256)
  enumValue(value.channel, ['site', 'feishu'], 'invalid_channel')
  enumValue(value.delivery_kind, ['initial', 'update'], 'invalid_delivery_kind')
  text(value.template_version, 1, 80)
  prose(value.title, 8, 80)
  prose(value.summary, 20, 260)
  url(value.content_url)
  const expectedKey = [value.article_id, String(value.revision), value.channel,
    value.delivery_kind].join(':')
  assert(value.idempotency_key === expectedKey, 'invalid_idempotency_key')
  enumValue(value.delivery_disposition, ['required', 'skipped'],
    'invalid_delivery_disposition')
  return value
}

// ---------------------------------------------------------------------------
// Fixture dispatch (TypeScript half of the 对拍)
// ---------------------------------------------------------------------------

const VALIDATORS: Record<string, (wire: unknown, fulltext?: Uint8Array) => Record<string, unknown>> = {
  source_document_v2: (wire, fulltext) => validateSourceDocumentV2(wire, fulltext),
  capture_receipt_v3: (wire) => validateCaptureReceiptV3(wire),
  evidence_packet_v2: (wire, fulltext) => validateEvidencePacketV2(wire, fulltext),
  writer_envelope_v2: (wire) => validateWriterEnvelopeV2(wire),
  review_report_v2: (wire) => validateReviewReportV2(wire),
  publication_renderer_v2: (wire) => validatePublicationV2(wire),
  distribution_binding_v2: (wire) => validateDistributionBindingV2(wire),
}

/** Contracts validated only by the Python side (design §8). */
export const PYTHON_ONLY_CONTRACTS = new Set(['editorial_invocation_events'])

export function validateWire(contractId: string, wire: unknown, text?: Uint8Array): Record<string, unknown> {
  const validator = VALIDATORS[contractId]
  if (!validator) fail('invalid_contract_id')
  return validator(wire, text)
}

export function validateRawCase(contractId: string, raw: string, text?: Uint8Array): void {
  const value = strictParse(raw)
  requireCanonical(raw, value)
  if (contractId === 'cross_contract') return
  validateWire(contractId, value, text)
}
