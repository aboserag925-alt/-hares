-- Member profiles and minimal account activity history.
-- Each authenticated member can read and write only their own records.
begin;

create table if not exists public.member_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text check (email is null or char_length(email) <= 320),
  display_name text check (display_name is null or char_length(display_name) <= 100),
  avatar_url text check (
    avatar_url is null or
    (char_length(avatar_url) <= 2048 and avatar_url like 'https://%')
  ),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.member_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('login', 'section_view', 'dhikr_progress')),
  metadata jsonb not null default '{}'::jsonb check (pg_catalog.pg_column_size(metadata) <= 4096),
  created_at timestamptz not null default now()
);

create index if not exists member_activity_user_created_idx
  on public.member_activity(user_id, created_at desc);

alter table public.member_profiles enable row level security;
alter table public.member_activity enable row level security;

revoke all on public.member_profiles, public.member_activity from public, anon;
grant select, insert, update on public.member_profiles to authenticated;
grant select, insert on public.member_activity to authenticated;
grant usage, select on sequence public.member_activity_id_seq to authenticated;

drop policy if exists "Members read own profile" on public.member_profiles;
create policy "Members read own profile" on public.member_profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Members insert own profile" on public.member_profiles;
create policy "Members insert own profile" on public.member_profiles
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Members update own profile" on public.member_profiles;
create policy "Members update own profile" on public.member_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Members read own activity" on public.member_activity;
create policy "Members read own activity" on public.member_activity
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Members add own activity" on public.member_activity;
create policy "Members add own activity" on public.member_activity
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

commit;
