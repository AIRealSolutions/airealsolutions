-- Factory build pipeline step 3: investor share links for the instant preview.
-- Applied to the AIrealsolutions.com Supabase project as migrations `factory_preview_invites`,
-- `factory_preview_summary_skip_zeros` and `factory_preview_invites_has_pin` (this file is the combined result).
-- Builds on docs/factory-site-preview.sql.
--
--   factory_preview_invites   one private link per investor (token, optional PIN, expiry, what they may see)
--   factory_preview_views     every page opened on a preview by a non-member (per link)
--   private.factory_preview_grants  12-hour pass handed out once a link (and its PIN) checks out
--
-- An invite works even when public sharing is off. It always shows the latest approved Site Spec.
-- The investor summary page (problem, users, pricing, break-even) is built in the database and only
-- leaves it for members and for invites with show_summary; the dollar figures need show_numbers.
--
-- RPCs (anon + authenticated):
--   factory_preview_open(slug, invite, pin, visitor, path)  -> {grant?, needs_pin?, error?}; logs the first view
--   factory_preview_track(slug, grant, visitor, path)        logs a page view (deduped, capped)
--   factory_preview_get / _records / _submit                 now take p_grant
-- Members only:
--   factory_preview_invite_create(project, label, pin, days, show_summary, show_numbers) -> token
--   factory_preview_invite_set_pin(invite, pin)

-- ---- tables ------------------------------------------------------------------

create table if not exists public.factory_preview_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.factory_projects(id) on delete cascade,
  token text not null unique,
  label text not null,
  pin_hash text,
  has_pin boolean generated always as (pin_hash is not null) stored,
  show_summary boolean not null default true,
  show_numbers boolean not null default false,
  expires_at timestamptz,
  revoked_at timestamptz,
  pin_failures integer not null default 0,
  pin_locked_until timestamptz,
  view_count integer not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists factory_preview_invites_project_idx on public.factory_preview_invites(project_id, created_at desc);

alter table public.factory_preview_invites enable row level security;
drop policy if exists "members read preview invites" on public.factory_preview_invites;
create policy "members read preview invites" on public.factory_preview_invites for select to authenticated
  using ((select private.factory_can_access_project(project_id)));
drop policy if exists "members update preview invites" on public.factory_preview_invites;
create policy "members update preview invites" on public.factory_preview_invites for update to authenticated
  using ((select private.factory_can_access_project(project_id)))
  with check ((select private.factory_can_access_project(project_id)));
-- Rows are created by factory_preview_invite_create; the PIN hash and counters are never readable or writable.
revoke all on public.factory_preview_invites from anon, authenticated;
grant select (id, project_id, token, label, has_pin, show_summary, show_numbers, expires_at, revoked_at, pin_locked_until,
              view_count, first_viewed_at, last_viewed_at, created_by, created_at)
  on public.factory_preview_invites to authenticated;
grant update (label, show_summary, show_numbers, expires_at, revoked_at) on public.factory_preview_invites to authenticated;

create table if not exists public.factory_preview_views (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.factory_projects(id) on delete cascade,
  invite_id uuid references public.factory_preview_invites(id) on delete set null,
  visitor uuid,
  path text not null default '/',
  created_at timestamptz not null default now()
);
create index if not exists factory_preview_views_project_idx on public.factory_preview_views(project_id, created_at desc);
create index if not exists factory_preview_views_invite_idx on public.factory_preview_views(invite_id, created_at desc);
create index if not exists factory_preview_views_visitor_idx on public.factory_preview_views(visitor, created_at desc);

alter table public.factory_preview_views enable row level security;
drop policy if exists "members read preview views" on public.factory_preview_views;
create policy "members read preview views" on public.factory_preview_views for select to authenticated
  using ((select private.factory_can_access_project(project_id)));
revoke insert, update, delete on public.factory_preview_views from anon, authenticated;

create table if not exists private.factory_preview_grants (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.factory_preview_invites(id) on delete cascade,
  project_id uuid not null references public.factory_projects(id) on delete cascade,
  visitor uuid,
  expires_at timestamptz not null default now() + interval '12 hours',
  created_at timestamptz not null default now()
);
create index if not exists factory_preview_grants_invite_idx on private.factory_preview_grants(invite_id);
create index if not exists factory_preview_grants_expiry_idx on private.factory_preview_grants(expires_at);
alter table private.factory_preview_grants enable row level security;

-- ---- access ------------------------------------------------------------------

drop function if exists public.factory_preview_get(text, integer);
drop function if exists public.factory_preview_records(text, text, uuid);
drop function if exists public.factory_preview_submit(text, uuid, text, jsonb, uuid);
drop function if exists private.factory_preview_resolve(text, integer);

-- Which spec may this caller see, and through what? Same error for "no such project", "not shared" and "bad link".
create or replace function private.factory_preview_resolve(p_slug text, p_version integer default null, p_grant uuid default null)
returns table (project_id uuid, project_name text, spec_id uuid, spec_version integer, spec_status text,
               content jsonb, is_member boolean, is_shared boolean, invite_id uuid, invite_label text,
               show_summary boolean, show_numbers boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project public.factory_projects%rowtype;
  v_member boolean;
  v_shared boolean;
  v_invite public.factory_preview_invites%rowtype;
begin
  select * into v_project from public.factory_projects p where p.slug = p_slug;
  if v_project.id is null then
    raise exception 'This preview is not available.' using errcode = 'P0002';
  end if;
  v_member := private.factory_can_access_project(v_project.id);
  select coalesce(s.shared, false) into v_shared from public.factory_preview_settings s where s.project_id = v_project.id;
  v_shared := coalesce(v_shared, false);

  if p_grant is not null and not v_member then
    select i.* into v_invite
    from private.factory_preview_grants g
    join public.factory_preview_invites i on i.id = g.invite_id
    where g.id = p_grant and g.project_id = v_project.id and g.expires_at > now()
      and i.revoked_at is null and (i.expires_at is null or i.expires_at > now());
  end if;

  if not v_member and not v_shared and v_invite.id is null then
    raise exception 'This preview is not available.' using errcode = 'P0002';
  end if;

  return query
  select v_project.id, v_project.name, s.id, s.version, s.status, s.content, v_member, v_shared,
         v_invite.id, v_invite.label,
         v_member or coalesce(v_invite.show_summary, false),
         v_member or coalesce(v_invite.show_numbers, false)
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

-- The investor one-pager: built from the approved synthesis and the economics row.
create or replace function private.factory_preview_summary(p_project uuid, p_numbers boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_syn jsonb;
  v_e public.factory_project_economics%rowtype;
  v_monthly_cost numeric;
  v_price numeric;
  v_numbers jsonb := null;
  v_list jsonb;
begin
  select s.content into v_syn from public.factory_product_syntheses s
   where s.project_id = p_project and s.status = 'approved' order by s.version desc limit 1;
  select * into v_e from public.factory_project_economics e where e.project_id = p_project;

  if p_numbers and v_e.project_id is not null then
    v_monthly_cost := coalesce(v_e.monthly_infrastructure_cost, 0) + coalesce(v_e.monthly_ai_api_cost, 0) + coalesce(v_e.monthly_support_cost, 0);
    v_price := nullif(v_e.target_customer_monthly_price, 0);
    -- Economics columns default to 0; treat 0 as "not set" so the page never shows $0.
    v_numbers := jsonb_strip_nulls(jsonb_build_object(
      'pricing_model', nullif(nullif(v_e.pricing_model, ''), 'undecided'),
      'setup_price', nullif(v_e.target_setup_price, 0),
      'monthly_price', v_price,
      'target_customers', nullif(v_e.target_customers, 0),
      'target_mrr', case when v_price is not null and v_e.target_customers is not null then nullif(v_price * v_e.target_customers, 0) end,
      'monthly_operating_cost', nullif(v_monthly_cost, 0),
      'break_even_customers', case when v_price is not null and v_monthly_cost > 0 then ceil(v_monthly_cost / v_price) end,
      'build_cost', nullif(v_e.estimated_build_cost, 0),
      'customer_value_monthly', nullif(v_e.customer_value_monthly, 0),
      'hours_saved_monthly', nullif(v_e.hours_saved_monthly, 0)));
    if v_numbers = '{}'::jsonb then v_numbers := null; end if;
  end if;

  if v_syn is null and v_numbers is null then
    return null;
  end if;

  -- Only the investor-facing parts of the synthesis; internal notes (assumptions, open questions) stay in.
  select coalesce(jsonb_object_agg(k, v_syn -> k), '{}'::jsonb) into v_list
  from unnest(array['product_summary', 'problem_statement', 'desired_outcomes', 'users_and_roles', 'requirements',
                    'automation_opportunities', 'integrations', 'build_sequence']) k
  where v_syn ? k;

  return jsonb_build_object('synthesis', v_list, 'numbers', v_numbers);
end;
$$;

create or replace function public.factory_preview_get(p_slug text, p_version integer default null, p_grant uuid default null)
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
    'shared', r.is_shared,
    'invite', case when r.invite_id is not null then jsonb_build_object('label', r.invite_label) end,
    'summary', case when r.show_summary then private.factory_preview_summary(r.project_id, r.show_numbers) end)
  from private.factory_preview_resolve(p_slug, p_version, p_grant) r;
$$;

create or replace function public.factory_preview_records(p_slug text, p_entity text, p_visitor uuid default null, p_grant uuid default null)
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
  select * into r from private.factory_preview_resolve(p_slug, null, p_grant);
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
  p_slug text, p_spec uuid, p_form text, p_data jsonb, p_visitor uuid default null, p_grant uuid default null)
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
  select * into r from private.factory_preview_resolve(p_slug, null, p_grant);
  select * into v_spec from public.factory_site_specs s where s.id = p_spec and s.project_id = r.project_id;
  if v_spec.id is null then
    raise exception 'This preview has changed. Reload the page and try again.' using errcode = 'P0002';
  end if;
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

  for v_key in select jsonb_array_elements_text(coalesce(v_form -> 'fields', '[]'::jsonb)) loop
    if p_data ? v_key then
      v_val := left(btrim(case when jsonb_typeof(p_data -> v_key) = 'string' then p_data ->> v_key else (p_data -> v_key)::text end), 2000);
      if v_val <> '' then v_clean := v_clean || jsonb_build_object(v_key, v_val); end if;
    end if;
  end loop;
  if v_clean = '{}'::jsonb then
    raise exception 'Fill in the form before sending it.' using errcode = '22023';
  end if;

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

-- Record one page view by a non-member. Deduped (same page within 30 s) and capped per visitor.
create or replace function private.factory_preview_log_view(p_project uuid, p_invite uuid, p_visitor uuid, p_path text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_path text := left(coalesce(nullif(btrim(p_path), ''), '/'), 120);
begin
  if p_visitor is not null and exists (
    select 1 from public.factory_preview_views v
     where v.visitor = p_visitor and v.project_id = p_project and v.path = v_path and v.created_at > now() - interval '30 seconds') then
    return;
  end if;
  if p_visitor is not null and (select count(*) from public.factory_preview_views v
       where v.visitor = p_visitor and v.created_at > now() - interval '1 day') >= 500 then
    return;
  end if;
  insert into public.factory_preview_views(project_id, invite_id, visitor, path) values (p_project, p_invite, p_visitor, v_path);
  if p_invite is not null then
    update public.factory_preview_invites i
       set view_count = i.view_count + 1, last_viewed_at = now(), first_viewed_at = coalesce(i.first_viewed_at, now())
     where i.id = p_invite;
  end if;
end;
$$;

-- Open a preview. With an invite token: check it and its PIN, then hand out a 12-hour grant.
-- Wrong PINs are counted (5 in a row locks the link for 15 minutes); errors are returned, not raised,
-- so the count is kept.
create or replace function public.factory_preview_open(
  p_slug text, p_invite text default null, p_pin text default null, p_visitor uuid default null, p_path text default '/')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_project public.factory_projects%rowtype;
  v_member boolean;
  v_shared boolean;
  v_invite public.factory_preview_invites%rowtype;
  v_grant uuid;
begin
  select * into v_project from public.factory_projects p where p.slug = p_slug;
  if v_project.id is null then
    return jsonb_build_object('error', 'This preview is not available.');
  end if;
  v_member := private.factory_can_access_project(v_project.id);
  if v_member then
    return jsonb_build_object('member', true);
  end if;
  select coalesce(s.shared, false) into v_shared from public.factory_preview_settings s where s.project_id = v_project.id;
  v_shared := coalesce(v_shared, false);

  if nullif(btrim(p_invite), '') is null then
    if not v_shared then
      return jsonb_build_object('error', 'This preview is not available.');
    end if;
    perform private.factory_preview_log_view(v_project.id, null, p_visitor, p_path);
    return jsonb_build_object('shared', true);
  end if;

  select * into v_invite from public.factory_preview_invites i
   where i.token = btrim(p_invite) and i.project_id = v_project.id
   for update;
  if v_invite.id is null or v_invite.revoked_at is not null or (v_invite.expires_at is not null and v_invite.expires_at <= now()) then
    return jsonb_build_object('error', 'This link is no longer active. Ask the person who sent it for a new one.');
  end if;

  if v_invite.pin_hash is not null then
    if v_invite.pin_locked_until is not null and v_invite.pin_locked_until > now() then
      return jsonb_build_object('needs_pin', true, 'error',
        'Too many wrong PINs. Try again in ' || greatest(1, ceil(extract(epoch from v_invite.pin_locked_until - now()) / 60))::int || ' minutes.');
    end if;
    if nullif(btrim(p_pin), '') is null then
      return jsonb_build_object('needs_pin', true);
    end if;
    if extensions.crypt(btrim(p_pin), v_invite.pin_hash) <> v_invite.pin_hash then
      update public.factory_preview_invites i
         set pin_failures = case when i.pin_failures + 1 >= 5 then 0 else i.pin_failures + 1 end,
             pin_locked_until = case when i.pin_failures + 1 >= 5 then now() + interval '15 minutes' else i.pin_locked_until end
       where i.id = v_invite.id;
      return jsonb_build_object('needs_pin', true, 'error', 'That PIN is not right.');
    end if;
    update public.factory_preview_invites i set pin_failures = 0, pin_locked_until = null where i.id = v_invite.id;
  end if;

  delete from private.factory_preview_grants g where g.expires_at < now() - interval '1 day';
  insert into private.factory_preview_grants(invite_id, project_id, visitor)
  values (v_invite.id, v_project.id, p_visitor)
  returning id into v_grant;
  perform private.factory_preview_log_view(v_project.id, v_invite.id, p_visitor, p_path);
  return jsonb_build_object('grant', v_grant, 'expires_at', now() + interval '12 hours');
end;
$$;

create or replace function public.factory_preview_track(p_slug text, p_grant uuid default null, p_visitor uuid default null, p_path text default '/')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
begin
  begin
    select * into r from private.factory_preview_resolve(p_slug, null, p_grant);
  exception when others then
    return; -- nothing to track for a preview this caller cannot see
  end;
  if r.is_member then
    return;
  end if;
  perform private.factory_preview_log_view(r.project_id, r.invite_id, p_visitor, p_path);
end;
$$;

-- ---- invite management (members) -----------------------------------------------

create or replace function public.factory_preview_invite_create(
  p_project uuid, p_label text, p_pin text default null, p_days integer default 30,
  p_show_summary boolean default true, p_show_numbers boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_pin text := nullif(btrim(p_pin), '');
  v_row public.factory_preview_invites%rowtype;
begin
  if auth.uid() is null or not private.factory_can_access_project(p_project) then
    raise exception 'Project not available.' using errcode = '42501';
  end if;
  if nullif(btrim(p_label), '') is null then
    raise exception 'Say who the link is for.' using errcode = '22023';
  end if;
  if v_pin is not null and v_pin !~ '^[0-9]{4,8}$' then
    raise exception 'A PIN is 4 to 8 digits.' using errcode = '22023';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 365) then
    raise exception 'A link can last 1 to 365 days.' using errcode = '22023';
  end if;
  if (select count(*) from public.factory_preview_invites i where i.project_id = p_project and i.revoked_at is null) >= 100 then
    raise exception 'This project already has 100 active links. Turn some off first.' using errcode = 'P0429';
  end if;

  v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  insert into public.factory_preview_invites(project_id, token, label, pin_hash, show_summary, show_numbers, expires_at, created_by)
  values (p_project, v_token, left(btrim(p_label), 120),
          case when v_pin is not null then extensions.crypt(v_pin, extensions.gen_salt('bf', 8)) end,
          coalesce(p_show_summary, true), coalesce(p_show_numbers, false),
          case when p_days is not null then now() + make_interval(days => p_days) end, auth.uid())
  returning * into v_row;

  insert into public.factory_project_events(project_id, actor_id, event_type, detail)
  values (p_project, auth.uid(), 'preview.invite_created',
          jsonb_build_object('invite_id', v_row.id, 'label', v_row.label, 'pin', v_pin is not null, 'expires_at', v_row.expires_at));

  return jsonb_build_object('id', v_row.id, 'token', v_row.token, 'expires_at', v_row.expires_at);
end;
$$;

create or replace function public.factory_preview_invite_set_pin(p_invite uuid, p_pin text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_pin text := nullif(btrim(p_pin), '');
begin
  select i.project_id into v_project from public.factory_preview_invites i where i.id = p_invite;
  if v_project is null or auth.uid() is null or not private.factory_can_access_project(v_project) then
    raise exception 'Link not available.' using errcode = '42501';
  end if;
  if v_pin is not null and v_pin !~ '^[0-9]{4,8}$' then
    raise exception 'A PIN is 4 to 8 digits.' using errcode = '22023';
  end if;
  update public.factory_preview_invites i
     set pin_hash = case when v_pin is not null then extensions.crypt(v_pin, extensions.gen_salt('bf', 8)) end,
         pin_failures = 0, pin_locked_until = null
   where i.id = p_invite;
end;
$$;

-- ---- grants --------------------------------------------------------------------

revoke all on function private.factory_preview_resolve(text, integer, uuid) from public, anon, authenticated;
revoke all on function private.factory_preview_summary(uuid, boolean) from public, anon, authenticated;
revoke all on function private.factory_preview_log_view(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.factory_preview_get(text, integer, uuid) from public;
revoke all on function public.factory_preview_records(text, text, uuid, uuid) from public;
revoke all on function public.factory_preview_submit(text, uuid, text, jsonb, uuid, uuid) from public;
revoke all on function public.factory_preview_open(text, text, text, uuid, text) from public;
revoke all on function public.factory_preview_track(text, uuid, uuid, text) from public;
revoke all on function public.factory_preview_invite_create(uuid, text, text, integer, boolean, boolean) from public, anon;
revoke all on function public.factory_preview_invite_set_pin(uuid, text) from public, anon;
grant execute on function public.factory_preview_get(text, integer, uuid) to anon, authenticated;
grant execute on function public.factory_preview_records(text, text, uuid, uuid) to anon, authenticated;
grant execute on function public.factory_preview_submit(text, uuid, text, jsonb, uuid, uuid) to anon, authenticated;
grant execute on function public.factory_preview_open(text, text, text, uuid, text) to anon, authenticated;
grant execute on function public.factory_preview_track(text, uuid, uuid, text) to anon, authenticated;
grant execute on function public.factory_preview_invite_create(uuid, text, text, integer, boolean, boolean) to authenticated;
grant execute on function public.factory_preview_invite_set_pin(uuid, text) to authenticated;
