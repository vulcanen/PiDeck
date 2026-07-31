export type TaskState =
  | "idle"
  | "running"
  | "waiting-approval"
  | "compacting"
  | "retrying"
  | "completed"
  | "failed";

export interface ProjectSummary {
  id: string;
  cwd: string;
  name: string;
  taskCount: number;
}

export interface TaskSummary {
  id: string;
  title: string;
  projectId: string;
  state: TaskState;
  model: string;
  updatedAt: string;
  unread?: boolean;
}

export interface PiDeckEvent {
  type: "runtime.status" | "task.state" | "message.delta" | "approval.requested";
  taskId?: string;
  payload: unknown;
}
