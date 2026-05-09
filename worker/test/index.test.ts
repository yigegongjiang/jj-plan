/// <reference types="@cloudflare/vitest-pool-workers" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';

import worker from '../src/index';

// =============================================================================
// jjplan worker — full boundary suite.
//
// Goal: pin down EVERY decision branch in worker/src/index.ts.
// Strategy: hit the worker's fetch handler directly (no HTTP server, no remote
// D1). vitest-pool-workers provides a workerd runtime with a real Miniflare D1.
// Each test starts with empty `projects`, `specs` and `tasks` tables (see
// beforeEach).
//
// Coverage axes:
//   * auth boundary (token presence/correctness on every protected route)
//   * input validation (title/body length, type, JSON parse)
//   * project upsert on POST /projects/:name/specs
//   * spec chain: standalone / 2-cycle orphan / fork rejection / linked CRUD
//   * task chain: head / middle / tail CRUD on a 3-node chain
//   * 3 specs × 3 tasks integrated walk
//   * direct schema constraints (UNIQUE indexes, FK CASCADE, FK SET NULL)
//   * cross-project isolation (prev_id may not span projects, DELETE
//     /projects cascade)
//   * cycle handling in orderTaskChain / orderSpecs (orphan tail)
// =============================================================================

const TOKEN = 'test-token';
const PROJECT = 'P';

interface Project {
  name: string;
  created_at: number;
  updated_at: number;
}
interface Spec {
  id: string;
  project_id: string;
  title: string;
  body: string;
  status: string;
  prev_id: string | null;
  created_at: number;
  updated_at: number;
}
interface Task {
  id: string;
  spec_id: string;
  title: string;
  body: string;
  status: string;
  prev_id: string | null;
  created_at: number;
  updated_at: number;
}
interface SpecWithTasks extends Spec {
  tasks: Task[];
}
interface ProjectWithSpecs extends Project {
  specs: SpecWithTasks[];
}

const ctx = {} as ExecutionContext;

beforeEach(async () => {
  // tasks → specs → projects (FK CASCADE order). DELETE FROM projects alone
  // would cascade specs and tasks too; we wipe all three for clarity.
  await env.DB.exec('DELETE FROM tasks');
  await env.DB.exec('DELETE FROM specs');
  await env.DB.exec('DELETE FROM projects');
});

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function makeReq(path: string, init: RequestInit = {}): Request {
  return new Request(`http://test.local${path}`, init);
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(makeReq(path, init), env as unknown as Record<string, unknown>, ctx) as unknown as Promise<Response>;
}

function withAuth(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${TOKEN}`);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return { ...init, headers };
}

async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  return call(path, withAuth(init));
}

async function jsonReq(
  path: string,
  method: string,
  body: unknown,
): Promise<Response> {
  return authed(path, { method, body: JSON.stringify(body) });
}

async function newSpec(
  payload: {
    title: string;
    body?: string;
    prev_id?: string | null;
  },
  project: string = PROJECT,
): Promise<Spec> {
  const r = await jsonReq(`/projects/${project}/specs`, 'POST', payload);
  if (r.status !== 201) {
    throw new Error(`newSpec failed: ${r.status} ${await r.text()}`);
  }
  return r.json();
}

async function newTask(
  specId: string,
  payload: { title: string; body?: string },
): Promise<Task> {
  const r = await jsonReq(`/specs/${specId}/tasks`, 'POST', payload);
  if (r.status !== 201) {
    throw new Error(`newTask failed: ${r.status} ${await r.text()}`);
  }
  return r.json();
}

async function listSpecs(project: string = PROJECT): Promise<SpecWithTasks[]> {
  const r = await authed(`/projects/${project}/specs`);
  if (r.status !== 200) {
    throw new Error(`listSpecs failed: ${r.status} ${await r.text()}`);
  }
  return r.json();
}

async function listProjects(): Promise<ProjectWithSpecs[]> {
  const r = await authed('/projects');
  if (r.status !== 200) {
    throw new Error(`listProjects failed: ${r.status} ${await r.text()}`);
  }
  return r.json();
}

async function getSpec(id: string): Promise<SpecWithTasks> {
  const r = await authed(`/specs/${id}`);
  if (r.status !== 200) {
    throw new Error(`getSpec failed: ${r.status} ${await r.text()}`);
  }
  return r.json();
}

async function rowCount(table: 'projects' | 'specs' | 'tasks'): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
  return row?.c ?? 0;
}

// Date.now() resolution is 1 ms. Two consecutive inserts can land in the same
// millisecond, which makes "ORDER BY created_at DESC" non-deterministic. tick()
// nudges the clock between operations whose ordering we want to assert.
async function tick(ms = 2): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function buildSpecChain(project: string = PROJECT): Promise<{ a: Spec; b: Spec; c: Spec }> {
  const a = await newSpec({ title: 'A' }, project);
  await tick();
  const b = await newSpec({ title: 'B', prev_id: a.id }, project);
  await tick();
  const c = await newSpec({ title: 'C', prev_id: b.id }, project);
  return { a, b, c };
}

async function buildTaskChain(specId: string): Promise<{ a: Task; b: Task; c: Task }> {
  const a = await newTask(specId, { title: 'TA' });
  await tick();
  const b = await newTask(specId, { title: 'TB' });
  await tick();
  const c = await newTask(specId, { title: 'TC' });
  return { a, b, c };
}

const FAKE_ID = 'NONEXISTENT0000000000000000';

// =============================================================================
// public surface
// =============================================================================

describe('public surface', () => {
  // The dashboard SPA at `/` is served by Cloudflare Workers Static Assets
  // (see [assets] in wrangler.toml). Requests that match a built asset never
  // reach the worker fetch handler. In this test environment, no assets are
  // attached, so `/` falls through to the worker and 404s — that's the
  // correct contract for the worker handler in isolation.
  it('GET / falls through to the worker handler (assets serve it in production)', async () => {
    const r = await call('/');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'not found' });
  });

  it('unknown path returns 404 JSON', async () => {
    const r = await call('/no-such-route');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'not found' });
  });
});

// =============================================================================
// auth boundary on every protected route
// =============================================================================

describe('auth', () => {
  const cases = [
    { method: 'GET', path: '/projects', hasBody: false },
    { method: 'GET', path: '/projects/anything/specs', hasBody: false },
    { method: 'POST', path: '/projects/anything/specs', hasBody: true },
    { method: 'DELETE', path: '/projects/anything', hasBody: false },
    { method: 'GET', path: '/specs/anything', hasBody: false },
    { method: 'PATCH', path: '/specs/anything', hasBody: true },
    { method: 'DELETE', path: '/specs/anything', hasBody: false },
    { method: 'POST', path: '/specs/anything/tasks', hasBody: true },
    { method: 'PATCH', path: '/tasks/anything', hasBody: true },
    { method: 'DELETE', path: '/tasks/anything', hasBody: false },
  ] as const;

  for (const { method, path, hasBody } of cases) {
    it(`${method} ${path} without token rejects`, async () => {
      const init: RequestInit = { method };
      if (hasBody) {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify({ title: 't' });
      }
      const r = await call(path, init);
      expect(r.status).toBe(401);
    });

    it(`${method} ${path} with wrong token rejects`, async () => {
      const headers: Record<string, string> = { Authorization: 'Bearer wrong' };
      const init: RequestInit = { method, headers };
      if (hasBody) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify({ title: 't' });
      }
      const r = await call(path, init);
      expect(r.status).toBe(401);
    });
  }

  it('GET /projects with correct token succeeds', async () => {
    const r = await authed('/projects');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });
});

// =============================================================================
// POST /projects/:name/specs — body validation
// =============================================================================

describe('POST /projects/:name/specs validation', () => {
  it('rejects when title field is missing', async () => {
    const r = await jsonReq(`/projects/${PROJECT}/specs`, 'POST', {});
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('title required');
  });

  it('rejects empty title', async () => {
    const r = await jsonReq(`/projects/${PROJECT}/specs`, 'POST', { title: '' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('title required');
  });

  it('rejects non-string title (number)', async () => {
    const r = await jsonReq(`/projects/${PROJECT}/specs`, 'POST', { title: 123 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('title required');
  });

  it('rejects non-string title (null)', async () => {
    const r = await jsonReq(`/projects/${PROJECT}/specs`, 'POST', { title: null });
    expect(r.status).toBe(400);
  });

  it('accepts title of 1 char', async () => {
    const s = await newSpec({ title: 'x' });
    expect(s.title).toBe('x');
  });

  it('accepts title at boundary length 200', async () => {
    const t = 'x'.repeat(200);
    const s = await newSpec({ title: t });
    expect(s.title).toBe(t);
    expect(s.title.length).toBe(200);
  });

  it('rejects title at length 201', async () => {
    const r = await jsonReq(`/projects/${PROJECT}/specs`, 'POST', { title: 'x'.repeat(201) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/title too long/);
  });

  it('treats missing body as empty string', async () => {
    const s = await newSpec({ title: 't' });
    expect(s.body).toBe('');
  });

  it('treats non-string body as empty string', async () => {
    const r = await jsonReq(`/projects/${PROJECT}/specs`, 'POST', { title: 't', body: 123 });
    expect(r.status).toBe(201);
    expect((await r.json()).body).toBe('');
  });

  it('accepts body at boundary length 65536', async () => {
    const b = 'a'.repeat(65536);
    const s = await newSpec({ title: 't', body: b });
    expect(s.body.length).toBe(65536);
  });

  it('rejects body at length 65537', async () => {
    const r = await jsonReq(`/projects/${PROJECT}/specs`, 'POST', { title: 't', body: 'a'.repeat(65537) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/body too long/);
  });

  it('rejects malformed JSON body', async () => {
    const r = await authed(`/projects/${PROJECT}/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/invalid JSON/);
  });

  it('rejects empty project name (route 404 because /projects//specs collapses)', async () => {
    // Hono treats "//" as one segment by default; the route does not match.
    const r = await jsonReq('/projects//specs', 'POST', { title: 't' });
    expect(r.status).toBe(404);
  });

  it('rejects project name above 128 chars', async () => {
    const longName = 'p'.repeat(129);
    const r = await jsonReq(`/projects/${longName}/specs`, 'POST', { title: 't' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/project name length/);
  });

  it('accepts project name at boundary length 128', async () => {
    const name = 'p'.repeat(128);
    const s = await newSpec({ title: 't' }, name);
    expect(s.project_id).toBe(name);
    expect(s.project_id.length).toBe(128);
  });

  it('accepts non-ASCII project name (e.g. CJK directory)', async () => {
    const name = '我的项目-プロジェクト';
    const encoded = encodeURIComponent(name);
    const r = await jsonReq(`/projects/${encoded}/specs`, 'POST', { title: 't' });
    expect(r.status).toBe(201);
    expect((await r.json()).project_id).toBe(name);
    const projects = await listProjects();
    expect(projects.map((p) => p.name)).toContain(name);
  });

  it('default status is active', async () => {
    const s = await newSpec({ title: 't' });
    expect(s.status).toBe('active');
  });

  it('returns full row shape with ULID id, project_id, equal timestamps', async () => {
    const s = await newSpec({ title: 't', body: 'b' });
    expect(s).toMatchObject({
      title: 't',
      body: 'b',
      status: 'active',
      prev_id: null,
      project_id: PROJECT,
    });
    expect(s.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(typeof s.created_at).toBe('number');
    expect(s.updated_at).toBe(s.created_at);
  });
});

// =============================================================================
// POST /projects/:name/specs — prev_id semantics (chain head/successor)
// =============================================================================

describe('POST /projects/:name/specs prev_id', () => {
  it('undefined prev_id creates standalone (prev_id=null)', async () => {
    const s = await newSpec({ title: 'A' });
    expect(s.prev_id).toBe(null);
  });

  it('explicit null prev_id creates standalone', async () => {
    const r = await jsonReq(`/projects/${PROJECT}/specs`, 'POST', { title: 'A', prev_id: null });
    expect(r.status).toBe(201);
    expect((await r.json()).prev_id).toBe(null);
  });

  it('rejects non-string prev_id', async () => {
    const r = await jsonReq(`/projects/${PROJECT}/specs`, 'POST', { title: 'A', prev_id: 123 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/prev_id must be string/);
  });

  it('rejects prev_id pointing to non-existent spec', async () => {
    const r = await jsonReq(`/projects/${PROJECT}/specs`, 'POST', { title: 'A', prev_id: FAKE_ID });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('prev_id spec not found');
  });

  it('accepts valid prev_id and links the chain', async () => {
    const a = await newSpec({ title: 'A' });
    const b = await newSpec({ title: 'B', prev_id: a.id });
    expect(b.prev_id).toBe(a.id);
  });

  it('rejects fork attempt (two specs claiming same prev_id) with 409', async () => {
    const a = await newSpec({ title: 'A' });
    await newSpec({ title: 'B', prev_id: a.id });
    const r = await jsonReq(`/projects/${PROJECT}/specs`, 'POST', { title: 'B2', prev_id: a.id });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/successor/);
  });

  it('rejects prev_id pointing into another project', async () => {
    const a = await newSpec({ title: 'A' }, 'P1');
    const r = await jsonReq('/projects/P2/specs', 'POST', { title: 'B', prev_id: a.id });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/same project/);
  });
});

// =============================================================================
// project upsert + GET /projects + DELETE /projects
// =============================================================================

describe('projects', () => {
  it('GET /projects returns [] when nothing exists', async () => {
    expect(await listProjects()).toEqual([]);
  });

  it('first POST under a name creates the project; second POST does NOT bump created_at', async () => {
    const s1 = await newSpec({ title: 'A' }, 'X');
    await tick();
    const s2 = await newSpec({ title: 'B' }, 'X');

    const projects = await listProjects();
    expect(projects).toHaveLength(1);
    const x = projects.find((p) => p.name === 'X')!;
    // created_at pinned to the first INSERT (specs s1 created the project).
    expect(x.created_at).toBeLessThanOrEqual(s1.created_at);
    expect(x.created_at).toBeLessThan(s2.created_at);
    expect(x.specs.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
  });

  it('GET /projects orders by project created_at DESC', async () => {
    await newSpec({ title: 'A' }, 'oldest');
    await tick();
    await newSpec({ title: 'B' }, 'middle');
    await tick();
    await newSpec({ title: 'C' }, 'newest');
    const projects = await listProjects();
    expect(projects.map((p) => p.name)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('GET /projects nests ordered specs (head→tail) under each project', async () => {
    const { a, b, c } = await buildSpecChain('alpha');
    await newSpec({ title: 'lone' }, 'beta');
    const projects = await listProjects();
    const alpha = projects.find((p) => p.name === 'alpha')!;
    const beta = projects.find((p) => p.name === 'beta')!;
    expect(alpha.specs.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    expect(beta.specs.map((s) => s.title)).toEqual(['lone']);
  });

  it('GET /projects nests ordered tasks within each spec', async () => {
    const a = await newSpec({ title: 'A' });
    const tc = await buildTaskChain(a.id);
    const projects = await listProjects();
    const spec = projects[0]?.specs[0];
    expect(spec?.tasks.map((t) => t.id)).toEqual([tc.a.id, tc.b.id, tc.c.id]);
  });

  it('GET /projects/:name/specs requires the project to exist', async () => {
    const r = await authed('/projects/missing/specs');
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('project not found');
  });

  it('GET /projects/:name/specs only returns specs of that project', async () => {
    const aP1 = await newSpec({ title: 'A' }, 'P1');
    const aP2 = await newSpec({ title: 'A' }, 'P2');
    const onlyP1 = await listSpecs('P1');
    expect(onlyP1.map((s) => s.id)).toEqual([aP1.id]);
    const onlyP2 = await listSpecs('P2');
    expect(onlyP2.map((s) => s.id)).toEqual([aP2.id]);
  });

  it('DELETE /projects/:name removes the project, its specs, and their tasks', async () => {
    const a = await newSpec({ title: 'A' }, 'doomed');
    await newTask(a.id, { title: 't1' });
    await newTask(a.id, { title: 't2' });
    await newSpec({ title: 'kept' }, 'survivor');

    const r = await authed('/projects/doomed', { method: 'DELETE' });
    expect(r.status).toBe(204);

    expect(await rowCount('projects')).toBe(1);
    expect(await rowCount('specs')).toBe(1);
    expect(await rowCount('tasks')).toBe(0);

    const projects = await listProjects();
    expect(projects.map((p) => p.name)).toEqual(['survivor']);
  });

  it('DELETE /projects/:name returns 404 for unknown name', async () => {
    const r = await authed('/projects/none', { method: 'DELETE' });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('project not found');
  });

  it('failed spec insert (duplicate prev_id) does not create a new project', async () => {
    const a = await newSpec({ title: 'A' }, 'P1');
    await newSpec({ title: 'B', prev_id: a.id }, 'P1');
    // Attempt fork in a brand-new project name; the prev_id check fires first
    // (cross-project), but even when the unique violation could land we
    // rely on D1 batch rollback to leave the new project absent.
    const r = await jsonReq('/projects/freshName/specs', 'POST', { title: 'X', prev_id: a.id });
    expect(r.status).toBe(400);
    const projects = await listProjects();
    expect(projects.map((p) => p.name).sort()).toEqual(['P1']);
  });
});

// =============================================================================
// GET /projects/:name/specs — empty / standalone / chain / multi-chain / orphan ordering
// =============================================================================

describe('GET /projects/:name/specs ordering', () => {
  it('returns [] when project exists but has no specs (created via empty project deletion edge)', async () => {
    // Trick: insert a project directly so we can probe the empty-project path.
    await env.DB
      .prepare('INSERT INTO projects (name, created_at, updated_at) VALUES (?, ?, ?)')
      .bind('empty', Date.now(), Date.now())
      .run();
    const r = await authed('/projects/empty/specs');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });

  it('single standalone spec has empty tasks array', async () => {
    const a = await newSpec({ title: 'A' });
    const list = await listSpecs();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(a.id);
    expect(list[0]?.tasks).toEqual([]);
  });

  it('orders multiple standalones by created_at DESC', async () => {
    const a = await newSpec({ title: 'A' });
    await tick();
    const b = await newSpec({ title: 'B' });
    await tick();
    const c = await newSpec({ title: 'C' });
    const list = await listSpecs();
    expect(list.map((s) => s.id)).toEqual([c.id, b.id, a.id]);
  });

  it('walks 3-node chain head to tail', async () => {
    const { a, b, c } = await buildSpecChain();
    const list = await listSpecs();
    expect(list.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
  });

  it('orders multiple chains by head created_at DESC, each chain head-to-tail', async () => {
    const a1 = await newSpec({ title: 'A1' });
    await tick();
    const a2 = await newSpec({ title: 'A2', prev_id: a1.id });
    await tick();
    const b1 = await newSpec({ title: 'B1' });
    await tick();
    const b2 = await newSpec({ title: 'B2', prev_id: b1.id });
    const list = await listSpecs();
    expect(list.map((s) => s.title)).toEqual(['B1', 'B2', 'A1', 'A2']);
    void a2; void b2; // ids unused after construction
  });

  it('appends 2-cycle specs as orphans (after well-formed chain) within one project', async () => {
    const x = await newSpec({ title: 'X' });
    await tick();
    const y = await newSpec({ title: 'Y', prev_id: x.id });
    await tick();
    const p = await newSpec({ title: 'P' });
    await tick();
    const q = await newSpec({ title: 'Q', prev_id: p.id });

    // Force cycle on the second pair: P.prev=Q while Q.prev=P stays.
    // The schema's UNIQUE on prev_id (NOT NULL) is preserved (prev_ids = {Q, P}).
    await env.DB
      .prepare('UPDATE specs SET prev_id = ? WHERE id = ?')
      .bind(q.id, p.id)
      .run();

    const list = await listSpecs();
    // Heads = {X}; ordered = [X, Y]; orphans = [Q, P] (created_at DESC).
    expect(list.map((s) => s.id)).toEqual([x.id, y.id, q.id, p.id]);
  });
});

// =============================================================================
// GET /specs/:id
// =============================================================================

describe('GET /specs/:id', () => {
  it('returns spec with empty tasks and project_id', async () => {
    const a = await newSpec({ title: 'A' });
    const got = await getSpec(a.id);
    expect(got.id).toBe(a.id);
    expect(got.project_id).toBe(PROJECT);
    expect(got.tasks).toEqual([]);
  });

  it('returns spec with chained tasks in chain order', async () => {
    const a = await newSpec({ title: 'A' });
    const tc = await buildTaskChain(a.id);
    const got = await getSpec(a.id);
    expect(got.tasks.map((t) => t.id)).toEqual([tc.a.id, tc.b.id, tc.c.id]);
    expect(got.tasks[0]?.prev_id).toBe(null);
    expect(got.tasks[1]?.prev_id).toBe(tc.a.id);
    expect(got.tasks[2]?.prev_id).toBe(tc.b.id);
  });

  it('returns 404 for non-existent id', async () => {
    const r = await authed(`/specs/${FAKE_ID}`);
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('spec not found');
  });
});

// =============================================================================
// PATCH /specs/:id
// =============================================================================

describe('PATCH /specs/:id', () => {
  it('updates title only', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await jsonReq(`/specs/${a.id}`, 'PATCH', { title: 'A2' });
    expect(r.status).toBe(200);
    const got = await r.json();
    expect(got.title).toBe('A2');
    expect(got.body).toBe('');
    expect(got.status).toBe('active');
    expect(got.project_id).toBe(PROJECT);
  });

  it('updates body only', async () => {
    const a = await newSpec({ title: 'A', body: 'b' });
    const r = await jsonReq(`/specs/${a.id}`, 'PATCH', { body: 'b2' });
    expect(r.status).toBe(200);
    expect((await r.json()).body).toBe('b2');
  });

  for (const status of ['active', 'done']) {
    it(`accepts status=${status}`, async () => {
      const a = await newSpec({ title: 'A' });
      const r = await jsonReq(`/specs/${a.id}`, 'PATCH', { status });
      expect(r.status).toBe(200);
      expect((await r.json()).status).toBe(status);
    });
  }

  for (const status of ['draft', 'todo', 'doing', 'blocked', 'unknown', '']) {
    it(`rejects task-only, removed, or invalid status=${JSON.stringify(status)}`, async () => {
      const a = await newSpec({ title: 'A' });
      const r = await jsonReq(`/specs/${a.id}`, 'PATCH', { status });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/invalid status/);
    });
  }

  it('rejects empty patch body with no fields to update', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await jsonReq(`/specs/${a.id}`, 'PATCH', {});
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('no fields to update');
  });

  it('rejects non-string title', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await jsonReq(`/specs/${a.id}`, 'PATCH', { title: 123 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/title must be string/);
  });

  it('rejects non-string body', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await jsonReq(`/specs/${a.id}`, 'PATCH', { body: 5 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/body must be string/);
  });

  it('rejects empty title', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await jsonReq(`/specs/${a.id}`, 'PATCH', { title: '' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/title length/);
  });

  it('rejects title at length 201', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await jsonReq(`/specs/${a.id}`, 'PATCH', { title: 'x'.repeat(201) });
    expect(r.status).toBe(400);
  });

  it('accepts title at length 200', async () => {
    const a = await newSpec({ title: 'A' });
    const t = 'x'.repeat(200);
    const r = await jsonReq(`/specs/${a.id}`, 'PATCH', { title: t });
    expect(r.status).toBe(200);
    expect((await r.json()).title).toBe(t);
  });

  it('rejects body at length 65537', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await jsonReq(`/specs/${a.id}`, 'PATCH', { body: 'a'.repeat(65537) });
    expect(r.status).toBe(400);
  });

  it('updates multiple fields atomically', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await jsonReq(`/specs/${a.id}`, 'PATCH', {
      title: 'A2',
      body: 'b2',
      status: 'active',
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ title: 'A2', body: 'b2', status: 'active' });
  });

  it('bumps updated_at and preserves created_at and project_id', async () => {
    const a = await newSpec({ title: 'A' });
    await tick();
    const r = await jsonReq(`/specs/${a.id}`, 'PATCH', { title: 'A2' });
    const after = await r.json();
    expect(after.created_at).toBe(a.created_at);
    expect(after.updated_at).toBeGreaterThan(a.updated_at);
    expect(after.project_id).toBe(PROJECT);
  });

  it('returns 404 for non-existent id', async () => {
    const r = await jsonReq(`/specs/${FAKE_ID}`, 'PATCH', { title: 'x' });
    expect(r.status).toBe(404);
  });

  it('rejects malformed JSON body', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await authed(`/specs/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{broken',
    });
    expect(r.status).toBe(400);
  });

  it('PATCH does not change prev_id (chain stays linked)', async () => {
    const a = await newSpec({ title: 'A' });
    const b = await newSpec({ title: 'B', prev_id: a.id });
    await jsonReq(`/specs/${b.id}`, 'PATCH', { title: 'B2' });
    expect((await getSpec(b.id)).prev_id).toBe(a.id);
  });

  it('PATCH ignores attempt to change project_id', async () => {
    const a = await newSpec({ title: 'A' }, 'src');
    await newSpec({ title: 'X' }, 'dst'); // ensure dst exists so a fake FK can't accidentally be the issue
    const r = await jsonReq(`/specs/${a.id}`, 'PATCH', { title: 'A2', project_id: 'dst' });
    expect(r.status).toBe(200);
    const after = await r.json();
    expect(after.title).toBe('A2');
    expect(after.project_id).toBe('src'); // untouched
    // Confirm via authoritative read.
    expect((await getSpec(a.id)).project_id).toBe('src');
  });
});

// =============================================================================
// DELETE /specs/:id — 3-node chain A→B→C, every position
// =============================================================================

describe('DELETE /specs/:id (3-node chain A→B→C)', () => {
  let chain: { a: Spec; b: Spec; c: Spec };

  beforeEach(async () => {
    chain = await buildSpecChain();
  });

  it('delete head A: B becomes head, C still after B', async () => {
    const r = await authed(`/specs/${chain.a.id}`, { method: 'DELETE' });
    expect(r.status).toBe(204);

    const list = await listSpecs();
    expect(list.map((s) => s.id)).toEqual([chain.b.id, chain.c.id]);
    const b = list.find((s) => s.id === chain.b.id);
    const c = list.find((s) => s.id === chain.c.id);
    expect(b?.prev_id).toBe(null);
    expect(c?.prev_id).toBe(chain.b.id);
  });

  it('delete middle B: C.prev_id rewires to A', async () => {
    const r = await authed(`/specs/${chain.b.id}`, { method: 'DELETE' });
    expect(r.status).toBe(204);

    const list = await listSpecs();
    expect(list.map((s) => s.id)).toEqual([chain.a.id, chain.c.id]);
    expect(list.find((s) => s.id === chain.c.id)?.prev_id).toBe(chain.a.id);
  });

  it('delete tail C: A→B remains intact', async () => {
    const r = await authed(`/specs/${chain.c.id}`, { method: 'DELETE' });
    expect(r.status).toBe(204);

    const list = await listSpecs();
    expect(list.map((s) => s.id)).toEqual([chain.a.id, chain.b.id]);
    expect(list[1]?.prev_id).toBe(chain.a.id);
  });

  it('delete A then B: C left as standalone head', async () => {
    expect((await authed(`/specs/${chain.a.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await authed(`/specs/${chain.b.id}`, { method: 'DELETE' })).status).toBe(204);
    const list = await listSpecs();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(chain.c.id);
    expect(list[0]?.prev_id).toBe(null);
  });

  it('delete C then B: A left as standalone head', async () => {
    expect((await authed(`/specs/${chain.c.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await authed(`/specs/${chain.b.id}`, { method: 'DELETE' })).status).toBe(204);
    const list = await listSpecs();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(chain.a.id);
    expect(list[0]?.prev_id).toBe(null);
  });

  it('delete B then A: C left as standalone head', async () => {
    // Deleting B first: C.prev rewires to A. Then deleting A: C cascade-NULL.
    expect((await authed(`/specs/${chain.b.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await authed(`/specs/${chain.a.id}`, { method: 'DELETE' })).status).toBe(204);
    const list = await listSpecs();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(chain.c.id);
    expect(list[0]?.prev_id).toBe(null);
  });

  it('delete all three in original order: zero rows', async () => {
    expect((await authed(`/specs/${chain.a.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await authed(`/specs/${chain.b.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await authed(`/specs/${chain.c.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await rowCount('specs')).toBe(0);
  });

  it('delete all three reverse order: zero rows', async () => {
    expect((await authed(`/specs/${chain.c.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await authed(`/specs/${chain.b.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await authed(`/specs/${chain.a.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await rowCount('specs')).toBe(0);
  });

  it('cascades to tasks of the deleted spec only', async () => {
    await newTask(chain.a.id, { title: 't1' });
    await newTask(chain.a.id, { title: 't2' });
    await newTask(chain.b.id, { title: 'kept' });
    expect(await rowCount('tasks')).toBe(3);

    expect((await authed(`/specs/${chain.a.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await rowCount('tasks')).toBe(1);

    const bSpec = await getSpec(chain.b.id);
    expect(bSpec.tasks).toHaveLength(1);
    expect(bSpec.tasks[0]?.title).toBe('kept');
  });

  it('returns 404 for non-existent id', async () => {
    const r = await authed(`/specs/${FAKE_ID}`, { method: 'DELETE' });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('spec not found');
  });

  it('double-delete returns 404 the second time', async () => {
    expect((await authed(`/specs/${chain.b.id}`, { method: 'DELETE' })).status).toBe(204);
    const r = await authed(`/specs/${chain.b.id}`, { method: 'DELETE' });
    expect(r.status).toBe(404);
  });
});

// =============================================================================
// POST /specs/:id/tasks — chain build, validation, isolation
// =============================================================================

describe('POST /specs/:id/tasks', () => {
  it('first task is head with prev_id=null and status=todo', async () => {
    const a = await newSpec({ title: 'A' });
    const t = await newTask(a.id, { title: 't1' });
    expect(t.prev_id).toBe(null);
    expect(t.spec_id).toBe(a.id);
    expect(t.status).toBe('todo');
    expect(t.body).toBe('');
    expect(t.created_at).toBe(t.updated_at);
  });

  it('second and third tasks chain to current tail', async () => {
    const a = await newSpec({ title: 'A' });
    const t1 = await newTask(a.id, { title: 't1' });
    const t2 = await newTask(a.id, { title: 't2' });
    const t3 = await newTask(a.id, { title: 't3' });
    expect(t1.prev_id).toBe(null);
    expect(t2.prev_id).toBe(t1.id);
    expect(t3.prev_id).toBe(t2.id);
  });

  it('returns 404 when spec does not exist', async () => {
    const r = await jsonReq(`/specs/${FAKE_ID}/tasks`, 'POST', { title: 't' });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('spec not found');
  });

  it('rejects empty title', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await jsonReq(`/specs/${a.id}/tasks`, 'POST', { title: '' });
    expect(r.status).toBe(400);
  });

  it('rejects non-string title', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await jsonReq(`/specs/${a.id}/tasks`, 'POST', { title: 1 });
    expect(r.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await authed(`/specs/${a.id}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'bad',
    });
    expect(r.status).toBe(400);
  });

  it('accepts title at length 200, rejects 201', async () => {
    const a = await newSpec({ title: 'A' });
    const t = await newTask(a.id, { title: 'x'.repeat(200) });
    expect(t.title.length).toBe(200);
    const r = await jsonReq(`/specs/${a.id}/tasks`, 'POST', { title: 'x'.repeat(201) });
    expect(r.status).toBe(400);
  });

  it('accepts body at length 65536, rejects 65537', async () => {
    const a = await newSpec({ title: 'A' });
    const t = await newTask(a.id, { title: 't', body: 'a'.repeat(65536) });
    expect(t.body.length).toBe(65536);
    const r = await jsonReq(`/specs/${a.id}/tasks`, 'POST', {
      title: 't',
      body: 'a'.repeat(65537),
    });
    expect(r.status).toBe(400);
  });

  it('isolates chains across specs', async () => {
    const a = await newSpec({ title: 'A' });
    const b = await newSpec({ title: 'B' });
    const ta1 = await newTask(a.id, { title: 'TA1' });
    const tb1 = await newTask(b.id, { title: 'TB1' });
    const ta2 = await newTask(a.id, { title: 'TA2' });
    const tb2 = await newTask(b.id, { title: 'TB2' });
    expect(ta1.prev_id).toBe(null);
    expect(tb1.prev_id).toBe(null);
    expect(ta2.prev_id).toBe(ta1.id);
    expect(tb2.prev_id).toBe(tb1.id);
    expect((await getSpec(a.id)).tasks).toHaveLength(2);
    expect((await getSpec(b.id)).tasks).toHaveLength(2);
  });
});

// =============================================================================
// POST /specs/:id/tasks — prev_id (insert after a specific task)
// =============================================================================

describe('POST /specs/:id/tasks prev_id', () => {
  it('explicit null prev_id is equivalent to omitting (auto-append)', async () => {
    const a = await newSpec({ title: 'A' });
    const t1 = await newTask(a.id, { title: 't1' });
    const r = await jsonReq(`/specs/${a.id}/tasks`, 'POST', { title: 't2', prev_id: null });
    expect(r.status).toBe(201);
    const t2 = (await r.json()) as Task;
    expect(t2.prev_id).toBe(t1.id);
    expect((await getSpec(a.id)).tasks.map((t) => t.id)).toEqual([t1.id, t2.id]);
  });

  it('rejects non-string prev_id', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await jsonReq(`/specs/${a.id}/tasks`, 'POST', { title: 't', prev_id: 123 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/prev_id must be string/);
  });

  it('rejects unknown prev_id with 400', async () => {
    const a = await newSpec({ title: 'A' });
    const r = await jsonReq(`/specs/${a.id}/tasks`, 'POST', { title: 't', prev_id: FAKE_ID });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('prev_id task not found');
  });

  it('rejects prev_id pointing into another spec with 400', async () => {
    const s1 = await newSpec({ title: 'S1' });
    const s2 = await newSpec({ title: 'S2' });
    const t1 = await newTask(s1.id, { title: 't1' });
    const r = await jsonReq(`/specs/${s2.id}/tasks`, 'POST', { title: 'x', prev_id: t1.id });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/same spec/);
  });

  it('prev_id = tail makes the new task the new tail', async () => {
    const a = await newSpec({ title: 'A' });
    const t1 = await newTask(a.id, { title: 't1' });
    const t2 = await newTask(a.id, { title: 't2' });
    const r = await jsonReq(`/specs/${a.id}/tasks`, 'POST', { title: 't3', prev_id: t2.id });
    expect(r.status).toBe(201);
    const t3 = (await r.json()) as Task;
    expect(t3.prev_id).toBe(t2.id);
    const got = await getSpec(a.id);
    expect(got.tasks.map((t) => t.id)).toEqual([t1.id, t2.id, t3.id]);
    // t2.prev_id stays t1.id; the rewire UPDATE matched zero rows.
    expect(got.tasks[1]?.prev_id).toBe(t1.id);
  });

  it('prev_id = head: A→B→C with prev=A becomes A→X→B→C', async () => {
    const a = await newSpec({ title: 'A' });
    const chain = await buildTaskChain(a.id);
    const r = await jsonReq(`/specs/${a.id}/tasks`, 'POST', { title: 'X', prev_id: chain.a.id });
    expect(r.status).toBe(201);
    const x = (await r.json()) as Task;
    expect(x.prev_id).toBe(chain.a.id);
    const got = await getSpec(a.id);
    expect(got.tasks.map((t) => t.id)).toEqual([chain.a.id, x.id, chain.b.id, chain.c.id]);
    // B's prev_id rewired from A to X; C unchanged.
    expect(got.tasks[2]?.prev_id).toBe(x.id);
    expect(got.tasks[3]?.prev_id).toBe(chain.b.id);
  });

  it('prev_id = middle: A→B→C with prev=B becomes A→B→X→C', async () => {
    const a = await newSpec({ title: 'A' });
    const chain = await buildTaskChain(a.id);
    const r = await jsonReq(`/specs/${a.id}/tasks`, 'POST', { title: 'X', prev_id: chain.b.id });
    expect(r.status).toBe(201);
    const x = (await r.json()) as Task;
    const got = await getSpec(a.id);
    expect(got.tasks.map((t) => t.id)).toEqual([chain.a.id, chain.b.id, x.id, chain.c.id]);
    expect(got.tasks[2]?.prev_id).toBe(chain.b.id);
    expect(got.tasks[3]?.prev_id).toBe(x.id);
  });

  it('repeated middle inserts at head produce A→Y→X→B→C', async () => {
    const a = await newSpec({ title: 'A' });
    const chain = await buildTaskChain(a.id);
    // Insert X after A: A→X→B→C
    const rx = await jsonReq(`/specs/${a.id}/tasks`, 'POST', { title: 'X', prev_id: chain.a.id });
    const x = (await rx.json()) as Task;
    // Insert Y after A again: A→Y→X→B→C
    const ry = await jsonReq(`/specs/${a.id}/tasks`, 'POST', { title: 'Y', prev_id: chain.a.id });
    const y = (await ry.json()) as Task;
    const got = await getSpec(a.id);
    expect(got.tasks.map((t) => t.id)).toEqual([chain.a.id, y.id, x.id, chain.b.id, chain.c.id]);
    expect(got.tasks[1]?.prev_id).toBe(chain.a.id);
    expect(got.tasks[2]?.prev_id).toBe(y.id);
    expect(got.tasks[3]?.prev_id).toBe(x.id);
    expect(got.tasks[4]?.prev_id).toBe(chain.b.id);
  });

  it('inserted task carries title/body/status/timestamps and bumps successor.updated_at', async () => {
    const a = await newSpec({ title: 'A' });
    const t1 = await newTask(a.id, { title: 't1' });
    const t2 = await newTask(a.id, { title: 't2' });
    await tick();
    const r = await jsonReq(`/specs/${a.id}/tasks`, 'POST', {
      title: 'X',
      body: 'inserted',
      prev_id: t1.id,
    });
    expect(r.status).toBe(201);
    const x = (await r.json()) as Task;
    expect(x).toMatchObject({ title: 'X', body: 'inserted', status: 'todo', spec_id: a.id });
    expect(x.created_at).toBe(x.updated_at);
    // t2 was rewired to point at X, which means its row was updated and
    // updated_at must have advanced past its original creation time.
    const got = await getSpec(a.id);
    const t2After = got.tasks.find((t) => t.id === t2.id)!;
    expect(t2After.prev_id).toBe(x.id);
    expect(t2After.updated_at).toBeGreaterThan(t2.updated_at);
  });
});

// =============================================================================
// PATCH /tasks/:id
// =============================================================================

describe('PATCH /tasks/:id', () => {
  it('updates title', async () => {
    const a = await newSpec({ title: 'A' });
    const t = await newTask(a.id, { title: 't' });
    const r = await jsonReq(`/tasks/${t.id}`, 'PATCH', { title: 'T2' });
    expect(r.status).toBe(200);
    expect((await r.json()).title).toBe('T2');
  });

  it('updates body', async () => {
    const a = await newSpec({ title: 'A' });
    const t = await newTask(a.id, { title: 't' });
    const r = await jsonReq(`/tasks/${t.id}`, 'PATCH', { body: 'B' });
    expect(r.status).toBe(200);
    expect((await r.json()).body).toBe('B');
  });

  for (const status of ['todo', 'doing', 'done', 'blocked']) {
    it(`accepts task status=${status}`, async () => {
      const a = await newSpec({ title: 'A' });
      const t = await newTask(a.id, { title: 't' });
      const r = await jsonReq(`/tasks/${t.id}`, 'PATCH', { status });
      expect(r.status).toBe(200);
      expect((await r.json()).status).toBe(status);
    });
  }

  for (const status of ['draft', 'active', 'unknown', '']) {
    it(`rejects spec-only, removed, or invalid status=${JSON.stringify(status)}`, async () => {
      const a = await newSpec({ title: 'A' });
      const t = await newTask(a.id, { title: 't' });
      const r = await jsonReq(`/tasks/${t.id}`, 'PATCH', { status });
      expect(r.status).toBe(400);
    });
  }

  it('rejects empty patch body', async () => {
    const a = await newSpec({ title: 'A' });
    const t = await newTask(a.id, { title: 't' });
    const r = await jsonReq(`/tasks/${t.id}`, 'PATCH', {});
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('no fields to update');
  });

  it('rejects empty title', async () => {
    const a = await newSpec({ title: 'A' });
    const t = await newTask(a.id, { title: 't' });
    const r = await jsonReq(`/tasks/${t.id}`, 'PATCH', { title: '' });
    expect(r.status).toBe(400);
  });

  it('rejects title at length 201, accepts 200', async () => {
    const a = await newSpec({ title: 'A' });
    const t = await newTask(a.id, { title: 't' });
    const ok = await jsonReq(`/tasks/${t.id}`, 'PATCH', { title: 'x'.repeat(200) });
    expect(ok.status).toBe(200);
    const bad = await jsonReq(`/tasks/${t.id}`, 'PATCH', { title: 'x'.repeat(201) });
    expect(bad.status).toBe(400);
  });

  it('rejects body at length 65537', async () => {
    const a = await newSpec({ title: 'A' });
    const t = await newTask(a.id, { title: 't' });
    const r = await jsonReq(`/tasks/${t.id}`, 'PATCH', { body: 'a'.repeat(65537) });
    expect(r.status).toBe(400);
  });

  it('bumps updated_at; preserves created_at, prev_id, spec_id', async () => {
    const a = await newSpec({ title: 'A' });
    const t1 = await newTask(a.id, { title: 't1' });
    const t2 = await newTask(a.id, { title: 't2' });
    expect(t2.prev_id).toBe(t1.id);
    await tick();
    const r = await jsonReq(`/tasks/${t2.id}`, 'PATCH', { title: 'T2' });
    const after = await r.json();
    expect(after.created_at).toBe(t2.created_at);
    expect(after.updated_at).toBeGreaterThan(t2.updated_at);
    expect(after.prev_id).toBe(t1.id);
    expect(after.spec_id).toBe(a.id);
  });

  it('returns 404 for non-existent id', async () => {
    const r = await jsonReq(`/tasks/${FAKE_ID}`, 'PATCH', { title: 't' });
    expect(r.status).toBe(404);
  });

  it('rejects malformed JSON', async () => {
    const a = await newSpec({ title: 'A' });
    const t = await newTask(a.id, { title: 't' });
    const r = await authed(`/tasks/${t.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{x',
    });
    expect(r.status).toBe(400);
  });
});

// =============================================================================
// DELETE /tasks/:id — 3-node chain TA→TB→TC, every position
// =============================================================================

describe('DELETE /tasks/:id (3-node chain TA→TB→TC)', () => {
  let spec: Spec;
  let chain: { a: Task; b: Task; c: Task };

  beforeEach(async () => {
    spec = await newSpec({ title: 'S' });
    chain = await buildTaskChain(spec.id);
  });

  it('delete head TA: TB becomes head, TC still after TB', async () => {
    const r = await authed(`/tasks/${chain.a.id}`, { method: 'DELETE' });
    expect(r.status).toBe(204);
    const got = await getSpec(spec.id);
    expect(got.tasks.map((t) => t.id)).toEqual([chain.b.id, chain.c.id]);
    expect(got.tasks[0]?.prev_id).toBe(null);
    expect(got.tasks[1]?.prev_id).toBe(chain.b.id);
  });

  it('delete middle TB: TC.prev_id rewires to TA', async () => {
    const r = await authed(`/tasks/${chain.b.id}`, { method: 'DELETE' });
    expect(r.status).toBe(204);
    const got = await getSpec(spec.id);
    expect(got.tasks.map((t) => t.id)).toEqual([chain.a.id, chain.c.id]);
    expect(got.tasks[1]?.prev_id).toBe(chain.a.id);
  });

  it('delete tail TC: TA→TB remains intact', async () => {
    const r = await authed(`/tasks/${chain.c.id}`, { method: 'DELETE' });
    expect(r.status).toBe(204);
    const got = await getSpec(spec.id);
    expect(got.tasks.map((t) => t.id)).toEqual([chain.a.id, chain.b.id]);
    expect(got.tasks[1]?.prev_id).toBe(chain.a.id);
  });

  it('delete TA then TB: TC left as standalone head', async () => {
    expect((await authed(`/tasks/${chain.a.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await authed(`/tasks/${chain.b.id}`, { method: 'DELETE' })).status).toBe(204);
    const got = await getSpec(spec.id);
    expect(got.tasks).toHaveLength(1);
    expect(got.tasks[0]?.id).toBe(chain.c.id);
    expect(got.tasks[0]?.prev_id).toBe(null);
  });

  it('delete TC then TB: TA left as standalone head', async () => {
    expect((await authed(`/tasks/${chain.c.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await authed(`/tasks/${chain.b.id}`, { method: 'DELETE' })).status).toBe(204);
    const got = await getSpec(spec.id);
    expect(got.tasks).toHaveLength(1);
    expect(got.tasks[0]?.id).toBe(chain.a.id);
    expect(got.tasks[0]?.prev_id).toBe(null);
  });

  it('delete TB then TA: TC left as standalone head', async () => {
    expect((await authed(`/tasks/${chain.b.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await authed(`/tasks/${chain.a.id}`, { method: 'DELETE' })).status).toBe(204);
    const got = await getSpec(spec.id);
    expect(got.tasks).toHaveLength(1);
    expect(got.tasks[0]?.id).toBe(chain.c.id);
    expect(got.tasks[0]?.prev_id).toBe(null);
  });

  it('delete all three in original order: zero tasks', async () => {
    for (const t of [chain.a, chain.b, chain.c]) {
      const r = await authed(`/tasks/${t.id}`, { method: 'DELETE' });
      expect(r.status).toBe(204);
    }
    expect(await rowCount('tasks')).toBe(0);
  });

  it('delete all three reverse order: zero tasks', async () => {
    for (const t of [chain.c, chain.b, chain.a]) {
      const r = await authed(`/tasks/${t.id}`, { method: 'DELETE' });
      expect(r.status).toBe(204);
    }
    expect(await rowCount('tasks')).toBe(0);
  });

  it('does not affect tasks of another spec', async () => {
    const other = await newSpec({ title: 'OTHER' });
    const ot = await newTask(other.id, { title: 'OT' });
    const r = await authed(`/tasks/${chain.b.id}`, { method: 'DELETE' });
    expect(r.status).toBe(204);
    const otherSpec = await getSpec(other.id);
    expect(otherSpec.tasks.map((t) => t.id)).toEqual([ot.id]);
    expect(otherSpec.tasks[0]?.prev_id).toBe(null);
  });

  it('returns 404 for non-existent id', async () => {
    const r = await authed(`/tasks/${FAKE_ID}`, { method: 'DELETE' });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('task not found');
  });

  it('double-delete returns 404 the second time', async () => {
    expect((await authed(`/tasks/${chain.b.id}`, { method: 'DELETE' })).status).toBe(204);
    const r = await authed(`/tasks/${chain.b.id}`, { method: 'DELETE' });
    expect(r.status).toBe(404);
  });
});

// =============================================================================
// Integrated 3 specs × 3 tasks each — the canonical "three nodes everywhere"
// shape exercised end-to-end through CRUD.
// =============================================================================

describe('integrated 3-spec × 3-task scenario', () => {
  it('builds, reads ordered structure', async () => {
    const a = await newSpec({ title: 'A' });
    await tick();
    const b = await newSpec({ title: 'B', prev_id: a.id });
    await tick();
    const c = await newSpec({ title: 'C', prev_id: b.id });
    const ta = await buildTaskChain(a.id);
    const tb = await buildTaskChain(b.id);
    const tc = await buildTaskChain(c.id);

    expect(await rowCount('specs')).toBe(3);
    expect(await rowCount('tasks')).toBe(9);

    const list = await listSpecs();
    expect(list.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    expect(list[0]?.tasks.map((t) => t.id)).toEqual([ta.a.id, ta.b.id, ta.c.id]);
    expect(list[1]?.tasks.map((t) => t.id)).toEqual([tb.a.id, tb.b.id, tb.c.id]);
    expect(list[2]?.tasks.map((t) => t.id)).toEqual([tc.a.id, tc.b.id, tc.c.id]);
  });

  it('deleting middle spec B: B tasks cascade-deleted, A→C link, A & C tasks intact', async () => {
    const a = await newSpec({ title: 'A' });
    await tick();
    const b = await newSpec({ title: 'B', prev_id: a.id });
    await tick();
    const c = await newSpec({ title: 'C', prev_id: b.id });
    const ta = await buildTaskChain(a.id);
    await buildTaskChain(b.id);
    const tc = await buildTaskChain(c.id);

    expect((await authed(`/specs/${b.id}`, { method: 'DELETE' })).status).toBe(204);

    expect(await rowCount('tasks')).toBe(6);
    const list = await listSpecs();
    expect(list.map((s) => s.id)).toEqual([a.id, c.id]);
    expect(list[1]?.prev_id).toBe(a.id);
    expect(list[0]?.tasks.map((t) => t.id)).toEqual([ta.a.id, ta.b.id, ta.c.id]);
    expect(list[1]?.tasks.map((t) => t.id)).toEqual([tc.a.id, tc.b.id, tc.c.id]);
  });

  it('mixed CRUD walk: status patches across spec/task, mid-chain delete, then drop a spec', async () => {
    const a = await newSpec({ title: 'A' });
    await tick();
    const b = await newSpec({ title: 'B', prev_id: a.id });
    await tick();
    const c = await newSpec({ title: 'C', prev_id: b.id });
    const ta = await buildTaskChain(a.id);
    const tb = await buildTaskChain(b.id);

    expect((await jsonReq(`/specs/${b.id}`, 'PATCH', { status: 'active' })).status).toBe(200);
    expect((await jsonReq(`/specs/${c.id}`, 'PATCH', { status: 'done' })).status).toBe(200);
    expect((await jsonReq(`/tasks/${tb.b.id}`, 'PATCH', { status: 'doing' })).status).toBe(200);
    expect((await jsonReq(`/tasks/${ta.b.id}`, 'PATCH', { body: 'updated' })).status).toBe(200);

    // delete middle task in A's chain → ta.c rewires to ta.a
    expect((await authed(`/tasks/${ta.b.id}`, { method: 'DELETE' })).status).toBe(204);
    const aAfter = await getSpec(a.id);
    expect(aAfter.tasks.map((t) => t.id)).toEqual([ta.a.id, ta.c.id]);
    expect(aAfter.tasks[1]?.prev_id).toBe(ta.a.id);

    // delete middle spec B (with all its tasks) → C rewires to A
    expect((await authed(`/specs/${b.id}`, { method: 'DELETE' })).status).toBe(204);
    const list = await listSpecs();
    expect(list.map((s) => s.id)).toEqual([a.id, c.id]);
    expect(list[1]?.prev_id).toBe(a.id);
    expect(list[1]?.status).toBe('done');
    expect(await rowCount('tasks')).toBe(2); // ta.a, ta.c
  });

  it('after a 3-spec chain delete sweep, specs and tasks both empty', async () => {
    const a = await newSpec({ title: 'A' });
    await tick();
    const b = await newSpec({ title: 'B', prev_id: a.id });
    await tick();
    const c = await newSpec({ title: 'C', prev_id: b.id });
    await buildTaskChain(a.id);
    await buildTaskChain(b.id);
    await buildTaskChain(c.id);

    for (const id of [a.id, b.id, c.id]) {
      const r = await authed(`/specs/${id}`, { method: 'DELETE' });
      expect(r.status).toBe(204);
    }
    expect(await rowCount('specs')).toBe(0);
    expect(await rowCount('tasks')).toBe(0);
    // Project itself is not auto-removed when its specs are gone — explicit
    // DELETE /projects/:name is the only way to drop it.
    expect(await rowCount('projects')).toBe(1);
  });
});

// =============================================================================
// Schema-level constraints — verify D1 actually enforces what index.ts trusts.
// If any of these fail, the application's race handling is wishful thinking.
// =============================================================================

describe('schema constraints (direct DB)', () => {
  it('uq_specs_succ rejects two specs sharing same prev_id', async () => {
    const a = await newSpec({ title: 'A' });
    await newSpec({ title: 'B', prev_id: a.id });
    await expect(
      env.DB
        .prepare(
          'INSERT INTO specs (id, project_id, title, body, status, prev_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind('TESTDIRECTSPEC0000000000000', PROJECT, 'X', '', 'active', a.id, Date.now(), Date.now())
        .run(),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('partial-NULL prev_ids: multiple standalone specs allowed', async () => {
    await newSpec({ title: 'A' });
    await newSpec({ title: 'B' });
    await newSpec({ title: 'C' });
    expect(await rowCount('specs')).toBe(3);
  });

  it('uq_tasks_chain rejects two tasks with same (spec_id, prev_id=NULL)', async () => {
    const s = await newSpec({ title: 'A' });
    await newTask(s.id, { title: 't1' });
    await expect(
      env.DB
        .prepare(
          'INSERT INTO tasks (id, spec_id, title, body, status, prev_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind('TESTDIRECTTASK0000000000000', s.id, 't1-fork', '', 'todo', null, Date.now(), Date.now())
        .run(),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('uq_tasks_chain rejects two tasks pointing at same predecessor', async () => {
    const s = await newSpec({ title: 'A' });
    const t1 = await newTask(s.id, { title: 't1' });
    await newTask(s.id, { title: 't2' });
    await expect(
      env.DB
        .prepare(
          'INSERT INTO tasks (id, spec_id, title, body, status, prev_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind('TESTDIRECTTASK0000000000001', s.id, 't2-fork', '', 'todo', t1.id, Date.now(), Date.now())
        .run(),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('uq_tasks_chain allows same prev_id across different specs', async () => {
    const s1 = await newSpec({ title: 'S1' });
    const s2 = await newSpec({ title: 'S2' });
    // Both have a head task with prev_id=null, different spec_id → distinct
    // (spec_id, COALESCE(prev_id, 'HEAD')) keys.
    await newTask(s1.id, { title: 'h1' });
    await newTask(s2.id, { title: 'h2' });
    expect(await rowCount('tasks')).toBe(2);
  });

  it('FK CASCADE: deleting spec deletes its tasks (direct DB)', async () => {
    const s = await newSpec({ title: 'A' });
    await newTask(s.id, { title: 't1' });
    await newTask(s.id, { title: 't2' });
    await env.DB.prepare('DELETE FROM specs WHERE id = ?').bind(s.id).run();
    expect(await rowCount('tasks')).toBe(0);
  });

  it('FK SET NULL: deleting predecessor sets successor.prev_id=null', async () => {
    const a = await newSpec({ title: 'A' });
    const b = await newSpec({ title: 'B', prev_id: a.id });
    await env.DB.prepare('DELETE FROM specs WHERE id = ?').bind(a.id).run();
    const after = await env.DB
      .prepare('SELECT prev_id FROM specs WHERE id = ?')
      .bind(b.id)
      .first<{ prev_id: string | null }>();
    expect(after?.prev_id).toBe(null);
  });

  it('FK CASCADE: deleting project deletes its specs and tasks (direct DB)', async () => {
    const s = await newSpec({ title: 'A' }, 'doomed');
    await newTask(s.id, { title: 't' });
    await newSpec({ title: 'kept' }, 'survivor');
    await env.DB.prepare('DELETE FROM projects WHERE name = ?').bind('doomed').run();
    expect(await rowCount('specs')).toBe(1);
    expect(await rowCount('tasks')).toBe(0);
    expect(await rowCount('projects')).toBe(1);
  });
});

// =============================================================================
// orderTaskChain orphan handling — exercise the cycle path.
// =============================================================================

describe('orderTaskChain orphan handling', () => {
  it('returns both nodes of a 2-cycle as orphans (after empty well-formed chain)', async () => {
    const s = await newSpec({ title: 'S' });
    const t1 = await newTask(s.id, { title: 't1' });
    const t2 = await newTask(s.id, { title: 't2' });

    // Force cycle: t1.prev = t2 (and t2.prev still = t1). tasks.prev_id has no
    // FK, so SQLite accepts. uq_tasks_chain key for t1 changes from
    // (spec, 'HEAD') to (spec, t2) and stays unique with t2's (spec, t1).
    await env.DB
      .prepare('UPDATE tasks SET prev_id = ? WHERE id = ?')
      .bind(t2.id, t1.id)
      .run();

    const got = await getSpec(s.id);
    expect(got.tasks).toHaveLength(2);
    const ids = got.tasks.map((t) => t.id).sort();
    expect(ids).toEqual([t1.id, t2.id].sort());
  });

  it('treats dangling prev_id (points outside row set) as head', async () => {
    const s = await newSpec({ title: 'S' });
    const t = await newTask(s.id, { title: 't' });
    // tasks.prev_id has no FK, so we can dangle it.
    await env.DB
      .prepare('UPDATE tasks SET prev_id = ? WHERE id = ?')
      .bind('DANGLING0000000000000000000', t.id)
      .run();
    const got = await getSpec(s.id);
    expect(got.tasks).toHaveLength(1);
    expect(got.tasks[0]?.id).toBe(t.id);
  });
});
