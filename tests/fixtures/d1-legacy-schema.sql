CREATE TABLE articles (
  url_hash          TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  original_title    TEXT,
  summary           TEXT,
  takeaway          TEXT,
  source            TEXT NOT NULL,
  url               TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'general',
  score             INTEGER NOT NULL DEFAULT 0,
  signal            INTEGER NOT NULL DEFAULT 0,
  novelty           INTEGER NOT NULL DEFAULT 0,
  usefulness        INTEGER NOT NULL DEFAULT 0,
  content_potential TEXT,
  published_at      TEXT,
  discovered_at     TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
