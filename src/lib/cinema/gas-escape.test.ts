import assert from "node:assert/strict";
import test from "node:test";
import { GAS_SOURCE_STAMP, buildGasScript, DEFAULT_WATCH, gasChunkSpan, gasPieces, gasStampIsCurrent, gasUpgradeSupported, sealGasSource } from "./gas-script";

test("gas code is current only when the stamp matches", () => {
  assert.equal(gasStampIsCurrent(GAS_SOURCE_STAMP), true);
  assert.equal(gasStampIsCurrent("20261007-job1"), false);
  assert.equal(gasStampIsCurrent(""), false);
  assert.equal(gasUpgradeSupported('{"ok":false,"error":"phase"}'), true);
  assert.equal(gasUpgradeSupported("openbell"), false);
  assert.deepEqual(gasChunkSpan(10, 0, 2), { from: 0, to: 2, more: true });
  assert.deepEqual(gasChunkSpan(10, 8, 2), { from: 8, to: 10, more: false });
  const raw = `${"한글".repeat(300)}abc`;
  const parts = gasPieces(raw, 800);
  assert.equal(parts.join(""), raw);
  for (const part of parts) assert.ok(encodeURIComponent(part).length <= 800);
});

test("sealGasSource escapes raw controls inside quotes", () => {
  const sealed = sealGasSource('var blob = lines.join("\n");');
  assert.equal(sealed, 'var blob = lines.join("\\n");');
  assert.doesNotThrow(() => new Function(sealed));
});

test("buildGasScript output parses", () => {
  const src = buildGasScript(
    {
      ...DEFAULT_WATCH,
      watchTitles: ["테스트\n영화", "a`b", "x${y}"],
      email: "a@b.com",
    },
    [],
  );
  assert.match(src, /lines\.join\("\\n"\)/);
  assert.match(src, /20261009-link/);
  assert.match(src, /error: "nodeploy"/);
  assert.match(src, /function rememberLiveSecrets_/);
  assert.match(src, /error: "busy"/);
  assert.doesNotThrow(() => new Function(src));
});
