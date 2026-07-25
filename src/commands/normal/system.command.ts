import fs from "fs";
import path from "path";
import { AuthTier, CommandContext, CommandDefinition } from "../../types/command.types";
import { EmergencyAuthServiceApi } from "../../services/emergencyAuthService";
import { readJsonState } from "../../utils/jsonStore";
import { ValidationError } from "../../utils/errors";

const START_TIME = Date.now();

export function createPingCommand(): CommandDefinition {
  return {
    name: "ping",
    tier: AuthTier.Normal,
    handler: async (): Promise<string> => "🏓 pong",
  };
}

export function createHealthCommand(): CommandDefinition {
  return {
    name: "health",
    tier: AuthTier.Normal,
    handler: async (): Promise<string> => {
      const uptimeSec = Math.floor((Date.now() - START_TIME) / 1000);
      return `✅ Bot đang chạy. Uptime: ${uptimeSec}s.`;
    },
  };
}

export function createWhoamiCommand(): CommandDefinition {
  return {
    name: "whoami",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<string> => {
      return `👤 Telegram ID: ${ctx.message.telegramId}\nUsername: @${ctx.message.telegramUsername ?? "(không có)"}`;
    },
  };
}

export function createLogsCommand(logDir: string): CommandDefinition {
  return {
    name: "logs",
    tier: AuthTier.Normal,
    handler: async (): Promise<string> => {
      if (!fs.existsSync(logDir)) return "📂 Chưa có log file nào.";
      const files = fs
        .readdirSync(logDir)
        .filter((f) => f.endsWith(".log"))
        .sort()
        .reverse();
      if (files.length === 0) return "📂 Chưa có log file nào.";

      const latest = path.join(logDir, files[0]);
      const content = fs.readFileSync(latest, "utf-8");
      const lastLines = content.trim().split("\n").slice(-20).join("\n");
      return `📄 ${files[0]} (20 dòng cuối):\n\`\`\`\n${lastLines}\n\`\`\``;
    },
  };
}

export function createHistoryCommand(historyFilePath: string): CommandDefinition {
  return {
    name: "history",
    tier: AuthTier.Normal,
    handler: async (): Promise<string> => {
      const history = readJsonState<Array<{ timestamp: string; event: { type: string } }>>(
        historyFilePath,
        []
      );
      if (history.length === 0) return "📜 Chưa có sự kiện nào được ghi lại.";
      const last20 = history.slice(-20);
      return last20.map((r) => `${r.timestamp} - ${r.event.type}`).join("\n");
    },
  };
}

export function createAuthTestCommand(emergencyAuth: EmergencyAuthServiceApi): CommandDefinition {
  return {
    name: "auth",
    tier: AuthTier.Normal,
    handler: async (ctx: CommandContext): Promise<string> => {
      const [sub, password] = ctx.effectiveArgs;
      if (sub !== "test") throw new ValidationError("Cú pháp: /auth test <password>");
      if (!password) throw new ValidationError("Cú pháp: /auth test <password>");
      const ok = emergencyAuth.verifyEmergencyPassword(password);
      return ok ? "✅ Mật khẩu đúng." : "❌ Mật khẩu sai.";
    },
  };
}
