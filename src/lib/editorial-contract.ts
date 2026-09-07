import { validOriginalMetadata, validateOriginalUrl, type OriginalUrlProvenance } from './source-provenance'

export const MAX_EDITORIAL_REQUEST_BYTES = 48 * 1024
export const MAX_EDITORIAL_PUBLICATION_BYTES = 24 * 1024
export const MAX_EDITORIAL_MANIFEST_BYTES = 32 * 1024
const encoder = new TextEncoder()
const DIGEST = /^[a-f0-9]{64}$/
export type EditorialState = 'absent' | 'published' | 'withdrawn'
export type EditorialSource = { url: string; original_url: string | null; original_url_provenance: OriginalUrlProvenance | null }
export type EditorialClaim = { text: string; evidence_ids: string[] }
export interface EditorialPublication {
  schema_version: 1
  renderer_version: 'editorial-v1'
  article_id: string
  source: EditorialSource
  packet_sha256: string
  evidence: Array<{ id: string; label: string; url: string; kind: 'primary' | 'secondary'; text_sha256: string }>
  brief: { headline: EditorialClaim; lead: EditorialClaim; facts: EditorialClaim[]; analysis: EditorialClaim; caveats: string[] }
}
export interface EditorialManifest {
  schema_version: 1
  publication: EditorialPublication
  action: 'publish' | 'restore'
  expected_revision: number
  expected_state: EditorialState
  review: { version: 'editorial-review-v1'; decisions: Array<{
    path: string; text_sha256: string; evidence_ids: string[]
    decision: 'supported' | 'qualified' | 'interpretation' | 'limitation'; note: string
  }> }
}
export interface EditorialAttestation {
  schema_version: 1
  manifest_sha256: string
  reviewer: string
  attested_at: string
  statement: 'reviewed-for-independent-editorial-publication-v1'
}
export type EditorialRevoke = { action: 'revoke'; expected_revision: number; expected_state: EditorialState; reason: string }

export class EditorialValidationError extends Error {
  constructor() { super('Invalid editorial request'); this.name = 'EditorialValidationError' }
}
function fail(): never { throw new EditorialValidationError() }
function assert(condition: unknown): asserts condition { if (!condition) fail() }
function scalarString(value: string) {
  for (const character of value) {
    const code = character.codePointAt(0)!
    assert(code < 0xd800 || code > 0xdfff)
  }
}

/** Exact cross-language UTF-8 JSON, never a text/URL normalization step. */
export function canonicalEditorialJson(value: unknown): string {
  function encode(node: unknown, depth: number): string {
    assert(depth <= 20)
    if (node === null || typeof node === 'boolean') return JSON.stringify(node)
    if (typeof node === 'number') {
      assert(Number.isSafeInteger(node) && !Object.is(node, -0))
      return String(node)
    }
    if (typeof node === 'string') { scalarString(node); return JSON.stringify(node) }
    if (Array.isArray(node)) return `[${node.map((item) => encode(item, depth + 1)).join(',')}]`
    assert(node !== null && typeof node === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(node)))
    return `{${Object.keys(node).sort().map((key) => {
      assert(/^[\x20-\x7e]+$/.test(key))
      return `${JSON.stringify(key)}:${encode((node as Record<string, unknown>)[key], depth + 1)}`
    }).join(',')}}`
  }
  return encode(value, 0)
}

/** Native JSON.parse loses duplicate keys and float spelling; reject them first. */
export function parseEditorialJson(text: string): unknown {
  assert(typeof text === 'string' && encoder.encode(text).byteLength <= MAX_EDITORIAL_REQUEST_BYTES)
  scalarString(text)
  let offset = 0
  function whitespace() { while (/^[\t\n\r ]$/.test(text[offset] ?? '')) offset++ }
  function string(): string {
    assert(text[offset] === '"')
    const start = offset++
    while (offset < text.length) {
      const character = text[offset++]
      if (character === '"') {
        let value: unknown
        try { value = JSON.parse(text.slice(start, offset)) } catch { fail() }
        assert(typeof value === 'string'); scalarString(value)
        return value
      }
      if (character === '\\') offset++
    }
    return fail()
  }
  function value(depth: number): unknown {
    assert(depth <= 20); whitespace()
    const first = text[offset]
    if (first === '"') return string()
    if (first === '{') {
      offset++; whitespace()
      const output: Record<string, unknown> = {}
      const keys = new Set<string>()
      if (text[offset] === '}') { offset++; return output }
      while (offset < text.length) {
        const key = string()
        assert(/^[\x20-\x7e]+$/.test(key) && !keys.has(key)); keys.add(key)
        whitespace(); assert(text[offset++] === ':')
        Object.defineProperty(output, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true })
        whitespace()
        if (text[offset] === '}') { offset++; return output }
        assert(text[offset++] === ','); whitespace()
      }
      fail()
    }
    if (first === '[') {
      offset++; whitespace()
      const output: unknown[] = []
      if (text[offset] === ']') { offset++; return output }
      while (offset < text.length) {
        output.push(value(depth + 1)); whitespace()
        if (text[offset] === ']') { offset++; return output }
        assert(text[offset++] === ','); whitespace()
      }
      fail()
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return result }
    }
    const number = /^-?(?:0|[1-9][0-9]*)/.exec(text.slice(offset))?.[0]
    assert(number && number !== '-0')
    offset += number.length
    const result = Number(number)
    assert(Number.isSafeInteger(result))
    return result
  }
  const result = value(0); whitespace(); assert(offset === text.length)
  return result
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value))
  const found = Object.keys(value)
  assert(found.length === keys.length && keys.every((key) => Object.hasOwn(value, key)))
  return value as Record<string, unknown>
}
function text(value: unknown, minimum: number, maximum: number): string {
  assert(typeof value === 'string' && [...value].length >= minimum && [...value].length <= maximum)
  assert(value === value.trim() && !/[\p{C}\p{Zl}\p{Zp}]/u.test(value))
  return value
}
// Match Python's Unicode \w/\b, not JavaScript's ASCII-only variants.
const word = '[\\p{L}\\p{N}_]'
const boundary = `(?<!${word})(?=${word})`
const letter = '(?![\\p{Nd}_])[\\p{L}\\p{N}_]'
const MODEL_URL = new RegExp(`[a-z][a-z0-9+.-]*://|${boundary}(?:www\\.|mailto:|tel:|javascript:|data:)|${boundary}[\\p{L}\\p{N}_.+-]+@[\\p{L}\\p{N}_.-]+\\.(?:${letter}){2,63}(?!${word})|${boundary}(?:[\\p{L}\\p{N}_-]+\\.)+${letter}[\\p{L}\\p{N}_-]{1,62}(?!${word})|(?<!${word})//\\S+`, 'iu')
const PLACEHOLDER = new RegExp(`${boundary}(?:todo|tbd|placeholder|lorem ipsum)(?!${word})|待补充|待完善|占位`, 'iu')
function prose(value: unknown, minimum: number, maximum: number): string {
  const result = text(value, minimum, maximum)
  assert(!MODEL_URL.test(result) && !/[<>\[\]{}*_`#\\|]/.test(result))
  assert(!PLACEHOLDER.test(result))
  return result
}
function digest(value: unknown): string { assert(typeof value === 'string' && DIGEST.test(value)); return value }
function url(value: unknown): string { assert(validateOriginalUrl(value) !== null); return value as string }
function references(value: unknown, known: Set<string>): string[] {
  assert(Array.isArray(value) && value.length >= 1 && value.length <= known.size)
  assert(value.every((id) => typeof id === 'string' && known.has(id)) && new Set(value).size === value.length)
  return [...value]
}
function claim(value: unknown, minimum: number, maximum: number, known: Set<string>): EditorialClaim {
  const node = object(value, ['text', 'evidence_ids'])
  return { text: prose(node.text, minimum, maximum), evidence_ids: references(node.evidence_ids, known) }
}
function boundedCopy(value: unknown, maximum: number): unknown {
  const canonical = canonicalEditorialJson(value)
  assert(encoder.encode(canonical).byteLength <= maximum)
  return JSON.parse(canonical)
}

export function validateEditorialPublication(value: unknown): EditorialPublication {
  const node = object(boundedCopy(value, MAX_EDITORIAL_PUBLICATION_BYTES), ['schema_version', 'renderer_version', 'article_id', 'source', 'packet_sha256', 'evidence', 'brief'])
  assert(node.schema_version === 1 && node.renderer_version === 'editorial-v1')
  assert(typeof node.article_id === 'string' && /^[a-f0-9]{16}$/.test(node.article_id))
  const source = object(node.source, ['url', 'original_url', 'original_url_provenance'])
  url(source.url)
  assert((source.original_url === null && source.original_url_provenance === null) || validOriginalMetadata(source))
  digest(node.packet_sha256)
  assert(Array.isArray(node.evidence) && node.evidence.length >= 1 && node.evidence.length <= 4)
  const known = new Set<string>()
  for (const entry of node.evidence) {
    const evidence = object(entry, ['id', 'label', 'url', 'kind', 'text_sha256'])
    assert(typeof evidence.id === 'string' && /^E[1-4]$/.test(evidence.id) && !known.has(evidence.id))
    known.add(evidence.id); text(evidence.label, 1, 160); url(evidence.url); digest(evidence.text_sha256)
    assert(evidence.kind === 'primary' || evidence.kind === 'secondary')
  }
  const brief = object(node.brief, ['headline', 'lead', 'facts', 'analysis', 'caveats'])
  assert(Array.isArray(brief.facts) && brief.facts.length >= 2 && brief.facts.length <= 4)
  assert(Array.isArray(brief.caveats) && brief.caveats.length >= 1 && brief.caveats.length <= 3)
  const facts = brief.facts.map((fact) => claim(fact, 12, 220, known))
  const keys = facts.map((fact) => fact.text.normalize('NFKC').toUpperCase().toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
  assert(new Set(keys).size === keys.length)
  const claims = [claim(brief.headline, 8, 80, known), claim(brief.lead, 20, 260, known), ...facts, claim(brief.analysis, 12, 240, known)]
  const caveats = brief.caveats.map((item) => prose(item, 8, 180))
  assert(claims.reduce((count, item) => count + [...item.text].length, 0) + caveats.reduce((count, item) => count + [...item].length, 0) <= 1400)
  return node as unknown as EditorialPublication
}

function expectation(node: Record<string, unknown>) {
  assert(typeof node.expected_revision === 'number' && Number.isInteger(node.expected_revision) && node.expected_revision >= 0 && node.expected_revision <= 2147483646)
  assert(['absent', 'published', 'withdrawn'].includes(node.expected_state as string))
  assert((node.expected_state === 'absent') === (node.expected_revision === 0))
}
export function validateEditorialRevoke(value: unknown): EditorialRevoke {
  const node = object(boundedCopy(value, MAX_EDITORIAL_REQUEST_BYTES), ['action', 'expected_revision', 'expected_state', 'reason'])
  assert(node.action === 'revoke'); expectation(node); text(node.reason, 1, 240)
  return node as EditorialRevoke
}
export async function editorialSha256(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
function validTimestamp(value: unknown) {
  assert(typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(value) && !value.startsWith('0000'))
  const parsed = new Date(value)
  assert(Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value.replace('Z', '.000Z'))
}

/** Review metadata is a bearer-authorized operator attestation, not proof of truth. */
export async function validateEditorialApproval(manifestValue: unknown, attestationValue: unknown) {
  const node = object(boundedCopy(manifestValue, MAX_EDITORIAL_MANIFEST_BYTES), ['schema_version', 'publication', 'action', 'expected_revision', 'expected_state', 'review'])
  assert(node.schema_version === 1); expectation(node)
  assert((node.action === 'publish' && node.expected_state !== 'withdrawn') || (node.action === 'restore' && node.expected_state === 'withdrawn'))
  const publication = validateEditorialPublication(node.publication)
  const review = object(node.review, ['version', 'decisions'])
  assert(review.version === 'editorial-review-v1' && Array.isArray(review.decisions))
  const brief = publication.brief
  const sections = [
    { path: 'headline', claim: brief.headline, allowed: ['supported', 'qualified'] },
    { path: 'lead', claim: brief.lead, allowed: ['supported', 'qualified'] },
    ...brief.facts.map((item, index) => ({ path: `facts.${index}`, claim: item, allowed: ['supported', 'qualified'] })),
    { path: 'analysis', claim: brief.analysis, allowed: ['interpretation'] },
    ...brief.caveats.map((item, index) => ({ path: `caveats.${index}`, claim: { text: item, evidence_ids: null }, allowed: ['limitation'] })),
  ]
  assert(review.decisions.length === sections.length)
  const known = new Set(publication.evidence.map((entry) => entry.id))
  for (const [index, section] of sections.entries()) {
    const decision = object(review.decisions[index], ['path', 'text_sha256', 'evidence_ids', 'decision', 'note'])
    assert(decision.path === section.path && section.allowed.includes(decision.decision as string))
    const ids = references(decision.evidence_ids, known)
    if (section.claim.evidence_ids) assert(canonicalEditorialJson(ids) === canonicalEditorialJson(section.claim.evidence_ids))
    assert(digest(decision.text_sha256) === await editorialSha256(section.claim.text))
    text(decision.note, 1, 240)
  }
  const attestation = object(boundedCopy(attestationValue, 2048), ['schema_version', 'manifest_sha256', 'reviewer', 'attested_at', 'statement'])
  assert(attestation.schema_version === 1 && attestation.statement === 'reviewed-for-independent-editorial-publication-v1')
  text(attestation.reviewer, 1, 80); validTimestamp(attestation.attested_at)
  const manifestSha256 = await editorialSha256(canonicalEditorialJson(node))
  assert(digest(attestation.manifest_sha256) === manifestSha256)
  return {
    manifest: node as unknown as EditorialManifest, attestation: attestation as unknown as EditorialAttestation,
    publicationJson: canonicalEditorialJson(publication), manifestSha256,
    approvalDigest: await editorialSha256(canonicalEditorialJson({ manifest: node, attestation })),
    reviewSha256: await editorialSha256(canonicalEditorialJson(review)),
  }
}
