alter table user_settings add column if not exists alerts jsonb not null default '[]'::jsonb;
alter table user_settings add column if not exists prefs jsonb not null default '{}'::jsonb;
