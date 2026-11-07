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

-- ---------------------------------------------------------------------------
-- Migration factory_project_infrastructure: dedicated infra provisioned for a project.
-- Project members can read; only Factory admins (via server routes) write. db_pass_ciphertext is server-encrypted.
create table public.factory_project_infrastructure(
  project_id uuid primary key references public.factory_projects(id) on delete cascade,
  github_repo text, github_repo_id bigint, github_url text,
  vercel_project_id text, vercel_project_name text, vercel_url text,
  supabase_ref text, supabase_url text, supabase_status text, db_pass_ciphertext text,
  env_linked_at timestamptz,
  last_deployment_id text, last_deployment_url text, last_deployment_state text,
  domain text, domain_verified boolean, domain_records jsonb not null default '[]'::jsonb,
  last_error text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.factory_project_infrastructure enable row level security;
create policy fpi_select on public.factory_project_infrastructure for select to authenticated
  using ((select private.factory_can_access_project(project_id)) or (select public.factory_is_admin()));
create policy fpi_insert on public.factory_project_infrastructure for insert to authenticated
  with check ((select public.factory_is_admin()));
create policy fpi_update on public.factory_project_infrastructure for update to authenticated
  using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()));

-- Migration factory_admin_project_helpers
create or replace function public.factory_admin_project(p_slug text)
returns table(id uuid, name text, slug text, repository_url text, deployment_url text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.factory_admins a where a.user_id = auth.uid()) then
    raise exception 'Factory admin access required' using errcode = '42501';
  end if;
  return query select p.id, p.name, p.slug, p.repository_url, p.deployment_url
    from public.factory_projects p where p.slug = p_slug limit 1;
end $$;

create or replace function public.factory_admin_set_project_urls(p_project uuid, p_repository_url text default null, p_deployment_url text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.factory_admins a where a.user_id = auth.uid()) then
    raise exception 'Factory admin access required' using errcode = '42501';
  end if;
  update public.factory_projects
     set repository_url = coalesce(p_repository_url, repository_url),
         deployment_url = coalesce(p_deployment_url, deployment_url),
         updated_at = now()
   where id = p_project;
end $$;
revoke execute on function public.factory_admin_project(text) from public, anon;
revoke execute on function public.factory_admin_set_project_urls(uuid, text, text) from public, anon;
grant execute on function public.factory_admin_project(text) to authenticated;
grant execute on function public.factory_admin_set_project_urls(uuid, text, text) to authenticated;
