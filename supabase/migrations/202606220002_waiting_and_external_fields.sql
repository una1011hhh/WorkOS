-- WorkOS waiting workflow and future external contact source fields
-- Safe additive migration: no data deletion, no table rebuilds.

alter table public.tasks
  add column if not exists waiting_reason text,
  add column if not exists follow_up_date date;

alter table public.contacts
  add column if not exists external_source text not null default 'manual',
  add column if not exists external_id text;

alter table public.contact_groups
  add column if not exists external_source text not null default 'manual',
  add column if not exists external_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contacts_external_source_check'
  ) then
    alter table public.contacts
      add constraint contacts_external_source_check check (external_source in ('manual', 'feishu'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'contact_groups_external_source_check'
  ) then
    alter table public.contact_groups
      add constraint contact_groups_external_source_check check (external_source in ('manual', 'feishu'));
  end if;
end $$;

create index if not exists contacts_external_lookup_idx
  on public.contacts(user_id, external_source, external_id);

create index if not exists contact_groups_external_lookup_idx
  on public.contact_groups(user_id, external_source, external_id);

-- Rollback reference:
-- drop index if exists public.contact_groups_external_lookup_idx;
-- drop index if exists public.contacts_external_lookup_idx;
-- alter table public.contact_groups drop constraint if exists contact_groups_external_source_check;
-- alter table public.contacts drop constraint if exists contacts_external_source_check;
-- alter table public.contact_groups drop column if exists external_id, drop column if exists external_source;
-- alter table public.contacts drop column if exists external_id, drop column if exists external_source;
-- alter table public.tasks drop column if exists follow_up_date, drop column if exists waiting_reason;
