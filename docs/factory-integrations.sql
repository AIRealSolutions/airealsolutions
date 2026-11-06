-- Factory integrations (applied to the shared Supabase project as migration `factory_integrations`).
-- Per-user Google (Gmail + Calendar) connections and an audit log, plus an admin check for platform routes.
-- token_ciphertext is AES-256-GCM encrypted by the Next.js server (INTEGRATIONS_ENCRYPTION_KEY);
-- the database never stores plaintext tokens.
create table public.factory_user_integrations(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google')),
  account_email text,
  scopes text[] not null default '{}',
  token_ciphertext text not null,
  status text not null default 'connected' check (status in ('connected','error')),
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider)
);
alter table public.factory_user_integrations enable row level security;
create policy fui_select on public.factory_user_integrations for select to authenticated using (user_id = (select auth.uid()));
create policy fui_insert on public.factory_user_integrations for insert to authenticated with check (user_id = (select auth.uid()));
create policy fui_update on public.factory_user_integrations for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy fui_delete on public.factory_user_integrations for delete to authenticated using (user_id = (select auth.uid()));

create table public.factory_integration_events(
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index factory_integration_events_user_idx on public.factory_integration_events(user_id, created_at desc);
alter table public.factory_integration_events enable row level security;
create policy fie_select on public.factory_integration_events for select to authenticated using (user_id = (select auth.uid()));
create policy fie_insert on public.factory_integration_events for insert to authenticated with check (user_id = (select auth.uid()));

create or replace function public.factory_is_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select exists(select 1 from public.factory_admins a where a.user_id = auth.uid()); $$;
revoke execute on function public.factory_is_admin() from public, anon;
grant execute on function public.factory_is_admin() to authenticated;
