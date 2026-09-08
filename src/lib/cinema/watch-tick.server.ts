import { getSql } from "@/lib/db";
import { snapshotFromRow, pingGasHeartbeat, type CloudSnapshot } from "./cloud";
import { ensureUserSettingsSchema } from "./settings-schema.server";
import {
  filterWatched,
  primeIdsForWatchChange,
  watchedTitleSet,
  watchSignature,
} from "./match";
import { runScan } from "./scan-impl.server";
import { diffStarSeats, notifyCopy, seatChangeAlert } from "./seats";
import { THEATERS } from "./theaters";
import type { AlertItem, BookingIntent, Showtime, TheaterId, WatchConfig } from "./types";
import { mailEnabled } from "./types";

const THEATER_IDS = THEATERS.map((t) => t.id);
let lastRunAt = 0;

function uniqueCap(ids: string[], cap: number): string[] {
  return [...new Set(ids)].slice(-cap);
}

function toAlert(show: Showtime): AlertItem {
  return {
    id: `alert:${show.id}:${Date.now()}`,
    createdAt: new Date().toISOString(),
    kind: "open",
    title: `${show.movieTitle} 예매 오픈`,
    body: `${show.theaterName} · ${show.hallName} · ${show.startTime}`,
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
  if (!tokenJson.access_token) return;
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
  const { subject, text, telegramHtml } = notifyCopy(items);
  const jobs: Promise<unknown>[] = [];
  if (config.telegramToken && config.telegramChatId) {
    jobs.push(
      sendTelegram(
        config.telegramToken,
        config.telegramChatId,
        telegramHtml,
        true,
      ).catch(() => null),
    );
  }
  if (config.kakaoRestKey && config.kakaoRefreshToken) {
    for (const item of items.slice(0, 8)) {
      jobs.push(
        sendKakao(
          config.kakaoRestKey,
          config.kakaoRefreshToken,
          `${item.title}\n${item.body}`.slice(0, 200),
          item.bookingUrl || "https://www.megabox.co.kr",
        ).catch(() => null),
      );
    }
  }
  if (config.webhookUrl.trim()) {
    jobs.push(
      fetch(config.webhookUrl.trim(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: items[0]?.title, items }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => null),
    );
  }
  if (mailEnabled(config)) {
    jobs.push(
      import("./mail.server").then(({ sendOpenbellMail }) =>
        sendOpenbellMail({
          to: config.email,
          subject,
          text,
          url: items[0]?.bookingUrl,
          items,
          gasWebUrl: config.gasWebUrl,
          gmailAppPassword: config.gmailAppPassword,
        }),
      ).catch(() => null),
    );
  }
  await Promise.all(jobs);
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
  const prefs = {
    onlyAlerted: snap.onlyAlerted,
    primed: extras.primed,
    seenIds: uniqueCap(extras.seenIds, 2500),
    seenDates: uniqueCap(extras.seenDates, 40),
    watchSig: extras.watchSig,
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
  if (now - lastRunAt < 3 * 60 * 1000) {
    return { skipped: true as const, users: 0, sent: 0 };
  }
  lastRunAt = now;
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
      const email = String(row.account_email || snap.config.email || "").trim();
      return {
        userId: row.user_id,
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
  const allShows = scan.theaters.flatMap((t) => t.showtimes);
  let sent = 0;
  for (const { userId, snap } of accounts) {
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
    if (!snap.primed) {
      const primedQueue = diffStarSeats(snap.queue, allShows).nextQueue;
      await persistWatch(userId, snap, {
        primed: true,
        seenIds: uniqueCap([...snap.seenIds, ...watched.map((s) => s.id)], 2500),
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
    const seen = new Set([...snap.seenIds, ...extraSeen]);
    const fresh = watched.filter((s) => !seen.has(s.id));
    const nextSeen = uniqueCap(
      [...snap.seenIds, ...extraSeen, ...fresh.map((s) => s.id)],
      2500,
    );
    const { nextQueue, changes } = diffStarSeats(snap.queue, allShows);
    const items = [...fresh.map(toAlert), ...changes.map(seatChangeAlert)];
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
        return pingGasHeartbeat(url, key);
      }),
    );
    return { skipped: false as const, users: accounts.length, sent };
  } catch (err) {
    lastRunAt = 0;
    throw err;
  }
}
