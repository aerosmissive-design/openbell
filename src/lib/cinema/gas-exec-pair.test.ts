import assert from "node:assert/strict";
import test from "node:test";
import { envGasPair, pairGasExec } from "./gas-exec-pair.ts";

const aero = "https://script.google.com/macros/s/aero/exec";
const other = "https://script.google.com/macros/s/other/exec";

test("the same URL keeps its key when no new key is given", () => {
  const next = pairGasExec({ url: aero, key: "key-aero" }, { url: aero });
  assert.deepEqual(next, { url: aero, key: "key-aero" });
});

test("a different URL does not keep the previous key", () => {
  const next = pairGasExec({ url: aero, key: "key-aero" }, { url: other });
  assert.deepEqual(next, { url: other, key: "" });
});

test("a different URL uses only the key given with it", () => {
  const next = pairGasExec({ url: aero, key: "key-aero" }, { url: other, key: "key-other" });
  assert.deepEqual(next, { url: other, key: "key-other" });
});

test("a non GAS host does not change the stored pair", () => {
  const current = { url: aero, key: "key-aero" };
  assert.deepEqual(pairGasExec(current, { url: "https://example.test/exec", key: "nope" }), current);
});

test("an env key is not attached to a different remembered URL", () => {
  const current = { url: other, key: "" };
  assert.equal(envGasPair(current, "https://example.test/not-gas", "key-aero"), null);
  assert.deepEqual(envGasPair(current, aero, "key-aero"), { url: aero, key: "key-aero" });
  assert.deepEqual(envGasPair(current, aero, ""), { url: aero, key: "" });
});
