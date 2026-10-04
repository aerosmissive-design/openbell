import nodemailer from "nodemailer";
import type { MailProvider } from "./types";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function sendDirectMail(opts: {
  provider: MailProvider;
  to: string;
  credential: string;
  subject: string;
  text: string;
}) {
  const to = opts.to.trim();
  if (!validEmail(to)) return { ok: false as const, error: "메일 주소가 올바르지 않습니다." };
  if (opts.provider === "gmail_smtp") return sendGmail(to, opts.credential, opts.subject, opts.text);
  if (opts.provider === "resend") return sendResend(to, opts.credential, opts.subject, opts.text);
  return { ok: false as const, error: "mail_provider_none" };
}

async function sendGmail(to: string, appPassword: string, subject: string, text: string) {
  const pass = appPassword.replace(/\s+/g, "");
  if (pass.length < 8) return { ok: false as const, error: "Gmail 앱 비밀번호가 없습니다." };
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: to, pass },
    });
    await transporter.sendMail({
      from: `"오픈벨" <${to}>`,
      to,
      subject: subject.slice(0, 120),
      text,
    });
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Gmail로 메일을 보내지 못했습니다." };
  }
}

async function sendResend(to: string, credential: string, subject: string, text: string) {
  const key = credential.trim() || process.env.RESEND_API_KEY?.trim() || "";
  if (!key) return { ok: false as const, error: "Resend 키가 없습니다." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "오픈벨 <onboarding@resend.dev>",
        to: [to],
        subject: subject.slice(0, 120),
        text,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false as const, error: "Resend가 메일을 거절했습니다." };
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Resend에 연결하지 못했습니다." };
  }
}

export async function sendGasMail(rawUrl: string, subject: string, text: string) {
  let target: URL;
  try {
    target = new URL(rawUrl.trim());
  } catch {
    return { ok: false as const, error: "GAS 주소가 없습니다." };
  }
  const host = target.hostname;
  if (!host.endsWith("script.google.com") && !host.endsWith("googleusercontent.com")) {
    return { ok: false as const, error: "구글 스크립트 주소만 사용할 수 있습니다." };
  }
  target.searchParams.set("op", "mail");
  target.searchParams.set("subject", subject.slice(0, 120));
  target.searchParams.set("body", text.slice(0, 900));
  target.searchParams.set("title", subject.slice(0, 80));
  const res = await fetch(target.toString(), { redirect: "follow", signal: AbortSignal.timeout(20000) });
  const body = await res.text();
  if (!/ok/i.test(body) || /sign in|accounts\.google/i.test(body)) {
    return { ok: false as const, error: "GAS 메일을 보내지 못했습니다." };
  }
  return { ok: true as const };
}
