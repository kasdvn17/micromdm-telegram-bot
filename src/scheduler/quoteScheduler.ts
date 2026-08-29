import { NotificationServiceApi } from "../services/notificationService";
import { getLogger } from "../utils/logger";

export interface FamousQuote {
  text: string;
  author: string;
}

export const FAMOUS_QUOTES: readonly FamousQuote[] = [
  { text: "Thiên tài là 1% cảm hứng và 99% mồ hôi.", author: "Thomas Edison" },
  { text: "Cuộc sống giống như đi xe đạp. Muốn giữ thăng bằng, bạn phải tiếp tục di chuyển.", author: "Albert Einstein" },
  { text: "Tôi không thất bại. Tôi chỉ tìm ra 10.000 cách không hiệu quả.", author: "Thomas Edison" },
  { text: "Điều duy nhất chúng ta phải sợ chính là nỗi sợ.", author: "Franklin D. Roosevelt" },
  { text: "Hành trình ngàn dặm bắt đầu từ một bước chân.", author: "Lão Tử" },
  { text: "Thành công không phải là cuối cùng, thất bại không phải là chí mạng; lòng can đảm đi tiếp mới là điều quan trọng.", author: "Winston Churchill" },
  { text: "Không quan trọng bạn đi chậm thế nào, miễn là bạn không dừng lại.", author: "Khổng Tử" },
  { text: "Cách tốt nhất để dự đoán tương lai là tạo ra nó.", author: "Peter Drucker" },
  { text: "Tri thức là sức mạnh.", author: "Francis Bacon" },
  { text: "Hãy sống như thể bạn sẽ chết ngày mai. Hãy học như thể bạn sẽ sống mãi mãi.", author: "Mahatma Gandhi" },
  { text: "Cơ hội thường bị bỏ lỡ vì nó mặc quần áo lao động và trông giống công việc.", author: "Thomas Edison" },
  { text: "Người chưa từng mắc lỗi là người chưa từng thử điều gì mới.", author: "Albert Einstein" },
];

export interface QuoteSchedulerApi {
  start(intervalMs: number): void;
  stop(): void;
  sendNext(): Promise<void>;
}

/** Gửi đúng một câu sau mỗi interval; không gửi ngay khi bot vừa khởi động. */
export function createQuoteScheduler(
  notificationService: NotificationServiceApi,
  quotes: readonly FamousQuote[] = FAMOUS_QUOTES
): QuoteSchedulerApi {
  if (quotes.length === 0) throw new Error("Quote scheduler cần ít nhất một câu quote.");

  let handle: NodeJS.Timeout | null = null;
  let nextIndex = Math.floor(Math.random() * quotes.length);
  let sending = false;

  const sendNext = async (): Promise<void> => {
    if (sending) {
      getLogger().warn("[quoteScheduler] Bỏ qua tick vì lần gửi trước chưa hoàn tất");
      return;
    }
    sending = true;
    try {
      const quote = quotes[nextIndex];
      nextIndex = (nextIndex + 1) % quotes.length;
      await notificationService.send(`💬 “${quote.text}”\n— ${quote.author}`);
    } finally {
      sending = false;
    }
  };

  return {
    start(intervalMs: number): void {
      if (handle) return;
      if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
        throw new Error("Quote interval phải là số dương.");
      }
      handle = setInterval(() => void sendNext(), intervalMs);
      getLogger().info("[quoteScheduler] Đã khởi động", { intervalMs });
    },
    stop(): void {
      if (!handle) return;
      clearInterval(handle);
      handle = null;
    },
    sendNext,
  };
}
