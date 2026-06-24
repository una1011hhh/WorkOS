-- WorkOS calendar/contact consistency
-- Additive migration only. Legacy text fields stay for read fallback.

alter table public.tasks
  add column if not exists requester_contact_id text references public.contacts(id) on delete set null,
  add column if not exists created_by_contact_id text references public.contacts(id) on delete set null;

alter table public.meetings
  add column if not exists end_time timestamptz,
  add column if not exists task_id text references public.tasks(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'meetings_end_after_date'
  ) then
    alter table public.meetings
      add constraint meetings_end_after_date
      check (end_time is null or end_time > date) not valid;
  end if;
end $$;

create index if not exists tasks_requester_contact_idx
  on public.tasks(user_id, requester_contact_id);

create index if not exists tasks_created_by_contact_idx
  on public.tasks(user_id, created_by_contact_id);

create index if not exists meetings_task_idx
  on public.meetings(user_id, task_id);
