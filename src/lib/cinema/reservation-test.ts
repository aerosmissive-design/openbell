import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchCgvOfficial } from "./cgv.server";
import { fetchMegaboxSchedule } from "./megabox.server";
import { notifyCopy, showAlertBody } from "./seats";
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
  return {
    date: `${get("year")}${get("month")}${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function pick(shows: Showtime[], today: string, nowTime: string) {
  const usable = shows.filter((s) => s && s.bookable !== false);
  const todayFuture = usable.filter(
    (s) => s.playDate === today && String(s.startTime).slice(0, 5) >= nowTime,
  );
  const pool = todayFuture.length ? todayFuture : usable;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

function isExactCgvUrl(url: string) {
  return /cgv\.co\.kr\/cnm\/movieBook\/movie\?[^#]*movNo=[^#]*scnYmd=[^#]*scnsNo=[^#]*scnSseq=/i.test(url);
}

function isExactMegaboxUrl(url: string) {
  return /megabox\.co\.kr\/booking\/seat\?[^#]*playSchdlNo=/i.test(url) ||
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

async function exactCgvShow(theaterId: "cgv_yongsan" | "cgv_yeongdeungpo", candidate: Showtime) {
  const rows = await fetchCgvOfficial(theaterId, candidate.playDate);
  const matches = rows.filter((row) => sameShow(row, candidate) && isExactCgvUrl(row.bookingUrl));
  return matches[Math.floor(Math.random() * Math.max(matches.length, 1))] ?? null;
}

async function exactMegaboxShow(theaterId: "megabox_coex" | "megabox_namyangju", candidate: Showtime) {
  const rows = await fetchMegaboxSchedule(theaterId, candidate.playDate, { ignoreCircuit: true, timeoutMs: 8000 });
  const matches = rows.filter((row) => sameShow(row, candidate) && isExactMegaboxUrl(row.bookingUrl));
  return matches[Math.floor(Math.random() * Math.max(matches.length, 1))] ?? null;
}

async function findExactTestShows(now: { date: string; time: string }) {
  const selected: Showtime[] = [];
  const failures: string[] = [];

  for (const theaterId of THEATERS) {
    let candidates: Showtime[] = [];
    try {
      if (theaterId.startsWith("cgv_")) {
        // CGV exact 회차 파라미터는 공식 상영 API에서만 취합니다.
        candidates = await fetchCgvOfficial(theaterId, now.date);
        if (!candidates.some((s) => s.playDate === now.date && String(s.startTime).slice(0, 5) >= now.time)) {
          // CGV official endpoint may expose up to the supported upcoming window.
          const later = candidates.filter((s) => s.playDate >= now.date);
          candidates = later;
        }
      } else {
        candidates = await fetchMegaboxSchedule(theaterId, now.date, { ignoreCircuit: true, timeoutMs: 8000 });
      }
    } catch {
      candidates = [];
    }

    const candidate = pick(candidates, now.date, now.time);
    if (!candidate) {
      failures.push(theaterId);
      continue;
    }

    try {
      const exact = theaterId.startsWith("cgv_")
        ? await exactCgvShow(theaterId, candidate as Showtime)
        : await exactMegaboxShow(theaterId, candidate as Showtime);
      if (!exact) {
        failures.push(theaterId);
        continue;
      }
      selected.push(exact);
    } catch {
      failures.push(theaterId);
    }
  }

  if (failures.length || selected.length !== THEATERS.length) {
    throw new Error(
      `실제 예매 회차 URL을 확인하지 못했습니다: ${failures.join(", ") || "알 수 없는 극장"}. 잠시 뒤 다시 눌러 주세요.`,
    );
  }
  return selected;
}

async function kakaoSend(restKey: string, refreshToken: string, text: string, bookingUrl: string) {
  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: restKey, refresh_token: refreshToken }),
    signal: AbortSignal.timeout(10000),
  });
  const token = await tokenRes.json() as { access_token?: string; error_description?: string };
  if (!token.access_token) throw new Error(token.error_description || "카카오 토큰이 만료되었습니다.");
  const res = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token.access_token}`, "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({
      template_object: JSON.stringify({
        object_type: "text",
        text: text.slice(0, 200),
        link: { web_url: bookingUrl, mobile_web_url: bookingUrl },
        button_title: "바로 예매",
      }),
    }),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json() as { result_code?: number; msg?: string };
  if (!res.ok || (json.result_code != null && json.result_code !== 0)) throw new Error(json.msg || "카카오톡 전송에 실패했습니다.");
}

async function telegramSend(token: string, chatId: string, html: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: /^-?\d+$/.test(chatId.trim()) ? Number(chatId.trim()) : chatId.trim(),
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json() as { ok?: boolean; description?: string };
  if (!json.ok) throw new Error(json.description || "텔레그램 전송에 실패했습니다.");
}

export const sendReservationTest = createServerFn({ method: "POST" })
  .validator(Input)
  .handler(async ({ data }) => {
    const selected = await findExactTestShows(kstNow());
    const items = selected.map((show, i) => ({
      id: `alert:test-reservation:${show.id}:${Date.now()}:${i}`,
      createdAt: new Date().toISOString(),
      kind: "open" as const,
      title: `${show.movieTitle} 예매 오픈`,
      body: showAlertBody(show),
      bookingUrl: show.bookingUrl,
      theaterId: show.theaterId,
      movieTitle: show.movieTitle,
      playDate: show.playDate,
      startTime: show.startTime,
      hallName: show.hallName,
      formats: show.formats,
      restSeats: show.restSeats,
      totalSeats: show.totalSeats,
      seatSource: show.seatSource,
    }));
    const copy = notifyCopy(items as any, { total: items.length });

    if (data.channel === "telegram") {
      if (!data.telegramToken?.trim() || !data.telegramChatId?.trim()) throw new Error("텔레그램을 먼저 연결하세요.");
      await telegramSend(data.telegramToken, data.telegramChatId, copy.telegramHtml);
    } else if (data.channel === "kakao") {
      if (!data.kakaoRestKey?.trim() || !data.kakaoRefreshToken?.trim()) throw new Error("카카오를 먼저 연결하세요.");
      for (const item of items) await kakaoSend(data.kakaoRestKey, data.kakaoRefreshToken, `${item.title}\n${item.body}`, item.bookingUrl);
    } else {
      if (!data.email?.trim()) throw new Error("메일 주소를 확인하세요.");
      const { sendOpenbellMail } = await import("./mail.server");
      const result = await sendOpenbellMail({
        to: data.email,
        subject: `[오픈벨] 예매 오픈 테스트 ${items.length}건`,
        text: copy.text,
        url: items[0].bookingUrl,
        items: items.map((x) => ({ title: x.title, body: x.body, bookingUrl: x.bookingUrl })),
        gasWebUrl: data.gasWebUrl,
        gmailAppPassword: data.gmailAppPassword,
      });
      if (!result.ok) throw new Error(result.error);
    }
    return {
      ok: true as const,
      count: items.length,
      theaters: items.map(({ theaterId, movieTitle, playDate, startTime, hallName, bookingUrl }) => ({
        theaterId,
        movieTitle,
        playDate,
        startTime,
        hallName,
        bookingUrl,
      })),
    };
  });
