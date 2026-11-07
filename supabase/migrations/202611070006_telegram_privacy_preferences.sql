-- Persist Telegram privacy opt-out across server restarts.
-- Only the trusted server service role can read or write these minimal preferences.
begin;

create table if not exists public.telegram_user_preferences (
  telegram_user_id bigint primary key check (telegram_user_id > 0),
  opted_out boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.telegram_user_preferences enable row level security;
revoke all on public.telegram_user_preferences from public, anon, authenticated;
grant all on public.telegram_user_preferences to service_role;

commit;
