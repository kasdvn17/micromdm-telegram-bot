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

export function addFocusBundleId(restrictedAppsFilePath: string, bundleId: string): string[] {
  const data = readJsonState<BundleIdListFile>(restrictedAppsFilePath, { bundleIds: [] });
  if (!data.bundleIds.includes(bundleId)) {
    data.bundleIds.push(bundleId);
    writeJsonState(restrictedAppsFilePath, data);
  }
  return data.bundleIds;
}

export function removeFocusBundleId(restrictedAppsFilePath: string, bundleId: string): string[] {
  const data = readJsonState<BundleIdListFile>(restrictedAppsFilePath, { bundleIds: [] });
  data.bundleIds = data.bundleIds.filter((id) => id !== bundleId);
  writeJsonState(restrictedAppsFilePath, data);
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

/**
 * Danh sách app riêng cho Safe Mode (data/sensitive_apps.json) - ĐỘC LẬP
 * hoàn toàn với danh sách của Focus Mode (restricted-apps.json). Dùng khi
 * cho người khác mượn máy: chặn các app riêng tư (ngân hàng, tin nhắn...)
 * mà không cần đụng tới cấu hình Focus Mode hằng ngày.
 */
export function loadSensitiveBundleIds(sensitiveAppsFilePath: string): string[] {
  const data = readJsonState<BundleIdListFile>(sensitiveAppsFilePath, { bundleIds: [] });
  return data.bundleIds;
}

export function addSensitiveBundleId(sensitiveAppsFilePath: string, bundleId: string): string[] {
  const data = readJsonState<BundleIdListFile>(sensitiveAppsFilePath, { bundleIds: [] });
  if (!data.bundleIds.includes(bundleId)) {
    data.bundleIds.push(bundleId);
    writeJsonState(sensitiveAppsFilePath, data);
  }
  return data.bundleIds;
}

export function removeSensitiveBundleId(sensitiveAppsFilePath: string, bundleId: string): string[] {
  const data = readJsonState<BundleIdListFile>(sensitiveAppsFilePath, { bundleIds: [] });
  data.bundleIds = data.bundleIds.filter((id) => id !== bundleId);
  writeJsonState(sensitiveAppsFilePath, data);
  return data.bundleIds;
}

interface WebsiteListFile {
  websites: string[];
}

/**
 * Danh sách website bị chặn cho Focus Mode (data/focus-websites.json) -
 * dùng chung profile với Focus (FOCUS_PROFILE_IDENTIFIER), payload
 * com.apple.webcontent-filter thêm vào CÙNG profile với app restriction.
 */
export function loadFocusWebsites(focusWebsitesFilePath: string): string[] {
  const data = readJsonState<WebsiteListFile>(focusWebsitesFilePath, { websites: [] });
  return data.websites;
}

export function addFocusWebsite(focusWebsitesFilePath: string, url: string): string[] {
  const data = readJsonState<WebsiteListFile>(focusWebsitesFilePath, { websites: [] });
  if (!data.websites.includes(url)) {
    data.websites.push(url);
    writeJsonState(focusWebsitesFilePath, data);
  }
  return data.websites;
}

export function removeFocusWebsite(focusWebsitesFilePath: string, url: string): string[] {
  const data = readJsonState<WebsiteListFile>(focusWebsitesFilePath, { websites: [] });
  data.websites = data.websites.filter((w) => w !== url);
  writeJsonState(focusWebsitesFilePath, data);
  return data.websites;
}

/**
 * Danh sách website bị chặn cho Blacklist (data/blacklist-websites.json) -
 * ĐỘC LẬP với website list của Focus, dùng chung profile với Blacklist app
 * (BLACKLIST_PROFILE_IDENTIFIER).
 */
export function loadBlacklistWebsites(blacklistWebsitesFilePath: string): string[] {
  const data = readJsonState<WebsiteListFile>(blacklistWebsitesFilePath, { websites: [] });
  return data.websites;
}

export function addBlacklistWebsite(blacklistWebsitesFilePath: string, url: string): string[] {
  const data = readJsonState<WebsiteListFile>(blacklistWebsitesFilePath, { websites: [] });
  if (!data.websites.includes(url)) {
    data.websites.push(url);
    writeJsonState(blacklistWebsitesFilePath, data);
  }
  return data.websites;
}
