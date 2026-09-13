import { getSql } from "@/lib/db";
import { snapshotFromRow, pingGasHeartbeat, type CloudSnapshot } from "./cloud";
import { ensureUserSettingsSchema } from "./settings-schema.server";
import {
  dbLabel,
  readAppMeta,
  readLastNotify,
  readWatchLastRun,
  watchHost,
  writeLastNotify,
  writeWatchLastRun,
  type ChannelSendLog,
} from "./app-meta.server";
import { revealConfigSecrets } from "./secret-box.server";
import {
  filterWatched,
  primeIdsForWatchChange,
  watchedTitleSet,
  watchSignature,
} from "./match";
import { runScan } from "./scan-impl.server";
import { diffStarSeats, notifyBatches, notifyCopy, seatChangeAlert, showAlertBody } from "./seats";
import { THEATERS } from "./theaters";
import type { AlertItem, BookingIntent, Showtime, TheaterId, WatchConfig } from "./types";
import { mailEnabled } from "./types";

function hostSeenFromPrefs(prefs: unknown): string[] {
  const bag =
    prefs && typeof prefs === "object"
      ? (prefs as { seenByHost?: unknown })
      : {};
  const byHost =
    bag.seenByHost && typeof bag.seenByHost === "object"
      ? (bag.seenByHost as Record<string, unknown>)
      : {};
  const mine = byHost[watchHost()];
  return Array.isArray(mine) ? mine.map(String) : [];
}

const THEATER_IDS = THEATERS.map((t) => t.id);
let lastRunAt = 0;

export async function watchTickHealth() {
  const stored = await readWatchLastRun();
  const last = Math.max(lastRunAt, stored);
  const notify = await readLastNotify();
  const githubRaw = await readAppMeta("github_watch_at");
  const githubAt = Number(githubRaw);
  const githubWakeAt = Number.isFinite(githubAt) && githubAt > 0 ? githubAt : 0;
  const externalRaw = await readAppMeta("external_watch_at");
  const externalAt = Number(externalRaw);
  const externalWakeAt =
    Number.isFinite(externalAt) && externalAt > 0 ? externalAt : 0;
  const { readCgvRelayWatch } = await import("./relay-watch.server");
  return {
    lastRunAt: last,
    ageMs: last ? Date.now() - last : null,
    alive: last > 0 && Date.now() - last < 10 * 60 * 1000,
    db: dbLabel(),
    lastNotify: notify,
    githubWakeAt,
    githubWakeAgeMs: githubWakeAt ? Date.now() - githubWakeAt : null,
    githubWakeAlive: githubWakeAt > 0 && Date.now() - githubWakeAt < 15 * 60 * 1000,
    externalWakeAt,
    externalWakeAgeMs: externalWakeAt ? Date.now() - externalWakeAt : null,
    externalWakeAlive:
      externalWakeAt > 0 && Date.now() - externalWakeAt < 15 * 60 * 1000,
    cgvRelay: await readCgvRelayWatch(),
  };
}

function uniqueCap(ids: string[], cap: number): string[] {
  return [...new Set(ids)].slice(-cap);
}

function toAlert(show: Showtime, all: Showtime[]): AlertItem {
  return {
    id: `alert:${show.id}:${Date.now()}`,
    createdAt: new Date().toISOString(),
    kind: "open",
    title: `${show.movieTitle} 예매 오픈`,
    body: showAlertBody(show, all),
    bookingUrl: show.bookingUrl,
    theaterId: show.theaterId,
    movieTitle: show.movieTitle,
    playDate: show.playDate,
    startTime: show.startTime,
    hallName: show.hallName,
    formats: show.formats,
    restSeats: show.restSeats,
    totalSeats: show.totalSeats,
  };
}

function canNotify(config: WatchConfig) {
  return Boolean(
    (config.telegramToken && config.telegramChatId) ||
      (config.kakaoRestKey && config.kakaoRefreshToken) ||
      config.webhookUrl.trim() ||
      mailEnabled(config),
  );
}

async function notifyRelayOutage(
  configs: WatchConfig[],
  watch: { theaters: TheaterId[]; durationMs: number },
) {
  const names =
    watch.theaters
      .map((id) => THEATERS.find((row) => row.id === id)?.shortName)
      .filter(Boolean)
      .join("·") || "용산·영등포";
  const mins = Math.max(15, Math.round(watch.durationMs / 60_000));
  const subject = `[오픈벨] ${names} 잔여석 우회조회가 막혔습니다`;
  const text = `${names} 잔여석이 ${mins}분째 없습니다. 시간표는 네이버로 유지됩니다. 우회조회가 돌아오면 좌석이 다시 붙습니다.`;
  const sent = new Set<string>();
  const { sendOpenbellMail } = await import("./mail.server");
  for (const config of configs) {
    if (!mailEnabled(config)) continue;
    const to = config.email.trim();
    if (!to || sent.has(to)) continue;
    sent.add(to);
    await sendOpenbellMail({
      to,
      subject,
      text,
      gasWebUrl: config.gasWebUrl,
      gmailAppPassword: config.gmailAppPassword,
    }).catch(() => null);
  }
}

async function sendTelegram(token: string, chatId: string, text: string, html?: boolean) {
  const res = await fetch(`https://api.telegram.org/bot${token.trim()}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: /^-?\d+$/.test(chatId.trim()) ? Number(chatId.trim()) : chatId.trim(),
      text,
      parse_mode: html ? "HTML" : undefined,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const json = (await res.json()) as { ok?: boolean };
  if (!json.ok) throw new Error("telegram");
}

async function sendKakao(restKey: string, refreshToken: string, text: string, url: string) {
  const tokenBody = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: restKey.trim(),
    refresh_token: refreshToken.trim(),
  });
  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: tokenBody,
    signal: AbortSignal.timeout(10000),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("kakao");
  const memoBody = new URLSearchParams({
    template_object: JSON.stringify({
      object_type: "text",
      text: text.slice(0, 200),
      link: { web_url: url, mobile_web_url: url },
      button_title: "바로 예매",
    }),
  });
  await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "content-type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: memoBody,
    signal: AbortSignal.timeout(10000),
  });
}

async function notifyChannels(config: WatchConfig, items: AlertItem[]) {
  const batches = notifyBatches(items, 8);
  const first = notifyCopy(batches[0] ?? items, { total: items.length });
  const { subject, text } = first;
  const log: ChannelSendLog = { at: Date.now() };
  const jobs: Promise<void>[] = [];
  if (config.telegramToken && config.telegramChatId) {
    jobs.push(
      (async () => {
        for (const part of batches) {
          const { telegramHtml } = notifyCopy(part, { total: items.length });
          await sendTelegram(
            config.telegramToken,
            config.telegramChatId,
            telegramHtml,
            true,
          );
        }
      })()
        .then(() => {
          log.telegram = "ok";
        })
        .catch((err: unknown) => {
          log.telegram = err instanceof Error ? err.message : "실패";
        }),
    );
  }
  if (config.kakaoRestKey && config.kakaoRefreshToken) {
    jobs.push(
      Promise.all(
        items.slice(0, 8).map((item) =>
          sendKakao(
            config.kakaoRestKey,
            config.kakaoRefreshToken,
            `${item.title}\n${item.body}`.slice(0, 200),
            item.bookingUrl || "https://www.megabox.co.kr",
          ),
        ),
      )
        .then(() => {
          log.kakao = "ok";
        })
        .catch((err: unknown) => {
          log.kakao = err instanceof Error ? err.message : "실패";
        }),
    );
  }
  if (config.webhookUrl.trim()) {
    jobs.push(
      fetch(config.webhookUrl.trim(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: items[0]?.title, items }),
        signal: AbortSignal.timeout(10000),
      })
        .then((res) => {
          log.webhook = res.ok ? "ok" : `실패 ${res.status}`;
        })
        .catch((err: unknown) => {
          log.webhook = err instanceof Error ? err.message : "실패";
        }),
    );
  }
  if (mailEnabled(config)) {
    const mailItems = items.slice(0, 20);
    const mailCopy = notifyCopy(mailItems, { total: items.length });
    jobs.push(
      import("./mail.server")
        .then(({ sendOpenbellMail }) =>
          sendOpenbellMail({
            to: config.email,
            subject,
            text: mailCopy.text,
            url: items[0]?.bookingUrl,
            items: mailItems.map((a) => ({
              title: a.title,
              body: a.body,
              bookingUrl: a.bookingUrl,
            })),
            gasWebUrl: config.gasWebUrl,
            gmailAppPassword: config.gmailAppPassword,
          }),
        )
        .then(() => {
          log.mail = "ok";
        })
        .catch((err: unknown) => {
          log.mail = err instanceof Error ? err.message : "실패";
        }),
    );
  }
  await Promise.all(jobs);
  await writeLastNotify(log);
}

async function persistWatch(
  userId: string,
  snap: CloudSnapshot,
  extras: {
    primed: boolean;
    seenIds: string[];
    seenDates: string[];
    watchSig: string;
    alerts: AlertItem[];
    queue: BookingIntent[];
  },
) {
  const sql = await getSql();
  const prevRows = await sql.query<{ prefs: unknown }>(
    "select prefs from user_settings where user_id = $1 limit 1",
    [userId],
  );
  let prevByHost: Record<string, string[]> = {};
  try {
    const raw = prevRows[0]?.prefs;
    const parsed =
      typeof raw === "string"
        ? JSON.parse(raw)
        : raw && typeof raw === "object"
          ? raw
          : {};
    const bag = (parsed as { seenByHost?: Record<string, unknown> }).seenByHost;
    if (bag && typeof bag === "object") {
      prevByHost = Object.fromEntries(
        Object.entries(bag).map(([key, val]) => [
          key,
          Array.isArray(val) ? val.map(String) : [],
        ]),
      );
    }
  } catch {
    prevByHost = {};
  }
  const prefs = {
    onlyAlerted: snap.onlyAlerted,
    primed: extras.primed,
    seenIds: uniqueCap(extras.seenIds, 2500),
    seenDates: uniqueCap(extras.seenDates, 40),
    watchSig: extras.watchSig,
    seenByHost: {
      ...prevByHost,
      [watchHost()]: uniqueCap(extras.seenIds, 2500),
    },
  };
  await sql.query(
    `update user_settings
     set alerts = $1::jsonb, prefs = $2::jsonb, queue = $3::jsonb, updated_at = now()
     where user_id = $4`,
    [
      JSON.stringify(extras.alerts.slice(0, 2000)),
      JSON.stringify(prefs),
      JSON.stringify(extras.queue.slice(0, 40)),
      userId,
    ],
  );
}

export async function runWatchTick() {
  const now = Date.now();
  const storedRun = await readWatchLastRun();
  if (now - Math.max(lastRunAt, storedRun) < 3 * 60 * 1000) {
    return { skipped: true as const, users: 0, sent: 0 };
  }
  lastRunAt = now;
  await writeWatchLastRun(now);
  try {
    await ensureUserSettingsSchema();
    const sql = await getSql();
  const rows = await sql.query<{
    user_id: string;
    config: unknown;
    queue: unknown;
    alerts: unknown;
    prefs: unknown;
    account_email: string | null;
  }>(
    `select us.user_id, us.config, us.queue, us.alerts, us.prefs, u.email as account_email
     from user_settings us
     left join "user" u on u.id = us.user_id`,
  );
  const accounts = rows
    .map((row) => {
      const snap = snapshotFromRow(row);
      snap.config = revealConfigSecrets(snap.config);
      const email = String(row.account_email || snap.config.email || "").trim();
      return {
        userId: row.user_id,
        hostSeen: hostSeenFromPrefs(row.prefs),
        snap: {
          ...snap,
          config: { ...snap.config, email },
        },
      };
    })
    .filter((row) => canNotify(row.snap.config));
  if (!accounts.length) {
    return { skipped: false as const, users: 0, sent: 0 };
  }
  const daysAhead = Math.min(
    14,
    Math.max(7, ...accounts.map((a) => a.snap.config.daysAhead || 7)),
  );
  const gasWebUrl =
    accounts.map((a) => a.snap.config.gasWebUrl.trim()).find(Boolean) || undefined;
  const scan = await runScan({
    daysAhead,
    theaters: THEATER_IDS as TheaterId[],
    gasWebUrl,
    sources: { official: true, naver: true, gas: Boolean(gasWebUrl) },
  });
  const { noteCgvRelayHealth } = await import("./relay-watch.server");
  const relayWatch = await noteCgvRelayHealth(scan.theaters);
  if (relayWatch.shouldAlert) {
    await notifyRelayOutage(accounts.map((a) => a.snap.config), relayWatch);
  }
  const allShows = scan.theaters.flatMap((t) => t.showtimes);
  let sent = 0;
  for (const { userId, snap, hostSeen } of accounts) {
    const config = snap.config;
    const enabled = new Set(
      THEATERS.filter((t) => config.theaters[t.id]).map((t) => t.id),
    );
    const titles = watchedTitleSet(scan.ranking, config);
    const watched = filterWatched(
      allShows.filter((s) => enabled.has(s.theaterId)),
      config,
      titles,
    );
    const sig = watchSignature(config);
    if (!hostSeen.length) {
      const primedQueue = diffStarSeats(snap.queue, allShows).nextQueue;
      await persistWatch(userId, snap, {
        primed: true,
        seenIds: uniqueCap(watched.map((s) => s.id), 2500),
        seenDates: snap.seenDates,
        watchSig: sig,
        alerts: snap.alerts,
        queue: primedQueue,
      });
      continue;
    }
    let extraSeen: string[] = [];
    let nextSig = snap.watchSig || sig;
    if (!snap.watchSig) {
      nextSig = sig;
    } else if (snap.watchSig !== sig) {
      extraSeen = primeIdsForWatchChange(snap.watchSig, config, scan.ranking, watched);
      nextSig = sig;
    }
    const seen = new Set([...hostSeen, ...extraSeen]);
    const fresh = watched.filter((s) => !seen.has(s.id));
    const nextSeen = uniqueCap(
      [...hostSeen, ...extraSeen, ...fresh.map((s) => s.id)],
      2500,
    );
    const { nextQueue, changes } = diffStarSeats(snap.queue, allShows);
    const items = [
      ...fresh.map((show) => toAlert(show, allShows)),
      ...changes.map((change) => seatChangeAlert(change, allShows)),
    ];
    if (items.length) {
      await notifyChannels(config, items);
      sent += items.length;
    }
    await persistWatch(userId, snap, {
      primed: true,
      seenIds: nextSeen,
      seenDates: uniqueCap(
        [...snap.seenDates, ...fresh.map((s) => s.playDate)],
        40,
      ),
      watchSig: nextSig,
      alerts: [...items, ...snap.alerts],
      queue: nextQueue,
    });
  }
    const beats = new Set(
      accounts
        .map((a) => a.snap.config.gasWebUrl.trim())
        .filter(Boolean),
    );
    await Promise.all(
      [...beats].map((url) => {
        const key =
          accounts.find((a) => a.snap.config.gasWebUrl.trim() === url)?.snap
            .config.gasSyncKey || "";
        return pingGasHeartbeat(url, key, "tick");
      }),
    );
    return { skipped: false as const, users: accounts.length, sent };
  } catch (err) {
    lastRunAt = 0;
    await writeWatchLastRun(0);
    throw err;
  }
}
