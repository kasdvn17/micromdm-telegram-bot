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
  };
  enabled: boolean;
}

export interface SchedulerState {
  schedules: FocusSchedule[];
}

export interface MarkLostState {
  active: boolean;
  startedAt?: string;
}
