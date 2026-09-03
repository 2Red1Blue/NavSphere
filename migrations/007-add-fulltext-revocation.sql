-- Keep rights withdrawals sticky across later content re-ingestion.
ALTER TABLE articles ADD COLUMN fulltext_revoked_at TEXT;

INSERT OR IGNORE INTO schema_migrations(version) VALUES (7);
