-- Additive: new `asks` table only. Same chain shape as `specs`.

CREATE TABLE asks (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(name) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  origin     TEXT NOT NULL DEFAULT '',
  prev_id    TEXT REFERENCES asks(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_asks_project ON asks(project_id);
CREATE INDEX idx_asks_prev    ON asks(prev_id);
CREATE UNIQUE INDEX uq_asks_succ ON asks(prev_id) WHERE prev_id IS NOT NULL;
