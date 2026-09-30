import assert from "node:assert/strict";
import test from "node:test";
import { buildGasScript, DEFAULT_WATCH, sealGasSource } from "./gas-script";

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
  assert.doesNotThrow(() => new Function(src));
});
