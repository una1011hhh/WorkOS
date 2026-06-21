-- WorkOS cloud schema
-- Safe migration: creates new tables only, does not modify or delete localStorage data.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text,
  background text,
  goal text,
  status text not null default 'Planning' check (status in ('Planning', 'Active', 'Paused', 'Done')),
  priority text not null default 'P2' check (priority in ('P0', 'P1', 'P2', 'P3')),
  progress numeric not null default 0 check (progress >= 0 and progress <= 100),
  start_date date,
  due_date date,
  risks text[] not null default '{}',
  next_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  source text,
  requester text,
  project_id text references public.projects(id) on delete set null,
  status text not null default 'Inbox' check (status in ('Inbox', 'Todo', 'Doing', 'Waiting', 'Done')),
  priority text not null default 'P2' check (priority in ('P0', 'P1', 'P2', 'P3')),
  due_date date,
  estimated_hours numeric not null default 0,
  notes text,
  waiting_for text,
  tags text[] not null default '{}',
  completed_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.time_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id text not null references public.tasks(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  is_running boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_session_end_after_start check (end_time is null or end_time >= start_time)
);

create unique index if not exists one_running_timer_per_user
on public.time_sessions(user_id)
where is_running = true;

create table if not exists public.meetings (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  date timestamptz not null,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  attendees text[] not null default '{}',
  notes text,
  decisions text[] not null default '{}',
  related_project_id text references public.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_action_items (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  meeting_id text not null references public.meetings(id) on delete cascade,
  text text not null,
  owner text,
  due_date date,
  task_id text references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reflections (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text,
  type text not null check (type in ('问题复盘', '流程优化', '风险提醒', '经验沉淀', '自动化想法', '管理思考')),
  related_project_id text references public.projects(id) on delete set null,
  related_task_id text references public.tasks(id) on delete set null,
  date date not null,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  type text not null check (type in ('日报', '周报', '月报', '季度报', '自定义')),
  start_date date not null,
  end_date date not null,
  generated_content text not null,
  included_task_ids text[] not null default '{}',
  included_reflection_ids text[] not null default '{}',
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_end_after_start check (end_date >= start_date)
);

create or replace view public.task_time_totals as
select
  user_id,
  task_id,
  coalesce(sum(duration_seconds), 0)::integer as accumulated_seconds,
  round((coalesce(sum(duration_seconds), 0)::numeric / 3600), 4) as actual_hours
from public.time_sessions
group by user_id, task_id;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'projects',
    'tasks',
    'time_sessions',
    'meetings',
    'meeting_action_items',
    'reflections',
    'reports'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end $$;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = user_id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profiles_delete_own" on public.profiles for delete using (auth.uid() = user_id);

create policy "projects_select_own" on public.projects for select using (auth.uid() = user_id);
create policy "projects_insert_own" on public.projects for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects_delete_own" on public.projects for delete using (auth.uid() = user_id);

create policy "tasks_select_own" on public.tasks for select using (auth.uid() = user_id);
create policy "tasks_insert_own" on public.tasks for insert with check (auth.uid() = user_id);
create policy "tasks_update_own" on public.tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks_delete_own" on public.tasks for delete using (auth.uid() = user_id);

create policy "time_sessions_select_own" on public.time_sessions for select using (auth.uid() = user_id);
create policy "time_sessions_insert_own" on public.time_sessions for insert with check (auth.uid() = user_id);
create policy "time_sessions_update_own" on public.time_sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "time_sessions_delete_own" on public.time_sessions for delete using (auth.uid() = user_id);

create policy "meetings_select_own" on public.meetings for select using (auth.uid() = user_id);
create policy "meetings_insert_own" on public.meetings for insert with check (auth.uid() = user_id);
create policy "meetings_update_own" on public.meetings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "meetings_delete_own" on public.meetings for delete using (auth.uid() = user_id);

create policy "meeting_action_items_select_own" on public.meeting_action_items for select using (auth.uid() = user_id);
create policy "meeting_action_items_insert_own" on public.meeting_action_items for insert with check (auth.uid() = user_id);
create policy "meeting_action_items_update_own" on public.meeting_action_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "meeting_action_items_delete_own" on public.meeting_action_items for delete using (auth.uid() = user_id);

create policy "reflections_select_own" on public.reflections for select using (auth.uid() = user_id);
create policy "reflections_insert_own" on public.reflections for insert with check (auth.uid() = user_id);
create policy "reflections_update_own" on public.reflections for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "reflections_delete_own" on public.reflections for delete using (auth.uid() = user_id);

create policy "reports_select_own" on public.reports for select using (auth.uid() = user_id);
create policy "reports_insert_own" on public.reports for insert with check (auth.uid() = user_id);
create policy "reports_update_own" on public.reports for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "reports_delete_own" on public.reports for delete using (auth.uid() = user_id);

-- Rollback plan:
-- drop view if exists public.task_time_totals;
-- drop table if exists public.reports;
-- drop table if exists public.reflections;
-- drop table if exists public.meeting_action_items;
-- drop table if exists public.meetings;
-- drop table if exists public.time_sessions;
-- drop table if exists public.tasks;
-- drop table if exists public.projects;
-- drop table if exists public.profiles;
-- drop function if exists public.set_updated_at();
