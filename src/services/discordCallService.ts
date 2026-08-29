import { Client } from "discord.js-selfbot-v13";
import { getLogger } from "../utils/logger";

export interface DiscordCallResult {
  ok: boolean;
  detail: string;
}

export interface DiscordCallServiceApi {
  start(): Promise<void>;
  call(): Promise<DiscordCallResult>;
  stopActiveCall(): void;
}

/**
 * Discord DM call/ring client backed by a user account (selfbot).
 *
 * In discord.js-selfbot-v13 3.7.1, DMChannel does NOT expose call().
 * The supported DM call primitive in this version is DMChannel.ring(),
 * which sends Discord's DM call ring request to the recipient.
 *
 * We intentionally do not invent a local call duration: Discord/iOS controls
 * the lifetime of the actual call UI/session. The alarm scheduler can send
 * another ring request while a stage is active.
 */
export function createDiscordCallService(
  token: string,
  targetUserId: string,
): DiscordCallServiceApi {
  // v3.7.1 không khai báo checkUpdate/patchVoice trong ClientOptions;
  // truyền các key này khiến typecheck sai và thư viện cũng không cần chúng
  // để dùng DMChannel.sync()/ring().
  const client = new Client();

  let ready = false;
  let loginPromise: Promise<void> | null = null;

  client.on("ready", () => {
    ready = true;
    getLogger().info("[discord] Selfbot ready", {
      username: client.user?.username,
      targetUserId,
    });
  });

  client.on("error", (error) => {
    getLogger().error("[discord] Client error", { error: error.message });
  });

  async function start(): Promise<void> {
    if (ready) return;
    if (!loginPromise) {
      loginPromise = client.login(token).then(() => undefined);
    }
    await loginPromise;
  }

  function stopActiveCall(): void {
    // v3.7.1 does not expose a DM voice connection from DMChannel.call().
    // /alarm_stop therefore stops all future ring requests. If the recipient
    // has already answered a call, Discord/iOS owns that active session.
  }

  async function call(): Promise<DiscordCallResult> {
    try {
      await start();

      const user = await client.users.fetch(targetUserId);
      const dmChannel = user.dmChannel ?? await user.createDM();

      // In v3.7.1, DMChannel.call() is not exposed at runtime.
      // sync() sends the DM voice-state update used by the library, then
      // ring() sends the actual call-ring request.
      dmChannel.sync();
      await dmChannel.ring();

      getLogger().info("[discord] DM call ring sent", {
        targetUserId,
        targetUsername: user.username,
      });

      return {
        ok: true,
        detail: `OK: Đã gửi yêu cầu gọi Discord tới ${user.username} (${user.id}).`,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      getLogger().error("[discord] DM call ring failed", {
        targetUserId,
        error: detail,
      });
      return { ok: false, detail };
    }
  }

  return {
    start,
    call,
    stopActiveCall,
  };
}
