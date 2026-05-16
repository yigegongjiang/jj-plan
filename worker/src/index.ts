import { Hono, type Context } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';

import { ulid } from './ulid';

type Bindings = {
  DB: D1Database;
  JJPLAN_TOKEN: string;
};

const SPEC_STATUSES = ['active', 'done'] as const;
const TASK_STATUSES = ['todo', 'doing', 'done', 'blocked'] as const;
const PATCH_FIELDS = ['title', 'body', 'status'] as const;

const MAX_TITLE_LEN = 200;
const MAX_BODY_LEN = 65536;
const MAX_PROJECT_NAME_LEN = 128;

type PatchBody = Partial<Record<(typeof PATCH_FIELDS)[number], unknown>>;
type PatchResult =
  | { ok: true; setClause: string; values: unknown[] }
  | { ok: false; error: string };

interface ProjectRow {
  name: string;
  created_at: number;
  updated_at: number;
}

interface SpecRow {
  id: string;
  project_id: string;
  title: string;
  body: string;
  status: string;
  prev_id: string | null;
  created_at: number;
  updated_at: number;
}

interface TaskRow {
  id: string;
  spec_id: string;
  title: string;
  body: string;
  status: string;
  prev_id: string | null;
  created_at: number;
  updated_at: number;
}

interface AskRow {
  id: string;
  project_id: string;
  body: string;
  origin: string;
  prev_id: string | null;
  created_at: number;
  updated_at: number;
}

const ASK_LIMIT_DEFAULT = 3;
const ASK_LIMIT_MAX = 100;

const app = new Hono<{ Bindings: Bindings }>();

// ---------- middleware ----------

app.use('/projects/*', (c, next) => bearerAuth({ token: c.env.JJPLAN_TOKEN })(c, next));
app.use('/specs/*', (c, next) => bearerAuth({ token: c.env.JJPLAN_TOKEN })(c, next));
app.use('/tasks/*', (c, next) => bearerAuth({ token: c.env.JJPLAN_TOKEN })(c, next));
app.use('/asks/*', (c, next) => bearerAuth({ token: c.env.JJPLAN_TOKEN })(c, next));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message || 'unauthorized' }, err.status);
  }
  return c.json({ error: err.message }, 500);
});
app.notFound((c) => c.json({ error: 'not found' }, 404));

// ---------- request parsing ----------

async function parseJsonBody<T>(
  c: Context<{ Bindings: Bindings }>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  try {
    const value = await c.req.json<T>();
    return { ok: true, value };
  } catch {
    return { ok: false, response: c.json({ error: 'invalid JSON body' }, 400) };
  }
}

interface NewPayload {
  title: string;
  body: string;
}

function parseNewPayload(raw: { title?: unknown; body?: unknown }):
  | { ok: true; value: NewPayload }
  | { ok: false; error: string } {
  if (typeof raw.title !== 'string' || raw.title.length === 0) {
    return { ok: false, error: 'title required' };
  }
  if (raw.title.length > MAX_TITLE_LEN) {
    return { ok: false, error: `title too long (max ${MAX_TITLE_LEN} chars)` };
  }
  const body = typeof raw.body === 'string' ? raw.body : '';
  if (body.length > MAX_BODY_LEN) {
    return { ok: false, error: `body too long (max ${MAX_BODY_LEN} chars)` };
  }
  return { ok: true, value: { title: raw.title, body } };
}

// ---------- helpers ----------

const now = (): number => Date.now();

function buildPatch(
  body: PatchBody,
  allowedStatuses: readonly string[],
  ts: number,
): PatchResult {
  const fragments: string[] = [];
  const values: unknown[] = [];
  for (const field of PATCH_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') return { ok: false, error: `${field} must be string` };
    if (field === 'title' && (value.length === 0 || value.length > MAX_TITLE_LEN)) {
      return { ok: false, error: `title length must be 1..${MAX_TITLE_LEN}` };
    }
    if (field === 'body' && value.length > MAX_BODY_LEN) {
      return { ok: false, error: `body too long (max ${MAX_BODY_LEN} chars)` };
    }
    if (field === 'status' && !allowedStatuses.includes(value)) {
      return { ok: false, error: `invalid status: ${value} (allowed: ${allowedStatuses.join('|')})` };
    }
    fragments.push(`${field} = ?`);
    values.push(value);
  }
  if (fragments.length === 0) return { ok: false, error: 'no fields to update' };
  fragments.push('updated_at = ?');
  values.push(ts);
  return { ok: true, setClause: fragments.join(', '), values };
}

// Walk a list of {id, prev_id} into chain order. If the data is corrupted
// (multiple successors of the same node, cycles, dangling prev_id), broken
// rows still come back — appended after the well-formed prefix — so a
// client can spot the problem instead of silently losing data.
function orderTaskChain(rows: TaskRow[]): TaskRow[] {
  if (rows.length === 0) return [];
  const ids = new Set(rows.map((r) => r.id));
  const byPrev = new Map<string | null, TaskRow>();
  for (const r of rows) {
    const key = r.prev_id !== null && ids.has(r.prev_id) ? r.prev_id : null;
    byPrev.set(key, r);
  }

  const ordered: TaskRow[] = [];
  const seen = new Set<string>();
  let cursor = byPrev.get(null);
  while (cursor && !seen.has(cursor.id)) {
    ordered.push(cursor);
    seen.add(cursor.id);
    cursor = byPrev.get(cursor.id);
  }
  if (ordered.length < rows.length) {
    for (const r of rows) {
      if (!seen.has(r.id)) ordered.push(r);
    }
  }
  return ordered;
}

// Specs may live as standalone heads or as members of a chain WITHIN a single
// project. Output:
//   - one chain at a time, head first, then sequential successors
//   - chains ordered by their head's updated_at DESC (most-recently-active
//     chain first; child task mutations cascade into the head's updated_at)
//   - within a chain, successors keep prev_id order regardless of their own
//     updated_at — chain integrity beats recency for non-head nodes
//   - any orphans (data inconsistency) appended last, by updated_at DESC
function orderSpecs(rows: SpecRow[]): SpecRow[] {
  if (rows.length === 0) return [];
  const ids = new Set(rows.map((r) => r.id));
  const successor = new Map<string, SpecRow>(); // prev_id -> the spec whose prev_id is this
  const heads: SpecRow[] = [];
  for (const r of rows) {
    if (r.prev_id === null || !ids.has(r.prev_id)) {
      heads.push(r);
    } else {
      successor.set(r.prev_id, r);
    }
  }
  heads.sort((a, b) => b.updated_at - a.updated_at);

  const ordered: SpecRow[] = [];
  const seen = new Set<string>();
  for (const head of heads) {
    let cursor: SpecRow | undefined = head;
    while (cursor && !seen.has(cursor.id)) {
      ordered.push(cursor);
      seen.add(cursor.id);
      cursor = successor.get(cursor.id);
    }
  }
  if (ordered.length < rows.length) {
    const orphans = rows
      .filter((r) => !seen.has(r.id))
      .sort((a, b) => b.updated_at - a.updated_at);
    ordered.push(...orphans);
  }
  return ordered;
}

async function readSpec(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM specs WHERE id = ?').bind(id).first<SpecRow>();
}

async function readTask(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
}

async function readProject(db: D1Database, name: string) {
  return db.prepare('SELECT * FROM projects WHERE name = ?').bind(name).first<ProjectRow>();
}

async function readAsk(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM asks WHERE id = ?').bind(id).first<AskRow>();
}

// Parent-bump statement factories. They only build the prepared statement;
// callers decide whether to .run() standalone or fold it into a batch alongside
// the self-write. Pair them with a single `ts` per request so the parent's
// updated_at lines up with the child's created_at / updated_at.
function bumpProject(db: D1Database, name: string, ts: number) {
  return db.prepare('UPDATE projects SET updated_at = ? WHERE name = ?').bind(ts, name);
}

function bumpSpec(db: D1Database, id: string, ts: number) {
  return db.prepare('UPDATE specs SET updated_at = ? WHERE id = ?').bind(ts, id);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE/i.test(err.message);
}

function isFkViolation(err: unknown): boolean {
  return err instanceof Error && /FOREIGN KEY/i.test(err.message);
}

function indexTasks(taskRows: TaskRow[]): Map<string, TaskRow[]> {
  const m = new Map<string, TaskRow[]>();
  for (const t of taskRows) {
    const arr = m.get(t.spec_id);
    if (arr) arr.push(t);
    else m.set(t.spec_id, [t]);
  }
  return m;
}

function bundleSpecs(
  specRows: SpecRow[],
  tasksBySpec: Map<string, TaskRow[]>,
): Array<SpecRow & { tasks: TaskRow[] }> {
  return orderSpecs(specRows).map((s) => ({
    ...s,
    tasks: orderTaskChain(tasksBySpec.get(s.id) ?? []),
  }));
}

// ---------- projects ----------

// One-shot: every project, with its ordered specs (each with its ordered
// tasks). Browsing client renders this without a second round-trip.
app.get('/projects', async (c) => {
  const [
    { results: projectRows },
    { results: specRows },
    { results: taskRows },
    { results: askCountRows },
  ] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all<ProjectRow>(),
    c.env.DB.prepare('SELECT * FROM specs').all<SpecRow>(),
    c.env.DB.prepare('SELECT * FROM tasks').all<TaskRow>(),
    c.env.DB
      .prepare('SELECT project_id, COUNT(*) AS n FROM asks GROUP BY project_id')
      .all<{ project_id: string; n: number }>(),
  ]);

  const specsByProject = new Map<string, SpecRow[]>();
  for (const s of specRows) {
    const arr = specsByProject.get(s.project_id);
    if (arr) arr.push(s);
    else specsByProject.set(s.project_id, [s]);
  }

  const askCountByProject = new Map<string, number>();
  for (const r of askCountRows) askCountByProject.set(r.project_id, r.n);

  const tasksBySpec = indexTasks(taskRows);
  return c.json(
    projectRows.map((p) => ({
      ...p,
      specs: bundleSpecs(specsByProject.get(p.name) ?? [], tasksBySpec),
      asks_count: askCountByProject.get(p.name) ?? 0,
    })),
  );
});

app.get('/projects/:name/specs', async (c) => {
  const name = c.req.param('name');
  const project = await readProject(c.env.DB, name);
  if (!project) return c.json({ error: 'project not found' }, 404);

  const [{ results: specRows }, { results: taskRows }] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM specs WHERE project_id = ?').bind(name).all<SpecRow>(),
    c.env.DB
      .prepare(
        'SELECT t.* FROM tasks t INNER JOIN specs s ON t.spec_id = s.id WHERE s.project_id = ?',
      )
      .bind(name)
      .all<TaskRow>(),
  ]);

  return c.json(bundleSpecs(specRows, indexTasks(taskRows)));
});

// `prev_id` is optional: omit / null → standalone spec; provide an id → link
// after that spec. The unique partial index on `prev_id` rejects two specs
// claiming the same predecessor (no forks). Project membership is enforced:
// `prev_id` must point to a spec in the same project.
//
// Project upsert and spec INSERT run in a single batch so a failed spec
// insert does not leave a stray empty project behind.
app.post('/projects/:name/specs', async (c) => {
  const name = c.req.param('name');
  if (name.length === 0 || name.length > MAX_PROJECT_NAME_LEN) {
    return c.json({ error: `project name length must be 1..${MAX_PROJECT_NAME_LEN}` }, 400);
  }

  const parsedBody = await parseJsonBody<{ title?: unknown; body?: unknown; prev_id?: unknown }>(c);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = parseNewPayload(parsedBody.value);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  let prevId: string | null = null;
  if (parsedBody.value.prev_id !== undefined && parsedBody.value.prev_id !== null) {
    if (typeof parsedBody.value.prev_id !== 'string') {
      return c.json({ error: 'prev_id must be string or null' }, 400);
    }
    const prev = await c.env.DB
      .prepare('SELECT project_id FROM specs WHERE id = ?')
      .bind(parsedBody.value.prev_id)
      .first<{ project_id: string }>();
    if (!prev) return c.json({ error: 'prev_id spec not found' }, 400);
    if (prev.project_id !== name) {
      return c.json({ error: 'prev_id must belong to the same project' }, 400);
    }
    prevId = parsedBody.value.prev_id;
  }

  const id = ulid();
  const t = now();
  try {
    await c.env.DB.batch([
      c.env.DB
        .prepare('INSERT OR IGNORE INTO projects (name, created_at, updated_at) VALUES (?, ?, ?)')
        .bind(name, t, t),
      c.env.DB
        .prepare(
          'INSERT INTO specs (id, project_id, title, body, status, prev_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(id, name, parsed.value.title, parsed.value.body, 'active', prevId, t, t),
      // Bump regardless of whether the INSERT OR IGNORE above hit a fresh row
      // or no-op'd on an existing project — we want updated_at to track the
      // most recent activity inside the project, not just project creation.
      bumpProject(c.env.DB, name, t),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) {
      return c.json({ error: 'prev_id already has a successor' }, 409);
    }
    if (isFkViolation(e)) {
      return c.json({ error: 'prev_id no longer exists' }, 400);
    }
    throw e;
  }
  return c.json(await readSpec(c.env.DB, id), 201);
});

// Drops the project, all its specs (FK CASCADE), and all those specs' tasks
// (FK CASCADE on tasks.spec_id). prev_id chains within the project are
// scoped to the project, so no cross-project link survives.
app.delete('/projects/:name', async (c) => {
  const name = c.req.param('name');
  const result = await c.env.DB
    .prepare('DELETE FROM projects WHERE name = ?')
    .bind(name)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'project not found' }, 404);
  return c.body(null, 204);
});

// Rename a project, or merge it into an existing target.
//
// The project's "id" is its name (primary key), so renaming means migrating
// every child row that references it. specs.project_id and asks.project_id
// both point at projects.name with ON DELETE CASCADE — but we must move the
// children BEFORE deleting the old row, otherwise the cascade wipes them.
//
// Two paths depending on whether the target name already exists:
//
//   rename (target absent):
//     1. INSERT new project row, inheriting old's created_at; updated_at = ts
//     2. UPDATE specs.project_id = new WHERE project_id = old
//     3. UPDATE asks.project_id  = new WHERE project_id = old
//     4. DELETE old project row
//
//   merge (target present):
//     1. UPDATE specs.project_id = target WHERE project_id = old
//     2. UPDATE asks.project_id  = target WHERE project_id = old
//     3. UPDATE projects SET updated_at = ts WHERE name = target
//     4. DELETE old project row
//
// Merge safety relies on three schema facts:
//   - specs.id / asks.id are ULIDs (globally unique) — no PK clash when child
//     rows land in the target project.
//   - uq_specs_succ / uq_asks_succ are partial unique indexes on prev_id
//     WHERE prev_id IS NOT NULL; ULID uniqueness means no two chains can
//     share a prev_id, so the indexes cannot trip on merge.
//   - Multiple heads (prev_id IS NULL) per project are already legal; the
//     reader (orderSpecs) handles multi-head projects.
//
// tasks.spec_id is untouched — task chains belong to their spec, which keeps
// its id through the move.
app.patch('/projects/:name', async (c) => {
  const oldName = c.req.param('name');

  const parsedBody = await parseJsonBody<{ new_name?: unknown }>(c);
  if (!parsedBody.ok) return parsedBody.response;
  const raw = parsedBody.value.new_name;
  if (typeof raw !== 'string') return c.json({ error: 'new_name must be string' }, 400);
  if (raw.length === 0 || raw.length > MAX_PROJECT_NAME_LEN) {
    return c.json({ error: `new_name length must be 1..${MAX_PROJECT_NAME_LEN}` }, 400);
  }
  const newName = raw;
  if (newName === oldName) {
    return c.json({ error: 'new_name must differ from current name' }, 400);
  }

  const oldProject = await readProject(c.env.DB, oldName);
  if (!oldProject) return c.json({ error: 'project not found' }, 404);

  const target = await readProject(c.env.DB, newName);
  const ts = now();

  if (target) {
    // merge: target already exists, fold old's children into it
    await c.env.DB.batch([
      c.env.DB
        .prepare('UPDATE specs SET project_id = ? WHERE project_id = ?')
        .bind(newName, oldName),
      c.env.DB
        .prepare('UPDATE asks SET project_id = ? WHERE project_id = ?')
        .bind(newName, oldName),
      c.env.DB
        .prepare('UPDATE projects SET updated_at = ? WHERE name = ?')
        .bind(ts, newName),
      c.env.DB.prepare('DELETE FROM projects WHERE name = ?').bind(oldName),
    ]);
  } else {
    // rename: stand up the new row first so the FK target exists before we
    // repoint children, then drop the old row.
    await c.env.DB.batch([
      c.env.DB
        .prepare('INSERT INTO projects (name, created_at, updated_at) VALUES (?, ?, ?)')
        .bind(newName, oldProject.created_at, ts),
      c.env.DB
        .prepare('UPDATE specs SET project_id = ? WHERE project_id = ?')
        .bind(newName, oldName),
      c.env.DB
        .prepare('UPDATE asks SET project_id = ? WHERE project_id = ?')
        .bind(newName, oldName),
      c.env.DB.prepare('DELETE FROM projects WHERE name = ?').bind(oldName),
    ]);
  }

  return c.json(await readProject(c.env.DB, newName));
});

// ---------- specs ----------

app.get('/specs/:id', async (c) => {
  const id = c.req.param('id');
  const spec = await readSpec(c.env.DB, id);
  if (!spec) return c.json({ error: 'spec not found' }, 404);
  const { results: taskRows } = await c.env.DB
    .prepare('SELECT * FROM tasks WHERE spec_id = ?')
    .bind(id)
    .all<TaskRow>();
  return c.json({ ...spec, tasks: orderTaskChain(taskRows) });
});

app.patch('/specs/:id', async (c) => {
  const id = c.req.param('id');
  const parsedBody = await parseJsonBody<PatchBody>(c);
  if (!parsedBody.ok) return parsedBody.response;

  // Read first to grab project_id for the cascade bump and to surface 404
  // before the write. The extra round-trip is intentional: it lets us keep
  // the self-write and parent-bump in a single batch with a shared ts.
  const existing = await readSpec(c.env.DB, id);
  if (!existing) return c.json({ error: 'spec not found' }, 404);

  const ts = now();
  const patch = buildPatch(parsedBody.value, SPEC_STATUSES, ts);
  if (!patch.ok) return c.json({ error: patch.error }, 400);
  await c.env.DB.batch([
    c.env.DB
      .prepare(`UPDATE specs SET ${patch.setClause} WHERE id = ?`)
      .bind(...patch.values, id),
    bumpProject(c.env.DB, existing.project_id, ts),
  ]);
  return c.json(await readSpec(c.env.DB, id));
});

// Delete a spec and rewire its successor (if any) to its predecessor.
//
// Why this dance is necessary:
//   The schema declares `prev_id REFERENCES specs(id) ON DELETE SET NULL`.
//   So `DELETE FROM specs WHERE id=?B` automatically nulls out C.prev_id
//   for any C whose prev_id was B. A naive "UPDATE WHERE prev_id=?B" run
//   afterwards would match zero rows — the link was already severed by
//   cascade — and the chain A→B→C silently degrades into A and C heads.
//
// We therefore look up the successor's id ahead of time and rewire it
// directly. The NOT EXISTS guard couples the UPDATE to the DELETE: if the
// CAS DELETE matches no rows, the UPDATE also matches zero, leaving data
// untouched.
//
// Concurrency safety (optimistic concurrency control):
//   * `DELETE ... AND prev_id IS ?` performs a CAS on the spec's prev_id
//     read at the start of this handler. If a concurrent operation has
//     since changed prev_id (e.g., the predecessor was deleted, triggering
//     cascade SET NULL), the CAS fails and we return 409 for the client
//     to retry with fresh state.
//   * If `spec.prev_id` was concurrently deleted between our read and the
//     batch, the UPDATE will hit the FK and the entire batch rolls back —
//     also surfaced as 409.
app.delete('/specs/:id', async (c) => {
  const id = c.req.param('id');
  const spec = await readSpec(c.env.DB, id);
  if (!spec) return c.json({ error: 'spec not found' }, 404);

  const succ = await c.env.DB
    .prepare('SELECT id FROM specs WHERE prev_id = ?')
    .bind(id)
    .first<{ id: string }>();

  const t = now();
  const ops = [
    c.env.DB
      .prepare('DELETE FROM specs WHERE id = ? AND prev_id IS ?')
      .bind(id, spec.prev_id),
  ];
  if (succ) {
    ops.push(
      c.env.DB
        .prepare(
          'UPDATE specs SET prev_id = ?, updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM specs WHERE id = ?)',
        )
        .bind(spec.prev_id, t, succ.id, id),
    );
  }
  // Cascade bump, gated by the same condition as the DELETE: only if the
  // spec is actually gone. Mirrors the successor-rewire's NOT EXISTS guard so
  // a CAS-failed DELETE leaves project.updated_at untouched.
  ops.push(
    c.env.DB
      .prepare(
        'UPDATE projects SET updated_at = ? WHERE name = ? AND NOT EXISTS (SELECT 1 FROM specs WHERE id = ?)',
      )
      .bind(t, spec.project_id, id),
  );

  let results;
  try {
    results = await c.env.DB.batch(ops);
  } catch (e) {
    if (isUniqueViolation(e) || isFkViolation(e)) {
      return c.json({ error: 'concurrent modification, retry' }, 409);
    }
    throw e;
  }
  if (!results[0] || results[0].meta.changes === 0) {
    const stillExists = await readSpec(c.env.DB, id);
    if (!stillExists) return c.json({ error: 'spec not found' }, 404);
    return c.json({ error: 'concurrent modification, retry' }, 409);
  }
  return c.body(null, 204);
});

// ---------- tasks ----------

// `prev_id` is optional:
//   * omitted / null → auto-append to the spec's tail (single-statement INSERT).
//   * provided → insert AFTER that task. If prev had a successor, the successor
//     gets rewired so its prev_id points to the new task (A→B→C with prev=A
//     yields A→X→B→C). Cross-spec or unknown prev_id surfaces as 400.
//
// uq_tasks_chain on (spec_id, COALESCE(prev_id, 'HEAD')) makes ordering
// matter inside the batch:
//   1. UPDATE successor.prev_id = new_id  — vacates (spec_id, prev_id) so the
//      INSERT can reuse it. Safe because tasks.prev_id has no FK; the not-yet-
//      inserted new_id is allowed to dangle for one statement.
//   2. INSERT new task with prev_id = original prev_id.
// Reversing the order would trip UNIQUE on the INSERT and the batch would roll
// back. UPDATE→INSERT keeps the chain consistent at every statement boundary.
app.post('/specs/:id/tasks', async (c) => {
  const specId = c.req.param('id');
  const parsedBody = await parseJsonBody<{ title?: unknown; body?: unknown; prev_id?: unknown }>(c);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = parseNewPayload(parsedBody.value);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  // Explicit prev_id branch: validate cross-spec membership, then run the
  // 2-statement insert. Spec existence is implied by a matching prev_id.
  if (parsedBody.value.prev_id !== undefined && parsedBody.value.prev_id !== null) {
    if (typeof parsedBody.value.prev_id !== 'string') {
      return c.json({ error: 'prev_id must be string or null' }, 400);
    }
    const prevId = parsedBody.value.prev_id;
    // Pull project_id alongside spec_id in one round-trip; we need it for
    // the project-level cascade bump below.
    const prev = await c.env.DB
      .prepare(
        'SELECT t.spec_id, s.project_id FROM tasks t JOIN specs s ON t.spec_id = s.id WHERE t.id = ?',
      )
      .bind(prevId)
      .first<{ spec_id: string; project_id: string }>();
    if (!prev) return c.json({ error: 'prev_id task not found' }, 400);
    if (prev.spec_id !== specId) {
      return c.json({ error: 'prev_id must belong to the same spec' }, 400);
    }

    const id = ulid();
    const t = now();
    try {
      await c.env.DB.batch([
        c.env.DB
          .prepare(
            'UPDATE tasks SET prev_id = ?, updated_at = ? WHERE spec_id = ? AND prev_id = ?',
          )
          .bind(id, t, specId, prevId),
        c.env.DB
          .prepare(
            'INSERT INTO tasks (id, spec_id, title, body, status, prev_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(id, specId, parsed.value.title, parsed.value.body, 'todo', prevId, t, t),
        bumpSpec(c.env.DB, specId, t),
        bumpProject(c.env.DB, prev.project_id, t),
      ]);
    } catch (e) {
      // A concurrent insert/delete may have changed the chain between our
      // SELECT and the batch (e.g. another writer raced to occupy the same
      // slot, or prev was deleted and rewired). Either way, retry with fresh
      // state.
      if (isUniqueViolation(e)) {
        return c.json({ error: 'concurrent task insert, retry' }, 409);
      }
      throw e;
    }
    return c.json(await readTask(c.env.DB, id), 201);
  }

  // Default branch: auto-append to the tail. We need project_id for the
  // cascade bump, so we read the spec up-front (which also turns the previous
  // WHERE-EXISTS-based 404 into an explicit 404). A concurrent spec delete
  // between this read and the batch trips the FK on tasks.spec_id, which
  // rolls back the entire batch.
  const spec = await readSpec(c.env.DB, specId);
  if (!spec) return c.json({ error: 'spec not found' }, 404);

  const id = ulid();
  const t = now();
  try {
    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO tasks (id, spec_id, title, body, status, prev_id, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'todo',
             (SELECT t.id FROM tasks t
                WHERE t.spec_id = ?2
                  AND NOT EXISTS (SELECT 1 FROM tasks t2 WHERE t2.spec_id = ?2 AND t2.prev_id = t.id)
                LIMIT 1),
             ?5, ?5)`,
        )
        .bind(id, specId, parsed.value.title, parsed.value.body, t),
      bumpSpec(c.env.DB, specId, t),
      bumpProject(c.env.DB, spec.project_id, t),
    ]);
  } catch (e) {
    // Concurrent inserts may race on the tail-lookup; partial unique index
    // catches the second writer. Surface as 409 so the client can retry.
    if (isUniqueViolation(e)) {
      return c.json({ error: 'concurrent task insert, retry' }, 409);
    }
    // Spec was deleted between our read and the batch — FK on tasks.spec_id
    // rolls everything back, including both bumps.
    if (isFkViolation(e)) {
      return c.json({ error: 'spec not found' }, 404);
    }
    throw e;
  }
  return c.json(await readTask(c.env.DB, id), 201);
});

app.patch('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const parsedBody = await parseJsonBody<PatchBody>(c);
  if (!parsedBody.ok) return parsedBody.response;

  // Single JOIN read: spec_id + project_id for the two cascade bumps, plus
  // 404 detection. Same trade-off as PATCH /specs/:id — one extra round-trip
  // buys atomic batch with shared ts.
  const ctx = await c.env.DB
    .prepare(
      'SELECT t.spec_id, s.project_id FROM tasks t JOIN specs s ON t.spec_id = s.id WHERE t.id = ?',
    )
    .bind(id)
    .first<{ spec_id: string; project_id: string }>();
  if (!ctx) return c.json({ error: 'task not found' }, 404);

  const ts = now();
  const patch = buildPatch(parsedBody.value, TASK_STATUSES, ts);
  if (!patch.ok) return c.json({ error: patch.error }, 400);
  await c.env.DB.batch([
    c.env.DB
      .prepare(`UPDATE tasks SET ${patch.setClause} WHERE id = ?`)
      .bind(...patch.values, id),
    bumpSpec(c.env.DB, ctx.spec_id, ts),
    bumpProject(c.env.DB, ctx.project_id, ts),
  ]);
  return c.json(await readTask(c.env.DB, id));
});

// Delete a task and rewire its successor to its predecessor. Same OCC
// pattern as spec delete:
//   * `DELETE ... AND prev_id IS ?` is a CAS on the prev_id we just read.
//     A concurrent delete of an adjacent task (which would have rewritten
//     this row's neighbours' prev_id) makes the CAS fail.
//   * `UPDATE ... NOT EXISTS (... WHERE id = ?)` couples the rewire to the
//     DELETE: zero rows deleted ⇒ zero rows updated. Without this guard, a
//     stale prev_id from the read would silently rewire the successor to a
//     now-missing predecessor.
//
// `AND spec_id = ?` on the UPDATE prevents cross-spec contamination if any
// rogue row exists with `prev_id = ?id` in another spec.
app.delete('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const task = await readTask(c.env.DB, id);
  if (!task) return c.json({ error: 'task not found' }, 404);

  // Need project_id for the project-level cascade bump.
  const projectRow = await c.env.DB
    .prepare('SELECT project_id FROM specs WHERE id = ?')
    .bind(task.spec_id)
    .first<{ project_id: string }>();
  if (!projectRow) return c.json({ error: 'task not found' }, 404);

  const t = now();
  let results;
  try {
    results = await c.env.DB.batch([
      c.env.DB
        .prepare('DELETE FROM tasks WHERE id = ? AND prev_id IS ?')
        .bind(id, task.prev_id),
      c.env.DB
        .prepare(
          'UPDATE tasks SET prev_id = ?, updated_at = ? WHERE prev_id = ? AND spec_id = ? AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = ?)',
        )
        .bind(task.prev_id, t, id, task.spec_id, id),
      // Cascade bumps gated by the same NOT EXISTS condition as the
      // successor rewire: a CAS-failed DELETE leaves both updated_at fields
      // untouched.
      c.env.DB
        .prepare(
          'UPDATE specs SET updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = ?)',
        )
        .bind(t, task.spec_id, id),
      c.env.DB
        .prepare(
          'UPDATE projects SET updated_at = ? WHERE name = ? AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = ?)',
        )
        .bind(t, projectRow.project_id, id),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) {
      return c.json({ error: 'concurrent modification, retry' }, 409);
    }
    throw e;
  }
  if (!results[0] || results[0].meta.changes === 0) {
    const stillExists = await readTask(c.env.DB, id);
    if (!stillExists) return c.json({ error: 'task not found' }, 404);
    return c.json({ error: 'concurrent modification, retry' }, 409);
  }
  return c.body(null, 204);
});

// ---------- asks ----------
// Same project/chain shape as specs; only body + immutable origin columns.

function parseAskBody(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'body required' };
  }
  if (raw.length > MAX_BODY_LEN) {
    return { ok: false, error: `body too long (max ${MAX_BODY_LEN} chars)` };
  }
  return { ok: true, value: raw };
}

function parseAskOrigin(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false, error: 'origin must be string' };
  if (raw.length > MAX_BODY_LEN) {
    return { ok: false, error: `origin too long (max ${MAX_BODY_LEN} chars)` };
  }
  return { ok: true, value: raw };
}

app.post('/projects/:name/asks', async (c) => {
  const name = c.req.param('name');
  if (name.length === 0 || name.length > MAX_PROJECT_NAME_LEN) {
    return c.json({ error: `project name length must be 1..${MAX_PROJECT_NAME_LEN}` }, 400);
  }

  const parsedBody = await parseJsonBody<{
    body?: unknown;
    origin?: unknown;
    prev_id?: unknown;
  }>(c);
  if (!parsedBody.ok) return parsedBody.response;

  const bodyParsed = parseAskBody(parsedBody.value.body);
  if (!bodyParsed.ok) return c.json({ error: bodyParsed.error }, 400);
  const originParsed = parseAskOrigin(parsedBody.value.origin);
  if (!originParsed.ok) return c.json({ error: originParsed.error }, 400);

  let prevId: string | null = null;
  if (parsedBody.value.prev_id !== undefined && parsedBody.value.prev_id !== null) {
    if (typeof parsedBody.value.prev_id !== 'string') {
      return c.json({ error: 'prev_id must be string or null' }, 400);
    }
    const prev = await c.env.DB
      .prepare('SELECT project_id FROM asks WHERE id = ?')
      .bind(parsedBody.value.prev_id)
      .first<{ project_id: string }>();
    if (!prev) return c.json({ error: 'prev_id ask not found' }, 400);
    if (prev.project_id !== name) {
      return c.json({ error: 'prev_id must belong to the same project' }, 400);
    }
    prevId = parsedBody.value.prev_id;
  }

  const id = ulid();
  const t = now();
  try {
    await c.env.DB.batch([
      c.env.DB
        .prepare('INSERT OR IGNORE INTO projects (name, created_at, updated_at) VALUES (?, ?, ?)')
        .bind(name, t, t),
      c.env.DB
        .prepare(
          'INSERT INTO asks (id, project_id, body, origin, prev_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(id, name, bodyParsed.value, originParsed.value, prevId, t, t),
      bumpProject(c.env.DB, name, t),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) {
      return c.json({ error: 'prev_id already has a successor' }, 409);
    }
    if (isFkViolation(e)) {
      return c.json({ error: 'prev_id no longer exists' }, 400);
    }
    throw e;
  }
  return c.json(await readAsk(c.env.DB, id), 201);
});

app.get('/projects/:name/asks', async (c) => {
  const name = c.req.param('name');
  const project = await readProject(c.env.DB, name);
  if (!project) return c.json({ error: 'project not found' }, 404);

  const rawLimit = c.req.query('limit');
  let limit = ASK_LIMIT_DEFAULT;
  if (rawLimit !== undefined) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > ASK_LIMIT_MAX) {
      return c.json({ error: `limit must be integer in 1..${ASK_LIMIT_MAX}` }, 400);
    }
    limit = n;
  }

  const { results } = await c.env.DB
    .prepare('SELECT * FROM asks WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?')
    .bind(name, limit)
    .all<AskRow>();
  return c.json(results);
});

app.get('/asks/:id', async (c) => {
  const id = c.req.param('id');
  const ask = await readAsk(c.env.DB, id);
  if (!ask) return c.json({ error: 'ask not found' }, 404);
  return c.json(ask);
});

// Only body is patchable; origin is immutable.
app.patch('/asks/:id', async (c) => {
  const id = c.req.param('id');
  const parsedBody = await parseJsonBody<{ body?: unknown }>(c);
  if (!parsedBody.ok) return parsedBody.response;
  const bodyParsed = parseAskBody(parsedBody.value.body);
  if (!bodyParsed.ok) return c.json({ error: bodyParsed.error }, 400);

  const existing = await readAsk(c.env.DB, id);
  if (!existing) return c.json({ error: 'ask not found' }, 404);

  const ts = now();
  await c.env.DB.batch([
    c.env.DB
      .prepare('UPDATE asks SET body = ?, updated_at = ? WHERE id = ?')
      .bind(bodyParsed.value, ts, id),
    bumpProject(c.env.DB, existing.project_id, ts),
  ]);
  return c.json(await readAsk(c.env.DB, id));
});

// Same OCC pattern as DELETE /specs/:id.
app.delete('/asks/:id', async (c) => {
  const id = c.req.param('id');
  const ask = await readAsk(c.env.DB, id);
  if (!ask) return c.json({ error: 'ask not found' }, 404);

  const succ = await c.env.DB
    .prepare('SELECT id FROM asks WHERE prev_id = ?')
    .bind(id)
    .first<{ id: string }>();

  const t = now();
  const ops = [
    c.env.DB
      .prepare('DELETE FROM asks WHERE id = ? AND prev_id IS ?')
      .bind(id, ask.prev_id),
  ];
  if (succ) {
    ops.push(
      c.env.DB
        .prepare(
          'UPDATE asks SET prev_id = ?, updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM asks WHERE id = ?)',
        )
        .bind(ask.prev_id, t, succ.id, id),
    );
  }
  ops.push(
    c.env.DB
      .prepare(
        'UPDATE projects SET updated_at = ? WHERE name = ? AND NOT EXISTS (SELECT 1 FROM asks WHERE id = ?)',
      )
      .bind(t, ask.project_id, id),
  );

  let results;
  try {
    results = await c.env.DB.batch(ops);
  } catch (e) {
    if (isUniqueViolation(e) || isFkViolation(e)) {
      return c.json({ error: 'concurrent modification, retry' }, 409);
    }
    throw e;
  }
  if (!results[0] || results[0].meta.changes === 0) {
    const stillExists = await readAsk(c.env.DB, id);
    if (!stillExists) return c.json({ error: 'ask not found' }, 404);
    return c.json({ error: 'concurrent modification, retry' }, 409);
  }
  return c.body(null, 204);
});

export default app;
