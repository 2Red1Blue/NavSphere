-- Independent reviewed briefs never mutate original bodies or their permissions.
-- Wrangler tracks retries; any pre-existing table must fail before bookkeeping.
CREATE TABLE article_editorials (
  url_hash TEXT PRIMARY KEY NOT NULL REFERENCES articles(url_hash) ON DELETE RESTRICT
    CHECK(typeof(url_hash) = 'text' AND length(url_hash) = 16 AND length(CAST(url_hash AS BLOB)) = 16 AND url_hash NOT GLOB '*[^0-9a-f]*'),
  revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision BETWEEN 1 AND 2147483647),
  state TEXT NOT NULL CHECK(typeof(state) = 'text' AND state IN ('published', 'withdrawn')),
  publication_json TEXT CHECK(publication_json IS NULL OR
    (typeof(publication_json) = 'text' AND length(CAST(publication_json AS BLOB)) BETWEEN 1 AND 24576
      AND instr(publication_json, char(0)) = 0 AND json_valid(publication_json))),
  manifest_sha256 TEXT CHECK(manifest_sha256 IS NULL OR
    (typeof(manifest_sha256) = 'text' AND length(manifest_sha256) = 64 AND length(CAST(manifest_sha256 AS BLOB)) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*')),
  approval_digest TEXT CHECK(approval_digest IS NULL OR
    (typeof(approval_digest) = 'text' AND length(approval_digest) = 64 AND length(CAST(approval_digest AS BLOB)) = 64 AND approval_digest NOT GLOB '*[^0-9a-f]*')),
  review_sha256 TEXT CHECK(review_sha256 IS NULL OR
    (typeof(review_sha256) = 'text' AND length(review_sha256) = 64 AND length(CAST(review_sha256 AS BLOB)) = 64 AND review_sha256 NOT GLOB '*[^0-9a-f]*')),
  approved_by TEXT CHECK(approved_by IS NULL OR (typeof(approved_by) = 'text' AND instr(approved_by, char(0)) = 0 AND length(approved_by) BETWEEN 1 AND 80)),
  approved_at TEXT CHECK(approved_at IS NULL OR (typeof(approved_at) = 'text' AND length(approved_at) = 20 AND length(CAST(approved_at AS BLOB)) = 20)),
  published_at TEXT CHECK(published_at IS NULL OR (typeof(published_at) = 'text' AND length(published_at) = 20 AND length(CAST(published_at AS BLOB)) = 20)),
  withdrawn_at TEXT CHECK(withdrawn_at IS NULL OR (typeof(withdrawn_at) = 'text' AND length(withdrawn_at) = 20 AND length(CAST(withdrawn_at AS BLOB)) = 20)),
  withdrawal_reason TEXT CHECK(withdrawal_reason IS NULL OR
    (typeof(withdrawal_reason) = 'text' AND instr(withdrawal_reason, char(0)) = 0 AND length(withdrawal_reason) BETWEEN 1 AND 240)),
  CHECK(
    (publication_json IS NULL AND manifest_sha256 IS NULL AND approval_digest IS NULL
      AND review_sha256 IS NULL AND approved_by IS NULL AND approved_at IS NULL AND published_at IS NULL)
    OR (publication_json IS NOT NULL AND manifest_sha256 IS NOT NULL AND approval_digest IS NOT NULL
      AND review_sha256 IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND published_at IS NOT NULL)
  ),
  CHECK(
    (state = 'published' AND publication_json IS NOT NULL AND withdrawn_at IS NULL AND withdrawal_reason IS NULL)
    OR (state = 'withdrawn' AND withdrawn_at IS NOT NULL AND withdrawal_reason IS NOT NULL)
  )
);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (10);
