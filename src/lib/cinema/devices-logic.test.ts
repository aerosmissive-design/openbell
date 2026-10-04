import assert from "node:assert/strict";
import test from "node:test";
import {
  applyApprove,
  applyPairRequest,
  applyReject,
  applyRevoke,
  applyStatus,
  emptyRegistry,
  freshness,
  hashDeviceKey,
  resolveDeviceKey,
} from "./devices-logic";

const now = Date.parse("2026-10-05T00:00:00+09:00");

test("pairing reuses a live code and then rate limits", () => {
  let reg = emptyRegistry();
  const first = applyPairRequest(reg, {
    deviceName: "G_PC",
    hostname: "DESK",
    agentVersion: "2.0.22",
    now,
    id: "pr1",
    code: "K7P4-M2",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  reg = first.reg;
  const again = applyPairRequest(reg, {
    deviceName: "G_PC",
    hostname: "DESK",
    agentVersion: "2.0.22",
    now: now + 1000,
    id: "pr2",
    code: "AAAA-BB",
  });
  assert.equal(again.ok && again.pairingRequestId, "pr1");
  for (let i = 0; i < 4; i++) {
    const next = applyPairRequest(reg, {
      deviceName: "G_PC",
      hostname: `OTHER${i}`,
      agentVersion: "2.0.22",
      now: now + i,
      id: `prX${i}`,
      code: `CODE-${i}${i}`,
    });
    assert.equal(next.ok, true);
    if (next.ok) reg = next.reg;
  }
  const blocked = applyPairRequest(reg, {
    deviceName: "G_PC",
    hostname: "SIXTH",
    agentVersion: "2.0.22",
    now: now + 10,
    id: "prZ",
    code: "ZZZZ-ZZ",
  });
  assert.equal(blocked.ok, false);
});

test("approve delivers the key only with the pairing code", () => {
  const requested = applyPairRequest(emptyRegistry(), {
    deviceName: "G_DS225+",
    hostname: "DS225",
    agentVersion: "1.0",
    now,
    id: "pr1",
    code: "K7P4-M2",
  });
  assert.equal(requested.ok, true);
  if (!requested.ok) return;
  const approved = applyApprove(requested.reg, {
    pairingId: "pr1",
    userId: "userA",
    mode: "approve",
    now: now + 1000,
    deviceId: "dev1",
    deviceKey: "secret-key",
    keyHash: hashDeviceKey("secret-key"),
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const missing = applyStatus(approved.reg, { pairingId: "pr1", code: "NOPE-00", now: now + 2000 });
  assert.equal(missing.deviceKey, "");
  const ready = applyStatus(approved.reg, { pairingId: "pr1", code: "K7P4-M2", now: now + 2000 });
  assert.equal(ready.deviceKey, "secret-key");
  const resolved = resolveDeviceKey(approved.reg, "secret-key");
  assert.equal(resolved.ok && resolved.userIds[0], "userA");
  assert.equal(resolveDeviceKey(approved.reg, "other").ok, false);
});

test("other account must replace, revoke blocks the old key", () => {
  let reg = emptyRegistry();
  const requested = applyPairRequest(reg, {
    deviceName: "G_PC",
    hostname: "DESK",
    agentVersion: "2.0.22",
    now,
    id: "pr1",
    code: "K7P4-M2",
  });
  if (!requested.ok) return;
  const approved = applyApprove(requested.reg, {
    pairingId: "pr1",
    userId: "userA",
    mode: "approve",
    now,
    deviceId: "dev1",
    deviceKey: "key-a",
    keyHash: hashDeviceKey("key-a"),
  });
  if (!approved.ok) return;
  reg = approved.reg;
  const second = applyPairRequest(reg, {
    deviceName: "G_PC",
    hostname: "DESK",
    agentVersion: "2.0.22",
    now: now + 1000,
    id: "pr2",
    code: "ABCD-EF",
  });
  if (!second.ok) return;
  const blocked = applyApprove(second.reg, {
    pairingId: "pr2",
    userId: "userB",
    mode: "approve",
    now: now + 1000,
    deviceId: "dev2",
    deviceKey: "key-b",
    keyHash: hashDeviceKey("key-b"),
  });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.error, "NEED_TRANSFER");
  const replaced = applyApprove(second.reg, {
    pairingId: "pr2",
    userId: "userB",
    mode: "replace",
    now: now + 2000,
    deviceId: "dev2",
    deviceKey: "key-b",
    keyHash: hashDeviceKey("key-b"),
  });
  assert.equal(replaced.ok, true);
  if (!replaced.ok) return;
  assert.equal(resolveDeviceKey(replaced.reg, "key-a").ok, false);
  const live = resolveDeviceKey(replaced.reg, "key-b");
  assert.equal(live.ok && live.device.ownerUserId, "userB");
  const revoked = applyRevoke(replaced.reg, { deviceId: live.ok ? live.device.id : "", userId: "userB", now: now + 3000 });
  assert.equal(revoked.ok, true);
  assert.equal(resolveDeviceKey(revoked.reg, "key-b").ok, false);
});

test("reject and expiry do not approve", () => {
  const requested = applyPairRequest(emptyRegistry(), {
    deviceName: "G_DS423+",
    hostname: "DS423",
    agentVersion: "1",
    now,
    id: "pr1",
    code: "K7P4-M2",
  });
  if (!requested.ok) return;
  const rejected = applyReject(requested.reg, { pairingId: "pr1", now });
  const approved = applyApprove(rejected.reg, {
    pairingId: "pr1",
    userId: "userA",
    mode: "approve",
    now,
    deviceId: "dev1",
    deviceKey: "k",
    keyHash: hashDeviceKey("k"),
  });
  assert.equal(approved.ok, false);
  const stale = applyApprove(requested.reg, {
    pairingId: "pr1",
    userId: "userA",
    mode: "approve",
    now: now + 11 * 60 * 1000,
    deviceId: "dev1",
    deviceKey: "k",
    keyHash: hashDeviceKey("k"),
  });
  assert.equal(stale.ok, false);
});

test("freshness windows", () => {
  assert.equal(freshness("", now), "NONE");
  assert.equal(freshness(new Date(now - 60_000).toISOString(), now), "ONLINE");
  assert.equal(freshness(new Date(now - 3 * 60_000).toISOString(), now), "DELAYED");
  assert.equal(freshness(new Date(now - 6 * 60_000).toISOString(), now), "OFFLINE");
});
