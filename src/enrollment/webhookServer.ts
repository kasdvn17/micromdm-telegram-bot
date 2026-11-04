import http from "http";
import { MicroMdmClient } from "../micromdm/client";
import { MicroMdmWebhookEvent } from "../types/micromdm.types";
import { EventBus } from "../events/eventBus";
import { ActivationLockServiceApi } from "../services/activationLockService";
import { DefaultProfileServiceApi } from "../services/defaultProfileService";
import { isRepeatCheckin } from "./checkinDedup";
import { DeviceManagerServiceApi } from "../services/deviceManagerService";
import { LapsServiceApi } from "../services/lapsService";
import { AgentCheckinPayload, AgentReportPayload } from "../types/laps.types";
import { getLogger } from "../utils/logger";
import { readJsonState, writeJsonState } from "../utils/jsonStore";

export interface WebhookServerOptions {
  port: number;
  path: string;
  deviceUUID?: string;
  /** File lưu danh sách UDID đã từng thấy, dùng để tự phát hiện enrollment MỚI
   *  (MicroMDM KHÔNG có topic "mdm.Enrollment" riêng - đây là cách chính thức
   *  được khuyến nghị, theo repo mẫu micromdm-webhook-blueprints). */
  seenDevicesFilePath: string;
  /** File lưu hash raw_payload lần check-in gần nhất, dùng để phát hiện
   *  check-in "heartbeat" (lặp lại, không có gì mới) - xem enrollment/checkinDedup.ts */
  checkinStateFilePath: string;
}

interface SeenDevicesState {
  udids: string[];
}

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

/**
 * HTTP server nội bộ nhận webhook từ MicroMDM (cấu hình MicroMDM chạy với
 * `-command-webhook-url=http://<host>:<port>/webhook/micromdm`).
 *
 * QUAN TRỌNG: đã verify lại theo docs/user-guide/api-and-webhooks.md của
 * micromdm/micromdm - chỉ có ĐÚNG 4 topic được expose qua webhook:
 *   - mdm.Authenticate  -> checkin_event
 *   - mdm.TokenUpdate   -> checkin_event
 *   - mdm.CheckOut      -> checkin_event
 *   - mdm.Connect       -> acknowledge_event  (đây là nơi nhận KẾT QUẢ command)
 * KHÔNG có "mdm.Enrollment" hay "mdm.Acknowledge" như bản trước đây suy đoán sai.
 *
 * Vai trò:
 *  1. mdm.TokenUpdate với UDID CHƯA từng thấy -> coi là enrollment mới, gọi
 *     activationLockService (bật Activation Lock) - vì không có topic riêng.
 *  2. mdm.Connect -> resolve pending command trong MicroMdmClient (kết quả
 *     DeviceInformation/DeviceLocation...) + publish event mdm.command.*
 *  3. mdm.TokenUpdate / mdm.Authenticate (không phải lần đầu) -> publish
 *     device.checkin (không phải heartbeat thuần, KHÔNG bị lọc khỏi notify)
 *  4. mdm.CheckOut -> publish device.offline
 *
 * Đây là nơi duy nhất parse webhook payload; các module khác không tự parse.
 *
 * Về lọc "heartbeat" (yêu cầu bổ sung): mdm.TokenUpdate LẶP LẠI mà raw_payload
 * đã decode giống HỆT lần gần nhất (theo hash, xem checkinDedup.ts) được coi
 * là heartbeat thuần tuý (chỉ re-register push token, không có gì mới) và
 * publish qua "device.heartbeat" (notifyBridge lọc khỏi Telegram, historyLogger
 * vẫn ghi đầy đủ). Mọi check-in KHÁC (Authenticate, TokenUpdate lần đầu/có thay
 * đổi thật, CheckOut) publish qua "device.checkin" kèm raw_payload ĐÃ DECODE
 * trong field `details` để notifyBridge gửi kèm Telegram.
 */
export function startWebhookServer(
  options: WebhookServerOptions,
  client: MicroMdmClient,
  bus: EventBus,
  activationLockService: ActivationLockServiceApi,
  defaultProfileService: DefaultProfileServiceApi,
  deviceManager?: DeviceManagerServiceApi,
  lapsService?: LapsServiceApi
): http.Server {
  const server = http.createServer((req, res) => {
    const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
    
    // Kiểm tra các route được hỗ trợ
    const isWebhook = requestPath === options.path;
    const isLapsCheckin = requestPath === "/api/laps/checkin";
    const isLapsReport = requestPath === "/api/laps/report";

    if (!isWebhook && !isLapsCheckin && !isLapsReport) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }

    let body = "";
    let bodyBytes = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > MAX_WEBHOOK_BODY_BYTES) {
        rejected = true;
        res.writeHead(413).end();
        return;
      }
      body += chunk;
    });

    req.on("end", () => {
      if (rejected) return;

      // Xử lý LAPS API
      if (isLapsCheckin || isLapsReport) {
        if (!lapsService) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "LAPS Service chưa được kích hoạt" }));
          return;
        }

        const authHeader = req.headers["authorization"] || req.headers["x-api-key"];
        let apiKey = "";
        if (typeof authHeader === "string") {
          apiKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
        }

        try {
          const parsed = JSON.parse(body);
          if (isLapsCheckin) {
            const resp = lapsService.handleCheckin(apiKey, parsed as AgentCheckinPayload);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(resp));
          } else {
            const resp = lapsService.handleReport(apiKey, parsed as AgentReportPayload);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(resp));
          }
        } catch (err) {
          const msg = (err as Error).message;
          const status = msg.includes("Unauthorized") ? 401 : 400;
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: msg }));
        }
        return;
      }

      // Xử lý Webhook MicroMDM
      res.writeHead(200).end();
      void handleWebhookBody(
        body,
        options,
        client,
        bus,
        activationLockService,
        defaultProfileService,
        deviceManager
      );
    });
  });

  server.listen(options.port, () => {
    getLogger().info("[webhookServer] Đang lắng nghe webhook MicroMDM", {
      port: options.port,
      path: options.path,
    });
  });

  return server;
}

function isNewDevice(seenDevicesFilePath: string, udid: string): boolean {
  const state = readJsonState<SeenDevicesState>(seenDevicesFilePath, { udids: [] });
  if (state.udids.includes(udid)) return false;
  state.udids.push(udid);
  writeJsonState(seenDevicesFilePath, state);
  return true;
}

async function handleWebhookBody(
  rawBody: string,
  options: WebhookServerOptions,
  client: MicroMdmClient,
  bus: EventBus,
  activationLockService: ActivationLockServiceApi,
  defaultProfileService: DefaultProfileServiceApi,
  deviceManager?: DeviceManagerServiceApi
): Promise<void> {
  let event: MicroMdmWebhookEvent;
  try {
    event = JSON.parse(rawBody) as MicroMdmWebhookEvent;
  } catch (err) {
    getLogger().error("[webhookServer] Payload webhook không phải JSON hợp lệ", {
      error: (err as Error).message,
    });
    return;
  }

  switch (event.topic) {
    case "mdm.TokenUpdate": {
      const ci = event.checkin_event;
      if (!ci || !ci.udid) break;

      const decoded = ci.raw_payload ? client.decodeBase64Plist(ci.raw_payload) : {};

      // Cập nhật trạng thái thiết bị trong DeviceManager
      deviceManager?.registerOrUpdate(ci.udid, {
        status: "online",
        lastSeenAt: new Date().toISOString(),
      });

      // TokenUpdate lần đầu (push token vừa đăng ký) ~= enrollment vừa hoàn tất.
      // Đây là cách MicroMDM chính thức khuyến nghị để phát hiện enroll mới,
      // vì không có topic "mdm.Enrollment" riêng.
      const isNew = isNewDevice(options.seenDevicesFilePath, ci.udid);
      if (isNew) {
        await activationLockService.handleEnrollment(ci.udid);
        await defaultProfileService.installOnEnrollment(ci.udid);
      }

      // isNew luôn coi là "có gì đó mới" (bỏ qua so sánh hash) - còn lại so
      // khớp hash với lần check-in gần nhất để phát hiện heartbeat thuần tuý.
      const isHeartbeat = !isNew && isRepeatCheckin(options.checkinStateFilePath, ci.udid, decoded);

      if (isHeartbeat) {
        bus.publish({ type: "device.heartbeat", deviceUUID: ci.udid, requestType: event.topic });
      } else {
        bus.publish({
          type: "device.checkin",
          deviceUUID: ci.udid,
          requestType: event.topic,
          details: decoded,
        });
        bus.publish({ type: "device.online", deviceUUID: ci.udid });
      }
      break;
    }

    case "mdm.Authenticate": {
      const ci = event.checkin_event;
      if (!ci || !ci.udid) break;

      // Authenticate chỉ xảy ra ở bước đầu handshake enrollment/re-enrollment
      // (không xảy ra định kỳ như TokenUpdate) - luôn coi là có ý nghĩa, không
      // áp dụng lọc heartbeat, luôn đính kèm raw_payload đã decode.
      const decoded = ci.raw_payload ? client.decodeBase64Plist(ci.raw_payload) : {};

      const deviceName = decoded["DeviceName"] ? String(decoded["DeviceName"]) : undefined;
      const model = decoded["ModelName"] || decoded["Model"] ? String(decoded["ModelName"] ?? decoded["Model"]) : undefined;
      const osVersion = decoded["OSVersion"] ? String(decoded["OSVersion"]) : undefined;
      const serialNumber = decoded["SerialNumber"] ? String(decoded["SerialNumber"]) : undefined;

      deviceManager?.registerOrUpdate(ci.udid, {
        ...(deviceName ? { name: deviceName } : {}),
        ...(model ? { model } : {}),
        ...(osVersion ? { osVersion } : {}),
        ...(serialNumber ? { serialNumber } : {}),
        status: "online",
        lastSeenAt: new Date().toISOString(),
      });

      bus.publish({
        type: "device.checkin",
        deviceUUID: ci.udid,
        requestType: event.topic,
        details: decoded,
      });
      bus.publish({ type: "device.online", deviceUUID: ci.udid });
      break;
    }

    case "mdm.CheckOut": {
      const ci = event.checkin_event;
      if (!ci || !ci.udid) break;
      const decoded = ci.raw_payload ? client.decodeBase64Plist(ci.raw_payload) : undefined;
      deviceManager?.registerOrUpdate(ci.udid, {
        status: "offline",
        lastSeenAt: new Date().toISOString(),
      });
      bus.publish({ type: "device.offline", deviceUUID: ci.udid, details: decoded });
      break;
    }

    case "mdm.Connect": {
      const ack = event.acknowledge_event;
      if (!ack || !ack.udid) break;

      const requestType = client.resolveAcknowledge(
        ack.command_uuid,
        ack.status,
        ack.raw_payload
      );
      const command = requestType ?? "UnknownCommand";

      if (ack.status === "Acknowledged" && command === "DeviceInformation" && ack.raw_payload) {
        try {
          const parsed = client.decodeBase64Plist(ack.raw_payload);
          const raw = (parsed["QueryResponses"] as Record<string, unknown>) ?? parsed;
          deviceManager?.registerOrUpdate(ack.udid, {
            ...(raw["DeviceName"] ? { name: String(raw["DeviceName"]) } : {}),
            ...(raw["ModelName"] || raw["Model"] ? { model: String(raw["ModelName"] ?? raw["Model"]) } : {}),
            ...(raw["OSVersion"] ? { osVersion: String(raw["OSVersion"]) } : {}),
            ...(raw["SerialNumber"] ? { serialNumber: String(raw["SerialNumber"]) } : {}),
            ...(raw["BatteryLevel"] !== undefined ? { batteryLevel: Number(raw["BatteryLevel"]) } : {}),
            ...(raw["BatteryState"] ? { batteryState: String(raw["BatteryState"]) } : {}),
            ...(raw["IsSupervised"] !== undefined ? { isSupervised: Boolean(raw["IsSupervised"]) } : {}),
            status: "online",
            lastSeenAt: new Date().toISOString(),
          });
        } catch {
          // ignore
        }
      }

      if (ack.status === "Acknowledged") {
        bus.publish({
          type: "mdm.command.succeeded",
          command,
          commandUUID: ack.command_uuid,
          deviceUUID: ack.udid,
        });
      } else if (ack.status === "Error") {
        let parsed: Record<string, unknown> = {};
        if (ack.raw_payload)
          parsed = client.decodeBase64Plist(ack.raw_payload);
        getLogger().error("[webhookServer] MicroMDM báo lỗi khi thực thi command trên thiết bị", {
          udid: ack.udid,
          commandUUID: ack.command_uuid,
          raw: parsed,
        });
        bus.publish({
          type: "mdm.command.failed",
          command,
          commandUUID: ack.command_uuid,
          deviceUUID: ack.udid,
          error: `MicroMDM báo lỗi khi thực thi command trên thiết bị: ${JSON.stringify(parsed)}`,
        });
      }
      // status "NotNow" - thiết bị bận, không coi là lỗi, không publish gì thêm
      break;
    }

    default:
      getLogger().warn("[webhookServer] Topic webhook không xử lý", {
        topic: (event as { topic?: string }).topic,
      });
  }
}
