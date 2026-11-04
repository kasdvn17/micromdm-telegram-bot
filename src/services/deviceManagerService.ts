import { AsyncLocalStorage } from "async_hooks";
import { DeviceRecord, DeviceRegistryState } from "../types/micromdm.types";
import { readJsonState, writeJsonState } from "../utils/jsonStore";
import { ValidationError } from "../utils/errors";
import { getLogger } from "../utils/logger";
import { MicroMdmClient } from "../micromdm/client";

export interface DeviceManagerServiceApi {
  listDevices(): DeviceRecord[];
  getPrimaryDevice(): DeviceRecord | undefined;
  getTargetDevice(): DeviceRecord | undefined;
  getActiveTargetDevice(): DeviceRecord | undefined;
  getPrimaryUDID(): string;
  getTargetUDID(): string;
  getActiveTargetUDID(): string;
  setPrimary(query: string): DeviceRecord;
  setTarget(query: string): DeviceRecord;
  resetTarget(): DeviceRecord;
  resolveDevice(query: string): DeviceRecord | undefined;
  registerOrUpdate(udid: string, partial?: Partial<DeviceRecord>): DeviceRecord;
  renameDevice(query: string, newName: string): DeviceRecord;
  removeDevice(query: string): DeviceRecord;
  syncWithMicroMdm(client: MicroMdmClient): Promise<DeviceRecord[]>;
  runWithTarget<T>(udid: string, fn: () => Promise<T>): Promise<T>;
}

export function createDeviceManagerService(
  filePath: string,
  initialPrimaryUdid: string,
  seenDevicesFilePath?: string
): DeviceManagerServiceApi {
  const targetStorage = new AsyncLocalStorage<string>();

  const defaultState: DeviceRegistryState = {
    primaryUdid: initialPrimaryUdid,
    activeTargetUdid: initialPrimaryUdid,
    devices: [],
  };

  const state = readJsonState<DeviceRegistryState>(filePath, defaultState);

  // 1. Đảm bảo initialPrimaryUdid có trong danh sách
  if (initialPrimaryUdid && !state.devices.some((d) => d.udid.toLowerCase() === initialPrimaryUdid.toLowerCase())) {
    state.devices.push({
      udid: initialPrimaryUdid,
      name: "iPhone chính",
      isPrimary: true,
      status: "online",
      enrolledAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
  }

  // 2. Migration từ seen-devices.json nếu có
  if (seenDevicesFilePath) {
    try {
      const seen = readJsonState<{ udids?: string[] }>(seenDevicesFilePath, { udids: [] });
      const udids = Array.isArray(seen.udids) ? seen.udids : [];
      for (const udid of udids) {
        if (!udid || typeof udid !== "string") continue;
        if (!state.devices.some((d) => d.udid.toLowerCase() === udid.toLowerCase())) {
          state.devices.push({
            udid,
            name: `Thiết bị ${state.devices.length + 1}`,
            isPrimary: state.devices.length === 0,
            status: "enrolled",
            enrolledAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      getLogger().warn("[deviceManager] Không thể đọc seenDevicesFilePath để migrate", {
        error: (err as Error).message,
      });
    }
  }

  // 3. Đảm bảo duy nhất 1 thiết bị là primary
  let primaryFound = false;
  for (const dev of state.devices) {
    if (dev.isPrimary) {
      if (!primaryFound) {
        primaryFound = true;
        state.primaryUdid = dev.udid;
      } else {
        dev.isPrimary = false;
      }
    }
  }

  if (!primaryFound && state.devices.length > 0) {
    state.devices[0].isPrimary = true;
    state.primaryUdid = state.devices[0].udid;
  }

  if (!state.activeTargetUdid || !state.devices.some((d) => d.udid.toLowerCase() === state.activeTargetUdid?.toLowerCase())) {
    state.activeTargetUdid = state.primaryUdid;
  }

  writeJsonState(filePath, state);

  function save(): void {
    writeJsonState(filePath, state);
  }

  function resolveDevice(query: string): DeviceRecord | undefined {
    if (!query || typeof query !== "string") return undefined;
    const clean = query.trim().toLowerCase();
    if (!clean) return undefined;

    if (clean === "primary" || clean === "main") {
      return getPrimaryDevice();
    }
    if (clean === "target" || clean === "active") {
      return getTargetDevice();
    }

    // 1-based index (vd: "1", "2")
    const index = Number.parseInt(clean, 10);
    if (Number.isFinite(index) && String(index) === clean && index >= 1 && index <= state.devices.length) {
      return state.devices[index - 1];
    }

    // Khớp exact UDID
    const exactUdid = state.devices.find((d) => d.udid.toLowerCase() === clean);
    if (exactUdid) return exactUdid;

    // Khớp UDID prefix/substring (nếu query dài >= 4 ký tự)
    if (clean.length >= 4) {
      const matchUdid = state.devices.find((d) => d.udid.toLowerCase().includes(clean));
      if (matchUdid) return matchUdid;
    }

    // Khớp exact name (case-insensitive)
    const exactName = state.devices.find((d) => d.name.toLowerCase() === clean);
    if (exactName) return exactName;

    // Khớp name chứa substring
    const matchName = state.devices.find((d) => d.name.toLowerCase().includes(clean));
    if (matchName) return matchName;

    return undefined;
  }

  function getPrimaryDevice(): DeviceRecord | undefined {
    return state.devices.find((d) => d.isPrimary) ?? state.devices[0];
  }

  function getTargetDevice(): DeviceRecord | undefined {
    const target = state.devices.find((d) => d.udid.toLowerCase() === state.activeTargetUdid?.toLowerCase());
    return target ?? getPrimaryDevice();
  }

  function getActiveTargetDevice(): DeviceRecord | undefined {
    const scopedUdid = targetStorage.getStore();
    if (scopedUdid) {
      const found = state.devices.find((d) => d.udid.toLowerCase() === scopedUdid.toLowerCase());
      if (found) return found;
    }
    return getTargetDevice();
  }

  function getPrimaryUDID(): string {
    return getPrimaryDevice()?.udid || initialPrimaryUdid;
  }

  function getTargetUDID(): string {
    return getTargetDevice()?.udid || getPrimaryUDID();
  }

  function getActiveTargetUDID(): string {
    const scoped = targetStorage.getStore();
    if (scoped) return scoped;
    return getTargetUDID();
  }

  function setPrimary(query: string): DeviceRecord {
    const dev = resolveDevice(query);
    if (!dev) {
      throw new ValidationError(`Không tìm thấy thiết bị nào khớp với "${query}". Dùng /devices để xem danh sách.`);
    }

    for (const d of state.devices) {
      d.isPrimary = d.udid === dev.udid;
    }
    state.primaryUdid = dev.udid;
    save();
    getLogger().info("[deviceManager] Đã đổi Primary device", { udid: dev.udid, name: dev.name });
    return dev;
  }

  function setTarget(query: string): DeviceRecord {
    const dev = resolveDevice(query);
    if (!dev) {
      throw new ValidationError(`Không tìm thấy thiết bị nào khớp với "${query}". Dùng /devices để xem danh sách.`);
    }

    state.activeTargetUdid = dev.udid;
    save();
    getLogger().info("[deviceManager] Đã đổi Target device", { udid: dev.udid, name: dev.name });
    return dev;
  }

  function resetTarget(): DeviceRecord {
    const primary = getPrimaryDevice();
    state.activeTargetUdid = primary?.udid || initialPrimaryUdid;
    save();
    return primary ?? state.devices[0];
  }

  function registerOrUpdate(udid: string, partial?: Partial<DeviceRecord>): DeviceRecord {
    if (!udid) {
      throw new ValidationError("UDID không được để trống khi đăng ký thiết bị.");
    }
    const cleanUdid = udid.trim();
    const existing = state.devices.find((d) => d.udid.toLowerCase() === cleanUdid.toLowerCase());

    if (existing) {
      if (partial?.name && partial.name.trim()) existing.name = partial.name.trim();
      if (partial?.model) existing.model = partial.model;
      if (partial?.modelName) existing.modelName = partial.modelName;
      if (partial?.osVersion) existing.osVersion = partial.osVersion;
      if (partial?.serialNumber) existing.serialNumber = partial.serialNumber;
      if (partial?.batteryLevel !== undefined) existing.batteryLevel = partial.batteryLevel;
      if (partial?.batteryState) existing.batteryState = partial.batteryState;
      if (partial?.isSupervised !== undefined) existing.isSupervised = partial.isSupervised;
      if (partial?.status) existing.status = partial.status;
      existing.lastSeenAt = partial?.lastSeenAt || new Date().toISOString();
      save();
      return existing;
    }

    const isFirst = state.devices.length === 0;
    const newRecord: DeviceRecord = {
      udid: cleanUdid,
      name: partial?.name?.trim() || `Thiết bị ${state.devices.length + 1}`,
      model: partial?.model,
      modelName: partial?.modelName,
      osVersion: partial?.osVersion,
      serialNumber: partial?.serialNumber,
      batteryLevel: partial?.batteryLevel,
      batteryState: partial?.batteryState,
      isSupervised: partial?.isSupervised,
      isPrimary: isFirst,
      status: partial?.status || "online",
      enrolledAt: partial?.enrolledAt || new Date().toISOString(),
      lastSeenAt: partial?.lastSeenAt || new Date().toISOString(),
    };

    state.devices.push(newRecord);
    if (isFirst) {
      state.primaryUdid = cleanUdid;
      state.activeTargetUdid = cleanUdid;
    }
    save();
    getLogger().info("[deviceManager] Đã thêm/đăng ký thiết bị mới", { udid: cleanUdid, name: newRecord.name });
    return newRecord;
  }

  function renameDevice(query: string, newName: string): DeviceRecord {
    const dev = resolveDevice(query);
    if (!dev) {
      throw new ValidationError(`Không tìm thấy thiết bị nào khớp với "${query}". Dùng /devices để xem danh sách.`);
    }
    const cleanName = newName.trim();
    if (!cleanName) {
      throw new ValidationError("Tên mới của thiết bị không được để trống.");
    }
    dev.name = cleanName;
    save();
    return dev;
  }

  function removeDevice(query: string): DeviceRecord {
    const dev = resolveDevice(query);
    if (!dev) {
      throw new ValidationError(`Không tìm thấy thiết bị nào khớp với "${query}". Dùng /devices để xem danh sách.`);
    }
    if (dev.isPrimary) {
      throw new ValidationError("Không thể xóa thiết bị đang là Primary. Hãy đặt thiết bị khác làm Primary trước.");
    }
    if (state.devices.length <= 1) {
      throw new ValidationError("Không thể xóa thiết bị duy nhất trong danh sách.");
    }

    state.devices = state.devices.filter((d) => d.udid.toLowerCase() !== dev.udid.toLowerCase());
    if (state.activeTargetUdid?.toLowerCase() === dev.udid.toLowerCase()) {
      state.activeTargetUdid = state.primaryUdid;
    }
    save();
    return dev;
  }

  async function syncWithMicroMdm(client: MicroMdmClient): Promise<DeviceRecord[]> {
    const list = await client.getDevices();
    for (const item of list) {
      if (!item.udid) continue;
      registerOrUpdate(item.udid, {
        serialNumber: item.serial_number,
        lastSeenAt: item.last_seen,
        status: item.enrollment_status === false ? "offline" : "online",
      });
    }
    return [...state.devices];
  }

  async function runWithTarget<T>(udid: string, fn: () => Promise<T>): Promise<T> {
    return targetStorage.run(udid, fn);
  }

  return {
    listDevices: () => [...state.devices],
    getPrimaryDevice,
    getTargetDevice,
    getActiveTargetDevice,
    getPrimaryUDID,
    getTargetUDID,
    getActiveTargetUDID,
    setPrimary,
    setTarget,
    resetTarget,
    resolveDevice,
    registerOrUpdate,
    renameDevice,
    removeDevice,
    syncWithMicroMdm,
    runWithTarget,
  };
}
