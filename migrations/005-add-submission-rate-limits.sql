-- Persist anonymous submission limits across Workers isolates and deploys.
CREATE TABLE submission_rate_limits (
  client_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK(request_count >= 0)
);

CREATE INDEX idx_submission_rate_window ON submission_rate_limits(window_start);
INSERT OR IGNORE INTO schema_migrations(version) VALUES (5);
