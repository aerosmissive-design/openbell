import assert from "node:assert/strict";
import { test } from "node:test";
import { createSession, notifyPaymentReady } from "./openbell-api.js";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("createSession posts /api/booking/create and returns id", async () => {
  const calls: string[] = [];
  const id = await createSession(
    {
      openbellUrl: "https://openbell-fawn.vercel.app",
      workerToken: "t",
      theaterId: "CGV용산아이파크몰",
      movieTitle: "영화",
      playDate: "2026-09-20",
      showtime: "20:10",
      hall: "20관",
      requestedSeatCount: 2,
    },
    {
      fetch: async (url) => {
        calls.push(String(url));
        return jsonResponse(200, { ok: true, session: { id: "abc" } });
      },
    },
  );
  assert.equal(id, "abc");
  assert.equal(calls[0], "https://openbell-fawn.vercel.app/api/booking/create");
});

test("notifyPaymentReady does not retry 401", async () => {
  let n = 0;
  await assert.rejects(
    () =>
      notifyPaymentReady(
        {
          openbellUrl: "https://openbell-fawn.vercel.app",
          workerToken: "t",
          sessionId: "s",
          url: "https://cgv.co.kr/pay",
          seats: ["E5", "E6"],
        },
        {
          fetch: async () => {
            n += 1;
            return new Response("unauthorized", { status: 401 });
          },
          sleep: async () => {
            throw new Error("sleep should not run on 401");
          },
        },
      ),
    /OPENBELL_PAYMENT_READY_FAILED:401/,
  );
  assert.equal(n, 1);
});

test("notifyPaymentReady retries 500 then succeeds", async () => {
  const sleeps: number[] = [];
  let n = 0;
  await notifyPaymentReady(
    {
      openbellUrl: "https://openbell-fawn.vercel.app",
      workerToken: "t",
      sessionId: "s",
      url: "https://cgv.co.kr/pay",
      seats: ["E5"],
    },
    {
      fetch: async () => {
        n += 1;
        if (n === 1) return new Response("boom", { status: 502 });
        return jsonResponse(200, { ok: true, hardStop: true });
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  );
  assert.equal(n, 2);
  assert.deepEqual(sleeps, [500]);
});
