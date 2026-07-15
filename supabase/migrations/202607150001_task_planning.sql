alter table public.tasks
  add column if not exists planned_start timestamptz,
  add column if not exists planned_end timestamptz;

alter table public.tasks
  drop constraint if exists task_planned_end_after_start;

alter table public.tasks
  add constraint task_planned_end_after_start
  check (planned_end is null or planned_start is null or planned_end >= planned_start);
