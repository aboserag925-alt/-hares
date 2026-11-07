-- Re-apply approval hardening for databases that ran the earlier AI migration.
begin;
alter table public.ai_tasks alter column tainted set default true;

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
commit;
