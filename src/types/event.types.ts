export type AppEvent =
  | { type: "device.enrolled"; deviceUUID: string }
  | { type: "device.checkin"; deviceUUID: string; requestType: string }
  | { type: "device.online" }
  | { type: "device.offline" }
  | { type: "profile.installed"; identifier: string }
  | { type: "profile.removed"; identifier: string }
  | { type: "focus.enabled"; durationMs?: number }
  | { type: "focus.disabled" }
  | { type: "safe.enabled" }
  | { type: "safe.disabled" }
  | { type: "marklost.enabled" }
  | { type: "marklost.disabled" }
  | {
      type: "marklost.location";
      lat: number;
      lng: number;
      timestamp: string;
    }
  | { type: "marklost.heartbeat"; online: boolean }
  | { type: "lostmode.enabled" }
  | { type: "lostmode.disabled" }
  | { type: "playsound.requested" }
  | { type: "activationlock.result"; success: boolean; reason?: string }
  | { type: "mdm.command.queued"; command: string; commandUUID: string }
  | { type: "mdm.command.acked"; command: string; commandUUID: string }
  | { type: "mdm.command.succeeded"; command: string; commandUUID: string }
  | {
      type: "mdm.command.failed";
      command: string;
      commandUUID: string;
      error: string;
    }
  | { type: "scheduler.started"; scheduleId: string }
  | { type: "scheduler.stopped"; scheduleId: string }
  | { type: "error"; source: string; message: string }
  /** Heartbeat routine (vd TokenUpdate không kèm thay đổi trạng thái) - bị lọc khỏi notify mặc định */
  | { type: "heartbeat" }
  /** Emergency command bất kỳ được thực thi - dùng để log + notify tài khoản chính */
  | {
      type: "emergency.command.executed";
      command: string;
      telegramUsername?: string;
      telegramId: number;
    }
  /** Lệnh /api được thực thi qua whitelist two-factor */
  | {
      type: "api.command.executed";
      commandName: string;
      telegramUsername: string;
      telegramId: number;
      confirmed: boolean;
    };

export type AppEventType = AppEvent["type"];
