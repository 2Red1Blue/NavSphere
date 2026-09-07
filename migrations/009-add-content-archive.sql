-- Private immutable body pointers. Keep every article, editorial field, right,
-- legacy NULL content_hash, collection identity and topic relationship intact.
ALTER TABLE articles ADD COLUMN fulltext_control_version INTEGER NOT NULL DEFAULT 0
  CHECK(typeof(fulltext_control_version) = 'integer'
    AND fulltext_control_version BETWEEN 0 AND 9007199254740991);
ALTER TABLE articles ADD COLUMN content_archive_key TEXT
  CHECK(content_archive_key IS NULL OR length(content_archive_key) BETWEEN 1 AND 512);
ALTER TABLE articles ADD COLUMN content_archive_sha256 TEXT
  CHECK(content_archive_sha256 IS NULL OR
    (length(content_archive_sha256) = 64 AND content_archive_sha256 NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE articles ADD COLUMN content_archive_version INTEGER
  CHECK(content_archive_version IS NULL OR
    (typeof(content_archive_version) = 'integer' AND content_archive_version BETWEEN 0 AND 9007199254740991));
ALTER TABLE articles ADD COLUMN content_archive_bytes INTEGER
  CHECK(content_archive_bytes IS NULL OR
    (typeof(content_archive_bytes) = 'integer' AND content_archive_bytes BETWEEN 1 AND 800000));
ALTER TABLE articles ADD COLUMN content_archived_at TEXT
  CHECK(
    (content_archive_key IS NULL AND content_archive_sha256 IS NULL
      AND content_archive_version IS NULL AND content_archive_bytes IS NULL AND content_archived_at IS NULL)
    OR (content_archive_key IS NOT NULL AND content_archive_sha256 IS NOT NULL
      AND content_archive_version IS NOT NULL AND content_archive_bytes IS NOT NULL
      AND content_archived_at IS NOT NULL AND length(content_archived_at) BETWEEN 1 AND 64
      AND content_archive_version = content_version)
  );

-- Revision is event-based, not timestamp-based: repeated same-second revokes
-- must invalidate any asynchronous read or restore that observed older rights.
CREATE TRIGGER articles_fulltext_control_revision
AFTER UPDATE OF approved_for_publication, fulltext_publication_allowed, fulltext_revoked_at ON articles
FOR EACH ROW
BEGIN
  UPDATE articles SET fulltext_control_version = OLD.fulltext_control_version + 1
  WHERE url_hash = NEW.url_hash;
END;

-- Count all reserved KV write attempts, including failed or uncertain writes.
CREATE TABLE feed_archive_daily_budget (
  day TEXT PRIMARY KEY,
  writes INTEGER NOT NULL CHECK(typeof(writes) = 'integer' AND writes BETWEEN 0 AND 100)
);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (9);
