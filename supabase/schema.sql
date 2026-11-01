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


-- Member directory and activity history. Each member can access only their own rows.
create table if not exists public.member_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  membership_status text not null default 'member' check (membership_status in ('member')),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.member_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (event_type in ('login', 'section_view', 'dhikr_progress')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.member_profiles enable row level security;
alter table public.member_activity enable row level security;
revoke all on public.member_profiles, public.member_activity from anon, public;
grant select, insert, update on public.member_profiles to authenticated;
grant select, insert on public.member_activity to authenticated;
grant usage, select on sequence public.member_activity_id_seq to authenticated;

drop policy if exists "Members read own profile" on public.member_profiles;
create policy "Members read own profile" on public.member_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Members insert own profile" on public.member_profiles;
create policy "Members insert own profile" on public.member_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Members update own profile" on public.member_profiles;
create policy "Members update own profile" on public.member_profiles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Members read own activity" on public.member_activity;
create policy "Members read own activity" on public.member_activity
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Members add own activity" on public.member_activity;
create policy "Members add own activity" on public.member_activity
  for insert to authenticated with check ((select auth.uid()) = user_id);
