import { DeviceCommands } from "../micromdm/deviceCommands";
import { getLogger } from "../utils/logger";

export interface ActivationLockAttemptResult {
  success: boolean;
  reason?: string;
}

/**
 * Được gọi bởi services/activationLockService.ts khi có sự kiện enroll mới.
 * Không phải mọi thiết bị/phiên bản iOS đều hỗ trợ User-Linked Activation Lock
 * (yêu cầu Supervised + iOS đủ mới) - nếu MicroMDM trả lỗi, coi là "failed"
 * và để caller quyết định việc notify, không throw ra ngoài.
 */
export async function attemptEnableActivationLock(
  deviceCommands: DeviceCommands
): Promise<ActivationLockAttemptResult> {
  try {
    await deviceCommands.enableActivationLock();
    return { success: true };
  } catch (err) {
    getLogger().error("[activationLock] Bật Activation Lock thất bại", {
      error: (err as Error).message,
    });
    return { success: false, reason: (err as Error).message };
  }
}
