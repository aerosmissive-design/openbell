import { getSql } from "@/lib/db";

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
     where config->>'gasSyncKey' = $3
        or ($4 <> '' and lower(coalesce(config->>'email','')) = $4)`,
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
     where ($1 <> '' and sync_key = $1)
        or ($2 <> '' and lower(email) = $2)
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