create table if not exists booking_jobs (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'pending',
  agent_id text,
  prev_agent_id text,
  attempts int not null default 0,
  lease_expires_at timestamptz,
  movie_title text not null default '',
  theater_id text not null default '',
  play_date text not null default '',
  start_time text not null default '',
  hall_name text not null default '',
  booking_url text not null,
  seats int not null default 2,
  zone text not null default 'center',
  preferred_seats jsonb not null default '[]'::jsonb,
  result_message text not null default ''
);

create index if not exists booking_jobs_claim_idx on booking_jobs (status, created_at);
