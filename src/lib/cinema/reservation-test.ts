import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { kstDateKeys } from "@/lib/utils";
import { fetchCgvOfficial, fetchCgvRelaySeatmap, fetchCgvNaver } from "./cgv.server";
import { fetchMegaboxSchedule } from "./megabox.server";
import { alertBookingUrl, formatPlayDate, formatClock, showAlertBody } from "./seats";
import { theaterById } from "./theaters";
import type { Showtime, TheaterId } from "./types";

const Input = z.object({
  channel: z.enum(["mail", "telegram", "kakao"]),
  email: z.string().optional(),
  gmailAppPassword: z.string().optional(),
  gasWebUrl: z.string().optional(),
  telegramToken: z.string().optional(),
  telegramChatId: z.string().optional(),
  kakaoRestKey: z.string().optional(),
  kakaoRefreshToken: z.string().optional(),
});

const THEATERS = [
  "cgv_yongsan",
  "cgv_yeongdeungpo",
  "megabox_coex",
  "megabox_namyangju",
] as const satisfies readonly TheaterId[];

function kstNow() {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value || "";
  return { date: `${get("year")}${get("month")}${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function pick(shows: Showtime[], today: string, nowTime: string) {
  const usable = shows.filter((s) => s && s.bookable !== false);
  const todayFuture = usable.filter((s) => s.playDate === today && String(s.startTime).slice(0, 5) >= nowTime);
  const pool = todayFuture.length ? todayFuture : usable.filter((s) => s.playDate >= today);
  const ranked = pool.length ? pool : usable;
  if (!ranked.length) return null;
  const withUrl = ranked.filter((s) => String(s.bookingUrl || "").trim());
  const source = withUrl.length ? withUrl : ranked;
  return source[Math.floor(Math.random() * source.length)];
}

function isExactCgvUrl(url: string) {
  return /cgv\.co\.kr\/cnm\/movieBook\/movie\?[^#]*movNo=[^#]*scnYmd=[^#]*scnsNo=[^#]*scnSseq=/i.test(url);
}

function isExactMegaboxUrl(url: string) {
  return /(?:www\.|m\.)?megabox\.co\.kr\/booking\/seat\?[^#]*playSchdlNo=/i.test(url) ||
    /megabox\.co\.kr\/on\/oh\/ohz\/PcntSeatChoi\/selectPcntSeatChoi\.do\?[^#]*playSchdlNo=/i.test(url);
}

function sameShow(a: Showtime, b: Showtime) {
  const titleA = a.movieTitle.replace(/\s+/g, "").toLowerCase();
  const titleB = b.movieTitle.replace(/\s+/g, "").toLowerCase();
  const hallA = a.hallName.replace(/\s+/g, "").toLowerCase();
  const hallB = b.hallName.replace(/\s+/g, "").toLowerCase();
  return a.playDate === b.playDate &&
    String(a.startTime).slice(0, 5) === String(b.startTime).slice(0, 5) &&
    titleA === titleB &&
    (!hallA || !hallB || hallA === hallB || hallA.includes(hallB) || hallB.includes(hallA));
}

async function findExactOrBestCgvShow(theaterId: "cgv_yongsan" | "cgv_yeongdeungpo", candidate: Showtime) {
  const rows = await fetchCgvOfficial(theaterId, candidate.playDate);
  const matches = rows.filter((row) => sameShow(row, candidate));
  const exact = matches.filter((row) => isExactCgvUrl(row.bookingUrl));
  return exact[Math.floor(Math.random() * Math.max(1, exact.length))] ||
    matches[Math.floor(Math.random() * Math.max(1, matches.length))] ||
    candidate;
}

async function findExactOrBestMegaboxShow(theaterId: "megabox_coex" | "megabox_namyangju", candidate: Showtime) {
  const rows = await fetchMegaboxSchedule(theaterId, candidate.playDate, { ignoreCircuit: true, timeoutMs: 8000 });
  const matches = rows.filter((row) => sameShow(row, candidate));
  const exact = matches.filter((row) => isExactMegaboxUrl(row.bookingUrl));
  return exact[Math.floor(Math.random() * Math.max(1, exact.length))] ||
    matches[Math.floor(Math.random() * Math.max(1, matches.length))] ||
    candidate;
}

async function fetchCandidates(theaterId: TheaterId, dates: string[]) {
  const all: Showtime[] = [];
  for (const date of dates) {
    if (theaterId.startsWith("cgv_")) {
      let rows: Showtime[] = [];
      try {
        rows = await fetchCgvOfficial(theaterId, date);
      } catch {
        rows = [];
      }
      if (!rows.length) {
        try {
          const relay = await fetchCgvRelaySeatmap({ theaterId, days: 1, fresh: true });
          rows = relay.showtimes.filter((s) => s.playDate === date);
        } catch {
          rows = [];
        }
      }
      if (!rows.length) {
        try {
          const naver = await fetchCgvNaver(theaterId);
          rows = naver.get(date) ?? [];
        } catch {
          rows = [];
        }
      }
      all.push(...rows);
      continue;
    }

    try {
      const rows = await fetchMegaboxSchedule(theaterId, date, { ignoreCircuit: true, timeoutMs: 8000 });
      all.push(...rows);
    } catch {
      // keep going
    }
  }
  return all;
}

function fallbackShow(theaterId: TheaterId, now: { date: string; time: string }): Showtime {
  const theater = theaterById(theaterId);
  return {
    id: `test-fallback:${theaterId}:${now.date}`,
    theaterId,
    theaterName: theater.name,
    chain: theater.chain,
    movieTitle: `${theater.shortName} 예매 테스트`,
    movieNo: "",
    playDate: now.date,
    startTime: now.time,
    endTime: null,
    hallName: theater.name,
    formats: [],
    restSeats: null,
    totalSeats: null,
    bookingUrl: theater.bookingUrl,
    bookable: true,
  };
}

async function pickTheaterShow(theaterId: TheaterId, now: { date: string; time: string }) {
  const dates = kstDateKeys(3);
  let candidate: Showtime | null = null;
  try {
    const candidates = await fetchCandidates(theaterId, dates);
    candidate = pick(candidates, now.date, now.time);
  } catch {
    candidate = null;
  }
  if (!candidate) return fallbackShow(theaterId, now);
  try {
    const best = theaterId === "cgv_yongsan" || theaterId === "cgv_yeongdeungpo"
      ? await findExactOrBestCgvShow(theaterId, candidate)
      : await findExactOrBestMegaboxShow(theaterId, candidate);
    return best || candidate;
  } catch {
    return candidate;
  }
}

async function findTestShows(now: { date: string; time: string }) {
  const picked = await Promise.all(THEATERS.map((id) => pickTheaterShow(id, now)));
  return THEATERS.map((id, i) => picked[i] || fallbackShow(id, now));
}

function cardText(show: Showtime) {
  const theater = theaterById(show.theaterId);
  const place = showAlertBody(show) || [theater.name, formatPlayDate(show.playDate), formatClock(show.startTime), show.hallName].filter(Boolean).join(" · ");
  return { title: `${show.movieTitle} 예매 오픈`, body: place, theater: theater.name };
}

function telegramCard(show: Showtime) {
  const card = cardText(show);
  const href = alertBookingUrl(show) || show.bookingUrl;
  const link = href ? `\n<a href="${href.replace(/&/g, "&").replace(/"/g, """)}">바로 예매</a>` : "";
  return `<b>${card.title}</b>\n${card.body}${link}`;
}

async function kakaoSend(restKey: string, refreshToken: string, text: string, bookingUrl: string) {
  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: restKey, refresh_token: refreshToken }), signal: AbortSignal.timeout(10000) });
  const token = await tokenRes.json() as { access_token?: string; error_description?: string };
  if (!token.access_token) throw new Error(token.error_description || "카카오 토큰이 만료되었습니다.");
  const res = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body: new URLSearchParams({ template_object: JSON.stringify({ object_type: "text", text: text.slice(0, 200), link: { web_url: bookingUrl, mobile_web_url: bookingUrl }, button_title: "바로 예매" }) }), signal: AbortSignal.timeout(10000) });
  const json = await res.json() as { result_code?: number; msg?: string };
  if (!res.ok || (json.result_code != null && json.result_code !== 0)) throw new Error(json.msg || "카카오톡 전송에 실패했습니다.");
}

async function telegramSend(token: string, chatId: string, html: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: /^-?\d+$/.test(chatId.trim()) ? Number(chatId.trim()) : chatId.trim(), text: html, parse_mode: "HTML", disable_web_page_preview: true }), signal: AbortSignal.timeout(10000) });
  const json = await res.json() as { ok?: boolean; description?: string };
  if (!json.ok) throw new Error(json.description || "텔레그램 전송에 실패했습니다.");
}

export const sendReservationTest = createServerFn({ method: "POST" })
  .validator(Input)
  .handler(async ({ data }) => {
    const selected = await findTestShows(kstNow());

    const items = selected.map((show, i) => {
      const card = cardText(show);
      return {
        id: `alert:test-reservation:${show.theaterId}:${Date.now()}:${i}`,
        createdAt: new Date().toISOString(),
        kind: "open" as const,
        title: card.title,
        body: card.body,
        bookingUrl: alertBookingUrl(show) || show.bookingUrl,
        theaterId: show.theaterId,
        theaterName: card.theater,
        movieTitle: show.movieTitle,
        playDate: show.playDate,
        startTime: show.startTime,
        hallName: show.hallName,
        formats: show.formats,
        restSeats: show.restSeats,
        totalSeats: show.totalSeats,
        seatSource: show.seatSource,
      };
    });

    if (data.channel === "telegram") {
      if (!data.telegramToken?.trim() || !data.telegramChatId?.trim()) throw new Error("텔레그램을 먼저 연결하세요.");
      for (const show of selected) await telegramSend(data.telegramToken, data.telegramChatId, telegramCard(show));
    } else if (data.channel === "kakao") {
      if (!data.kakaoRestKey?.trim() || !data.kakaoRefreshToken?.trim()) throw new Error("카카오를 먼저 연결하세요.");
      for (const item of items) await kakaoSend(data.kakaoRestKey, data.kakaoRefreshToken, `${item.title}\n${item.body}`, item.bookingUrl);
    } else {
      if (!data.email?.trim()) throw new Error("메일 주소를 확인하세요.");
      const { sendOpenbellMail } = await import("./mail.server");
      for (const item of items) {
        const result = await sendOpenbellMail({
          to: data.email,
          subject: `[오픈벨] ${item.movieTitle} 예매 오픈`,
          text: `${item.title}\n${item.body}\n바로 예매 ${item.bookingUrl}`,
          url: item.bookingUrl,
          title: item.title,
          theater: item.theaterName,
          hall: item.hallName,
          date: item.playDate,
          time: item.startTime,
          items: [{ title: item.title, body: item.body, bookingUrl: item.bookingUrl }],
          gasWebUrl: data.gasWebUrl,
          gmailAppPassword: data.gmailAppPassword,
        });
        if (!result.ok) throw new Error(result.error);
      }
    }
    return { ok: true as const, count: items.length, theaters: items.map(({ theaterId, movieTitle, playDate, startTime, hallName, bookingUrl }) => ({ theaterId, movieTitle, playDate, startTime, hallName, bookingUrl })) };
  });
