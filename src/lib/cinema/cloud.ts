import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { DEFAULT_WATCH } from "./gas-script";
import { THEATERS } from "./theaters";
import type { AlertItem, BookingIntent, WatchConfig } from "./types";
import { CHART_SIZE, normalizeScanSources } from "./types";
import { normalizeTheme } from "@/lib/theme";

export type CloudSnapshot = {
  config: WatchConfig;
  queue: BookingIntent[];
  alerts: AlertItem[];
  onlyAlerted: boolean;
  primed: boolean;
  seenIds: string[];
  seenDates: string[];
  watchSig: string;
};

export function hydrateConfig(raw: unknown): WatchConfig {
  const c = (raw ?? {}) as Partial<WatchConfig>;
  const formats = { ...DEFAULT_WATCH.formats, ...(c.formats ?? {}) };
  return {
    ...DEFAULT_WATCH,
    ...c,
    ranks: clampRanks(c.ranks),
    watchTitles: Array.isArray(c.watchTitles)
      ? c.watchTitles.map(String)
      : DEFAULT_WATCH.watchTitles,
    formats,
    theaters: Object.fromEntries(
      THEATERS.map((t) => [t.id, (formats[t.id] ?? []).length > 0]),
    ) as WatchConfig["theaters"],
    scanSources: normalizeScanSources(c.scanSources),
    telegramToken: String(c.telegramToken ?? ""),
    telegramChatId: String(c.telegramChatId ?? ""),
    webhookUrl: String(c.webhookUrl ?? ""),
    email: String(c.email ?? ""),
    emailNotify:
      typeof c.emailNotify === "boolean"
        ? c.emailNotify
        : Boolean(String(c.email ?? "").trim()),
    gmailAppPassword: String(c.gmailAppPassword ?? ""),
    kakaoRestKey: String(c.kakaoRestKey ?? ""),
    kakaoRefreshToken: String(c.kakaoRefreshToken ?? ""),
    xApiKey: String(c.xApiKey ?? ""),
    xApiSecret: String(c.xApiSecret ?? ""),
    xAccessToken: String(c.xAccessToken ?? ""),
    xAccessSecret: String(c.xAccessSecret ?? ""),
    xClientId: String(c.xClientId ?? ""),
    xClientSecret: String(c.xClientSecret ?? ""),
    xRefreshToken: String(c.xRefreshToken ?? ""),
    gasWebUrl: String(c.gasWebUrl ?? ""),
    gasSyncKey: String(c.gasSyncKey ?? ""),
    gasScriptId: String(c.gasScriptId ?? ""),
    gasSourceStamp: String(c.gasSourceStamp ?? ""),
    theme: normalizeTheme(c.theme),
  };
}

function clampRanks(raw: unknown): number[] {
  const list = Array.isArray(raw)
    ? raw.filter((n): n is number => typeof n === "number" && n >= 1 && n <= CHART_SIZE)
    : [];
  return list.length ? list : DEFAULT_WATCH.ranks;
}

function asList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

function mergeById<T extends { id: string }>(a: T[], b: T[], cap: number): T[] {
  const map = new Map<string, T>();
  for (const item of [...a, ...b]) {
    if (item && item.id) map.set(item.id, item);
  }
  return [...map.values()].slice(0, cap);
}

function mergeTitles(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const title of [...a, ...b]) {
    const key = title.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(title.trim());
  }
  return out;
}

export function mergeSnapshots(
  remote: CloudSnapshot | null,
  local: CloudSnapshot,
): CloudSnapshot {
  if (!remote) return local;
  const config = hydrateConfig({
    ...local.config,
    ...remote.config,
    telegramToken: remote.config.telegramToken || local.config.telegramToken,
    telegramChatId: remote.config.telegramChatId || local.config.telegramChatId,
    email: remote.config.email || local.config.email,
    gmailAppPassword:
      remote.config.gmailAppPassword || local.config.gmailAppPassword,
    webhookUrl: remote.config.webhookUrl || local.config.webhookUrl,
    kakaoRestKey: remote.config.kakaoRestKey || local.config.kakaoRestKey,
    kakaoRefreshToken:
      remote.config.kakaoRefreshToken || local.config.kakaoRefreshToken,
    gasWebUrl: remote.config.gasWebUrl || local.config.gasWebUrl,
    gasSyncKey: remote.config.gasSyncKey || local.config.gasSyncKey,
    gasScriptId: remote.config.gasScriptId || local.config.gasScriptId,
    watchTitles: mergeTitles(
      remote.config.watchTitles ?? [],
      local.config.watchTitles ?? [],
    ),
  });
  return {
    config,
    queue: mergeById(remote.queue, local.queue, 40),
    alerts: mergeById(remote.alerts, local.alerts, 2000),
    onlyAlerted: remote.onlyAlerted || local.onlyAlerted,
    primed: remote.primed || local.primed,
    seenIds: [...new Set([...remote.seenIds, ...local.seenIds])].slice(-2500),
    seenDates: [...new Set([...remote.seenDates, ...local.seenDates])].slice(-40),
    watchSig: remote.watchSig || local.watchSig,
  };
}

function gasPayload(config: WatchConfig, queue: BookingIntent[]) {
  const payload: Record<string, unknown> = {
    ranks: config.ranks,
    extraTitles: config.watchTitles ?? [],
    theaters: THEATERS.filter((t) => config.theaters[t.id]).map((t) => t.id),
    formats: config.formats,
    daysAhead: config.daysAhead,
    intervalMin: config.intervalMin <= 1 ? 1 : config.intervalMin <= 5 ? 5 : 10,
    scanSources: normalizeScanSources(config.scanSources),
    syncKey: config.gasSyncKey,
    queued: queue.slice(0, 20).map((q) => ({
      id: q.showtimeId,
      title: q.movieTitle,
      url: q.bookingUrl,
    })),
  };
  const secrets: Array<keyof WatchConfig> = [
    "email",
    "telegramToken",
    "telegramChatId",
    "webhookUrl",
    "kakaoRestKey",
    "kakaoRefreshToken",
    "xApiKey",
    "xApiSecret",
    "xAccessToken",
    "xAccessSecret",
    "xClientId",
    "xClientSecret",
    "xRefreshToken",
  ];
  for (const key of secrets) {
    const value = String(config[key] ?? "").trim();
    if (value) payload[key] = value;
  }
  return payload;
}

export async function pingGasHeartbeat(url: string, key = "", src = "page") {
  const raw = String(url || "").trim();
  if (!raw) return;
  try {
    const target = new URL(raw);
    const host = target.hostname;
    if (
      !host.endsWith("script.google.com") &&
      !host.endsWith("googleusercontent.com")
    ) {
      return;
    }
    target.searchParams.set("op", "beat");
    target.searchParams.set("src", src === "tick" ? "tick" : "page");
    if (key.trim()) target.searchParams.set("key", key.trim());
    await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // 예비 스크립트가 잠시 안 받아도 메인 알림은 그대로 갑니다.
  }
}

async function fetchGasText(url: URL): Promise<string> {
  const res = await fetch(url.toString(), {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  return res.text();
}

function looksJsonOk(text: string): boolean {
  try {
    const json = JSON.parse(text) as { ok?: boolean };
    return Boolean(json && json.ok);
  } catch {
    return false;
  }
}

export type GasPushResult =
  | { status: "skipped"; reason: string }
  | { status: "ok" }
  | { status: "need-script" }
  | { status: "error"; message: string };

async function pushGasConfig(
  config: WatchConfig,
  queue: BookingIntent[],
): Promise<GasPushResult> {
  const raw = config.gasWebUrl.trim();
  if (!raw) return { status: "skipped", reason: "no-url" };
  if (!config.gasSyncKey) return { status: "skipped", reason: "no-key" };
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return { status: "error", message: "웹앱 주소가 올바르지 않습니다." };
  }
  const host = target.hostname;
  if (
    !host.endsWith("script.google.com") &&
    !host.endsWith("googleusercontent.com")
  ) {
    return { status: "error", message: "구글 스크립트 주소만 사용할 수 있습니다." };
  }
  const payload = JSON.stringify({
    key: config.gasSyncKey,
    config: gasPayload(config, queue),
  });
  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += 1100) {
    chunks.push(payload.slice(i, i + 1100));
  }
  try {
    const start = new URL(raw);
    start.searchParams.set("op", "sync");
    start.searchParams.set("phase", "start");
    start.searchParams.set("key", config.gasSyncKey);
    start.searchParams.set("n", String(chunks.length));
    const startText = await fetchGasText(start);
    if (startText.trim() === "openbell" || startText.trim() === "ok") {
      return { status: "need-script" };
    }
    let startJson: { ok?: boolean; error?: string } = {};
    try {
      startJson = JSON.parse(startText) as { ok?: boolean; error?: string };
    } catch {
      return { status: "need-script" };
    }
    if (startJson.error === "key") {
      return {
        status: "error",
        message: "동기화 키가 다릅니다. 설정에서 코드를 다시 붙여넣으세요.",
      };
    }
    if (!startJson.ok) return { status: "need-script" };

    for (let i = 0; i < chunks.length; i++) {
      const part = new URL(raw);
      part.searchParams.set("op", "sync");
      part.searchParams.set("phase", "chunk");
      part.searchParams.set("i", String(i));
      part.searchParams.set("d", chunks[i]);
      const partText = await fetchGasText(part);
      if (!looksJsonOk(partText)) return { status: "need-script" };
    }

    const end = new URL(raw);
    end.searchParams.set("op", "sync");
    end.searchParams.set("phase", "end");
    end.searchParams.set("key", config.gasSyncKey);
    const endText = await fetchGasText(end);
    if (looksJsonOk(endText)) return { status: "ok" };
    return { status: "need-script" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "스크립트에 보내지 못했습니다.",
    };
  }
}

async function chunkGasOp(
  raw: string,
  key: string,
  op: "sync" | "upgrade",
  payload: string,
): Promise<GasPushResult> {
  const target = parseGasUrl(raw);
  if (!target) return { status: "error", message: "웹앱 주소가 올바르지 않습니다." };
  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += 1100) {
    chunks.push(payload.slice(i, i + 1100));
  }
  try {
    const start = new URL(target.toString());
    start.searchParams.set("op", op);
    start.searchParams.set("phase", "start");
    start.searchParams.set("key", key);
    start.searchParams.set("n", String(chunks.length));
    const startText = await fetchGasText(start);
    if (startText.trim() === "openbell" || startText.trim() === "ok") {
      return { status: "need-script" };
    }
    let startJson: { ok?: boolean; error?: string } = {};
    try {
      startJson = JSON.parse(startText) as { ok?: boolean; error?: string };
    } catch {
      return { status: "need-script" };
    }
    if (startJson.error === "key") {
      return {
        status: "error",
        message: "동기화 키가 다릅니다. 설정에서 코드를 다시 붙여넣으세요.",
      };
    }
    if (!startJson.ok) return { status: "need-script" };

    for (let i = 0; i < chunks.length; i++) {
      const part = new URL(target.toString());
      part.searchParams.set("op", op);
      part.searchParams.set("phase", "chunk");
      part.searchParams.set("i", String(i));
      part.searchParams.set("d", chunks[i]);
      const partText = await fetchGasText(part);
      if (!looksJsonOk(partText)) return { status: "need-script" };
    }

    const end = new URL(target.toString());
    end.searchParams.set("op", op);
    end.searchParams.set("phase", "end");
    end.searchParams.set("key", key);
    const endText = await fetchGasText(end);
    if (looksJsonOk(endText)) return { status: "ok" };
    return { status: "need-script" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "스크립트에 보내지 못했습니다.",
    };
  }
}

export const upgradeExistingGas = createServerFn({ method: "POST" })
  .validator(
    z.object({
      url: z.string().min(8),
      key: z.string().min(8),
      source: z.string().min(20),
    }),
  )
  .handler(async ({ data }) => {
    return chunkGasOp(data.url, data.key, "upgrade", data.source);
  });

export const pullGasMeta = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string() }))
  .handler(async ({ data }) => {
    const parsed = parseGasUrl(data.url);
    if (!parsed) return { status: "error" as const };
    parsed.searchParams.set("op", "meta");
    try {
      const text = await fetchGasText(parsed);
      const json = JSON.parse(text) as {
        ok?: boolean;
        id?: string;
        url?: string;
        stamp?: string;
      };
      if (!json?.ok || !json.id) return { status: "need-script" as const };
      return {
        status: "ok" as const,
        scriptId: String(json.id),
        url: String(json.url || ""),
        stamp: String(json.stamp || ""),
      };
    } catch {
      return { status: "need-script" as const };
    }
  });

export type GasAlertStatus =
  | { status: "skipped"; reason: string }
  | { status: "error"; message: string }
  | {
      status: "ok";
      grokMain: boolean;
      remainMs: number;
      waitMs: number;
      beat: number;
      tick: number;
      intervalMin: number;
    };

export const pullGasAlertStatus = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string() }))
  .handler(async ({ data }): Promise<GasAlertStatus> => {
    const parsed = parseGasUrl(data.url);
    if (!parsed) return { status: "skipped", reason: "no-url" };
    parsed.searchParams.set("op", "status");
    try {
      const text = await fetchGasText(parsed);
      const json = JSON.parse(text) as {
        ok?: boolean;
        grokMain?: boolean;
        remainMs?: number;
        waitMs?: number;
        beat?: number;
        tick?: number;
        intervalMin?: number;
      };
      if (!json?.ok) return { status: "error", message: "status" };
      return {
        status: "ok",
        grokMain: Boolean(json.grokMain),
        remainMs: Number(json.remainMs || 0),
        waitMs: Number(json.waitMs || 0),
        beat: Number(json.beat || 0),
        tick: Number(json.tick || 0),
        intervalMin: Number(json.intervalMin || 5),
      };
    } catch {
      return { status: "error", message: "status" };
    }
  });

export function snapshotFromRow(row: {
  config: unknown;
  queue: unknown;
  alerts?: unknown;
  prefs?: unknown;
}): CloudSnapshot {
  const prefs = parseJson<Partial<CloudSnapshot>>(row.prefs, {});
  return {
    config: hydrateConfig(parseJson(row.config, {})),
    queue: asList<BookingIntent>(row.queue),
    alerts: asList<AlertItem>(row.alerts ?? prefs.alerts),
    onlyAlerted: Boolean(prefs.onlyAlerted),
    primed: Boolean(prefs.primed),
    seenIds: asList<string>(prefs.seenIds),
    seenDates: asList<string>(prefs.seenDates),
    watchSig: String(prefs.watchSig ?? ""),
  };
}

export const loadCloudSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { ensureUserSettingsSchema } = await import("./settings-schema.server");
    await ensureUserSettingsSchema();
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql.query<{
      config: unknown;
      queue: unknown;
      alerts: unknown;
      prefs: unknown;
    }>(
      "select config, queue, alerts, prefs from user_settings where user_id = $1 limit 1",
      [context.userId],
    );
    const row = rows[0];
    if (!row) return { snapshot: null as CloudSnapshot | null };
    return { snapshot: snapshotFromRow(row) };
  });

const SaveInput = z.object({
  config: z.unknown(),
  queue: z.array(z.unknown()).optional(),
  alerts: z.array(z.unknown()).optional(),
  onlyAlerted: z.boolean().optional(),
  primed: z.boolean().optional(),
  seenIds: z.array(z.string()).optional(),
  seenDates: z.array(z.string()).optional(),
  watchSig: z.string().optional(),
});

export const saveCloudSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(SaveInput)
  .handler(async ({ context, data }) => {
    const { ensureUserSettingsSchema } = await import("./settings-schema.server");
    await ensureUserSettingsSchema();
    const snapshot: CloudSnapshot = {
      config: hydrateConfig(data.config),
      queue: asList<BookingIntent>(data.queue),
      alerts: asList<AlertItem>(data.alerts),
      onlyAlerted: Boolean(data.onlyAlerted),
      primed: Boolean(data.primed),
      seenIds: asList<string>(data.seenIds).slice(-2500),
      seenDates: asList<string>(data.seenDates).slice(-40),
      watchSig: String(data.watchSig ?? ""),
    };
    const prefs = {
      onlyAlerted: snapshot.onlyAlerted,
      primed: snapshot.primed,
      seenIds: snapshot.seenIds,
      seenDates: snapshot.seenDates,
      watchSig: snapshot.watchSig,
    };
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const account = await sql.query<{ email: string }>(
      `select email from "user" where id = $1 limit 1`,
      [context.userId],
    );
    const accountEmail = String(account[0]?.email ?? "").trim();
    if (accountEmail) {
      snapshot.config.email = accountEmail;
    }
    await sql.query(
      `insert into user_settings (user_id, config, queue, alerts, prefs, updated_at)
       values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, now())
       on conflict (user_id) do update set
         config = excluded.config,
         queue = excluded.queue,
         alerts = excluded.alerts,
         prefs = excluded.prefs,
         updated_at = now()`,
      [
        context.userId,
        JSON.stringify(snapshot.config),
        JSON.stringify(snapshot.queue),
        JSON.stringify(snapshot.alerts),
        JSON.stringify(prefs),
      ],
    );
    const gas = await pushGasConfig(snapshot.config, snapshot.queue);
    return { ok: true as const, gas };
  });

export const publishToGas = createServerFn({ method: "POST" })
  .validator(SaveInput)
  .handler(async ({ data }) => {
    const config = hydrateConfig(data.config);
    const queue = asList<BookingIntent>(data.queue);
    const gas = await pushGasConfig(config, queue);
    return { ok: true as const, gas };
  });

export type GasNotify = {
  email: string;
  telegramToken: string;
  telegramChatId: string;
  webhookUrl: string;
  kakaoRestKey: string;
  kakaoRefreshToken: string;
  xApiKey: string;
  xApiSecret: string;
  xAccessToken: string;
  xAccessSecret: string;
  xClientId: string;
  xClientSecret: string;
  xRefreshToken: string;
};

export type GasPullResult =
  | { status: "ok"; notify: GasNotify }
  | { status: "need-script" }
  | { status: "error"; message: string }
  | { status: "skipped"; reason: string };

export function mergeNotifyFromGas(
  local: WatchConfig,
  gas: GasNotify,
  mode: "fill" | "prefer-gas",
): Partial<WatchConfig> {
  const pick = (localValue: string, gasValue: string) =>
    mode === "prefer-gas"
      ? gasValue.trim() || localValue
      : localValue.trim() || gasValue;
  return {
    email: pick(local.email, gas.email),
    telegramToken: pick(local.telegramToken, gas.telegramToken),
    telegramChatId: pick(local.telegramChatId, gas.telegramChatId),
    webhookUrl: pick(local.webhookUrl, gas.webhookUrl),
    kakaoRestKey: pick(local.kakaoRestKey, gas.kakaoRestKey),
    kakaoRefreshToken: pick(local.kakaoRefreshToken, gas.kakaoRefreshToken),
    xApiKey: pick(local.xApiKey, gas.xApiKey),
    xApiSecret: pick(local.xApiSecret, gas.xApiSecret),
    xAccessToken: pick(local.xAccessToken, gas.xAccessToken),
    xAccessSecret: pick(local.xAccessSecret, gas.xAccessSecret),
    xClientId: pick(local.xClientId, gas.xClientId),
    xClientSecret: pick(local.xClientSecret, gas.xClientSecret),
    xRefreshToken: pick(local.xRefreshToken, gas.xRefreshToken),
  };
}

function parseGasUrl(raw: string): URL | null {
  try {
    const target = new URL(raw.trim());
    const host = target.hostname;
    if (
      !host.endsWith("script.google.com") &&
      !host.endsWith("googleusercontent.com")
    ) {
      return null;
    }
    return target;
  } catch {
    return null;
  }
}

export const pullGasNotify = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string() }))
  .handler(async ({ data }): Promise<GasPullResult> => {
    if (!data.url.trim()) return { status: "skipped", reason: "no-url" };
    const parsed = parseGasUrl(data.url);
    if (!parsed) {
      return { status: "error", message: "구글 스크립트 주소만 사용할 수 있습니다." };
    }
    parsed.searchParams.set("op", "config");
    try {
      const text = await fetchGasText(parsed);
      if (text.trim() === "openbell" || text.trim() === "ok") {
        return { status: "need-script" };
      }
      const json = JSON.parse(text) as Partial<GasNotify> & { ok?: boolean };
      if (!json || json.ok !== true) return { status: "need-script" };
      return {
        status: "ok",
        notify: {
          email: String(json.email ?? ""),
          telegramToken: String(json.telegramToken ?? ""),
          telegramChatId: String(json.telegramChatId ?? ""),
          webhookUrl: String(json.webhookUrl ?? ""),
          kakaoRestKey: String(json.kakaoRestKey ?? ""),
          kakaoRefreshToken: String(json.kakaoRefreshToken ?? ""),
          xApiKey: String(json.xApiKey ?? ""),
          xApiSecret: String(json.xApiSecret ?? ""),
          xAccessToken: String(json.xAccessToken ?? ""),
          xAccessSecret: String(json.xAccessSecret ?? ""),
          xClientId: String(json.xClientId ?? ""),
          xClientSecret: String(json.xClientSecret ?? ""),
          xRefreshToken: String(json.xRefreshToken ?? ""),
        },
      };
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : "스크립트에서 불러오지 못했습니다.",
      };
    }
  });
