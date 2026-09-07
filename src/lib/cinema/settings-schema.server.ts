export async function ensureUserSettingsSchema() {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  await sql.query(
    `alter table user_settings add column if not exists alerts jsonb not null default '[]'::jsonb`,
  );
  await sql.query(
    `alter table user_settings add column if not exists prefs jsonb not null default '{}'::jsonb`,
  );
}
