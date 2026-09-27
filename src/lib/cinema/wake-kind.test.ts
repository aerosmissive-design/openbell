import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wakeKindFromRequest } from "./wake-kind.ts";

function req(url: string, headers: Record<string, string> = {}) {
  const bag = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url,
    headers: { get: (name: string) => bag.get(name.toLowerCase()) ?? null },
  };
}

describe("wakeKindFromRequest", () => {
  it("keeps an outside cron off the GAS bucket", () => {
    assert.equal(wakeKindFromRequest(req("https://openbell.test/api/watch-tick?src=external")), "external");
    assert.equal(
      wakeKindFromRequest(req("https://openbell.test/api/watch-tick", { "user-agent": "openbell-gas-wake" })),
      "gas",
    );
    assert.equal(wakeKindFromRequest(req("https://openbell.test/api/watch-tick?src=gas")), "gas");
    assert.equal(
      wakeKindFromRequest(req("https://openbell.test/api/watch-tick", { "user-agent": "openbell-github-watch" })),
      "github",
    );
    assert.equal(
      wakeKindFromRequest(req("https://openbell.test/api/watch-tick", { "x-vercel-cron": "1" })),
      "vercel",
    );
  });
});
