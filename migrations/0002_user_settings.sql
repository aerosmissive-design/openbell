create table if not exists user_settings (
  user_id text primary key,
  config jsonb not null,
  queue jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
