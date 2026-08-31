-- Public Feed is fail-closed: legacy rows stay private until the pipeline
-- explicitly republishes them with approved_for_publication=true.
ALTER TABLE articles ADD COLUMN approved_for_publication INTEGER NOT NULL DEFAULT 0
  CHECK(approved_for_publication IN (0, 1));

CREATE INDEX idx_articles_public_date
  ON articles(approved_for_publication, discovered_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_migrations(version) VALUES (4);
