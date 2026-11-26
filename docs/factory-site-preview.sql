-- Factory build pipeline step 2: Site Spec + instant preview (/preview/<slug>).
-- Applied to the AIrealsolutions.com Supabase project as migration `factory_site_preview`.
--
--   factory_site_specs           versioned Site Spec JSON per project (draft / approved / superseded)
--   factory_preview_settings     per project: is the instant preview shared with anyone who has the link?
--   factory_preview_submissions  form posts made on a preview (members read them; nobody writes directly)
--
-- Visitors never touch the tables. Three SECURITY DEFINER functions do the work:
--   factory_preview_get(slug, version)          the spec a caller may see
--   factory_preview_records(slug, entity, visitor)  rows for a dashboard table section
--   factory_preview_submit(slug, spec, form, data, visitor)  a form post, checked and rate-limited
-- A project member sees any version and every submission. Anyone else sees only the latest
-- approved version, only while sharing is on, and only the submissions they made themselves
-- (identified by a random visitor id kept in their browser).

create table if not exists public.factory_site_specs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.factory_projects(id) on delete cascade,
  version integer not null,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  source text not null default 'template' check (source in ('template', 'site_agent')),
  model text,
  agent_run_id uuid references public.factory_agent_runs(id) on delete set null,
  synthesis_version integer,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (project_id, version)
);
create index if not exists factory_site_specs_run_idx on public.factory_site_specs(agent_run_id);

alter table public.factory_site_specs enable row level security;
drop policy if exists "members read site specs" on public.factory_site_specs;
create policy "members read site specs" on public.factory_site_specs for select to authenticated
  using ((select private.factory_can_access_project(project_id)));
drop policy if exists "members add site specs" on public.factory_site_specs;
create policy "members add site specs" on public.factory_site_specs for insert to authenticated
  with check ((select private.factory_can_access_project(project_id)));
drop policy if exists "members update site specs" on public.factory_site_specs;
create policy "members update site specs" on public.factory_site_specs for update to authenticated
  using ((select private.factory_can_access_project(project_id)))
  with check ((select private.factory_can_access_project(project_id)));

create table if not exists public.factory_preview_settings (
  project_id uuid primary key references public.factory_projects(id) on delete cascade,
  shared boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.factory_preview_settings enable row level security;
drop policy if exists "members read preview settings" on public.factory_preview_settings;
create policy "members read preview settings" on public.factory_preview_settings for select to authenticated
  using ((select private.factory_can_access_project(project_id)));
drop policy if exists "members add preview settings" on public.factory_preview_settings;
create policy "members add preview settings" on public.factory_preview_settings for insert to authenticated
  with check ((select private.factory_can_access_project(project_id)));
drop policy if exists "members update preview settings" on public.factory_preview_settings;
create policy "members update preview settings" on public.factory_preview_settings for update to authenticated
  using ((select private.factory_can_access_project(project_id)))
  with check ((select private.factory_can_access_project(project_id)));

create table if not exists public.factory_preview_submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.factory_projects(id) on delete cascade,
  site_spec_id uuid references public.factory_site_specs(id) on delete set null,
  form_key text not null,
  entity_key text not null,
  data jsonb not null default '{}'::jsonb,
  visitor uuid,
  by_member boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists factory_preview_submissions_project_idx
  on public.factory_preview_submissions(project_id, entity_key, created_at desc);
create index if not exists factory_preview_submissions_visitor_idx
  on public.factory_preview_submissions(project_id, visitor, created_at desc);
create index if not exists factory_preview_submissions_spec_idx on public.factory_preview_submissions(site_spec_id);

alter table public.factory_preview_submissions enable row level security;
drop policy if exists "members read preview submissions" on public.factory_preview_submissions;
create policy "members read preview submissions" on public.factory_preview_submissions for select to authenticated
  using ((select private.factory_can_access_project(project_id)));
drop policy if exists "members delete preview submissions" on public.factory_preview_submissions;
create policy "members delete preview submissions" on public.factory_preview_submissions for delete to authenticated
  using ((select private.factory_can_access_project(project_id)));

-- Which spec may this caller see? Raises the same error for "no such project" and "not shared".
create or replace function private.factory_preview_resolve(p_slug text, p_version integer default null)
returns table (project_id uuid, project_name text, spec_id uuid, spec_version integer, spec_status text,
               content jsonb, is_member boolean, is_shared boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project public.factory_projects%rowtype;
  v_member boolean;
  v_shared boolean;
begin
  select * into v_project from public.factory_projects p where p.slug = p_slug;
  if v_project.id is null then
    raise exception 'This preview is not available.' using errcode = 'P0002';
  end if;
  v_member := private.factory_can_access_project(v_project.id);
  select coalesce(s.shared, false) into v_shared from public.factory_preview_settings s where s.project_id = v_project.id;
  v_shared := coalesce(v_shared, false);
  if not v_member and not v_shared then
    raise exception 'This preview is not available.' using errcode = 'P0002';
  end if;

  return query
  select v_project.id, v_project.name, s.id, s.version, s.status, s.content, v_member, v_shared
  from public.factory_site_specs s
  where s.project_id = v_project.id
    and (
      (v_member and p_version is not null and s.version = p_version)
      or (p_version is null or not v_member) and s.status = 'approved'
      or (v_member and p_version is null and not exists (
            select 1 from public.factory_site_specs a where a.project_id = v_project.id and a.status = 'approved'))
    )
  order by (s.status = 'approved') desc, s.version desc
  limit 1;

  if not found then
    raise exception 'This preview is not available.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.factory_preview_get(p_slug text, p_version integer default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'project', jsonb_build_object('name', r.project_name, 'slug', p_slug),
    'spec', jsonb_build_object('id', r.spec_id, 'version', r.spec_version, 'status', r.spec_status, 'content', r.content),
    'member', r.is_member,
    'shared', r.is_shared)
  from private.factory_preview_resolve(p_slug, p_version) r;
$$;

create or replace function public.factory_preview_records(p_slug text, p_entity text, p_visitor uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  v_rows jsonb;
begin
  select * into r from private.factory_preview_resolve(p_slug, null);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'data', x.data, 'created_at', x.created_at, 'mine', x.visitor = p_visitor)
                            order by x.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select s.id, s.data, s.created_at, s.visitor
    from public.factory_preview_submissions s
    where s.project_id = r.project_id
      and s.entity_key = p_entity
      and (r.is_member or (p_visitor is not null and s.visitor = p_visitor))
    order by s.created_at desc
    limit case when r.is_member then 200 else 50 end
  ) x;
  return v_rows;
end;
$$;

create or replace function public.factory_preview_submit(
  p_slug text, p_spec uuid, p_form text, p_data jsonb, p_visitor uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_spec public.factory_site_specs%rowtype;
  v_form jsonb;
  v_entity text;
  v_clean jsonb := '{}'::jsonb;
  v_key text;
  v_val text;
  v_id uuid;
begin
  select * into r from private.factory_preview_resolve(p_slug, null);
  select * into v_spec from public.factory_site_specs s where s.id = p_spec and s.project_id = r.project_id;
  if v_spec.id is null then
    raise exception 'This preview has changed. Reload the page and try again.' using errcode = 'P0002';
  end if;
  -- Visitors may only post to the version they are allowed to see; members may test any version.
  if not r.is_member and v_spec.id <> r.spec_id then
    raise exception 'This preview has changed. Reload the page and try again.' using errcode = 'P0002';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 20000 then
    raise exception 'The form could not be read.' using errcode = '22023';
  end if;

  select f into v_form from jsonb_array_elements(coalesce(v_spec.content -> 'forms', '[]'::jsonb)) f
   where f ->> 'key' = p_form limit 1;
  if v_form is null then
    raise exception 'That form is not part of this preview.' using errcode = '22023';
  end if;
  v_entity := v_form ->> 'entity';

  -- Keep only the form's own fields, as trimmed text.
  for v_key in select jsonb_array_elements_text(coalesce(v_form -> 'fields', '[]'::jsonb)) loop
    if p_data ? v_key then
      v_val := left(btrim(case when jsonb_typeof(p_data -> v_key) = 'string' then p_data ->> v_key else (p_data -> v_key)::text end), 2000);
      if v_val <> '' then v_clean := v_clean || jsonb_build_object(v_key, v_val); end if;
    end if;
  end loop;
  if v_clean = '{}'::jsonb then
    raise exception 'Fill in the form before sending it.' using errcode = '22023';
  end if;

  -- Spam limits: per visitor, per project per hour, and a cap on stored rows.
  perform pg_advisory_xact_lock(hashtextextended('factory_preview_submit:' || r.project_id::text, 0));
  if not r.is_member then
    if p_visitor is null then
      raise exception 'Reload the page and try again.' using errcode = '22023';
    end if;
    if (select count(*) from public.factory_preview_submissions s
         where s.project_id = r.project_id and s.visitor = p_visitor and s.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'Too many submissions from this browser. Try again later.' using errcode = 'P0429';
    end if;
    if (select count(*) from public.factory_preview_submissions s
         where s.project_id = r.project_id and s.created_at > now() - interval '1 hour') >= 300 then
      raise exception 'This preview is busy. Try again later.' using errcode = 'P0429';
    end if;
  end if;
  if (select count(*) from public.factory_preview_submissions s where s.project_id = r.project_id) >= 5000 then
    raise exception 'This preview has reached its storage limit.' using errcode = 'P0429';
  end if;

  insert into public.factory_preview_submissions(project_id, site_spec_id, form_key, entity_key, data, visitor, by_member)
  values (r.project_id, v_spec.id, p_form, coalesce(v_entity, p_form), v_clean, p_visitor, r.is_member)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.factory_preview_resolve(text, integer) from public, anon, authenticated;
revoke all on function public.factory_preview_get(text, integer) from public;
revoke all on function public.factory_preview_records(text, text, uuid) from public;
revoke all on function public.factory_preview_submit(text, uuid, text, jsonb, uuid) from public;
grant execute on function public.factory_preview_get(text, integer) to anon, authenticated;
grant execute on function public.factory_preview_records(text, text, uuid) to anon, authenticated;
grant execute on function public.factory_preview_submit(text, uuid, text, jsonb, uuid) to anon, authenticated;
