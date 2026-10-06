import assert from "node:assert/strict";
import test from "node:test";
import { postGasJson } from "./gas-post.ts";

test("GAS POST follows the result page with GET", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ url, method });
    if (method === "POST") {
      return new Response(null, { status: 302, headers: { location: "https://script.googleusercontent.com/macros/echo?user_content_key=test" } });
    }
    return new Response(JSON.stringify({ ok: true, count: 1 }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await postGasJson("https://script.google.com/macros/s/abc/exec", { theaterId: "megabox_coex", showtimes: [] });
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.text).ok, true);
    assert.deepEqual(calls.map((c) => c.method), ["POST", "GET"]);
    assert.equal(calls[1].url.includes("googleusercontent.com"), true);
  } finally {
    globalThis.fetch = original;
  }
});
