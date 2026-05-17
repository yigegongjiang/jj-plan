export const SPEC_STATUSES = ['active', 'done'] as const;
export const TASK_STATUSES = ['todo', 'doing', 'done', 'blocked'] as const;

export type SpecStatus = (typeof SPEC_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const MAX_TITLE_LEN = 200;
export const MAX_BODY_LEN = 65536;
export const MAX_PROJECT_NAME_LEN = 128;

export interface Task {
  id: string;
  spec_id: string;
  title: string;
  body: string;
  status: TaskStatus;
  prev_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface Spec {
  id: string;
  project_id: string;
  title: string;
  body: string;
  status: SpecStatus;
  prev_id: string | null;
  created_at: number;
  updated_at: number;
  tasks: Task[];
}

export interface Project {
  name: string;
  created_at: number;
  updated_at: number;
  specs: Spec[];
  asks_count: number;
}

export const ASK_LIMIT_DEFAULT = 3;
export const ASK_LIMIT_MAX = 100;

export interface Ask {
  id: string;
  project_id: string;
  body: string;
  origin: string;
  created_at: number;
  updated_at: number;
}
