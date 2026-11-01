-- Public content managed by trusted site administrators.
-- Grant app_metadata.role = 'site_admin' only from a trusted Supabase admin context.
create table if not exists public.site_content (
  content_key text primary key,
  content_type text not null check (content_type in ('lecture', 'livestream', 'schedule')),
  title text not null default '',
  data jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint site_content_key_length check (char_length(content_key) between 1 and 120),
  constraint site_content_title_length check (char_length(title) <= 240)
);

create index if not exists site_content_published_type_idx
  on public.site_content (content_type, published, updated_at desc);

alter table public.site_content enable row level security;

revoke all on table public.site_content from public;
grant select on table public.site_content to anon, authenticated;
grant insert, update, delete on table public.site_content to authenticated;

create or replace function public.is_site_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'site_admin', false);
$$;

revoke all on function public.is_site_admin() from public;
grant execute on function public.is_site_admin() to anon, authenticated;

drop policy if exists "Public can read published site content" on public.site_content;
create policy "Public can read published site content"
  on public.site_content
  for select
  to anon, authenticated
  using (published = true or (select public.is_site_admin()));

drop policy if exists "Site admins can insert content" on public.site_content;
create policy "Site admins can insert content"
  on public.site_content
  for insert
  to authenticated
  with check ((select public.is_site_admin()));

drop policy if exists "Site admins can update content" on public.site_content;
create policy "Site admins can update content"
  on public.site_content
  for update
  to authenticated
  using ((select public.is_site_admin()))
  with check ((select public.is_site_admin()));

drop policy if exists "Site admins can delete content" on public.site_content;
create policy "Site admins can delete content"
  on public.site_content
  for delete
  to authenticated
  using ((select public.is_site_admin()));
