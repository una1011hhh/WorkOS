-- WorkOS contacts and groups
-- Safe migration: creates new tables only, keeps existing WorkOS data untouched.

create table if not exists public.contacts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  role text,
  team text,
  company text,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_groups (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  contact_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['contacts', 'contact_groups']
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

create policy "contacts_select_own" on public.contacts for select using (auth.uid() = user_id);
create policy "contacts_insert_own" on public.contacts for insert with check (auth.uid() = user_id);
create policy "contacts_update_own" on public.contacts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "contacts_delete_own" on public.contacts for delete using (auth.uid() = user_id);

create policy "contact_groups_select_own" on public.contact_groups for select using (auth.uid() = user_id);
create policy "contact_groups_insert_own" on public.contact_groups for insert with check (auth.uid() = user_id);
create policy "contact_groups_update_own" on public.contact_groups for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "contact_groups_delete_own" on public.contact_groups for delete using (auth.uid() = user_id);

-- Rollback plan:
-- drop table if exists public.contact_groups;
-- drop table if exists public.contacts;
