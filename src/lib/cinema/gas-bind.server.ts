import { getSql } from "@/lib/db";
import { collectRegisteredEmails, isAccountEmail, normalizeAccountEmail } from "./registered-emails";

async function ensureBindTable() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists gas_binds (
      sync_key text primary key,
      url text not null default '',
      script_id text not null default '',
      email text not null default '',
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(`alter table gas_binds add column if not exists email text not null default ''`);
  return sql;
}

function validGasUrl(raw: string) {
  try {
    const target = new URL(raw.trim());
    const host = target.hostname;
    if (
      !host.endsWith("script.google.com") &&
      !host.endsWith("googleusercontent.com")
    ) {
      return null;
    }
    return target.toString().replace(/\/dev$/, "/exec");
  } catch {
    return null;
  }
}

export async function recordGasBind(input: {
  key: string;
  url: string;
  scriptId?: string;
  email?: string;
}) {
  const key = String(input.key || "").trim();
  const url = validGasUrl(input.url) || "";
  const scriptId = String(input.scriptId || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  if (!key || key.length < 8 || (!url && !scriptId)) {
    return { ok: false as const };
  }
  const sql = await ensureBindTable();
  await sql.query(
    `insert into gas_binds (sync_key, url, script_id, email, created_at)
     values ($1, $2, $3, $4, now())
     on conflict (sync_key) do update set
       url = case when excluded.url <> '' then excluded.url else gas_binds.url end,
       script_id = case when excluded.script_id <> '' then excluded.script_id else gas_binds.script_id end,
       email = case when excluded.email <> '' then excluded.email else gas_binds.email end,
       created_at = now()`,
    [key, url, scriptId, email],
  );
  await sql.query(
    `update user_settings
     set config = jsonb_set(
       jsonb_set(
         jsonb_set(coalesce(config, '{}'::jsonb), '{gasWebUrl}', to_jsonb($1::text)),
         '{gasScriptId}', to_jsonb($2::text)
       ),
       '{gasSyncKey}', to_jsonb($3::text)
     ),
     updated_at = now()
     where (
         $4 <> '' and (
           user_id in (select id from "user" where lower(email) = $4)
           or lower(coalesce(config->>'email','')) = $4
         )
       )
        or (
          $4 = '' and config->>'gasSyncKey' = $3
        )`,
    [url, scriptId, key, email],
  );
  return { ok: true as const, url, scriptId };
}

export async function claimGasBind(key: string, email?: string) {
  const syncKey = String(key || "").trim();
  const mail = String(email || "").trim().toLowerCase();
  const sql = await ensureBindTable();
  const rows = await sql.query<{
    url: string;
    script_id: string;
    created_at: string;
  }>(
    `select url, script_id, created_at::text as created_at
     from gas_binds
     where ($2 <> '' and lower(email) = $2)
        or ($2 = '' and $1 <> '' and sync_key = $1)
     order by created_at desc
     limit 1`,
    [syncKey, mail],
  );
  const row = rows[0];
  if (!row || (!row.url && !row.script_id)) return { status: "wait" as const };
  return {
    status: "ok" as const,
    url: row.url || "",
    scriptId: row.script_id || "",
    createdAt: row.created_at || "",
  };
}
export async function latestGasWebUrl() {
  const sql = await ensureBindTable();
  const rows = await sql.query<{ url: string }>(
    `select url from gas_binds where url <> '' order by created_at desc limit 1`,
  );
  return rows[0]?.url || "";
}

/** Mailboxes already stored for the web app. URLs and keys are never included. */
export async function listRegisteredEmails(): Promise<string[]> {
  const sql = await ensureBindTable();
  const binds = await sql.query<{ email: string }>(
    `select email from gas_binds where email <> ''`,
  );
  const users = await sql.query<{ email: string }>(
    `select email from "user" where coalesce(email, '') <> ''`,
  );
  const settings = await sql.query<{ email: string }>(
    `select config->>'email' as email from user_settings where coalesce(config->>'email', '') <> ''`,
  );
  return collectRegisteredEmails(
    binds.map((row) => row.email),
    users.map((row) => row.email),
    settings.map((row) => row.email),
  );
}

/** The GAS web app for this mailbox only. An unknown mailbox yields an empty URL. */
export async function gasWebUrlForEmail(email: string): Promise<string> {
  const mail = normalizeAccountEmail(email);
  if (!isAccountEmail(mail)) return "";
  const sql = await ensureBindTable();
  const binds = await sql.query<{ url: string }>(
    `select url from gas_binds
     where lower(email) = $1 and url <> ''
     order by created_at desc
     limit 1`,
    [mail],
  );
  const fromBind = validGasUrl(binds[0]?.url || "");
  if (fromBind) return fromBind;
  const settings = await sql.query<{ url: string }>(
    `select config->>'gasWebUrl' as url
     from user_settings
     where (
       lower(coalesce(config->>'email', '')) = $1
       or user_id in (select id from "user" where lower(email) = $1)
     )
       and coalesce(config->>'gasWebUrl', '') <> ''
     order by updated_at desc
     limit 1`,
    [mail],
  );
  return validGasUrl(settings[0]?.url || "") || "";
}
