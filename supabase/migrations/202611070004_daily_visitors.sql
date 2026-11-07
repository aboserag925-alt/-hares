-- Daily unique visitors. Only the server-side service role may access this table.
begin;
create table if not exists public.daily_visitors (
  visit_date date not null,
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (visit_date, visitor_hash)
);
alter table public.daily_visitors enable row level security;
revoke all on public.daily_visitors from public, anon, authenticated;
grant select, insert, delete on public.daily_visitors to service_role;
commit;
