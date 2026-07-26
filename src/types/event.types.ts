export type AppEvent =
  | { type: "device.enrolled"; deviceUUID: string }
  | {
      type: "device.checkin";
      deviceUUID: string;
      requestType: string;
      /** Raw payload (plist) đã DECODE - đính kèm để gửi kèm Telegram cho các
       *  check-in KHÔNG bị coi là heartbeat (xem device.heartbeat bên dưới). */
      details?: Record<string, unknown>;
    }
  /**
   * Check-in lặp lại KHÔNG có gì thay đổi so với lần gần nhất (so khớp hash của
   * raw_payload đã decode - xem enrollment/checkinDedup.ts) - vd TokenUpdate
   * định kỳ chỉ để làm mới push token, không mang thông tin mới. Bị lọc khỏi
   * notify Telegram mặc định (xem events/notifyBridge.ts) nhưng vẫn được ghi
   * đầy đủ vào history.json như mọi event khác.
   */
  | { type: "device.heartbeat"; deviceUUID: string; requestType: string }
  | { type: "device.online" }
  | { type: "device.offline"; details?: Record<string, unknown> }
  | { type: "profile.installed"; identifier: string }
  | { type: "profile.removed"; identifier: string }
  | { type: "focus.enabled"; durationMs?: number }
  | { type: "focus.disabled" }
  | { type: "focus.break.started"; durationMs: number }
  | { type: "focus.schedule.skipped"; scheduleId: string }
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
