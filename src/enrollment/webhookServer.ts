import http from "http";
import { MicroMdmClient } from "../micromdm/client";
import { MicroMdmWebhookEvent } from "../types/micromdm.types";
import { EventBus } from "../events/eventBus";
import { ActivationLockServiceApi } from "../services/activationLockService";
import { getLogger } from "../utils/logger";
import { readJsonState, writeJsonState } from "../utils/jsonStore";

export interface WebhookServerOptions {
  port: number;
  deviceUUID: string;
  /** File lưu danh sách UDID đã từng thấy, dùng để tự phát hiện enrollment MỚI
   *  (MicroMDM KHÔNG có topic "mdm.Enrollment" riêng - đây là cách chính thức
   *  được khuyến nghị, theo repo mẫu micromdm-webhook-blueprints). */
  seenDevicesFilePath: string;
}

interface SeenDevicesState {
  udids: string[];
}

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
 */
export function startWebhookServer(
  options: WebhookServerOptions,
  client: MicroMdmClient,
  bus: EventBus,
  activationLockService: ActivationLockServiceApi
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      res.writeHead(200).end();
      void handleWebhookBody(body, options, client, bus, activationLockService);
    });
  });

  server.listen(options.port, () => {
    getLogger().info("[webhookServer] Đang lắng nghe webhook MicroMDM", {
      port: options.port,
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
  activationLockService: ActivationLockServiceApi
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
      if (!ci || ci.udid !== options.deviceUUID) break;

      // TokenUpdate lần đầu (push token vừa đăng ký) ~= enrollment vừa hoàn tất.
      // Đây là cách MicroMDM chính thức khuyến nghị để phát hiện enroll mới,
      // vì không có topic "mdm.Enrollment" riêng.
      if (isNewDevice(options.seenDevicesFilePath, ci.udid)) {
        await activationLockService.handleEnrollment(ci.udid);
      }

      bus.publish({ type: "device.checkin", deviceUUID: ci.udid, requestType: event.topic });
      bus.publish({ type: "device.online" });
      break;
    }

    case "mdm.Authenticate": {
      const ci = event.checkin_event;
      if (!ci || ci.udid !== options.deviceUUID) break;
      bus.publish({ type: "device.checkin", deviceUUID: ci.udid, requestType: event.topic });
      bus.publish({ type: "device.online" });
      break;
    }

    case "mdm.CheckOut": {
      const ci = event.checkin_event;
      if (!ci || ci.udid !== options.deviceUUID) break;
      bus.publish({ type: "device.offline" });
      break;
    }

    case "mdm.Connect": {
      const ack = event.acknowledge_event;
      if (!ack) break;
      client.resolveAcknowledge(ack.command_uuid, ack.status, ack.raw_payload);
      if (ack.status === "Acknowledged") {
        bus.publish({
          type: "mdm.command.succeeded",
          command: ack.command_uuid,
          commandUUID: ack.command_uuid,
        });
      } else if (ack.status === "Error") {
        bus.publish({
          type: "mdm.command.failed",
          command: ack.command_uuid,
          commandUUID: ack.command_uuid,
          error: "MicroMDM báo lỗi khi thực thi command trên thiết bị",
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
