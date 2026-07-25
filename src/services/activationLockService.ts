import { DeviceCommands } from "../micromdm/deviceCommands";
import { attemptEnableActivationLock } from "../profiles/activationLock";
import { EventBus } from "../events/eventBus";

export interface ActivationLockServiceApi {
  handleEnrollment(deviceUUID: string): Promise<void>;
}

export function createActivationLockService(
  deviceCommands: DeviceCommands,
  bus: EventBus
): ActivationLockServiceApi {
  return {
    async handleEnrollment(deviceUUID: string): Promise<void> {
      bus.publish({ type: "device.enrolled", deviceUUID });
      const result = await attemptEnableActivationLock(deviceCommands);
      bus.publish({
        type: "activationlock.result",
        success: result.success,
        reason: result.reason,
      });
    },
  };
}
