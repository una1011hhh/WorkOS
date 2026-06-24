-- Feishu personal OAuth connections for production calendar sync.
-- Safe migration: creates one integration table only and keeps existing WorkOS data intact.

create table if not exists public.feishu_user_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  feishu_open_id text,
  feishu_union_id text,
  feishu_user_id text,
  name text,
  email text,
  access_token text not null,
  refresh_token text,
  token_type text,
  scope text,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.feishu_user_connections enable row level security;

drop trigger if exists set_feishu_user_connections_updated_at on public.feishu_user_connections;
create trigger set_feishu_user_connections_updated_at
  before update on public.feishu_user_connections
  for each row
  execute function public.set_updated_at();

drop policy if exists "feishu_user_connections_select_own" on public.feishu_user_connections;
create policy "feishu_user_connections_select_own"
  on public.feishu_user_connections for select
  using (auth.uid() = user_id);

drop policy if exists "feishu_user_connections_delete_own" on public.feishu_user_connections;
create policy "feishu_user_connections_delete_own"
  on public.feishu_user_connections for delete
  using (auth.uid() = user_id);

-- Inserts and updates are performed by trusted server routes using SUPABASE_SECRET_KEY.

create index if not exists idx_feishu_user_connections_open_id
  on public.feishu_user_connections(feishu_open_id);
