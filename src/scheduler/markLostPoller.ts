export interface MarkLostPollerApi {
  start(intervalMs: number, onTick: () => Promise<void>): void;
  stop(): void;
  isRunning(): boolean;
}

/**
 * Poller đơn giản chạy `onTick` mỗi `intervalMs` khi /mark lost đang bật.
 * `intervalMs` được validate < 2 phút ở tầng config/constants.ts trước khi
 * truyền vào đây, poller này không tự giới hạn lại (single source of truth).
 */
export function createMarkLostPoller(): MarkLostPollerApi {
  let handle: NodeJS.Timeout | null = null;

  return {
    start(intervalMs: number, onTick: () => Promise<void>): void {
      if (handle) return; // đã chạy rồi, tránh double-start
      handle = setInterval(() => {
        void onTick();
      }, intervalMs);
      void onTick(); // chạy ngay lần đầu khi bật, không chờ hết interval đầu tiên
    },
    stop(): void {
      if (handle) {
        clearInterval(handle);
        handle = null;
      }
    },
    isRunning(): boolean {
      return handle !== null;
    },
  };
}
