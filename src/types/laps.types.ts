export interface LapsHistoryEntry {
  timestamp: string;
  action: string;
  details?: string;
}

export interface LapsPendingAction {
  id: string;
  type: "rotate_now" | "demote" | "elevate" | "exec";
  payload?: {
    username?: string;
    durationMinutes?: number;
    command?: string;
  };
  createdAt: string;
}

export interface AgentFocusState {
  active: boolean;
  websites: string[];
}

export interface LapsState {
  adminUser: string;
  currentPassword?: string;
  lastRotatedAt?: string;
  lastCheckinAt?: string;
  serialNumber?: string;
  hostname?: string;
  ipAddress?: string;
  isBlamm01Admin?: boolean;
  demotedAt?: string;
  pendingAction?: LapsPendingAction | null;
  focusState?: AgentFocusState;
  history?: LapsHistoryEntry[];
}

export interface AgentCheckinPayload {
  serial: string;
  hostname: string;
  ip?: string;
  adminUser: string;
  isTargetAdmin: boolean;
  targetUser: string;
  agentVersion: string;
  uptimeSeconds?: number;
}

export interface AgentCheckinResponse {
  ok: boolean;
  action?: LapsPendingAction | null;
  serverTime: string;
  focus?: AgentFocusState;
}

export interface AgentReportPayload {
  actionId?: string;
  type: "rotate_result" | "demote_result" | "elevate_result" | "exec_result" | "periodic_rotate" | "initial_password";
  success: boolean;
  newPassword?: string;
  output?: string;
  error?: string;
}
