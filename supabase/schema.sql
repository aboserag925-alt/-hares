create table if not exists public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

revoke all on table public.user_data from anon, public;
grant select, insert, update on table public.user_data to authenticated;

drop policy if exists "Users can read their own data" on public.user_data;
create policy "Users can read their own data"
  on public.user_data
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own data" on public.user_data;
create policy "Users can insert their own data"
  on public.user_data
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own data" on public.user_data;
create policy "Users can update their own data"
  on public.user_data
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);


-- Lecture publishing and administrator authorization.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 180),
  description text not null default '' check (char_length(description) <= 4000),
  starts_at timestamptz,
  category text not null default 'محاضرة' check (char_length(category) <= 80),
  stream_url text,
  recording_url text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
alter table public.lectures enable row level security;
revoke all on public.admin_users from anon, authenticated, public;
revoke all on public.lectures from anon, authenticated, public;
grant all on public.admin_users, public.lectures to service_role;
grant select on public.lectures to anon, authenticated;

drop policy if exists "Public can read published lectures" on public.lectures;
create policy "Public can read published lectures"
  on public.lectures for select to anon, authenticated
  using (status = 'published');

-- The service role is used only by the server. No browser role can grant itself admin.
-- Add administrators manually from the Supabase SQL Editor, after creating their Auth account:
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'admin@example.com';


-- Daily unique visitor counts. Only the server service role may read or write these rows.
create table if not exists public.daily_visitors (
  visit_date date not null,
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (visit_date, visitor_hash)
);

alter table public.daily_visitors enable row level security;
revoke all on public.daily_visitors from anon, authenticated, public;
grant all on public.daily_visitors to service_role;
