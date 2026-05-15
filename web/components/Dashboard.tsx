'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '@/lib/api';
import {
  ASK_LIMIT_MAX,
  SPEC_STATUSES,
  TASK_STATUSES,
  type Ask,
  type Project,
  type Spec,
  type SpecStatus,
  type Task,
  type TaskStatus,
} from '@/lib/types';
import AskEditDialog from './AskEditDialog';
import AsksView from './AsksView';
import ConfirmDialog from './ConfirmDialog';
import EditDialog, { type EditDraft } from './EditDialog';
import ProjectsList from './ProjectsList';
import SpecDetail from './SpecDetail';
import ProjectTabs from './ProjectTabs';
import SpecsView from './SpecsView';

const STORAGE_KEY = 'jjplan_token';

type EditTarget =
  | { kind: 'spec'; spec: Spec }
  | { kind: 'task'; task: Task }
  | { kind: 'ask'; ask: Ask };

type DeleteTarget =
  | { kind: 'project'; name: string; specCount: number; taskCount: number }
  | { kind: 'spec'; id: string; title: string; taskCount: number }
  | { kind: 'task'; id: string; title: string }
  | { kind: 'ask'; id: string };

interface RouteHome {
  kind: 'home';
}
interface RouteProject {
  kind: 'project';
  project: string;
}
interface RouteSpec {
  kind: 'spec';
  project: string;
  specId: string;
}
type Route = RouteHome | RouteProject | RouteSpec;

function readRoute(): Route {
  if (typeof window === 'undefined') return { kind: 'home' };
  const params = new URLSearchParams(window.location.search);
  const p = params.get('p');
  const s = params.get('s');
  if (p && s) return { kind: 'spec', project: p, specId: s };
  if (p) return { kind: 'project', project: p };
  return { kind: 'home' };
}

function routeToUrl(route: Route): string {
  if (route.kind === 'home') return './';
  const params = new URLSearchParams();
  params.set('p', route.project);
  if (route.kind === 'spec') params.set('s', route.specId);
  return `./?${params.toString()}`;
}

export default function Dashboard() {
  const [token, setToken] = useState<string>('');
  const [draftToken, setDraftToken] = useState<string>('');
  const [hydrated, setHydrated] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [del, setDel] = useState<DeleteTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [route, setRoute] = useState<Route>({ kind: 'home' });
  // Asks lazy-loaded per active project; reset on navigation to avoid stale flashes.
  const [asks, setAsks] = useState<Ask[] | null>(null);
  const [asksProject, setAsksProject] = useState<string | null>(null);

  // Hydrate from localStorage + URL once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setToken(saved);
    setRoute(readRoute());
    setHydrated(true);
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next: Route) => {
    setRoute(next);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', routeToUrl(next));
    }
  }, []);

  // 401 falls back to login screen so a stale token isn't used silently.
  // Also wipes asks cache so a re-login under the same URL refetches instead
  // of showing the previous session's data until the next 5s tick.
  const fallbackToLogin = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setToken('');
    setDraftToken('');
    setProjects(null);
    setEdit(null);
    setDel(null);
    setAsks(null);
    setAsksProject(null);
  }, []);

  // silent=true: background auto-refresh path. Skip the loading/error UI so a
  // 5s tick does not flash spinners or red banners on transient hiccups, but
  // still react to 401 (stale token must kick the user back to login).
  const load = useCallback(
    async (t: string, silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const data = await api.listProjects(t);
        setProjects(data);
        window.localStorage.setItem(STORAGE_KEY, t);
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 401) {
          setLoginError('密码错误');
          fallbackToLogin();
        } else if (silent) {
          console.warn('[auto-refresh]', err);
        } else {
          setError(err.message);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [fallbackToLogin],
  );

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  // Silent fetch; routes share the projects-list 5s tick.
  const loadAsks = useCallback(
    async (t: string, project: string) => {
      try {
        const data = await api.listAsks(t, project, ASK_LIMIT_MAX);
        setAsks(data);
        setAsksProject(project);
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 401) {
          fallbackToLogin();
        } else if (err.status === 404) {
          setAsks([]);
          setAsksProject(project);
        } else {
          console.warn('[asks-load]', err);
        }
      }
    },
    [fallbackToLogin],
  );

  // asksProject gate prevents refetch when bouncing project ↔ spec routes.
  useEffect(() => {
    if (!token) return;
    if (route.kind === 'home') {
      setAsks(null);
      setAsksProject(null);
      return;
    }
    const project = route.project;
    if (asksProject !== project) {
      setAsks(null);
      void loadAsks(token, project);
    }
  }, [token, route, asksProject, loadAsks]);

  // Auto-refresh every 5s while logged in so AI-side CLI changes show up
  // without a manual reload. Skips ticks when the tab is hidden, then fires
  // immediately on visibilitychange→visible so a returning user sees fresh
  // data without waiting for the next interval.
  useEffect(() => {
    if (!token) return;
    if (typeof document === 'undefined') return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      void load(token, true);
      if (route.kind !== 'home') {
        void loadAsks(token, route.project);
      }
    };
    const intervalId = window.setInterval(tick, 5000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [token, load, route, loadAsks]);

  function login() {
    setLoginError(null);
    const t = draftToken.trim();
    if (!t) {
      setLoginError('请输入密码');
      return;
    }
    setToken(t);
  }

  // 当前路由对应的 project / spec 对象;若数据中已不存在,后面的渲染逻辑回退上一级
  const activeProject = useMemo(() => {
    if (!projects) return null;
    if (route.kind === 'home') return null;
    return projects.find((p) => p.name === route.project) ?? null;
  }, [projects, route]);

  const activeSpec = useMemo(() => {
    if (!activeProject || route.kind !== 'spec') return null;
    return activeProject.specs.find((s) => s.id === route.specId) ?? null;
  }, [activeProject, route]);

  // 路由指向的对象不存在时,自动回退上一级(避免空白页)
  useEffect(() => {
    if (!projects) return;
    if (route.kind === 'project' && !activeProject) {
      navigate({ kind: 'home' });
    } else if (route.kind === 'spec' && activeProject && !activeSpec) {
      navigate({ kind: 'project', project: activeProject.name });
    } else if (route.kind === 'spec' && !activeProject) {
      navigate({ kind: 'home' });
    }
  }, [projects, route, activeProject, activeSpec, navigate]);

  async function saveEdit(draft: EditDraft) {
    if (!edit) return;
    setBusy(true);
    setEditError(null);
    try {
      if (edit.kind === 'spec') {
        const patch: { title?: string; body?: string; status?: SpecStatus } = {};
        if (draft.title !== undefined) patch.title = draft.title;
        if (draft.body !== undefined) patch.body = draft.body;
        if (draft.status !== undefined) patch.status = draft.status as SpecStatus;
        const updated = await api.patchSpec(token, edit.spec.id, patch);
        setProjects((prev) =>
          prev === null
            ? prev
            : prev.map((p) => ({
                ...p,
                specs: p.specs.map((s) =>
                  s.id === updated.id ? { ...s, ...updated, tasks: s.tasks } : s,
                ),
              })),
        );
      } else if (edit.kind === 'task') {
        const patch: { title?: string; body?: string; status?: TaskStatus } = {};
        if (draft.title !== undefined) patch.title = draft.title;
        if (draft.body !== undefined) patch.body = draft.body;
        if (draft.status !== undefined) patch.status = draft.status as TaskStatus;
        const updated = await api.patchTask(token, edit.task.id, patch);
        setProjects((prev) =>
          prev === null
            ? prev
            : prev.map((p) => ({
                ...p,
                specs: p.specs.map((s) => ({
                  ...s,
                  tasks: s.tasks.map((t) =>
                    t.id === updated.id ? updated : t,
                  ),
                })),
              })),
        );
      }
      setEdit(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        fallbackToLogin();
      } else {
        setEditError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveAskEdit(newBody: string) {
    if (!edit || edit.kind !== 'ask') return;
    setBusy(true);
    setEditError(null);
    try {
      const updated = await api.patchAsk(token, edit.ask.id, { body: newBody });
      setAsks((prev) =>
        prev === null ? prev : prev.map((a) => (a.id === updated.id ? updated : a)),
      );
      setEdit(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        fallbackToLogin();
      } else {
        setEditError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!del) return;
    setBusy(true);
    setError(null);
    try {
      if (del.kind === 'project') {
        const name = del.name;
        await api.deleteProject(token, name);
        setProjects((prev) =>
          prev === null ? prev : prev.filter((p) => p.name !== name),
        );
      } else if (del.kind === 'spec') {
        const id = del.id;
        await api.deleteSpec(token, id);
        setProjects((prev) =>
          prev === null
            ? prev
            : prev.map((p) => ({
                ...p,
                specs: p.specs.filter((s) => s.id !== id),
              })),
        );
      } else if (del.kind === 'task') {
        const id = del.id;
        await api.deleteTask(token, id);
        setProjects((prev) =>
          prev === null
            ? prev
            : prev.map((p) => ({
                ...p,
                specs: p.specs.map((s) => ({
                  ...s,
                  tasks: s.tasks.filter((t) => t.id !== id),
                })),
              })),
        );
      } else {
        const id = del.id;
        await api.deleteAsk(token, id);
        setAsks((prev) => (prev === null ? prev : prev.filter((a) => a.id !== id)));
      }
      setDel(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        fallbackToLogin();
      } else {
        setError(err.message);
        setDel(null);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return null;

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-5xl font-black tracking-tight text-zinc-50">JJ</h1>
            <p className="mt-3 text-sm text-zinc-500">
              console · 输入密码以继续
            </p>
          </div>
          <div className="space-y-3">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draftToken}
              onChange={(e) => setDraftToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') login();
              }}
              placeholder="password"
              className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-800 focus:border-blue-500 focus:outline-none font-mono text-sm"
            />
            <button
              onClick={login}
              className="w-full py-2 rounded-md bg-blue-500 text-zinc-950 font-medium hover:bg-blue-400 transition"
            >
              continue
            </button>
            {loginError && (
              <div className="text-sm text-red-400 text-center">
                {loginError}
              </div>
            )}
          </div>
          <p className="mt-8 text-xs text-zinc-400 text-center leading-relaxed">
            创建 plan / task / ask 请使用 jjplan / jjask CLI;
            <br />
            此处仅查看与编辑。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 backdrop-blur bg-zinc-950/80 border-b border-zinc-800">
        <div className="px-4 h-14 flex items-center gap-3">
          <Breadcrumb route={route} activeSpecTitle={activeSpec?.title} onNavigate={navigate} />
          {loading && projects === null && (
            <span className="text-xs text-zinc-500 ml-auto">loading…</span>
          )}
        </div>
      </header>

      <main className="px-4 py-6 space-y-4">
        {error && (
          <div className="px-4 py-2.5 rounded-md border border-red-900 bg-red-950/40 text-red-300 text-sm flex items-start justify-between gap-4">
            <span className="break-all">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-300 shrink-0 leading-none"
              aria-label="dismiss"
            >
              ×
            </button>
          </div>
        )}

        {projects === null ? (
          <div className="text-center text-zinc-500 py-12 text-sm">
            loading…
          </div>
        ) : route.kind === 'home' ? (
          <ProjectsList
            projects={projects}
            onOpen={(name) => navigate({ kind: 'project', project: name })}
            onDelete={(p) => {
              const taskCount = p.specs.reduce(
                (n, s) => n + s.tasks.length,
                0,
              );
              setDel({
                kind: 'project',
                name: p.name,
                specCount: p.specs.length,
                taskCount,
              });
            }}
          />
        ) : route.kind === 'project' && activeProject ? (
          <ProjectTabs
            askCount={
              asksProject === activeProject.name ? (asks?.length ?? 0) : 0
            }
            specCount={activeProject.specs.length}
            taskCount={activeProject.specs.reduce(
              (n, s) => n + s.tasks.length,
              0,
            )}
            asks={
              <AsksView
                asks={asksProject === activeProject.name ? asks : null}
                onEdit={(ask) => {
                  setEditError(null);
                  setEdit({ kind: 'ask', ask });
                }}
                onDelete={(ask) => setDel({ kind: 'ask', id: ask.id })}
              />
            }
            plans={
              <SpecsView
                project={activeProject}
                onOpenSpec={(specId) =>
                  navigate({
                    kind: 'spec',
                    project: activeProject.name,
                    specId,
                  })
                }
                onEditSpec={(spec) => {
                  setEditError(null);
                  setEdit({ kind: 'spec', spec });
                }}
                onDeleteSpec={(spec) =>
                  setDel({
                    kind: 'spec',
                    id: spec.id,
                    title: spec.title,
                    taskCount: spec.tasks.length,
                  })
                }
              />
            }
          />
        ) : route.kind === 'spec' && activeSpec ? (
          <SpecDetail
            spec={activeSpec}
            onEditSpec={(spec) => {
              setEditError(null);
              setEdit({ kind: 'spec', spec });
            }}
            onDeleteSpec={(spec) =>
              setDel({
                kind: 'spec',
                id: spec.id,
                title: spec.title,
                taskCount: spec.tasks.length,
              })
            }
            onEditTask={(task) => {
              setEditError(null);
              setEdit({ kind: 'task', task });
            }}
            onDeleteTask={(task) =>
              setDel({ kind: 'task', id: task.id, title: task.title })
            }
          />
        ) : (
          <div className="text-center text-zinc-500 py-12 text-sm">…</div>
        )}
      </main>

      {edit && edit.kind === 'ask' && (
        <AskEditDialog
          ask={edit.ask}
          busy={busy}
          errorMessage={editError}
          onSave={saveAskEdit}
          onCancel={() => {
            if (!busy) {
              setEdit(null);
              setEditError(null);
            }
          }}
        />
      )}
      {edit && edit.kind !== 'ask' && (
        <EditDialog
          target={
            edit.kind === 'spec'
              ? {
                  kind: 'spec',
                  id: edit.spec.id,
                  title: edit.spec.title,
                  body: edit.spec.body,
                  status: edit.spec.status,
                  statuses: SPEC_STATUSES,
                }
              : {
                  kind: 'task',
                  id: edit.task.id,
                  title: edit.task.title,
                  body: edit.task.body,
                  status: edit.task.status,
                  statuses: TASK_STATUSES,
                }
          }
          busy={busy}
          errorMessage={editError}
          onSave={saveEdit}
          onCancel={() => {
            if (!busy) {
              setEdit(null);
              setEditError(null);
            }
          }}
        />
      )}

      {del && (
        <ConfirmDialog
          title={
            del.kind === 'project'
              ? `删除 project「${del.name}」?`
              : del.kind === 'spec'
                ? `删除 plan「${del.title}」?`
                : del.kind === 'task'
                  ? `删除 task「${del.title}」?`
                  : `删除 ask「${del.id}」?`
          }
          message={
            del.kind === 'project'
              ? `连同 ${del.specCount} 个 plan, ${del.taskCount} 个 task, 以及该项目下全部 ask 一并删除,无法恢复。`
              : del.kind === 'spec'
                ? `连同 ${del.taskCount} 个 task 一并删除,无法恢复。`
                : '此操作无法恢复。'
          }
          confirmLabel="删除"
          danger
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => {
            if (!busy) setDel(null);
          }}
        />
      )}
    </div>
  );
}

interface BreadcrumbProps {
  route: Route;
  activeSpecTitle?: string;
  onNavigate: (route: Route) => void;
}

function Breadcrumb({ route, activeSpecTitle, onNavigate }: BreadcrumbProps) {
  const segments: { label: string; route: Route | null }[] = [
    { label: 'JJ', route: { kind: 'home' } },
  ];
  if (route.kind !== 'home') {
    segments.push({
      label: route.project,
      route:
        route.kind === 'spec'
          ? { kind: 'project', project: route.project }
          : null,
    });
  }
  if (route.kind === 'spec') {
    segments.push({ label: activeSpecTitle ?? '…', route: null });
  }

  return (
    <nav className="flex items-center gap-1.5 text-sm min-w-0">
      {segments.map((seg, idx) => (
        <span key={idx} className="flex items-center gap-1.5 min-w-0">
          {idx > 0 && (
            <span className="text-zinc-500 select-none shrink-0">/</span>
          )}
          {seg.route ? (
            <button
              onClick={() => onNavigate(seg.route!)}
              className={
                idx === 0
                  ? 'font-black tracking-tight text-zinc-100 hover:text-white transition'
                  : 'text-zinc-400 hover:text-zinc-100 transition truncate'
              }
            >
              {seg.label}
            </button>
          ) : (
            <span
              className={
                idx === 0
                  ? 'font-black tracking-tight text-zinc-50'
                  : 'text-zinc-100 truncate'
              }
            >
              {seg.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
