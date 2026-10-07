import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Account = z.object({
  label: z.string().max(40),
  url: z.string().max(400),
  key: z.string().max(80),
});

function gasHost(url: string) {
  try {
    const host = new URL(url).hostname;
    return host.endsWith("script.google.com") || host.endsWith("googleusercontent.com");
  } catch {
    return false;
  }
}

export const listAccountJobs = createServerFn({ method: "POST" })
  .validator(z.object({ accounts: z.array(Account).max(3) }))
  .handler(async ({ data }) => {
    const { listBookingJobs, jobDbFailure } = await import("./booking-jobs.server");
    const { postGasJson } = await import("./gas-post");
    let neon: unknown[] = [];
    let neonReason = "";
    try {
      neon = await listBookingJobs(40);
    } catch (err) {
      neonReason = jobDbFailure(err).reason;
    }
    const accounts = [];
    for (const account of data.accounts) {
      if (!gasHost(account.url) || !account.key.trim()) {
        accounts.push({ label: account.label, ok: false, jobs: [] as unknown[], error: "gas" });
        continue;
      }
      try {
        const { text } = await postGasJson(account.url, { op: "job", action: "list", key: account.key });
        const json = JSON.parse(text) as { ok?: boolean; jobs?: unknown[]; error?: string };
        accounts.push({
          label: account.label,
          ok: Boolean(json.ok),
          jobs: Array.isArray(json.jobs) ? json.jobs : [],
          error: json.ok ? "" : String(json.error || "gas"),
        });
      } catch {
        accounts.push({ label: account.label, ok: false, jobs: [] as unknown[], error: "gas" });
      }
    }
    return { ok: true as const, neon, neonReason, accounts };
  });

export const retryAccountJob = createServerFn({ method: "POST" })
  .validator(
    z.object({
      url: z.string().max(400),
      key: z.string().max(80),
      id: z.string().min(1).max(80),
      status: z.enum(["failed", "expired"]),
    }),
  )
  .handler(async ({ data }) => {
    const { retryFailedBookingJob } = await import("./booking-jobs.server");
    const { postGasJson } = await import("./gas-post");
    let neon = false;
    try {
      neon = Boolean(await retryFailedBookingJob(data.id));
    } catch {
      neon = false;
    }
    let gas = false;
    if (gasHost(data.url) && data.key.trim()) {
      try {
        const { text } = await postGasJson(data.url, { op: "job", action: "retry", key: data.key, id: data.id });
        const json = JSON.parse(text) as { ok?: boolean };
        gas = Boolean(json.ok);
      } catch {
        gas = false;
      }
    }
    return { ok: neon || gas, neon, gas };
  });
