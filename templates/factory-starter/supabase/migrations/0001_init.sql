-- Factory starter: the data behind site.json.
--   site_members      who may sign in to the dashboard (by email; add the owner when the project launches)
--   site_submissions  everything sent through a form on the site
-- Visitors never read or write tables directly: forms go through site_submit (rate-limited),
-- and only members (signed in with an email listed in site_members) can see submissions.
-- The Code Agent may add real tables per entity in later migrations; keep RLS on every table.

create table if not exists public.site_members (
  email text primary key check (email = lower(email) and position('@' in email) > 1),
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

create table if not exists public.site_submissions (
  id uuid primary key default gen_random_uuid(),
  form_key text not null check (form_key ~ '^[a-z][a-z0-9_]{0,40}$'),
  entity_key text not null check (entity_key ~ '^[a-z][a-z0-9_]{0,40}$'),
  data jsonb not null check (jsonb_typeof(data) = 'object' and length(data::text) <= 20000),
  status text not null default 'new' check (status in ('new', 'contacted', 'done', 'archived')),
  fingerprint text,
  created_at timestamptz not null default now()
);
create index if not exists site_submissions_entity_idx on public.site_submissions(entity_key, created_at desc);
create index if not exists site_submissions_fingerprint_idx on public.site_submissions(fingerprint, created_at desc);

-- Is the caller a signed-in member? (Email from the verified Supabase session.)
create or replace function public.site_is_member(p_role text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.site_members m
    where m.email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
      and (p_role is null or m.role = p_role)
  );
$$;

alter table public.site_members enable row level security;
alter table public.site_submissions enable row level security;

drop policy if exists "members read members" on public.site_members;
create policy "members read members" on public.site_members for select to authenticated
  using ((select public.site_is_member()));
drop policy if exists "owners add members" on public.site_members;
create policy "owners add members" on public.site_members for insert to authenticated
  with check ((select public.site_is_member('owner')));
drop policy if exists "owners remove members" on public.site_members;
create policy "owners remove members" on public.site_members for delete to authenticated
  using ((select public.site_is_member('owner')));

drop policy if exists "members read submissions" on public.site_submissions;
create policy "members read submissions" on public.site_submissions for select to authenticated
  using ((select public.site_is_member()));
drop policy if exists "members update submissions" on public.site_submissions;
create policy "members update submissions" on public.site_submissions for update to authenticated
  using ((select public.site_is_member()))
  with check ((select public.site_is_member()));
drop policy if exists "owners delete submissions" on public.site_submissions;
create policy "owners delete submissions" on public.site_submissions for delete to authenticated
  using ((select public.site_is_member('owner')));

revoke all on public.site_members from anon, authenticated;
revoke all on public.site_submissions from anon, authenticated;
grant select, insert, delete on public.site_members to authenticated;
grant select, delete on public.site_submissions to authenticated;
grant update (status) on public.site_submissions to authenticated;

-- The only way in for visitors. The app's /api/forms route checks the fields against site.json first.
create or replace function public.site_submit(p_form text, p_entity text, p_data jsonb, p_fingerprint text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_fp text := left(nullif(btrim(p_fingerprint), ''), 128);
begin
  if p_form !~ '^[a-z][a-z0-9_]{0,40}$' or p_entity !~ '^[a-z][a-z0-9_]{0,40}$' then
    raise exception 'Unknown form.' using errcode = '22023';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or p_data = '{}'::jsonb or length(p_data::text) > 20000 then
    raise exception 'The form could not be read.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('site_submit', 0));
  if v_fp is not null and (select count(*) from public.site_submissions s
       where s.fingerprint = v_fp and s.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many requests. Try again later.' using errcode = 'P0429';
  end if;
  if (select count(*) from public.site_submissions s where s.created_at > now() - interval '1 minute') >= 60 then
    raise exception 'The site is busy. Try again in a minute.' using errcode = 'P0429';
  end if;
  insert into public.site_submissions(form_key, entity_key, data, fingerprint)
  values (p_form, p_entity, p_data, v_fp)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.site_submit(text, text, jsonb, text) from public;
revoke all on function public.site_is_member(text) from public;
grant execute on function public.site_submit(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.site_is_member(text) to anon, authenticated;
