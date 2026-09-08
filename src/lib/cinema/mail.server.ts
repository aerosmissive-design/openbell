import nodemailer from "nodemailer";
import { escapeAttr, escapeHtml } from "./seats";

export type MailSendResult =
  | { ok: true; needsConfirm?: boolean }
  | { ok: false; error: string };

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function mailHtml(
  subject: string,
  text: string,
  url?: string,
  items?: Array<{ title: string; body: string; bookingUrl: string }>,
) {
  const cards = (items?.length ? items.slice(0, 8) : []).map((item) => {
    const href = escapeAttr(item.bookingUrl);
    return `<div style="margin:0 0 14px;padding:16px;background:#161617;border-radius:12px">
      <p style="margin:0 0 6px;font-size:15px;font-weight:600;color:#f4f1ea">${escapeHtml(item.title)}</p>
      <p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#9a958c">${escapeHtml(item.body)}</p>
      ${href ? `<a href="${href}" style="display:inline-block;background:#1f5fd6;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:999px;font-size:13px;font-weight:600">바로 예매</a>` : ""}
    </div>`;
  });
  const fallback = !cards.length
    ? `<pre style="white-space:pre-wrap;font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.55;color:#f4f1ea">${escapeHtml(text)}</pre>${
        url
          ? `<p style="margin:20px 0 0"><a href="${escapeAttr(url)}" style="display:inline-block;background:#1f5fd6;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-size:14px">바로 예매</a></p>`
          : ""
      }`
    : cards.join("");
  return `<!doctype html><html><body style="margin:0;background:#0c0c0d;color:#f4f1ea;font-family:ui-sans-serif,system-ui,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <p style="letter-spacing:.18em;font-size:11px;color:#9a958c;margin:0">OPENBELL</p>
    <h1 style="font-size:22px;margin:10px 0 18px;color:#f4f1ea">${escapeHtml(subject)}</h1>
    ${fallback}
  </div>
</body></html>`;
}

export async function sendOpenbellMail(opts: {
  to: string;
  subject: string;
  text: string;
  url?: string;
  items?: Array<{ title: string; body: string; bookingUrl: string }>;
  gasWebUrl?: string;
  gmailAppPassword?: string;
}): Promise<MailSendResult> {
  const to = opts.to.trim();
  if (!validEmail(to)) {
    return { ok: false, error: "이메일 주소가 올바르지 않습니다." };
  }
  const html = mailHtml(opts.subject, opts.text, opts.url, opts.items);
  const viaGmail = await postGmailSmtp(
    to,
    opts.gmailAppPassword,
    opts.subject,
    opts.text,
    html,
  );
  if (viaGmail.ok) return viaGmail;
  const viaResend = await postResend(to, opts.subject, opts.text, html);
  if (viaResend.ok) return viaResend;
  const posted = await postFormSubmit(to, opts.subject, opts.text, opts.url);
  if (posted.ok) return posted;
  if (opts.gasWebUrl?.trim()) {
    const viaGas = await postGasMail(opts.gasWebUrl.trim(), opts);
    if (viaGas.ok) return viaGas;
  }
  return {
    ok: false,
    error:
      viaGmail.error ||
      viaResend.error ||
      posted.error ||
      "메일을 보내지 못했습니다.",
  };
}

async function postGmailSmtp(
  to: string,
  appPassword: string | undefined,
  subject: string,
  text: string,
  html: string,
): Promise<MailSendResult> {
  const pass = (appPassword || "").replace(/\s+/g, "");
  if (!pass) return { ok: false, error: "" };
  if (pass.length < 8) {
    return { ok: false, error: "Gmail 앱 비밀번호가 너무 짧습니다." };
  }
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
      html,
    });
    return { ok: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (/invalid login|badcredentials|username and password/i.test(raw)) {
      return {
        ok: false,
        error:
          "Gmail이 로그인을 거절했습니다. 계정 비밀번호가 아니라 16자리 앱 비밀번호인지 확인하세요.",
      };
    }
    if (/less secure|application-specific/i.test(raw)) {
      return {
        ok: false,
        error: "Gmail 2단계 인증과 앱 비밀번호가 필요합니다.",
      };
    }
    return { ok: false, error: "Gmail로 메일을 보내지 못했습니다." };
  }
}

async function postResend(
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<MailSendResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, error: "" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: "오픈벨 <onboarding@resend.dev>",
        to: [to],
        subject: subject.slice(0, 120),
        text,
        html,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const raw = await res.text();
      if (/only send testing emails/i.test(raw)) {
        return {
          ok: false,
          error: "Resend 테스트 한도에 걸렸습니다. Gmail 앱 비밀번호를 쓰세요.",
        };
      }
      return { ok: false, error: "메일 서버가 거절했습니다." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "" };
  }
}

async function postFormSubmit(
  to: string,
  subject: string,
  text: string,
  url?: string,
): Promise<MailSendResult> {
  try {
    const res = await fetch(
      `https://formsubmit.co/ajax/${encodeURIComponent(to)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          _subject: subject.slice(0, 120),
          _template: "box",
          _captcha: "false",
          _replyto: to,
          name: "오픈벨",
          email: to,
          message: text,
          booking: url || "",
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const raw = await res.text();
    let json: { success?: string | boolean; message?: string } = {};
    try {
      json = JSON.parse(raw) as { success?: string | boolean; message?: string };
    } catch {
      if (!res.ok) {
        return { ok: false, error: `메일을 보내지 못했습니다. (${res.status})` };
      }
      return { ok: true };
    }
    const message = String(json.message || "");
    if (/rate limit/i.test(message)) {
      return {
        ok: false,
        error: "메일 서버가 잠시 바쁩니다. Gmail 앱 비밀번호를 넣으면 바로 갑니다.",
      };
    }
    if (/confirm|activation/i.test(message)) {
      return { ok: true, needsConfirm: true };
    }
    if (json.success === false || !res.ok) {
      return {
        ok: false,
        error: message || "메일을 보내지 못했습니다.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "메일 서버에 연결하지 못했습니다." };
  }
}

async function postGasMail(
  rawUrl: string,
  opts: { subject: string; text: string; url?: string },
): Promise<MailSendResult> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return { ok: false, error: "웹앱 주소가 올바르지 않습니다." };
  }
  const host = target.hostname;
  if (
    !host.endsWith("script.google.com") &&
    !host.endsWith("googleusercontent.com")
  ) {
    return { ok: false, error: "구글 스크립트 주소만 사용할 수 있습니다." };
  }
  target.searchParams.set("op", "mail");
  target.searchParams.set("subject", opts.subject.slice(0, 120));
  target.searchParams.set("body", opts.text.slice(0, 500));
  if (opts.url) target.searchParams.set("url", opts.url);
  const res = await fetch(target.toString(), {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!/ok/i.test(text) || /sign in|accounts\.google/i.test(text)) {
    return { ok: false, error: "구글 스크립트가 메일을 보내지 못했습니다." };
  }
  return { ok: true };
}
