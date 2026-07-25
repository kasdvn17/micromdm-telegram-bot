import { readJsonState, writeJsonState } from "../utils/jsonStore";

interface BundleIdListFile {
  bundleIds: string[];
}

/**
 * Focus Mode bundle IDs: theo yêu cầu gốc "Bundle IDs will be provided later",
 * thiết kế generic - đọc từ file JSON, mặc định rỗng nếu chưa cấu hình.
 */
export function loadFocusBundleIds(restrictedAppsFilePath: string): string[] {
  const data = readJsonState<BundleIdListFile>(restrictedAppsFilePath, { bundleIds: [] });
  return data.bundleIds;
}

export function loadBlacklistBundleIds(blacklistFilePath: string): string[] {
  const data = readJsonState<BundleIdListFile>(blacklistFilePath, { bundleIds: [] });
  return data.bundleIds;
}

export function addBlacklistBundleId(blacklistFilePath: string, bundleId: string): string[] {
  const data = readJsonState<BundleIdListFile>(blacklistFilePath, { bundleIds: [] });
  if (!data.bundleIds.includes(bundleId)) {
    data.bundleIds.push(bundleId);
    writeJsonState(blacklistFilePath, data);
  }
  return data.bundleIds;
}

export function removeBlacklistBundleId(blacklistFilePath: string, bundleId: string): string[] {
  const data = readJsonState<BundleIdListFile>(blacklistFilePath, { bundleIds: [] });
  data.bundleIds = data.bundleIds.filter((id) => id !== bundleId);
  writeJsonState(blacklistFilePath, data);
  return data.bundleIds;
}
