import assert from "node:assert/strict";
import test from "node:test";
import { createEmergencyAuthService } from "../src/services/emergencyAuthService";
import { createAuthChecker } from "../src/telegram/authMiddleware";
import { AuthTier } from "../src/types/command.types";

test("numeric Telegram ID takes precedence over mutable username", () => {
  const emergency = createEmergencyAuthService("secret", "owner", 42);
  const check = createAuthChecker("owner", 42, emergency);
  assert.equal(check({ tier: AuthTier.Normal, telegramId: 42 }).ok, true);
  assert.equal(check({ tier: AuthTier.Normal, telegramId: 7, telegramUsername: "owner" }).ok, false);
  assert.equal(check({ tier: AuthTier.TwoFactor, telegramId: 42, passwordProvided: "secret" }).ok, true);
});
