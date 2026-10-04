create table if not exists user_notification_settings (
  id text primary key,
  user_id text not null unique,
  telegram_bot_token text,
  telegram_chat_id text,
  telegram_enabled boolean not null default false,
  telegram_verified boolean not null default false,
  mail_provider text not null default 'none',
  mail_address text,
  mail_credential text,
  mail_enabled boolean not null default false,
  kakao_api_key text,
  kakao_channel_id text,
  kakao_enabled boolean not null default false,
  kakao_verified boolean not null default false,
  gas_mail_enabled boolean not null default true,
  gas_web_url text,
  notify_payment_ready boolean not null default true,
  notify_daily_report boolean not null default true,
  notify_error_alert boolean not null default true,
  notify_settlement boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_notification_settings_mail_provider_chk
    check (mail_provider in ('gmail_smtp', 'resend', 'none'))
);

create table if not exists notification_delivery_log (
  id text primary key,
  user_id text not null,
  event_type text not null,
  channel text not null,
  ok boolean not null,
  is_test boolean not null default false,
  detail text,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create index if not exists notification_delivery_log_user_idx
  on notification_delivery_log (user_id, created_at desc);

create table if not exists notification_idempotency (
  idempotency_key text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
