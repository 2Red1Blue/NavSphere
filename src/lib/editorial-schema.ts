/** Shared readiness contract; constraints stay in migration010/schema.sql. */
export const EDITORIAL_CONTRACT_COLUMNS = [
  'url_hash', 'revision', 'state', 'publication_json', 'manifest_sha256',
  'approval_digest', 'review_sha256', 'approved_by', 'approved_at',
  'published_at', 'withdrawn_at', 'withdrawal_reason',
] as const
