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
 * Discord voice-call client backed by a user account (selfbot).
 *
 * discord.js-selfbot-v13 exposes DMChannel.call(), which creates a Discord
 * DM voice call. The library requires patchVoice:true for voice support.
 */
export function createDiscordCallService(
  token: string,
  targetUserId: string,
): DiscordCallServiceApi {
  const client = new Client({
    checkUpdate: false,
    patchVoice: true,
  });

  let ready = false;
  let loginPromise: Promise<void> | null = null;
  let activeConnection: { disconnect: () => void } | null = null;

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
    if (activeConnection) {
      try {
        activeConnection.disconnect();
      } catch (error) {
        getLogger().warn("[discord] Failed to disconnect active call", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      activeConnection = null;
    }
  }

  async function call(): Promise<DiscordCallResult> {
    try {
      await start();

      if (activeConnection) {
        return {
          ok: false,
          detail: "Đang có một cuộc gọi Discord khác.",
        };
      }

      const user = await client.users.fetch(targetUserId);
      const dmChannel = user.dmChannel ?? await user.createDM();

      const connection = await dmChannel.call({
        ring: true,
        selfDeaf: false,
        selfMute: true,
      });

      activeConnection = connection;
      getLogger().info("[discord] Voice call started", {
        targetUserId,
        targetUsername: user.username,
      });



      return {
        ok: true,
        detail: `Discord call đã được khởi tạo tới ${user.username} (${user.id}).`,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      getLogger().error("[discord] Voice call failed", {
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
