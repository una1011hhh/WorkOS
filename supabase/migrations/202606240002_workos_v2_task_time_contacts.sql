-- WorkOS V2 unified task, time and waiting-object migration.
-- Additive only: keeps legacy columns for fallback/search while new UI writes structured fields.

alter table public.tasks
  add column if not exists created_by text,
  add column if not exists subtasks jsonb not null default '[]'::jsonb,
  add column if not exists waiting_for_type text,
  add column if not exists waiting_for_id text;

update public.tasks
set created_by = coalesce(created_by, requester, '自己')
where created_by is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_waiting_for_type_check'
  ) then
    alter table public.tasks
      add constraint tasks_waiting_for_type_check
      check (waiting_for_type is null or waiting_for_type in ('contact', 'group', 'legacy'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'time_session_end_after_start_strict'
  ) then
    alter table public.time_sessions
      add constraint time_session_end_after_start_strict
      check (end_time is null or end_time > start_time) not valid;
  end if;
end $$;

create index if not exists tasks_waiting_lookup_idx
  on public.tasks(user_id, waiting_for_type, waiting_for_id);
