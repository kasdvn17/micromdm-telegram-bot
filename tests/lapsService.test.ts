import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createLapsService } from "../src/services/lapsService";
import { EventBus } from "../src/events/eventBus";

test("LapsService handles checkin, action queue, and password reports", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "micromdm-laps-test-"));
  const stateFile = path.join(dir, "laps-state.json");
  const bus = new EventBus();
  const apiKey = "test-secret-key";

  try {
    const lapsService = createLapsService(stateFile, apiKey, bus);

    // 1. Check validateApiKey
    assert.equal(lapsService.validateApiKey(apiKey), true);
    assert.equal(lapsService.validateApiKey("wrong-key"), false);

    // 2. Initial checkin from agent
    const checkinResp = lapsService.handleCheckin(apiKey, {
      serial: "C02TESTSERIAL",
      hostname: "MacBook-Pro",
      ip: "192.168.1.50",
      adminUser: "sysadmin",
      isTargetAdmin: true,
      targetUser: "blamm01",
      agentVersion: "1.1.0",
    });

    assert.equal(checkinResp.ok, true);
    assert.equal(checkinResp.action, null);

    const status1 = lapsService.getStatus();
    assert.equal(status1.serialNumber, "C02TESTSERIAL");
    assert.equal(status1.isBlamm01Admin, true);

    // 3. Request rotate now
    await lapsService.requestRotateNow();
    const checkinWithAction = lapsService.handleCheckin(apiKey, {
      serial: "C02TESTSERIAL",
      hostname: "MacBook-Pro",
      adminUser: "sysadmin",
      isTargetAdmin: true,
      targetUser: "blamm01",
      agentVersion: "1.1.0",
    });

    assert.equal(checkinWithAction.action?.type, "rotate_now");

    // 4. Report rotate result
    const reportResp = lapsService.handleReport(apiKey, {
      actionId: checkinWithAction.action?.id,
      type: "rotate_result",
      success: true,
      newPassword: "SuperSecureRandomPass123!",
    });

    assert.equal(reportResp.ok, true);

    const creds = lapsService.getPassword();
    assert.equal(creds.password, "SuperSecureRandomPass123!");
    assert.equal(creds.adminUser, "sysadmin");

    // Action should be cleared after reporting
    const statusAfterReport = lapsService.getStatus();
    assert.equal(statusAfterReport.pendingAction, null);

    // 5. Demote request and report
    await lapsService.requestDemote("blamm01");
    lapsService.handleReport(apiKey, {
      type: "demote_result",
      success: true,
    });

    const statusAfterDemote = lapsService.getStatus();
    assert.equal(statusAfterDemote.isBlamm01Admin, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
