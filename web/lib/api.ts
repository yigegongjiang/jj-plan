import type {
  Ask,
  Project,
  Spec,
  SpecStatus,
  Task,
  TaskStatus,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new ApiError(0, (e as Error).message || 'network error');
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const text = await res.text();
      if (text) {
        try {
          const parsed = JSON.parse(text) as { error?: unknown };
          message = typeof parsed.error === 'string' ? parsed.error : text;
        } catch {
          message = text;
        }
      }
    } catch {
      /* ignore body read errors */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export interface SpecPatch {
  title?: string;
  body?: string;
  status?: SpecStatus;
}

export interface TaskPatch {
  title?: string;
  body?: string;
  status?: TaskStatus;
}

export const api = {
  listProjects: (t: string) => request<Project[]>(t, 'GET', '/projects'),

  deleteProject: (t: string, name: string) =>
    request<null>(t, 'DELETE', `/projects/${encodeURIComponent(name)}`),

  renameProject: (t: string, oldName: string, newName: string) =>
    request<Project>(t, 'PATCH', `/projects/${encodeURIComponent(oldName)}`, {
      new_name: newName,
    }),

  patchSpec: (t: string, id: string, body: SpecPatch) =>
    request<Spec>(t, 'PATCH', `/specs/${encodeURIComponent(id)}`, body),

  deleteSpec: (t: string, id: string) =>
    request<null>(t, 'DELETE', `/specs/${encodeURIComponent(id)}`),

  patchTask: (t: string, id: string, body: TaskPatch) =>
    request<Task>(t, 'PATCH', `/tasks/${encodeURIComponent(id)}`, body),

  deleteTask: (t: string, id: string) =>
    request<null>(t, 'DELETE', `/tasks/${encodeURIComponent(id)}`),

  listAsks: (t: string, project: string, limit?: number) => {
    const q = limit !== undefined ? `?limit=${limit}` : '';
    return request<Ask[]>(t, 'GET', `/projects/${encodeURIComponent(project)}/asks${q}`);
  },

  patchAsk: (t: string, id: string, body: { body: string }) =>
    request<Ask>(t, 'PATCH', `/asks/${encodeURIComponent(id)}`, body),

  deleteAsk: (t: string, id: string) =>
    request<null>(t, 'DELETE', `/asks/${encodeURIComponent(id)}`),
};
