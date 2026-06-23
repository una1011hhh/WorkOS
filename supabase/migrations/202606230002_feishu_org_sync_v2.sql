-- Feishu Organization Sync V2
-- Incremental migration only. Keeps all existing local/manual data.

alter table public.contacts
  add column if not exists feishu_user_id text,
  add column if not exists feishu_open_id text,
  add column if not exists feishu_union_id text,
  add column if not exists avatar text,
  add column if not exists department_id text,
  add column if not exists department_name text,
  add column if not exists status text,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb;

alter table public.contact_groups
  add column if not exists feishu_chat_id text,
  add column if not exists owner_id text,
  add column if not exists member_count integer not null default 0,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb;

alter table public.meetings
  add column if not exists external_source text not null default 'manual',
  add column if not exists external_id text,
  add column if not exists location text,
  add column if not exists meeting_url text,
  add column if not exists calendar_id text,
  add column if not exists organizer_id text,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'meetings_external_source_check'
  ) then
    alter table public.meetings
      add constraint meetings_external_source_check check (external_source in ('manual', 'feishu'));
  end if;
end $$;

create table if not exists public.contact_group_members (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id text not null references public.contact_groups(id) on delete cascade,
  contact_id text not null references public.contacts(id) on delete cascade,
  feishu_user_id text,
  open_id text,
  role text,
  joined_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, group_id, contact_id)
);

create index if not exists idx_contacts_feishu_user_id on public.contacts(user_id, feishu_user_id);
create index if not exists idx_contacts_feishu_open_id on public.contacts(user_id, feishu_open_id);
create index if not exists idx_contact_groups_feishu_chat_id on public.contact_groups(user_id, feishu_chat_id);
create index if not exists idx_meetings_feishu_event on public.meetings(user_id, external_source, external_id);
create index if not exists idx_contact_group_members_user_group on public.contact_group_members(user_id, group_id);

drop trigger if exists update_contact_group_members_updated_at on public.contact_group_members;
create trigger update_contact_group_members_updated_at
  before update on public.contact_group_members
  for each row
  execute function public.update_updated_at_column();

alter table public.contact_group_members enable row level security;

drop policy if exists "Users can read own contact group members" on public.contact_group_members;
create policy "Users can read own contact group members"
  on public.contact_group_members for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own contact group members" on public.contact_group_members;
create policy "Users can insert own contact group members"
  on public.contact_group_members for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own contact group members" on public.contact_group_members;
create policy "Users can update own contact group members"
  on public.contact_group_members for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own contact group members" on public.contact_group_members;
create policy "Users can delete own contact group members"
  on public.contact_group_members for delete
  using (auth.uid() = user_id);
