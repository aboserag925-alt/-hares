-- Hares suggestions and AI workflow storage.
-- Public writes are performed by the Node API using service role after validation.
create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  category text not null check (category in ('feature','bug','design','content','performance','usability','other')),
  title text not null check (char_length(title) between 4 and 120),
  description text not null check (char_length(description) between 10 and 3000),
  status text not null default 'NEW' check (status in ('NEW','ANALYZING','ANALYZED','PLANNED','WAITING_APPROVAL','APPROVED','REJECTED','IMPLEMENTING','TESTING','VERIFYING','READY_FOR_REVIEW','COMPLETED')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  risk text not null default 'low' check (risk in ('low','medium','high','critical')),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  ai_analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists suggestions_created_at_idx on public.suggestions(created_at desc);
create index if not exists suggestions_status_created_idx on public.suggestions(status,created_at desc);
alter table public.suggestions enable row level security;
revoke all on public.suggestions from anon, authenticated, public;
grant all on public.suggestions to service_role;

create table if not exists public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid references public.suggestions(id) on delete set null,
  status text not null check (status in ('PROPOSED','ANALYZED','PLANNED','WAITING_APPROVAL','APPROVED','IMPLEMENTING','TESTING','VERIFYING','READY_FOR_REVIEW','HUMAN_APPROVED','MERGED','FAILED','REJECTED')),
  risk text not null check (risk in ('low','medium','high','critical')),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  requires_approval boolean not null default true,
  approved boolean not null default false,
  tainted boolean not null default false,
  source text not null default 'suggestion',
  affected_areas text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_tasks_status_created_idx on public.ai_tasks(status,created_at desc);
create table if not exists public.ai_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks(id) on delete cascade,
  agent text not null,
  result text not null check (result in ('PASS','FAIL','NEEDS_REVIEW','BLOCKED')),
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_reviews_task_created_idx on public.ai_reviews(task_id,created_at);
create table if not exists public.ai_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks(id) on delete cascade,
  approved_by uuid not null references auth.users(id),
  action text not null check (action in ('IMPLEMENT','MERGE')),
  decision text not null check (decision in ('APPROVED','REJECTED')),
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists ai_approvals_task_created_idx on public.ai_approvals(task_id,created_at desc);
do $$ declare t text; begin
  foreach t in array array['ai_tasks','ai_reviews','ai_approvals'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated, public',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
