import crypto from "crypto";
import {
  AgentCheckinPayload,
  AgentCheckinResponse,
  AgentReportPayload,
  LapsState,
} from "../types/laps.types";
import { readJsonState, writeJsonState } from "../utils/jsonStore";
import { getLogger } from "../utils/logger";
import { EventBus } from "../events/eventBus";

export interface LapsServiceApi {
  validateApiKey(apiKey: string): boolean;
  handleCheckin(apiKey: string, payload: AgentCheckinPayload): AgentCheckinResponse;
  handleReport(apiKey: string, payload: AgentReportPayload): { ok: boolean; message: string };
  requestRotateNow(): Promise<string>;
  requestDemote(username?: string): Promise<string>;
  requestElevate(username?: string, durationMinutes?: number): Promise<string>;
  requestExec(command: string): Promise<string>;
  cancelPendingAction(): Promise<boolean>;
  setFocusState(active: boolean, websites: string[]): void;
  getFocusState(): { active: boolean; websites: string[] };
  getStatus(): LapsState;
  getPassword(): { adminUser: string; password?: string; lastRotatedAt?: string };
}

const DEFAULT_LAPS_STATE: LapsState = {
  adminUser: "sysadmin",
  isBlamm01Admin: true,
  history: [],
};

export function createLapsService(
  stateFilePath: string,
  apiKey: string,
  bus: EventBus
): LapsServiceApi {
  const loadState = (): LapsState => {
    return readJsonState<LapsState>(stateFilePath, DEFAULT_LAPS_STATE);
  };

  const saveState = (state: LapsState): void => {
    writeJsonState(stateFilePath, state);
  };

  const addHistory = (state: LapsState, action: string, details?: string): void => {
    if (!state.history) state.history = [];
    state.history.unshift({
      timestamp: new Date().toISOString(),
      action,
      details,
    });
    // Giữ tối đa 50 lịch sử gần nhất
    if (state.history.length > 50) {
      state.history = state.history.slice(0, 50);
    }
  };

  return {
    validateApiKey(providedKey: string): boolean {
      if (!apiKey || !providedKey) return false;
      const bufA = Buffer.from(providedKey);
      const bufB = Buffer.from(apiKey);
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    },

    handleCheckin(providedKey: string, payload: AgentCheckinPayload): AgentCheckinResponse {
      if (!this.validateApiKey(providedKey)) {
        throw new Error("Unauthorized: Sai LAPS API key");
      }

      const state = loadState();
      state.lastCheckinAt = new Date().toISOString();
      state.serialNumber = payload.serial;
      state.hostname = payload.hostname;
      if (payload.ip) state.ipAddress = payload.ip;
      state.adminUser = payload.adminUser || state.adminUser;
      state.isBlamm01Admin = payload.isTargetAdmin;

      getLogger().info("[lapsService] Nhận checkin từ agent", {
        serial: payload.serial,
        hostname: payload.hostname,
        adminUser: payload.adminUser,
        isTargetAdmin: payload.isTargetAdmin,
      });

      // Lấy pending action (nếu có)
      const action = state.pendingAction ?? null;

      saveState(state);

      return {
        ok: true,
        action,
        serverTime: new Date().toISOString(),
        focus: state.focusState ?? {
          active: false,
          websites: [],
        },
      };
    },

    handleReport(providedKey: string, payload: AgentReportPayload): { ok: boolean; message: string } {
      if (!this.validateApiKey(providedKey)) {
        throw new Error("Unauthorized: Sai LAPS API key");
      }

      const state = loadState();
      const now = new Date().toISOString();

      getLogger().info("[lapsService] Nhận report từ agent", {
        type: payload.type,
        success: payload.success,
        error: payload.error,
      });

      if (payload.type === "rotate_result" || payload.type === "periodic_rotate" || payload.type === "initial_password") {
        if (payload.success && payload.newPassword) {
          state.currentPassword = payload.newPassword;
          state.lastRotatedAt = now;
          addHistory(state, "rotate_password", `Mật khẩu đã được cập nhật thành công (${payload.type})`);
          bus.publish({
            type: "device.checkin",
            deviceUUID: state.serialNumber ?? "local-mac",
            requestType: "LapsRotate",
            details: { message: `🔐 LAPS: Mật khẩu admin [${state.adminUser}] đã cập nhật lúc ${now}` },
          });
        } else {
          addHistory(state, "rotate_password_failed", payload.error ?? "Lỗi không xác định");
        }
      } else if (payload.type === "demote_result") {
        if (payload.success) {
          state.isBlamm01Admin = false;
          state.demotedAt = now;
          addHistory(state, "demote_user", "Tài khoản blamm01 đã được hạ xuống Standard User");
          bus.publish({
            type: "device.checkin",
            deviceUUID: state.serialNumber ?? "local-mac",
            requestType: "LapsDemote",
            details: { message: `👤 LAPS: Tài khoản blamm01 đã được hạ quyền xuống Standard User thành công.` },
          });
        } else {
          addHistory(state, "demote_failed", payload.error ?? "Lỗi không xác định");
        }
      } else if (payload.type === "elevate_result") {
        if (payload.success) {
          state.isBlamm01Admin = true;
          addHistory(state, "elevate_user", payload.output ?? "Đã cấp quyền admin tạm thời cho blamm01");
          bus.publish({
            type: "device.checkin",
            deviceUUID: state.serialNumber ?? "local-mac",
            requestType: "LapsElevate",
            details: { message: `⚡ LAPS: Tài khoản blamm01 đã được nâng cấp quyền admin tạm thời.` },
          });
        } else {
          addHistory(state, "elevate_failed", payload.error ?? "Lỗi không xác định");
        }
      } else if (payload.type === "exec_result") {
        addHistory(
          state,
          "exec_command",
          payload.success
            ? `Thành công: ${payload.output?.slice(0, 100)}`
            : `Thất bại: ${payload.error?.slice(0, 100)}`
        );
      }

      // Xoá pending action nếu khớp ID hoặc hoàn tất
      if (state.pendingAction && (!payload.actionId || state.pendingAction.id === payload.actionId)) {
        state.pendingAction = null;
      }

      saveState(state);
      return { ok: true, message: "Report đã được xử lý" };
    },

    async requestRotateNow(): Promise<string> {
      const state = loadState();
      state.pendingAction = {
        id: crypto.randomUUID(),
        type: "rotate_now",
        createdAt: new Date().toISOString(),
      };
      saveState(state);
      return `🔄 Đã lên lịch xoay mật khẩu ngay lập tức. Daemon sẽ thực hiện trong lần check-in tới.`;
    },

    async requestDemote(username = "blamm01"): Promise<string> {
      const state = loadState();
      state.pendingAction = {
        id: crypto.randomUUID(),
        type: "demote",
        payload: { username },
        createdAt: new Date().toISOString(),
      };
      saveState(state);
      return `👤 Đã đặt lệnh hạ quyền tài khoản [${username}] xuống Standard User ở lần check-in tới.`;
    },

    async requestElevate(username = "blamm01", durationMinutes = 30): Promise<string> {
      const state = loadState();
      state.pendingAction = {
        id: crypto.randomUUID(),
        type: "elevate",
        payload: { username, durationMinutes },
        createdAt: new Date().toISOString(),
      };
      saveState(state);
      return `⚡ Đã đặt lệnh cấp quyền Admin tạm thời cho [${username}] trong ${durationMinutes} phút.`;
    },

    async requestExec(command: string): Promise<string> {
      const state = loadState();
      state.pendingAction = {
        id: crypto.randomUUID(),
        type: "exec",
        payload: { command },
        createdAt: new Date().toISOString(),
      };
      saveState(state);
      return `💻 Đã gửi lệnh shell tới daemon: \`${command}\`. Chờ daemon thực thi.`;
    },

    async cancelPendingAction(): Promise<boolean> {
      const state = loadState();
      if (!state.pendingAction) return false;
      state.pendingAction = null;
      saveState(state);
      return true;
    },

    setFocusState(active: boolean, websites: string[]): void {
      const state = loadState();
      state.focusState = {
        active,
        websites: Array.isArray(websites) ? [...websites] : [],
      };
      saveState(state);
      getLogger().info("[lapsService] Đã cập nhật focusState cho agent", {
        active,
        websiteCount: state.focusState.websites.length,
      });
    },

    getFocusState(): { active: boolean; websites: string[] } {
      const state = loadState();
      return state.focusState ?? { active: false, websites: [] };
    },

    getStatus(): LapsState {
      return loadState();
    },

    getPassword(): { adminUser: string; password?: string; lastRotatedAt?: string } {
      const state = loadState();
      return {
        adminUser: state.adminUser,
        password: state.currentPassword,
        lastRotatedAt: state.lastRotatedAt,
      };
    },
  };
}
