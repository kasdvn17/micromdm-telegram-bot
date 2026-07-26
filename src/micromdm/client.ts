import fetch from "node-fetch";
import { randomUUID } from "crypto";
import { parse as parsePlist } from "plist";
import { getLogger } from "../utils/logger";
import { MicroMdmError } from "../utils/errors";
import {
  MdmCommandPayload,
  MdmCommandQueuedResult,
  MdmCommandResult,
  MdmRequestType,
} from "../types/micromdm.types";

export interface MicroMdmClientOptions {
  baseUrl: string;
  apiKey: string;
  /** ms chờ tối đa cho Acknowledge webhook trước khi coi là timeout */
  commandResultTimeoutMs: number;
}

interface PendingCommand {
  resolve: (result: MdmCommandResult) => void;
  reject: (err: Error) => void;
  requestType: MdmRequestType;
  timeout: NodeJS.Timeout;
}

/**
 * Low-level client nói chuyện trực tiếp với MicroMDM REST API.
 *
 * Lưu ý quan trọng về mô hình async của MDM protocol: khi queue 1 command
 * qua POST /v1/commands, MicroMDM chỉ trả về command_uuid ngay lập tức -
 * đó KHÔNG phải là kết quả thực thi trên thiết bị. Kết quả thật (Acknowledged/
 * Error/NotNow) chỉ đến sau, qua webhook `mdm.Connect` (payload `acknowledge_event`)
 * mà MicroMDM gọi ngược lại vào server này (xem enrollment/webhookServer.ts).
 *
 * Class này cung cấp `sendCommandAndWait()` để "giả lập" hành vi đồng bộ:
 * queue command, rồi chờ webhook Acknowledge tương ứng tới (khớp theo
 * command_uuid) trong `commandResultTimeoutMs`, hoặc reject nếu timeout.
 */
export class MicroMdmClient {
  private readonly pending = new Map<string, PendingCommand>();

  constructor(private readonly options: MicroMdmClientOptions) {}

  decodeBase64Plist(rawPayloadBase64: string): Record<string, unknown> {
    try {
      const xml = Buffer.from(rawPayloadBase64, "base64").toString("utf-8");
      return parsePlist(xml) as Record<string, unknown>;
    } catch (err) {
      getLogger().error("[micromdm] Parse plist raw_payload thất bại", {
        error: (err as Error).message,
      });
      return {};
    }
  }

  /**
   * Gọi bởi webhookServer khi nhận được sự kiện mdm.Connect (acknowledge_event).
   * `rawPayloadBase64` là base64 của plist XML THẬT mà thiết bị gửi (theo Apple MDM
   * Protocol Reference) - decode + parse ở đây, KHÔNG phải JSON đã parse sẵn.
   */
  resolveAcknowledge(
    commandUUID: string,
    status: "Acknowledged" | "Error" | "NotNow",
    rawPayloadBase64?: string
  ): void {
    const pending = this.pending.get(commandUUID);
    if (!pending) return; // không có ai đang chờ command này (fire-and-forget) - bỏ qua
    clearTimeout(pending.timeout);
    this.pending.delete(commandUUID);

    let parsed: Record<string, unknown> = {};
    if (rawPayloadBase64)
      parsed = this.decodeBase64Plist(rawPayloadBase64);
    getLogger().info(`[micromdm] Acknowledge nhận được ${commandUUID}`, {
      status,
      raw: parsed,
    });

    pending.resolve({
      commandUUID,
      requestType: pending.requestType,
      status,
      raw: parsed,
    });
  }

  /** Queue command, không chờ kết quả (fire-and-forget) - dùng cho Lock/Restart/PlaySound... */
  async queueCommand(payload: MdmCommandPayload): Promise<MdmCommandQueuedResult> {
    const commandUUID = randomUUID();
    const body = { ...payload, command_uuid: commandUUID };

    const res = await fetch(`${this.options.baseUrl}/v1/commands`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new MicroMdmError(
        `MicroMDM trả lỗi khi queue command ${payload.request_type}`,
        res.status,
        text
      );
    }

    // Sau khi queue, gửi push để đánh thức thiết bị lấy command ngay (nếu online)
    await this.sendPush(payload.udid);

    getLogger().info("[micromdm] Command queued", {
      commandUUID,
      requestType: payload.request_type,
    });

    return {
      commandUUID,
      requestType: payload.request_type,
      queuedAt: new Date().toISOString(),
    };
  }

  /**
   * Queue command và chờ Acknowledge qua webhook trước khi resolve.
   * Dùng cho các command cần đọc dữ liệu trả về (DeviceInformation, DeviceLocation).
   */
  async sendCommandAndWait(payload: MdmCommandPayload): Promise<MdmCommandResult> {
    const queued = await this.queueCommand(payload);

    return new Promise<MdmCommandResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(queued.commandUUID);
        reject(
          new MicroMdmError(
            `Timeout chờ Acknowledge cho command ${payload.request_type} ` +
              `(commandUUID=${queued.commandUUID}). Thiết bị có thể đang offline.`
          )
        );
      }, this.options.commandResultTimeoutMs);

      this.pending.set(queued.commandUUID, {
        resolve,
        reject,
        requestType: payload.request_type,
        timeout,
      });
    });
  }

  /**
   * Gửi RAW plist command qua endpoint /v1/commands/<udid> (khác endpoint JSON
   * /v1/commands). Dùng cho các command mà field casing trong JSON schema của
   * MicroMDM CHƯA verify được chắc chắn (vd Settings/MDMOptions cho Activation
   * Lock) - ở đây ta tự build plist XML đúng theo Apple MDM Protocol Reference,
   * tránh đoán sai tên field JSON nội bộ của MicroMDM.
   * Xem: "Schedule Raw Commands with the API" trong docs/user-guide/api-and-webhooks.md
   */
  /**
   * Giống sendRawCommand() nhưng CHỜ Acknowledge qua webhook trước khi resolve -
   * dùng cho các raw command cần đọc dữ liệu trả về (vd InstalledApplicationList).
   * `commandUUID` PHẢI khớp với <key>CommandUUID</key> đã nhúng sẵn trong `plistXml`
   * (caller tự generate UUID và nhúng vào plist trước khi gọi hàm này).
   */
  async sendRawCommandAndWait(
    udid: string,
    commandUUID: string,
    plistXml: string
  ): Promise<MdmCommandResult> {
    const waitPromise = new Promise<MdmCommandResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(commandUUID);
        reject(
          new MicroMdmError(
            `Timeout chờ Acknowledge cho raw command (commandUUID=${commandUUID}). ` +
              `Thiết bị có thể đang offline.`
          )
        );
      }, this.options.commandResultTimeoutMs);

      // requestType không quan trọng lắm ở raw command (chỉ dùng để log lại) -
      // để "RawCommand" làm placeholder chung.
      this.pending.set(commandUUID, { resolve, reject, requestType: "InstallProfile", timeout });
    });

    const res = await fetch(`${this.options.baseUrl}/v1/commands/${udid}`, {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/xml" },
      body: plistXml,
    });

    if (!res.ok) {
      const text = await res.text();
      this.pending.delete(commandUUID);
      throw new MicroMdmError(`MicroMDM trả lỗi khi queue raw command`, res.status, text);
    }

    await this.sendPush(udid);
    getLogger().info("[micromdm] Raw command (wait) queued", { commandUUID, udid });

    return waitPromise;
  }

  async sendRawCommand(
    udid: string,
    requestType: MdmRequestType,
    plistXml: string
  ): Promise<MdmCommandQueuedResult> {
    const commandUUID = randomUUID();
    const res = await fetch(`${this.options.baseUrl}/v1/commands/${udid}`, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/xml",
      },
      body: plistXml,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new MicroMdmError(`MicroMDM trả lỗi khi queue raw command`, res.status, text);
    }

    await this.sendPush(udid);
    getLogger().info("[micromdm] Raw command queued", { commandUUID, udid, requestType });

    return { commandUUID, requestType, queuedAt: new Date().toISOString() };
  }

  async installProfile(udid: string, mobileConfigBase64: string): Promise<MdmCommandQueuedResult> {
    return this.queueCommand({
      udid,
      request_type: "InstallProfile",
      payload: mobileConfigBase64,
    });
  }

  async removeProfile(udid: string, profileIdentifier: string): Promise<MdmCommandQueuedResult> {
    return this.queueCommand({
      udid,
      request_type: "RemoveProfile",
      Identifier: profileIdentifier,
    });
  }

  private async sendPush(udid: string): Promise<void> {
    try {
      const res = await fetch(`${this.options.baseUrl}/push/${udid}`, {
        method: "GET",
        headers: this.authHeaders(),
      });
      if (!res.ok) {
        getLogger().warn("[micromdm] Push thất bại (thiết bị có thể offline)", {
          udid,
          status: res.status,
        });
      }
    } catch (err) {
      getLogger().warn("[micromdm] Push lỗi network", { udid, error: (err as Error).message });
    }
  }

  private authHeaders(): Record<string, string> {
    const basic = Buffer.from(`micromdm:${this.options.apiKey}`).toString("base64");
    return {
      "Content-Type": "application/json",
      Authorization: `Basic ${basic}`,
    };
  }
}
