export type FocusScheduleType = "duration" | "recurring";

export interface FocusSchedule {
  id: string;
  type: FocusScheduleType;
  createdAt: string;
  /** Chỉ có khi type = "duration" */
  endAt?: string;
  /** Chỉ có khi type = "recurring" */
  recurring?: {
    daysOfWeek: number[]; // 0 = Chủ nhật ... 6 = Thứ bảy
    startTime: string; // "HH:mm", giờ local server
    endTime: string; // "HH:mm"
    /** "YYYY-MM-DD" - nếu trùng ngày hôm nay thì bỏ qua occurrence của ngày đó
     *  (đặt bởi /focus schedule skip). Tự hết hiệu lực khi sang ngày khác. */
    skippedDate?: string;
  };
  enabled: boolean;
}

export interface SchedulerState {
  schedules: FocusSchedule[];
  /** ISO timestamp - trong lúc breakUntil > now, Focus bị tạm ngưng dù đang
   *  trong khung giờ recurring active (đặt bởi /focus break <time>). Tự hết
   *  hiệu lực khi qua mốc thời gian này - scheduler tick sẽ tự bật lại Focus
   *  nếu vẫn còn đang trong khung giờ recurring. */
  breakUntil?: string;
  /** Số lần + tổng thời gian đã dùng /focus break TRONG NGÀY "date"
   *  ("YYYY-MM-DD"). Tự reset khi sang ngày khác (so sánh date !== hôm nay). */
  breakUsage?: {
    date: string;
    count: number;
    totalMs: number;
  };
  /** Tiến độ mở khóa Sleep Mode của phiên bắt đầu lúc 22:00 ngày sessionDate. */
  sleepUnlock?: {
    sessionDate: string;
    acceptedTaskCount: number;
    qualifiedAt?: string;
    disabledAt?: string;
  };
}

export interface SleepUnlockStatus {
  withinTimeRange: boolean;
  sessionDate?: string;
  sessionStartedAt?: string;
  acceptedTaskCount: number;
  requiredTaskCount: number;
  eligible: boolean;
  disabled: boolean;
}

export interface MarkLostState {
  active: boolean;
  startedAt?: string;
}
