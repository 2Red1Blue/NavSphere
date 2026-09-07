export const ORIGINAL_URL_PROVENANCES = ['aihot_rss_description', 'aihot_api_v1', 'legacy_flash'] as const
export type OriginalUrlProvenance = typeof ORIGINAL_URL_PROVENANCES[number]

const AIHOT_HOST = 'aihot.virxact.com'
const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'home', 'home.arpa', 'localdomain']

/** Lexical validation only: never fetch, resolve DNS, or rewrite a signed URL. */
export function validateOriginalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 2048) return null
  if (/[\s\p{C}\\]/u.test(value)) return null
  const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1]
  if (!authority || /[@%\[\]]/.test(authority)) return null
  const match = /^([^:]+)(?::([0-9]+))?$/.exec(authority)
  if (!match || (match[2] !== undefined && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return null
  try {
    const parsed = new URL(value)
    if (parsed.username || parsed.password) return null
    // URL performs IDNA conversion for validation only; the returned URL stays verbatim.
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
    const labels = host.split('.')
    if (host.length > 253 || labels.length < 2) return null
    if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null
    // Domain-only targets exclude IP literals and browser-specific numeric IP forms.
    if (!/^[a-z][a-z0-9-]*$/i.test(labels.at(-1)!)) return null
    if (LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return null
    return value
  } catch {
    return null
  }
}

export function isAihotUrl(value: unknown): value is string {
  const url = validateOriginalUrl(value)
  // Inspect the literal host, not a Unicode lookalike normalized by IDNA.
  const host = url?.match(/^https?:\/\/([^/:?#]+)/i)?.[1].toLowerCase().replace(/\.$/, '')
  return host === AIHOT_HOST
}

export function isOriginalUrlProvenance(value: unknown): value is OriginalUrlProvenance {
  return ORIGINAL_URL_PROVENANCES.some((provenance) => provenance === value)
}

export function validOriginalMetadata(value: {
  url?: unknown
  original_url?: unknown
  original_url_provenance?: unknown
}): value is { url: string; original_url: string; original_url_provenance: OriginalUrlProvenance } {
  const original = validateOriginalUrl(value.original_url)
  return isAihotUrl(value.url)
    && original !== null
    && new URL(original).hostname.toLowerCase().replace(/\.$/, '') !== AIHOT_HOST
    && isOriginalUrlProvenance(value.original_url_provenance)
}
