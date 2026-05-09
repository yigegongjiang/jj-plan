-- jjplan initial schema.
--
-- Three tables: projects → specs → tasks.
--
-- Projects are the top-level group. The project name (typically the basename
-- of the AI's working directory, supplied by the caller) is upserted by the
-- Worker on first POST /projects/:name/specs, so no explicit project
-- lifecycle is exposed. ON DELETE CASCADE on specs.project_id makes
-- DELETE /projects/:name clean specs (and via specs' own FK, tasks) too.
--
-- Specs may be independent OR linked into chains, scoped per project.
-- Multiple specs may have prev_id IS NULL (each one a head of its own chain,
-- or simply standalone), but each non-NULL prev_id may appear at most once
-- across all specs (no forks). The partial unique index excludes NULLs
-- precisely so multiple standalone heads are allowed. Application layer
-- additionally requires prev_id to point inside the same project.
--
-- Tasks form a STRICT linked list within their spec: at most one head
-- (prev_id IS NULL) and at most one successor per node, scoped per spec.

CREATE TABLE projects (
  name       TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE specs (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(name) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'draft',  -- draft | active | done
  prev_id    TEXT REFERENCES specs(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_specs_project ON specs(project_id);
CREATE INDEX idx_specs_prev ON specs(prev_id);
CREATE UNIQUE INDEX uq_specs_succ ON specs(prev_id) WHERE prev_id IS NOT NULL;

CREATE TABLE tasks (
  id         TEXT PRIMARY KEY,
  spec_id    TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'todo',   -- todo | doing | done | blocked
  prev_id    TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_tasks_spec ON tasks(spec_id);
CREATE INDEX idx_tasks_prev ON tasks(prev_id);
CREATE UNIQUE INDEX uq_tasks_chain ON tasks(spec_id, COALESCE(prev_id, 'HEAD'));
