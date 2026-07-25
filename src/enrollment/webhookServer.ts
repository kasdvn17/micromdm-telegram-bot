import http from "http";
import { MicroMdmClient } from "../micromdm/client";
import { MicroMdmWebhookEvent } from "../types/micromdm.types";
import { EventBus } from "../events/eventBus";
import { ActivationLockServiceApi } from "../services/activationLockService";
import { getLogger } from "../utils/logger";
import { parse } from "plist";

export interface WebhookServerOptions {
  port: number;
  deviceUUID: string;
  /**
   * URL path MicroMDM sẽ POST vào (ví dụ: "/webhook/micromdm").
   * Phải khớp với giá trị được set trong --webhook-url của MicroMDM server.
   * Mặc định: "/webhook/micromdm"
   */
  webhookPath?: string;
}

/**
 * HTTP server nội bộ nhận webhook từ MicroMDM (cấu hình MicroMDM chạy với
 * `-webhook-url=http://<host>:<port>/webhook/micromdm`).
 *
 * Vai trò:
 *  1. mdm.Authenticate -> gọi activationLockService (bật User-Linked Activation Lock)
 *     khi thiết bị enroll lần đầu. NOTE: mdm.Authenticate là topic enroll thực tế
 *     (không phải "mdm.Enrollment" vốn không tồn tại trong MicroMDM).
 *  2. mdm.Acknowledge -> decode raw_payload (base64 → JSON), resolve pending command
 *     trong MicroMdmClient (kết quả DeviceInformation/DeviceLocation...) + publish
 *     event mdm.command.succeeded/failed.
 *  3. mdm.TokenUpdate -> publish device.checkin + device.online
 *  4. mdm.CheckOut   -> publish device.offline
 *  5. mdm.Connect    -> heartbeat (thiết bị check-in thường xuyên, không thay đổi state)
 *
 * Đây là nơi duy nhất parse webhook payload; các module khác không tự parse.
 *
 * QUAN TRỌNG về raw_payload:
 * MicroMDM encode raw_payload ([]byte) thành base64 khi JSON-marshal sang webhook.
 * Phải decode: Buffer.from(raw_payload, "base64") → JSON.parse để lấy dữ liệu thực.
 */
export function startWebhookServer(
  options: WebhookServerOptions,
  client: MicroMdmClient,
  bus: EventBus,
  activationLockService: ActivationLockServiceApi
): http.Server {
  const webhookPath = options.webhookPath ?? "/webhook/micromdm";

  const server = http.createServer((req, res) => {
    getLogger().info(`[webhookServer] Nhận request: ${req.method} ${req.url}`);

    // Bug #9 fix: Validate URL path — only process requests at the expected path.
    // This prevents arbitrary callers from injecting fake MDM events.
    if (req.url !== webhookPath) {
      res.writeHead(404).end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      getLogger().info(`[webhookServer] Body: ${body}`);
      res.writeHead(200).end();
      void handleWebhookBody(body, options, client, bus, activationLockService);
    });
  });

  server.listen(options.port, () => {
    getLogger().info("[webhookServer] Đang lắng nghe webhook MicroMDM", {
      port: options.port,
      path: webhookPath,
    });
  });

  return server;
}

/**
 * Decode raw_payload từ base64 thành Record<string, unknown>.
 *
 * MicroMDM gửi raw_payload là []byte (Go) được marshal thành base64 string trong JSON.
 * Bước decode: base64 string → UTF-8 string → JSON.parse → object.
 * Nếu parse thất bại (thiết bị trả dữ liệu không phải JSON hợp lệ), trả về {}.
 */
function decodeRawPayload(base64: string | undefined): Record<string, unknown> {
  if (!base64) return {};

  try {
    // 1. Convert Base64 (supporting base64url if needed) to standard UTF-8 string
    const normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
    const decodedStr = Buffer.from(normalized, "base64").toString("utf-8");

    // 2. Try parsing as JSON first (for Apple Declarative Management / DDMF)
    if (decodedStr.trim().startsWith("{")) {
      const parsedJson = JSON.parse(decodedStr);
      return typeof parsedJson === "object" && parsedJson !== null ? parsedJson : {};
    }

    // 3. Fallback to XML Plist parser (for traditional Apple MDM protocol)
    const parsedPlist = parse(decodedStr);

    if (typeof parsedPlist === "object" && parsedPlist !== null && !Array.isArray(parsedPlist)) {
      return parsedPlist as Record<string, unknown>;
    }

    return {};
  } catch (error) {
    getLogger().warn("[webhookServer] Cannot decode raw_payload", {
      base64Prefix: base64.slice(0, 40),
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
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

  // MicroMDM đôi khi gửi acknowledge_event trong topic "mdm.Connect" (heartbeat)
  // thay vì "mdm.Acknowledge". Do đó, chúng ta xử lý acknowledge_event độc lập với topic.
  if (event.acknowledge_event) {
    const ack = event.acknowledge_event;
    const decodedPayload = decodeRawPayload(ack.raw_payload);
    client.resolveAcknowledge(ack.command_uuid, ack.status, decodedPayload);

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
  }

  switch (event.topic) {
    case "mdm.Authenticate": {
      /**
       * Bug #3 fix: mdm.Authenticate là topic enrollment thực tế trong MicroMDM.
       * "mdm.Enrollment" không tồn tại. Khi thiết bị enroll lần đầu, MicroMDM
       * phát mdm.Authenticate, sau đó mdm.TokenUpdate.
       *
       * Bug #4 fix: UDID nằm trong checkin_event.udid, KHÔNG phải root event.udid.
       */
      const udid = event.checkin_event?.udid;
      if (udid === options.deviceUUID) {
        await activationLockService.handleEnrollment(udid);
      }
      // Authenticate cũng báo hiệu device online
      if (udid === options.deviceUUID) {
        bus.publish({
          type: "device.checkin",
          deviceUUID: udid,
          requestType: event.topic,
        });
        bus.publish({ type: "device.online" });
      }
      break;
    }

    case "mdm.Acknowledge": {
      // Đã được xử lý ở khối bên ngoài switch thông qua event.acknowledge_event
      break;
    }

    case "mdm.TokenUpdate": {
      /**
       * Bug #4 fix: UDID nằm trong checkin_event.udid, KHÔNG phải event.udid.
       * mdm.TokenUpdate xảy ra sau Authenticate (enroll) và khi token được gia hạn.
       */
      const udid = event.checkin_event?.udid;
      if (udid === options.deviceUUID) {
        bus.publish({
          type: "device.checkin",
          deviceUUID: udid,
          requestType: event.topic,
        });
        bus.publish({ type: "device.online" });
      }
      break;
    }

    case "mdm.CheckOut": {
      /**
       * Bug #4 fix: UDID nằm trong checkin_event.udid.
       */
      const udid = event.checkin_event?.udid;
      if (udid === options.deviceUUID) {
        bus.publish({ type: "device.offline" });
      }
      break;
    }

    case "mdm.Connect": {
      /**
       * Bug #10 fix: mdm.Connect là topic heartbeat thực tế của MicroMDM (thiết bị
       * kết nối lấy command pending). "mdm.CheckinEvent" không tồn tại.
       * Publish heartbeat để notifyBridge lọc (không notify mặc định).
       */
      bus.publish({ type: "heartbeat" });
      break;
    }

    default:
      getLogger().warn("[webhookServer] Topic webhook không xử lý", { topic: (event as { topic: string }).topic });
  }
}
