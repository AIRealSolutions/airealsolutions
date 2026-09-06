-- AI Real Solutions Software Factory
-- Shared Supabase/Postgres incubator schema.
-- Purpose: safely host many low-risk prototypes in one project while keeping tenant/project data isolated.
-- Review RLS and product-specific compliance requirements before production use.

create extension if not exists pgcrypto;
create schema if not exists factory;

create type factory.project_stage as enum ('discovery','architecture','prototype','testing','production','archived');
create type factory.member_role as enum ('owner','admin','builder','viewer');

create table factory.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table factory.memberships (
  organization_id uuid not null references factory.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role factory.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table factory.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references factory.organizations(id) on delete cascade,
  name text not null,
  slug text,
  industry text,
  summary text,
  stage factory.project_stage not null default 'discovery',
  infrastructure_mode text not null default 'shared' check (infrastructure_mode in ('shared','dedicated_candidate','dedicated')),
  data_classification text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table factory.intake_answers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references factory.projects(id) on delete cascade,
  section text not null,
  field_key text not null,
  answer jsonb not null default 'null'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, field_key)
);

create table factory.build_briefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references factory.projects(id) on delete cascade,
  version integer not null default 1,
  content text not null,
  structured_brief jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create table factory.features (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references factory.projects(id) on delete cascade,
  name text not null,
  description text,
  priority text not null default 'later' check (priority in ('mvp','next','later')),
  status text not null default 'planned',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table factory.artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references factory.projects(id) on delete cascade,
  artifact_type text not null,
  title text not null,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table factory.project_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references factory.projects(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index memberships_user_idx on factory.memberships(user_id);
create index projects_org_idx on factory.projects(organization_id);
create index intake_project_idx on factory.intake_answers(project_id);
create index briefs_project_idx on factory.build_briefs(project_id);
create index features_project_idx on factory.features(project_id);
create index artifacts_project_idx on factory.artifacts(project_id);
create index events_project_idx on factory.project_events(project_id, created_at desc);

-- Helper functions keep RLS policies readable.
create or replace function factory.is_org_member(org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from factory.memberships m
    where m.organization_id = org_id and m.user_id = auth.uid()
  );
$$;

create or replace function factory.can_manage_org(org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from factory.memberships m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','builder')
  );
$$;

create or replace function factory.can_access_project(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from factory.projects p
    join factory.memberships m on m.organization_id = p.organization_id
    where p.id = pid and m.user_id = auth.uid()
  );
$$;

alter table factory.organizations enable row level security;
alter table factory.memberships enable row level security;
alter table factory.projects enable row level security;
alter table factory.intake_answers enable row level security;
alter table factory.build_briefs enable row level security;
alter table factory.features enable row level security;
alter table factory.artifacts enable row level security;
alter table factory.project_events enable row level security;

create policy organizations_select on factory.organizations for select using (factory.is_org_member(id));
create policy organizations_insert on factory.organizations for insert with check (created_by = auth.uid());
create policy organizations_update on factory.organizations for update using (factory.can_manage_org(id));

create policy memberships_select on factory.memberships for select using (factory.is_org_member(organization_id));
create policy memberships_manage on factory.memberships for all using (factory.can_manage_org(organization_id)) with check (factory.can_manage_org(organization_id));

create policy projects_select on factory.projects for select using (factory.is_org_member(organization_id));
create policy projects_insert on factory.projects for insert with check (factory.can_manage_org(organization_id));
create policy projects_update on factory.projects for update using (factory.can_manage_org(organization_id));
create policy projects_delete on factory.projects for delete using (factory.can_manage_org(organization_id));

create policy intake_access on factory.intake_answers for all using (factory.can_access_project(project_id)) with check (factory.can_access_project(project_id));
create policy briefs_access on factory.build_briefs for all using (factory.can_access_project(project_id)) with check (factory.can_access_project(project_id));
create policy features_access on factory.features for all using (factory.can_access_project(project_id)) with check (factory.can_access_project(project_id));
create policy artifacts_access on factory.artifacts for all using (factory.can_access_project(project_id)) with check (factory.can_access_project(project_id));
create policy events_access on factory.project_events for all using (factory.can_access_project(project_id)) with check (factory.can_access_project(project_id));

-- Graduation rule (application-level): move a project to dedicated infrastructure when
-- sensitivity/compliance, scale, backup/restore independence, customer isolation, or revenue warrants it.
