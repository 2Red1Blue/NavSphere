-- Evidence-backed navigation only. Collection identity and content rights do not change.
ALTER TABLE articles ADD COLUMN original_url TEXT
  CHECK(original_url IS NULL OR length(original_url) BETWEEN 1 AND 2048);
ALTER TABLE articles ADD COLUMN original_url_provenance TEXT
  CHECK(
    (original_url IS NULL AND original_url_provenance IS NULL)
    OR (original_url IS NOT NULL AND original_url_provenance IS NOT NULL
      AND original_url_provenance IN ('aihot_rss_description', 'aihot_api_v1', 'legacy_flash'))
  );

INSERT OR IGNORE INTO schema_migrations(version) VALUES (8);
