-- WorkOS task subtasks
-- Adds checklist-style subtasks without changing existing task records.

alter table public.tasks
  add column if not exists subtasks jsonb default '[]'::jsonb,
  add column if not exists auto_complete_on_subtasks_done boolean default true;

update public.tasks
set
  subtasks = coalesce(subtasks, '[]'::jsonb),
  auto_complete_on_subtasks_done = coalesce(auto_complete_on_subtasks_done, true);

-- Rollback:
-- alter table public.tasks
--   drop column if exists auto_complete_on_subtasks_done,
--   drop column if exists subtasks;
