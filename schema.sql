-- Content OS Feed - D1 Database Schema
-- Canonical local/CI snapshot. Remote D1 databases must be created and
-- upgraded only through `wrangler d1 migrations apply`.

-- Articles table. Retention is not enforced until verified cold reads exist.
CREATE TABLE IF NOT EXISTS articles (
  url_hash          TEXT PRIMARY KEY,          -- SHA-256 hex of normalized URL
  title             TEXT NOT NULL,
  original_title    TEXT,
  summary           TEXT,
  takeaway          TEXT,
  content           TEXT,                      -- Verified Markdown or retained legacy body
  content_format    TEXT CHECK(content_format = 'markdown_v1' OR content_format IS NULL),
  content_quality   TEXT NOT NULL DEFAULT 'summary_only'
                    CHECK(content_quality IN ('verified_fulltext', 'summary_only', 'legacy_unverified')),
  content_hash      TEXT,
  content_chars     INTEGER NOT NULL DEFAULT 0 CHECK(content_chars >= 0),
  content_quality_score INTEGER NOT NULL DEFAULT 0 CHECK(content_quality_score BETWEEN 0 AND 100),
  content_version   INTEGER NOT NULL DEFAULT 0 CHECK(content_version >= 0),
  content_extracted_at TEXT,
  content_source    TEXT,
  fulltext_publication_allowed INTEGER NOT NULL DEFAULT 0
                    CHECK(fulltext_publication_allowed IN (0, 1)),
  fulltext_revoked_at TEXT,
  fulltext_control_version INTEGER NOT NULL DEFAULT 0
                    CHECK(typeof(fulltext_control_version) = 'integer'
                      AND fulltext_control_version BETWEEN 0 AND 9007199254740991),
  content_archive_key TEXT CHECK(content_archive_key IS NULL OR length(content_archive_key) BETWEEN 1 AND 512),
  content_archive_sha256 TEXT CHECK(content_archive_sha256 IS NULL OR
                    (length(content_archive_sha256) = 64 AND content_archive_sha256 NOT GLOB '*[^0-9a-f]*')),
  content_archive_version INTEGER CHECK(content_archive_version IS NULL OR
                    (typeof(content_archive_version) = 'integer' AND content_archive_version BETWEEN 0 AND 9007199254740991)),
  content_archive_bytes INTEGER CHECK(content_archive_bytes IS NULL OR
                    (typeof(content_archive_bytes) = 'integer' AND content_archive_bytes BETWEEN 1 AND 800000)),
  content_archived_at TEXT CHECK(
    (content_archive_key IS NULL AND content_archive_sha256 IS NULL
      AND content_archive_version IS NULL AND content_archive_bytes IS NULL AND content_archived_at IS NULL)
    OR (content_archive_key IS NOT NULL AND content_archive_sha256 IS NOT NULL
      AND content_archive_version IS NOT NULL AND content_archive_bytes IS NOT NULL
      AND content_archived_at IS NOT NULL AND length(content_archived_at) BETWEEN 1 AND 64
      AND content_archive_version = content_version)
  ),
  source            TEXT NOT NULL,
  url               TEXT NOT NULL,
  original_url      TEXT CHECK(original_url IS NULL OR length(original_url) BETWEEN 1 AND 2048),
  original_url_provenance TEXT CHECK(
    (original_url IS NULL AND original_url_provenance IS NULL)
    OR (original_url IS NOT NULL AND original_url_provenance IS NOT NULL
      AND original_url_provenance IN ('aihot_rss_description', 'aihot_api_v1', 'legacy_flash'))
  ),
  category          TEXT NOT NULL DEFAULT 'general',
  topic             TEXT,
  type              TEXT,
  featured          INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0, 1)),
  score             INTEGER NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 30),
  signal            INTEGER NOT NULL DEFAULT 0 CHECK(signal BETWEEN 0 AND 10),
  novelty           INTEGER NOT NULL DEFAULT 0 CHECK(novelty BETWEEN 0 AND 10),
  usefulness        INTEGER NOT NULL DEFAULT 0 CHECK(usefulness BETWEEN 0 AND 10),
  content_potential TEXT CHECK(content_potential IN ('High', 'Medium', 'Low') OR content_potential IS NULL),
  published_at      TEXT,
  discovered_at     TEXT NOT NULL,
  approved_for_publication INTEGER NOT NULL DEFAULT 0 CHECK(approved_for_publication IN (0, 1)),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_discovered ON articles(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cat_score ON articles(category, score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cat_date ON articles(category, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_featured ON articles(featured);
CREATE INDEX IF NOT EXISTS idx_articles_topic ON articles(topic);
CREATE INDEX IF NOT EXISTS idx_articles_type ON articles(type);
CREATE INDEX IF NOT EXISTS idx_articles_public_date ON articles(approved_for_publication, discovered_at DESC);

-- Advance even when a revoke repeats the same value in the same second.
-- The trigger's UPDATE does not touch its watched columns, so it cannot recurse.
CREATE TRIGGER IF NOT EXISTS articles_fulltext_control_revision
AFTER UPDATE OF approved_for_publication, fulltext_publication_allowed, fulltext_revoked_at ON articles
FOR EACH ROW
BEGIN
  UPDATE articles SET fulltext_control_version = OLD.fulltext_control_version + 1
  WHERE url_hash = NEW.url_hash;
END;

-- The snapshot is schema version 10. Historical migrations are only for
-- upgrading a legacy database; do not apply them after loading schema.sql.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_migrations(version) VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10);

-- Independent reviewed briefs never mutate original bodies or their permissions.
CREATE TABLE IF NOT EXISTS article_editorials (
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

-- Account-wide KV allowances are not reserved by this per-project attempt cap.
CREATE TABLE IF NOT EXISTS feed_archive_daily_budget (
  day TEXT PRIMARY KEY,
  writes INTEGER NOT NULL CHECK(typeof(writes) = 'integer' AND writes BETWEEN 0 AND 100)
);

-- Persistent, privacy-preserving anonymous submission rate counters.
CREATE TABLE IF NOT EXISTS submission_rate_limits (
  client_key    TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK(request_count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_submission_rate_window ON submission_rate_limits(window_start);

-- Hot topics junction table (replaces JSON array anti-pattern)
CREATE TABLE IF NOT EXISTS hot_topics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic       TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS article_topics (
  article_id TEXT NOT NULL REFERENCES articles(url_hash) ON DELETE CASCADE,
  topic_id   INTEGER NOT NULL REFERENCES hot_topics(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, topic_id)
);

-- Retention safety: never delete articles by age alone. Public detail links,
-- approval and sticky full-text revocation currently depend on these rows.
-- Start with `pnpm run cf:retention-audit`; it does not archive or delete data.
-- See docs/d1-retention.md for the prerequisites before pruning.
