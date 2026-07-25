import { AuthCheckInput, AuthResult, AuthTier } from "../types/command.types";
import { EmergencyAuthServiceApi } from "../services/emergencyAuthService";

export function createAuthChecker(
  authorizedUsername: string,
  emergencyAuth: EmergencyAuthServiceApi
) {
  return function checkAuth(input: AuthCheckInput): AuthResult {
    switch (input.tier) {
      case AuthTier.Normal: {
        const username = input.telegramUsername?.toLowerCase().replace(/^@/, "");
        if (username !== authorizedUsername) {
          return { ok: false, reason: "unauthorized_user" };
        }
        return { ok: true };
      }
      case AuthTier.Emergency: {
        if (!input.passwordProvided) return { ok: false, reason: "missing_password" };
        if (!emergencyAuth.verifyEmergencyPassword(input.passwordProvided)) {
          return { ok: false, reason: "wrong_password" };
        }
        return { ok: true };
      }
      case AuthTier.TwoFactor: {
        if (!input.passwordProvided) return { ok: false, reason: "missing_password" };
        if (!emergencyAuth.verifyTwoFactor(input.telegramUsername, input.passwordProvided)) {
          return { ok: false, reason: "wrong_password" };
        }
        return { ok: true };
      }
      default:
        return { ok: false, reason: "unauthorized_user" };
    }
  };
}
