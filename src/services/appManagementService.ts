import { DeviceCommands } from "../micromdm/deviceCommands";
import { EventBus } from "../events/eventBus";
import { ValidationError } from "../utils/errors";

export interface AppManagementServiceApi {
  installFromManifest(manifestURL: string): Promise<void>;
  installFromAppStore(iTunesStoreID: number): Promise<void>;
  listApps(managedOnly: boolean): Promise<
    Array<{ identifier: string; name?: string; version?: string; managed?: boolean }>
  >;
  removeApp(bundleId: string): Promise<void>;
}

export function createAppManagementService(
  deviceCommands: DeviceCommands,
  bus: EventBus
): AppManagementServiceApi {
  return {
    async installFromManifest(manifestURL: string): Promise<void> {
      if (!manifestURL.startsWith("https://")) {
        throw new ValidationError("ManifestURL phải là HTTPS URL trỏ tới file Manifest.plist.");
      }
      const result = await deviceCommands.installApplication(manifestURL, true);
      bus.publish({
        type: "mdm.command.queued",
        command: result.requestType,
        commandUUID: result.commandUUID,
      });
    },

    async installFromAppStore(iTunesStoreID: number): Promise<void> {
      const result = await deviceCommands.installApplicationFromAppStore(iTunesStoreID);
      bus.publish({
        type: "mdm.command.queued",
        command: result.requestType,
        commandUUID: result.commandUUID,
      });
    },

    async listApps(managedOnly: boolean) {
      return deviceCommands.listInstalledApps(managedOnly);
    },

    async removeApp(bundleId: string): Promise<void> {
      const result = await deviceCommands.removeApplication(bundleId);
      bus.publish({
        type: "mdm.command.queued",
        command: result.requestType,
        commandUUID: result.commandUUID,
      });
    },
  };
}
