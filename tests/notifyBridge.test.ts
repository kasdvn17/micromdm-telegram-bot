import assert from "node:assert/strict";
import test from "node:test";
import { EventBus } from "../src/events/eventBus";
import { attachNotifyBridge } from "../src/events/notifyBridge";

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("MDM lifecycle edits one Telegram message instead of sending notification spam", async () => {
  const bus = new EventBus();
  const sent: string[] = [];
  const edited: Array<{ messageId: number; text: string }> = [];
  attachNotifyBridge(bus, {
    send: async (message) => {
      sent.push(message);
      return 73;
    },
    edit: async (messageId, text) => {
      edited.push({ messageId, text });
    },
    isEnabled: () => true,
    setEnabled: () => undefined,
    setChatId: () => undefined,
  });

  bus.publish({
    type: "mdm.command.queued",
    command: "InstallProfile",
    commandUUID: "command-1",
  });
  await flush();
  bus.publish({
    type: "mdm.command.succeeded",
    command: "InstallProfile",
    commandUUID: "command-1",
  });
  await flush();

  assert.equal(sent.length, 1);
  assert.match(sent[0], /queue/i);
  assert.deepEqual(edited, [{ messageId: 73, text: "✅ Lệnh MDM thành công: InstallProfile" }]);
});
