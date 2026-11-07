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
  tainted boolean not null default true,
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

create table if not exists public.ai_audit_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('suggestion.created','suggestion.updated','suggestion.rejected','ai.task.created','ai.analysis.completed','ai.approval.requested','ai.approval.granted','ai.approval.rejected','ai.implementation.started','ai.tests.executed','ai.verification.completed','ai.pull_request.prepared')),
  suggestion_id uuid references public.suggestions(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_audit_events_created_idx on public.ai_audit_events(created_at desc);
create index if not exists ai_audit_events_suggestion_idx on public.ai_audit_events(suggestion_id,created_at desc);
alter table public.ai_audit_events enable row level security;
revoke all on public.ai_audit_events from anon, authenticated, public;
grant all on public.ai_audit_events to service_role;

-- Approval records are written only by the trusted server after validating the caller's JWT.
alter table public.ai_tasks
  add column if not exists approval_id uuid,
  add column if not exists human_approved boolean not null default false,
  add column if not exists human_approval_id uuid;

alter table public.ai_tasks
  drop constraint if exists ai_tasks_approval_id_fkey;
alter table public.ai_tasks
  add constraint ai_tasks_approval_id_fkey foreign key (approval_id)
  references public.ai_approvals(id) on delete restrict;
alter table public.ai_tasks
  drop constraint if exists ai_tasks_human_approval_id_fkey;
alter table public.ai_tasks
  add constraint ai_tasks_human_approval_id_fkey foreign key (human_approval_id)
  references public.ai_approvals(id) on delete restrict;

create or replace function public.record_ai_approval(
  p_task_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_decision text,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.ai_tasks%rowtype;
  v_approval_id uuid;
begin
  if p_task_id is null or p_actor_user_id is null
     or p_action is null or p_decision is null
     or p_action not in ('IMPLEMENT','MERGE')
     or p_decision not in ('APPROVED','REJECTED') then
    raise exception 'Invalid approval request';
  end if;
  if p_decision = 'REJECTED'
     and pg_catalog.char_length(pg_catalog.btrim(coalesce(p_reason,''))) = 0 then
    raise exception 'A reason is required when rejecting an approval';
  end if;
  if not exists (
    select 1 from public.admin_users
    where user_id = p_actor_user_id
  ) then
    raise exception 'Administrator authorization required';
  end if;
  select * into v_task
  from public.ai_tasks
  where id = p_task_id
  for update;
  if not found then raise exception 'AI task not found'; end if;
  if v_task.tainted then raise exception 'Tainted tasks cannot be approved'; end if;
  if p_action = 'IMPLEMENT' and v_task.status <> 'WAITING_APPROVAL' then
    raise exception 'Task is not waiting for implementation approval';
  end if;
  if p_action = 'MERGE' and v_task.status <> 'READY_FOR_REVIEW' then
    raise exception 'Task is not ready for human review';
  end if;

  insert into public.ai_approvals(task_id,approved_by,action,decision,reason)
  values (p_task_id,p_actor_user_id,p_action,p_decision,pg_catalog.left(coalesce(p_reason,''),1000))
  returning id into v_approval_id;

  if p_action = 'IMPLEMENT' then
    update public.ai_tasks
      set status = case when p_decision = 'APPROVED' then 'APPROVED' else 'REJECTED' end,
          approved = (p_decision = 'APPROVED'),
          approval_id = v_approval_id,
          updated_at = pg_catalog.now()
      where id = p_task_id;
  elsif p_action = 'MERGE' then
    update public.ai_tasks
      set status = case when p_decision = 'APPROVED' then 'HUMAN_APPROVED' else 'REJECTED' end,
          human_approved = (p_decision = 'APPROVED'),
          human_approval_id = v_approval_id,
          updated_at = pg_catalog.now()
      where id = p_task_id;
  end if;

  insert into public.ai_audit_events(event_type,actor_user_id,metadata)
  values (
    case when p_decision = 'REJECTED' then 'ai.approval.rejected'
         else 'ai.approval.granted' end,
    p_actor_user_id,
    pg_catalog.jsonb_build_object('task_id',p_task_id,'result',p_decision,'status',p_action)
  );
  return v_approval_id;
end;
$$;

revoke all on function public.record_ai_approval(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.record_ai_approval(uuid,uuid,text,text,text) to service_role;
