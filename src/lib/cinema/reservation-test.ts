import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { kstDateKeys } from "@/lib/utils";
import { fetchCgvOfficial, fetchCgvNaver } from "./cgv.server";
import { fetchMegaboxSchedule, fetchNaverMegabox } from "./megabox.server";
import { escapeAttr, formatPlayDate, formatClock, showAlertBody } from "./seats";
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

const CGV_SITES: Record<"cgv_yongsan" | "cgv_yeongdeungpo", { siteNo: string; siteNm: string }> = {
  cgv_yongsan: { siteNo: "0013", siteNm: "용산아이파크몰" },
  cgv_yeongdeungpo: { siteNo: "0059", siteNm: "영등포타임스퀘어" },
};

const MEGA_BRCH: Record<"megabox_coex" | "megabox_namyangju", string> = {
  megabox_coex: "1351",
  megabox_namyangju: "0019",
};

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

function param(url: string, key: string) {
  const hit = String(url || "").match(new RegExp(`[?&]${key}=([^&#]*)`, "i"));
  return hit ? decodeURIComponent(hit[1]) : "";
}

function clockKey(raw: string) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 3) return "";
  const padded = digits.length === 3 ? `0${digits}` : digits.slice(0, 4);
  return `${padded.slice(0, 2)}:${padded.slice(2)}`;
}

function padScreen(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? digits.padStart(3, "0") : "";
}

function buildCgvUrl(opts: {
  siteNo: string;
  siteNm: string;
  movNo: string;
  scnYmd: string;
  scnsNo?: string;
  scnSseq?: string;
}) {
  if (!opts.movNo || !opts.scnYmd) return "";
  const q = new URLSearchParams({
    movNo: opts.movNo,
    scnYmd: opts.scnYmd,
    siteNo: opts.siteNo,
    siteNm: opts.siteNm,
  });
  if (opts.scnsNo) q.set("scnsNo", padScreen(opts.scnsNo));
  if (opts.scnSseq) q.set("scnSseq", String(opts.scnSseq));
  return `https://cgv.co.kr/cnm/movieBook/movie?${q.toString()}`;
}

function deepCgvUrl(url: string, playDate = "") {
  const movNo = param(url, "movNo");
  const scnYmd = param(url, "scnYmd") || playDate;
  const scnsNo = param(url, "scnsNo");
  const scnSseq = param(url, "scnSseq");
  if (!movNo || !scnYmd || !scnsNo || !scnSseq) return "";
  return buildCgvUrl({
    siteNo: param(url, "siteNo"),
    siteNm: param(url, "siteNm"),
    movNo,
    scnYmd,
    scnsNo,
    scnSseq,
  });
}

function deepMegaUrl(url: string, playDate = "", brchNo = "") {
  const playSchdlNo = param(url, "playSchdlNo");
  if (!playSchdlNo) return "";
  const q = new URLSearchParams({ playSchdlNo });
  const brch = brchNo || param(url, "brchNo");
  const playDe = playDate || param(url, "playDe");
  if (brch) q.set("brchNo", brch);
  if (playDe) q.set("playDe", playDe);
  const movieNo = param(url, "movieNo");
  if (movieNo) q.set("movieNo", movieNo);
  return `https://www.megabox.co.kr/booking/seat?${q.toString()}`;
}

function deepUrl(show: Showtime) {
  if (show.theaterId.startsWith("cgv_")) return deepCgvUrl(show.bookingUrl, show.playDate);
  const brch = show.theaterId === "megabox_coex" || show.theaterId === "megabox_namyangju" ? MEGA_BRCH[show.theaterId] : "";
  return deepMegaUrl(show.bookingUrl, show.playDate, brch);
}

function isDeep(show: Showtime) {
  return Boolean(deepUrl(show));
}

function walkRows(node: unknown, out: Record<string, unknown>[] = [], depth = 0) {
  if (node == null || depth > 8) return out;
  if (Array.isArray(node)) {
    for (const item of node) walkRows(item, out, depth + 1);
    return out;
  }
  if (typeof node !== "object") return out;
  const row = node as Record<string, unknown>;
  const time = String(row.scnsrtTm || row.startTime || row.playStartTime || "");
  const seq = row.scnSseq ?? row.scnsrtNo ?? row.sseq ?? row.playSseq ?? row.SCN_SSEQ;
  const screen = row.scnsNo ?? row.scrnNo ?? row.scnNo ?? row.theabNo ?? row.SCNS_NO;
  if (time && (seq != null || screen != null)) out.push(row);
  for (const child of Object.values(row)) {
    if (child && typeof child === "object") walkRows(child, out, depth + 1);
  }
  return out;
}

async function fetchCgvSchByMov(siteNo: string, playDate: string, movNo: string) {
  const scopes = ["01", "08"];
  for (const scope of scopes) {
    try {
      const res = await fetch(
        `https://api.cgv.co.kr/cnm/atkt/searchSchByMov?coCd=A420&siteNo=${siteNo}&scnYmd=${playDate}&movNo=${movNo}&rtctlScopCd=${scope}`,
        {
          headers: {
            accept: "application/json, text/plain, */*",
            "accept-language": "ko-KR,ko;q=0.9",
            origin: "https://cgv.co.kr",
            referer: "https://cgv.co.kr/",
            "user-agent":
              "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(4000),
        },
      );
      if (!res.ok) continue;
      const json = await res.json();
      const rows = walkRows(json);
      if (rows.length) return rows;
    } catch {
      /* try next scope */
    }
  }
  return [] as Record<string, unknown>[];
}

async function enrichCgv(show: Showtime): Promise<Showtime> {
  if (!show.theaterId.startsWith("cgv_")) return show;
  const ready = deepUrl(show);
  if (ready) return { ...show, bookingUrl: ready };
  const site = show.theaterId === "cgv_yongsan" || show.theaterId === "cgv_yeongdeungpo"
    ? CGV_SITES[show.theaterId]
    : null;
  if (!site) return show;
  const movNo = show.movieNo || param(show.bookingUrl, "movNo");
  if (!movNo) return show;
  const rows = await fetchCgvSchByMov(site.siteNo, show.playDate, movNo);
  const want = clockKey(show.startTime);
  const matched = rows.find((row) => clockKey(String(row.scnsrtTm || row.startTime || "")) === want) || rows[0];
  if (!matched) return show;
  const scnsNo = padScreen(String(matched.scnsNo ?? matched.scrnNo ?? matched.scnNo ?? matched.theabNo ?? param(show.bookingUrl, "scnsNo") ?? ""));
  const scnSseq = String(matched.scnSseq ?? matched.scnsrtNo ?? matched.sseq ?? matched.playSseq ?? param(show.bookingUrl, "scnSseq") ?? "");
  const url = buildCgvUrl({ ...site, movNo, scnYmd: show.playDate, scnsNo, scnSseq });
  return url ? { ...show, movieNo: movNo, bookingUrl: url } : show;
}

async function enrichMega(show: Showtime): Promise<Showtime> {
  const brch = show.theaterId === "megabox_coex" || show.theaterId === "megabox_namyangju" ? MEGA_BRCH[show.theaterId] : "";
  const ready = deepMegaUrl(show.bookingUrl, show.playDate, brch);
  return ready ? { ...show, bookingUrl: ready } : show;
}

function pickDeep(shows: Showtime[], today: string, nowTime: string) {
  const usable = shows.filter((s) => s && s.bookable !== false && isDeep(s));
  const todayFuture = usable.filter((s) => s.playDate === today && String(s.startTime).slice(0, 5) >= nowTime);
  const later = usable.filter((s) => s.playDate > today);
  const pool = todayFuture.length ? todayFuture : later.length ? later : usable;
  if (!pool.length) return null;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  const url = deepUrl(chosen);
  return url ? { ...chosen, bookingUrl: url } : null;
}

async function fetchDay(theaterId: TheaterId, date: string): Promise<Showtime[]> {
  try {
    if (theaterId === "cgv_yongsan" || theaterId === "cgv_yeongdeungpo") {
      const official = await fetchCgvOfficial(theaterId, date);
      let extra: Showtime[] = [];
      try {
        extra = (await fetchCgvNaver(theaterId)).get(date) ?? [];
      } catch {
        extra = [];
      }
      return [...official, ...extra];
    }
    const official = await fetchMegaboxSchedule(theaterId, date, { ignoreCircuit: true, timeoutMs: 8000 }).catch(() => []);
    if (official.some((row) => param(row.bookingUrl, "playSchdlNo"))) return official;
    try {
      const naver = await fetchNaverMegabox(theaterId);
      return [...official, ...(naver.get(date) ?? [])];
    } catch {
      return official;
    }
  } catch {
    return [];
  }
}

async function pickTheaterShow(theaterId: TheaterId, now: { date: string; time: string }) {
  const dates = kstDateKeys(7);
  const collected: Showtime[] = [];
  for (const date of dates) {
    collected.push(...(await fetchDay(theaterId, date)));
    const enriched = theaterId.startsWith("cgv_")
      ? await Promise.all(collected.filter((s) => !isDeep(s) && (s.movieNo || param(s.bookingUrl, "movNo"))).slice(0, 8).map(enrichCgv))
      : collected.map((s) => {
          const url = deepMegaUrl(
            s.bookingUrl,
            s.playDate,
            theaterId === "megabox_coex" || theaterId === "megabox_namyangju" ? MEGA_BRCH[theaterId] : "",
          );
          return url ? { ...s, bookingUrl: url } : s;
        });
    const merged = new Map<string, Showtime>();
    for (const row of [...collected, ...enriched]) merged.set(row.id, row);
    const hit = pickDeep([...merged.values()], now.date, now.time);
    if (hit) return theaterId.startsWith("cgv_") ? enrichCgv(hit) : enrichMega(hit);
  }
  const any = collected.find((s) => s.bookable !== false);
  if (any) {
    const enriched = theaterId.startsWith("cgv_") ? await enrichCgv(any) : await enrichMega(any);
    if (isDeep(enriched)) return enriched;
  }
  return fallbackShow(theaterId, now);
}

function fallbackShow(theaterId: TheaterId, now: { date: string; time: string }): Showtime {
  const theater = theaterById(theaterId);
  const bookingUrl = theaterId === "cgv_yongsan" || theaterId === "cgv_yeongdeungpo"
    ? `https://cgv.co.kr/cnm/movieBook/cinema?siteNo=${CGV_SITES[theaterId].siteNo}&siteNm=${encodeURIComponent(CGV_SITES[theaterId].siteNm)}&date=${now.date}`
    : `https://www.megabox.co.kr/booking?brchNo=${MEGA_BRCH[theaterId]}&playDe=${now.date}`;
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
    bookingUrl,
    bookable: true,
  };
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
  const href = escapeAttr(show.bookingUrl);
  const link = href ? `\n<a href="${href}">바로 예매</a>` : "";
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
        bookingUrl: show.bookingUrl,
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
