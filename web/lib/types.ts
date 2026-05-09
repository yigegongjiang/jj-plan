export const SPEC_STATUSES = ['draft', 'active', 'done'] as const;
export const TASK_STATUSES = ['todo', 'doing', 'done', 'blocked'] as const;

export type SpecStatus = (typeof SPEC_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const MAX_TITLE_LEN = 200;
export const MAX_BODY_LEN = 65536;

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
}
