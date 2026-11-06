-- Community discussions and structured debates for Ahl Athar.
-- Apply manually in Supabase SQL Editor after reviewing. This file is NOT auto-applied.
begin;

create table if not exists public.community_topics (
  id uuid primary key default gen_random_uuid(),
  topic_type text not null check (topic_type in ('forum', 'debate')),
  title text not null check (char_length(btrim(title)) between 5 and 180),
  description text not null default '' check (char_length(description) <= 4000),
  category text not null default 'عام' check (char_length(category) between 1 and 80),
  participant_a text,
  participant_b text,
  status text not null default 'published' check (status in ('published', 'hidden', 'locked')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_debate_participants check (
    (topic_type = 'forum' and participant_a is null and participant_b is null)
    or
    (topic_type = 'debate'
      and char_length(btrim(coalesce(participant_a, ''))) between 1 and 100
      and char_length(btrim(coalesce(participant_b, ''))) between 1 and 100)
  )
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.community_topics(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  author_label text not null check (char_length(btrim(author_label)) between 1 and 80),
  content text not null check (char_length(btrim(content)) between 2 and 5000),
  round_number integer check (round_number between 1 and 20),
  created_at timestamptz not null default now()
);

create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.community_topics(id) on delete cascade,
  post_id uuid references public.community_posts(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  created_at timestamptz not null default now()
);

create index if not exists community_topics_public_idx
  on public.community_topics (topic_type, created_at desc) where status = 'published';
create index if not exists community_posts_topic_idx
  on public.community_posts (topic_id, created_at asc);
create index if not exists community_reports_created_idx
  on public.community_reports (created_at desc);

alter table public.community_topics enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_reports enable row level security;

revoke all on public.community_topics, public.community_posts, public.community_reports from public, anon, authenticated;
grant select on public.community_topics, public.community_posts to anon, authenticated;
grant insert on public.community_topics, public.community_posts, public.community_reports to authenticated;
grant select on public.community_reports to authenticated;
grant update, delete on public.community_topics, public.community_posts, public.community_reports to authenticated;

create or replace function public.community_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users as admins
    where admins.user_id = (select auth.uid())
  );
$$;

revoke all on function public.community_is_admin() from public, anon;
grant execute on function public.community_is_admin() to anon, authenticated;

drop policy if exists "Community topics are publicly readable when published" on public.community_topics;
create policy "Community topics are publicly readable when published"
  on public.community_topics for select to anon, authenticated
  using (status = 'published' or (select public.community_is_admin()));

drop policy if exists "Authenticated members can create community topics" on public.community_topics;
create policy "Authenticated members can create community topics"
  on public.community_topics for insert to authenticated
  with check (created_by = (select auth.uid()) and status = 'published');

drop policy if exists "Admins can moderate community topics" on public.community_topics;
create policy "Admins can moderate community topics"
  on public.community_topics for update to authenticated
  using ((select public.community_is_admin()))
  with check ((select public.community_is_admin()));

drop policy if exists "Admins can delete community topics" on public.community_topics;
create policy "Admins can delete community topics"
  on public.community_topics for delete to authenticated
  using ((select public.community_is_admin()));

drop policy if exists "Posts are readable for published topics" on public.community_posts;
create policy "Posts are readable for published topics"
  on public.community_posts for select to anon, authenticated
  using (
    exists (
      select 1 from public.community_topics as topics
      where topics.id = community_posts.topic_id
        and (topics.status = 'published' or (select public.community_is_admin()))
    )
  );

drop policy if exists "Authenticated members can reply to published topics" on public.community_posts;
create policy "Authenticated members can reply to published topics"
  on public.community_posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.community_topics as topics
      where topics.id = community_posts.topic_id and topics.status = 'published'
    )
  );

drop policy if exists "Admins can moderate community posts" on public.community_posts;
create policy "Admins can moderate community posts"
  on public.community_posts for update to authenticated
  using ((select public.community_is_admin()))
  with check ((select public.community_is_admin()));

drop policy if exists "Admins can delete community posts" on public.community_posts;
create policy "Admins can delete community posts"
  on public.community_posts for delete to authenticated
  using ((select public.community_is_admin()));

drop policy if exists "Members can report community content" on public.community_reports;
create policy "Members can report community content"
  on public.community_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (
      select 1 from public.community_topics as topics
      where topics.id = community_reports.topic_id and topics.status = 'published'
    )
  );

drop policy if exists "Admins can read community reports" on public.community_reports;
create policy "Admins can read community reports"
  on public.community_reports for select to authenticated
  using ((select public.community_is_admin()));

drop policy if exists "Admins can manage community reports" on public.community_reports;
create policy "Admins can manage community reports"
  on public.community_reports for delete to authenticated
  using ((select public.community_is_admin()));

commit;
