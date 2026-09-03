-- Add the versioned full-content contract. Existing bodies are retained for
-- audit/backfill, but are explicitly unverified and must not be served.
ALTER TABLE articles ADD COLUMN content_format TEXT
  CHECK(content_format = 'markdown_v1' OR content_format IS NULL);
ALTER TABLE articles ADD COLUMN content_quality TEXT NOT NULL DEFAULT 'summary_only'
  CHECK(content_quality IN ('verified_fulltext', 'summary_only', 'legacy_unverified'));
ALTER TABLE articles ADD COLUMN content_hash TEXT;
ALTER TABLE articles ADD COLUMN content_chars INTEGER NOT NULL DEFAULT 0
  CHECK(content_chars >= 0);
ALTER TABLE articles ADD COLUMN content_quality_score INTEGER NOT NULL DEFAULT 0
  CHECK(content_quality_score BETWEEN 0 AND 100);
ALTER TABLE articles ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0
  CHECK(content_version >= 0);
ALTER TABLE articles ADD COLUMN content_extracted_at TEXT;
ALTER TABLE articles ADD COLUMN content_source TEXT;
ALTER TABLE articles ADD COLUMN fulltext_publication_allowed INTEGER NOT NULL DEFAULT 0
  CHECK(fulltext_publication_allowed IN (0, 1));

UPDATE articles
SET content_quality = CASE
      WHEN content IS NOT NULL AND length(trim(content)) > 0 THEN 'legacy_unverified'
      ELSE 'summary_only'
    END,
    content_chars = CASE WHEN content IS NULL THEN 0 ELSE length(content) END,
    fulltext_publication_allowed = 0;

INSERT OR IGNORE INTO schema_migrations(version) VALUES (6);
