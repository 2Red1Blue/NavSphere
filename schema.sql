-- Content OS Feed - D1 Database Schema
-- Run: wrangler d1 execute content-os-feed --file=schema.sql

-- Articles table (30-day window)
CREATE TABLE IF NOT EXISTS articles (
  url_hash          TEXT PRIMARY KEY,          -- SHA-256 hex of normalized URL
  title             TEXT NOT NULL,
  original_title    TEXT,
  summary           TEXT,
  takeaway          TEXT,
  source            TEXT NOT NULL,
  url               TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'general',
  score             INTEGER NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 30),
  signal            INTEGER NOT NULL DEFAULT 0 CHECK(signal BETWEEN 0 AND 10),
  novelty           INTEGER NOT NULL DEFAULT 0 CHECK(novelty BETWEEN 0 AND 10),
  usefulness        INTEGER NOT NULL DEFAULT 0 CHECK(usefulness BETWEEN 0 AND 10),
  content_potential TEXT CHECK(content_potential IN ('High', 'Medium', 'Low') OR content_potential IS NULL),
  published_at      TEXT,
  discovered_at     TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_discovered ON articles(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cat_score ON articles(category, score DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cat_date ON articles(category, discovered_at DESC);

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

-- Archive cleanup: remove articles older than 30 days
-- Run monthly via cron or manually: wrangler d1 execute content-os-feed --command="DELETE FROM articles WHERE discovered_at < datetime('now', '-30 days')"
-- Or add this to a scheduled cleanup script