import { readJsonState, writeJsonState } from "../utils/jsonStore";
import { stableHash } from "../utils/hash";

interface CheckinDedupState {
  [udid: string]: string; // hash của raw_payload (đã decode) lần gần nhất thấy
}

/**
 * So khớp raw_payload (đã decode plist -> object) của lần check-in HIỆN TẠI với
 * lần gần nhất đã ghi nhận cho cùng UDID. Dùng cho mdm.TokenUpdate - loại
 * check-in xảy ra thường xuyên nhất (mỗi lần app re-register push token) mà
 * đa số các lần lặp lại không mang thông tin gì mới ("heartbeat").
 *
 * Luôn ghi lại hash MỚI bất kể kết quả so sánh, để lần check-in kế tiếp so
 * đúng với lần này.
 */
export function isRepeatCheckin(
  filePath: string,
  udid: string,
  decodedPayload: Record<string, unknown>
): boolean {
  const state = readJsonState<CheckinDedupState>(filePath, {});
  const hash = stableHash(decodedPayload);
  const isRepeat = state[udid] === hash;
  state[udid] = hash;
  writeJsonState(filePath, state);
  return isRepeat;
}
