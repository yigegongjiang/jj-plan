import { Hono, type Context } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';

import { ulid } from './ulid';

type Bindings = {
  DB: D1Database;
  JJPLAN_TOKEN: string;
};

const SPEC_STATUSES = ['draft', 'active', 'done'] as const;
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

const app = new Hono<{ Bindings: Bindings }>();

// ---------- middleware ----------

app.use('/projects/*', (c, next) => bearerAuth({ token: c.env.JJPLAN_TOKEN })(c, next));
app.use('/specs/*', (c, next) => bearerAuth({ token: c.env.JJPLAN_TOKEN })(c, next));
app.use('/tasks/*', (c, next) => bearerAuth({ token: c.env.JJPLAN_TOKEN })(c, next));

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

function buildPatch(body: PatchBody, allowedStatuses: readonly string[]): PatchResult {
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
  values.push(now());
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
//   - chains ordered by their head's created_at DESC (newest chain first)
//   - any orphans (data inconsistency) appended last, by created_at DESC
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
  heads.sort((a, b) => b.created_at - a.created_at);

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
      .sort((a, b) => b.created_at - a.created_at);
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
  const [{ results: projectRows }, { results: specRows }, { results: taskRows }] =
    await Promise.all([
      c.env.DB.prepare('SELECT * FROM projects').all<ProjectRow>(),
      c.env.DB.prepare('SELECT * FROM specs').all<SpecRow>(),
      c.env.DB.prepare('SELECT * FROM tasks').all<TaskRow>(),
    ]);

  const specsByProject = new Map<string, SpecRow[]>();
  for (const s of specRows) {
    const arr = specsByProject.get(s.project_id);
    if (arr) arr.push(s);
    else specsByProject.set(s.project_id, [s]);
  }

  const tasksBySpec = indexTasks(taskRows);
  const sorted = projectRows.slice().sort((a, b) => b.created_at - a.created_at);
  return c.json(
    sorted.map((p) => ({
      ...p,
      specs: bundleSpecs(specsByProject.get(p.name) ?? [], tasksBySpec),
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
        .bind(id, name, parsed.value.title, parsed.value.body, 'draft', prevId, t, t),
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
  const patch = buildPatch(parsedBody.value, SPEC_STATUSES);
  if (!patch.ok) return c.json({ error: patch.error }, 400);
  const result = await c.env.DB
    .prepare(`UPDATE specs SET ${patch.setClause} WHERE id = ?`)
    .bind(...patch.values, id)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'spec not found' }, 404);
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
    const prev = await c.env.DB
      .prepare('SELECT spec_id FROM tasks WHERE id = ?')
      .bind(prevId)
      .first<{ spec_id: string }>();
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

  // Default branch: auto-append to the tail. Single statement to avoid the
  // round-trip of a separate tail lookup.
  const id = ulid();
  const t = now();
  let result;
  try {
    result = await c.env.DB
      .prepare(
        `INSERT INTO tasks (id, spec_id, title, body, status, prev_id, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, 'todo',
           (SELECT t.id FROM tasks t
              WHERE t.spec_id = ?2
                AND NOT EXISTS (SELECT 1 FROM tasks t2 WHERE t2.spec_id = ?2 AND t2.prev_id = t.id)
              LIMIT 1),
           ?5, ?5
         WHERE EXISTS (SELECT 1 FROM specs WHERE id = ?2)`,
      )
      .bind(id, specId, parsed.value.title, parsed.value.body, t)
      .run();
  } catch (e) {
    // Concurrent inserts may race on the tail-lookup; partial unique index
    // catches the second writer. Surface as 409 so the client can retry.
    if (isUniqueViolation(e)) {
      return c.json({ error: 'concurrent task insert, retry' }, 409);
    }
    throw e;
  }
  if (result.meta.changes === 0) return c.json({ error: 'spec not found' }, 404);
  return c.json(await readTask(c.env.DB, id), 201);
});

app.patch('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const parsedBody = await parseJsonBody<PatchBody>(c);
  if (!parsedBody.ok) return parsedBody.response;
  const patch = buildPatch(parsedBody.value, TASK_STATUSES);
  if (!patch.ok) return c.json({ error: patch.error }, 400);
  const result = await c.env.DB
    .prepare(`UPDATE tasks SET ${patch.setClause} WHERE id = ?`)
    .bind(...patch.values, id)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'task not found' }, 404);
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

export default app;
